// SPDX-License-Identifier: MIT
#include "common-program-syntax.h"
#include "formal-exception-identifiers.h"
#include "llvm/Support/ConvertUTF.h"
#include <algorithm>
namespace tsfg::commonProgram {
namespace {
bool space(char16_t c){return c==9||c==10||c==11||c==12||c==13||c==32||c==0xa0||c==0xfeff||c==0x2028||c==0x2029;}
bool nameUnit(char16_t c){return c=='$'||c=='_'||(c>='a'&&c<='z')||(c>='A'&&c<='Z')||(c>='0'&&c<='9')||(c>=128&&!space(c));}
std::string utf8(std::u16string_view s){
  std::string out(s.size()*3,'\0');auto *a=reinterpret_cast<const llvm::UTF16 *>(s.data()),*end=a+s.size();
  auto *b=reinterpret_cast<llvm::UTF8 *>(out.data()),*start=b;
  if(llvm::ConvertUTF16toUTF8(&a,end,&b,b+out.size(),llvm::strictConversion)!=llvm::conversionOK)return {};
  out.resize(b-start);return out;
}
}
bool SourceSyntax::read(llvm::StringRef raw){
  if(!model.need(raw.size()<=1048576,"Source UTF8 byte limit")||!model.spend(raw.size()/16+1))return false;
  content.resize(raw.size());auto *a=reinterpret_cast<const llvm::UTF8 *>(raw.data()),*end=a+raw.size();
  auto *b=reinterpret_cast<llvm::UTF16 *>(content.data()),*start=b;
  if(!model.need(llvm::ConvertUTF8toUTF16(&a,end,&b,b+content.size(),llvm::strictConversion)==llvm::conversionOK,"Source UTF8 differs"))return false;
  content.resize(b-start);size_t at=0;
  while(at<content.size()){
    if(!model.spend())return false;const auto first=at;const auto c=content[at];
    if(space(c)){++at;continue;}
    if(c=='/'&&at+1<content.size()&&content[at+1]=='/'){
      at+=2;while(at<content.size()&&content[at]!=10&&content[at]!=13&&content[at]!=0x2028&&content[at]!=0x2029)++at;continue;
    }
    if(c=='/'&&at+1<content.size()&&content[at+1]=='*'){
      at+=2;while(at+1<content.size()&&!(content[at]=='*'&&content[at+1]=='/'))++at;
      if(!model.need(at+1<content.size(),"unterminated original Source comment"))return false;at+=2;continue;
    }
    if(c=='\''||c=='"'){
      const auto quote=c;++at;bool escaped=false,closed=false;
      while(at<content.size()){
        auto next=content[at++];if(!model.need(next!=10&&next!=13&&next!=0x2028&&next!=0x2029,"unsupported multiline Source string"))return false;
        if(!escaped&&next==quote){closed=true;break;}if(!escaped&&next=='\\')escaped=true;else escaped=false;
      }
      if(!model.need(closed,"unterminated original Source string"))return false;
    }else if(c>='0'&&c<='9'){
      ++at;while(at<content.size()){
        const auto next=content[at];if(nameUnit(next)||next=='.'){++at;continue;}
        if((next=='+'||next=='-')&&at>first&&(content[at-1]=='e'||content[at-1]=='E')){++at;continue;}break;
      }
    }else if(nameUnit(c)){
      ++at;while(at<content.size()&&nameUnit(content[at]))++at;
    }else{
      // TypeScript rescans `>=`/`>>` at concrete type argument boundaries.
      // Punctuation units preserve those boundaries; sequence() proves that a
      // multi-character expression operator is contiguous in the original text.
      if(!model.need(std::u16string(u"{}[]():;,=|@.!?+-*/%~&^<>").find(c)!=std::u16string::npos,
        "original Source contains unsupported lexical token"))return false;++at;
    }
    if(!model.need(tokens.size()<100000,"Source token count exceeded"))return false;
    auto text=utf8(std::u16string_view(content).substr(first,at-first));if(!model.need(!text.empty(),"Source token UTF16 scalar differs"))return false;
    tokens.push_back({std::move(text),uint32_t(first),uint32_t(at)});
  }
  return true;
}
bool SourceSyntax::range(const Json &r,SourceAnchor &out)const{
  const auto a=field(r,"start").getAsInteger(),b=field(r,"end").getAsInteger();
  if(!model.need(exact(r,{"start","end"})&&a&&b&&*a>=0&&*b>*a&&uint64_t(*b)<=content.size(),"original UTF16 range differs"))return false;
  const auto boundary=[&](uint32_t n){return !n||n==content.size()||!(content[n]>=0xdc00&&content[n]<=0xdfff&&content[n-1]>=0xd800&&content[n-1]<=0xdbff);};
  if(!model.need(boundary(*a)&&boundary(*b),"Source range splits UTF16 scalar"))return false;out={uint32_t(*a),uint32_t(*b)};return true;
}
bool SourceSyntax::span(const Json &r,size_t &first,size_t &end)const{
  SourceAnchor a;if(!range(r,a))return false;
  first=std::lower_bound(tokens.begin(),tokens.end(),a.start,[](const SourceToken &t,uint32_t n){return t.start<n;})-tokens.begin();
  end=std::upper_bound(tokens.begin(),tokens.end(),a.end,[](uint32_t n,const SourceToken &t){return n<t.end;})-tokens.begin();
  return model.need(first<end&&first<tokens.size()&&tokens[first].start==a.start&&tokens[end-1].end==a.end,"original token envelope differs");
}
bool SourceSyntax::name(const Json &r,llvm::StringRef name)const{
  size_t a,b;if(!span(r,a,b)||!model.need(b==a+1&&tokens[a].text==name,"original Source identifier spelling differs"))return false;
  const auto &token=tokens[a];bool first=true;
  for(size_t n=token.start;n<token.end;++n){
    if(!model.spend())return false;uint32_t point=content[n];
    if(point>=0xd800&&point<=0xdbff){if(!model.need(n+1<token.end&&content[n+1]>=0xdc00&&content[n+1]<=0xdfff,"identifier Unicode scalar differs"))return false;
      point=0x10000+((point-0xd800)<<10)+(content[++n]-0xdc00);}
    if(!model.need(formalException::identifierPoint(point,first),"original Source identifier Unicode class differs"))return false;first=false;
  }
  return model.need(!first,"empty original Source identifier");
}
bool SourceSyntax::sequence(const Json &r,const std::vector<Json> &parts,bool semicolon)const{
  size_t a,b;if(!span(r,a,b))return false;
  for(const auto &part:parts){if(!model.spend())return false;
    if(auto token=part.getAsString()){
      std::string joined;uint32_t prior=0;
      while(a<b&&joined.size()<token->size()){
        if(!model.spend()||!model.need(joined.empty()||tokens[a].start==prior,"Source operator is not contiguous"))return false;
        joined+=tokens[a].text;prior=tokens[a++].end;
      }
      if(!model.need(joined==*token,"original Source punctuation/operator order differs"))return false;
    }else{size_t child,end;if(!span(part,child,end)||!model.need(child==a&&end<=b,"original Source child order differs"))return false;a=end;}
  }
  if(semicolon&&a<b&&tokens[a].text==";")++a;
  return model.need(a==b,"unrepresented original Source syntax");
}
} // namespace tsfg::commonProgram
