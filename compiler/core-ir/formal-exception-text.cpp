// SPDX-License-Identifier: MIT
#include "formal-exception-source.h"
#include "formal-exception-identifiers.h"
#include "llvm/Support/ConvertUTF.h"
namespace tsfg::formalException {
namespace {
bool space(char16_t c){return c==9||c==10||c==11||c==12||c==13||c==32||c==0xa0||c==0x1680
  ||(c>=0x2000&&c<=0x200a)||c==0x2028||c==0x2029||c==0x202f||c==0x205f||c==0x3000||c==0xfeff;}
void append(uint32_t c,std::string &out){
  if(c<128)out+=char(c);
  else if(c<2048){out+=char(0xc0|(c>>6));out+=char(0x80|(c&63));}
  else if(c<65536){out+=char(0xe0|(c>>12));out+=char(0x80|((c>>6)&63));out+=char(0x80|(c&63));}
  else{out+=char(0xf0|(c>>18));out+=char(0x80|((c>>12)&63));out+=char(0x80|((c>>6)&63));out+=char(0x80|(c&63));}
}
bool nameUnit(char16_t c){return c=='$'||c=='_'||(c>='a'&&c<='z')||(c>='A'&&c<='Z')
  ||(c>='0'&&c<='9')||(c>=128&&!space(c));}
int hex(char16_t c){if(c>='0'&&c<='9')return c-'0';if(c>='a'&&c<='f')return c-'a'+10;if(c>='A'&&c<='F')return c-'A'+10;return -1;}
bool identifier(const std::u16string &raw,size_t &at,std::string &text,Program &p){
  while(at<raw.size()){
    uint32_t point=raw[at];
    if(point=='\\'){
      if(!p.require(at+2<raw.size()&&raw[at+1]=='u',"identifier escape"))return false;
      at+=2;const bool braced=raw[at]=='{';if(braced)++at;point=0;unsigned digits=0;
      while(at<raw.size()&&hex(raw[at])>=0&&(braced||digits<4)){
        if(!p.require(++digits<=6,"identifier escape length"))return false;point=point*16+hex(raw[at++]);
      }
      if(!p.require((braced?digits>0&&at<raw.size()&&raw[at++]=='}':digits==4)&&point<=0x10ffff
        &&!(point>=0xd800&&point<=0xdfff),"identifier Unicode escape"))return false;
    }else{
      if(!nameUnit(raw[at]))break;++at;
      if(point>=0xd800&&point<=0xdbff){if(!p.require(at<raw.size()&&raw[at]>=0xdc00&&raw[at]<=0xdfff,"identifier surrogate"))return false;
        point=0x10000+((point-0xd800)<<10)+(raw[at++]-0xdc00);}
    }
    if(!p.step()||!p.require(identifierPoint(point,text.empty()),"decoded Source identifier code point is invalid at this position"))return false;
    append(point,text);
  }
  return !text.empty();
}
}
bool SourceText::read(llvm::StringRef raw,Program &p){
  if(!p.require(raw.size()<=1048576,"Source text byte limit"))return false;
  content.resize(raw.size());auto *s=reinterpret_cast<const llvm::UTF8 *>(raw.data()),*end=s+raw.size();
  auto *begin=reinterpret_cast<llvm::UTF16 *>(content.data()),*t=begin;
  if(!p.require(llvm::ConvertUTF8toUTF16(&s,end,&t,begin+content.size(),llvm::strictConversion)==llvm::conversionOK,"Source UTF8"))return false;
  content.resize(t-begin);size_t at=0;
  while(at<content.size()){
    if(!p.step())return false;const auto first=at;
    if(space(content[at])){++at;continue;}
    if(content[at]=='/'&&at+1<content.size()&&content[at+1]=='/'){
      at+=2;while(at<content.size()&&content[at]!=10&&content[at]!=13&&content[at]!=0x2028&&content[at]!=0x2029)++at;continue;
    }
    if(content[at]=='/'&&at+1<content.size()&&content[at+1]=='*'){
      at+=2;while(at+1<content.size()&&!(content[at]=='*'&&content[at+1]=='/'))++at;
      if(!p.require(at+1<content.size(),"unterminated Source comment"))return false;at+=2;continue;
    }
    std::string text;
    if(content[at]=='\''||content[at]=='"'){
      const auto quote=content[at++];append(quote,text);bool escaped=false,closed=false;
      while(at<content.size()){
        const auto c=content[at++];append(c,text);
        if(!p.require(c!=10&&c!=13&&c!=0x2028&&c!=0x2029,"multiline Source string"))return false;
        if(!escaped&&c==quote){closed=true;break;}if(!escaped&&c=='\\')escaped=true;else escaped=false;
      }
      if(!p.require(closed,"unterminated Source literal"))return false;
    }else if(content.compare(at,3,u"===")==0||content.compare(at,3,u"!==")==0){
      text=content[at]=='='?"===":"!==";at+=3;
    }else if(content.compare(at,2,u"=>")==0){text="=>";at+=2;}
    else if(nameUnit(content[at])||content[at]=='\\'){
      if(!identifier(content,at,text,p))return false;
    }else{
      if(!p.require(std::u16string(u"{}():;,=|@.!?").find(content[at])!=std::u16string::npos,"unsupported original Source token"))return false;
      text+=char(content[at++]);
    }
    if(!p.require(tokens.size()<100000,"Source token limit"))return false;
    tokens.push_back({std::move(text),uint32_t(first),uint32_t(at)});
  }
  return true;
}
llvm::StringRef SourceText::spelling(size_t at)const{return at<tokens.size()?llvm::StringRef(tokens[at].text):llvm::StringRef();}
bool SourceText::range(const Json &raw,uint32_t &start,uint32_t &end,Program &p)const{
  auto a=field(raw,"start").getAsInteger(),b=field(raw,"end").getAsInteger();
  if(!p.require(exception::exact(raw,{"start","end"})&&a&&b&&*a>=0&&*b>*a&&uint64_t(*b)<=content.size(),"original UTF16 range"))return false;
  start=uint32_t(*a);end=uint32_t(*b);
  auto boundary=[&](uint32_t n){return n==0||n==content.size()||!(content[n]>=0xdc00&&content[n]<=0xdfff&&content[n-1]>=0xd800&&content[n-1]<=0xdbff);};
  return p.require(boundary(start)&&boundary(end),"split Source UTF16 scalar");
}
bool SourceText::span(const Json &raw,size_t first,size_t last,Program &p,bool rawStart)const{
  uint32_t start,end;if(!range(raw,start,end,p))return false;
  return p.require(first<=last&&last<tokens.size()&&end==tokens[last].end
    &&start==(rawStart?(first?tokens[first-1].end:0):tokens[first].start),"original Source token envelope");
}
bool SourceText::expect(size_t &at,llvm::StringRef token,Program &p)const{
  if(!p.step()||!p.require(at<tokens.size()&&spelling(at)==token,"original Source token differs from statement/expression"))return false;++at;return true;
}
bool SourceText::name(size_t &at,llvm::StringRef name,const Json &range,Program &p,bool trimmed)const{
  const std::string reserved=" break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with implements interface let package private protected public static yield await eval arguments ";
  if(!p.require(at<tokens.size()&&!name.empty()&&!(name.front()>='0'&&name.front()<='9')
    &&reserved.find(" "+name.str()+" ")==std::string::npos&&spelling(at)==name,"original Source identifier spelling"))return false;
  const auto &token=tokens[at];uint32_t start,end;
  if(!this->range(range,start,end,p)||!p.require(end==token.end&&start==(trimmed?token.start:(at?tokens[at-1].end:0)),
    "original declaration/reference anchor"))return false;++at;return true;
}
}
