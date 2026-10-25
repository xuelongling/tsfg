// SPDX-License-Identifier: MIT
#include "common-program-syntax.h"
#include "llvm/ADT/APInt.h"
#include "llvm/ADT/APFloat.h"
#include "llvm/ADT/SmallString.h"
#include "llvm/ADT/STLExtras.h"
#include "llvm/Support/Error.h"
namespace tsfg::commonProgram {
namespace {
std::string flow(const Json &v){return string(field(v,"flowType"));}
bool scalar(const SourceModel &m,const std::string &id){auto i=m.types.find(id);return i!=m.types.end()&&string(field(*i->second,"kind"))=="scalar";}
bool assignment(SourceModel &m,const std::string &from,const std::string &to){
  if(from==to)return true;if(!m.spend()||!m.types.count(from)||!m.types.count(to))return false;
  const auto &wanted=*m.types.at(to),&actual=*m.types.at(from);
  if(string(field(wanted,"kind"))=="union"){
    if(string(field(actual,"kind"))=="union"){
      for(const auto &a:items(field(actual,"members")))if(!assignment(m,string(a),to))return false;return true;
    }
    for(const auto &a:items(field(wanted,"members")))if(assignment(m,from,string(a)))return true;return false;
  }
  std::set<std::string> seen;auto current=from;
  while(m.types.count(current)&&seen.insert(current).second){if(!m.spend())return false;current=string(field(*m.types.at(current),"base"));if(current==to)return true;}
  return false;
}
bool literal(SourceBodies &b,const Json &v){
  auto &m=b.model;const auto kind=string(field(v,"kind")),type=string(field(v,"type"));
  if(kind=="numericLiteral"){
    const auto token=string(field(v,"token"));if(!b.source->sequence(field(v,"range"),{Json(token)}))return false;
    std::string digits;for(char c:token)if(c!='_')digits+=c;
    if(type=="f32"||type=="f64"){
      llvm::APFloat number(type=="f32"?llvm::APFloat::IEEEsingle():llvm::APFloat::IEEEdouble());
      auto status=number.convertFromString(digits,llvm::APFloat::rmNearestTiesToEven);
      if(!status){llvm::consumeError(status.takeError());return m.need(false,"original floating literal differs");}
      llvm::SmallString<32> out;number.bitcastToAPInt().toString(out,16,false,false);std::string hex=out.str().lower();
      hex.insert(0,(type=="f32"?8:16)-hex.size(),'0');return m.need(hex==string(field(v,"bits")),"exact original floating bits differ");
    }
    llvm::APInt number;if(!m.need(scalar(m,type)&&type!="bool"&&!llvm::StringRef(digits).getAsInteger(0,number),"original integer literal differs"))return false;
    const unsigned width=(type=="isize"||type=="usize"||type=="i64"||type=="u64")?64:type=="i32"||type=="u32"?32:type=="i16"||type=="u16"?16:8;
    llvm::SmallString<80> out;number.toString(out,10,false,false);
    return m.need(out==string(field(v,"decimal"))&&number.getActiveBits()<=(type.front()=='i'?width-1:width),"original integer decimal/range differs");
  }
  if(kind=="booleanLiteral")return m.need(type=="bool"&&(string(field(v,"token"))=="true"||string(field(v,"token"))=="false"),"original boolean type differs")&&b.source->sequence(field(v,"range"),{field(v,"token")});
  if(kind=="undefinedLiteral"||kind=="nullLiteral")return m.need(type==(kind=="undefinedLiteral"?"undefined":"null"),"absence literal type differs")&&b.source->sequence(field(v,"range"),{Json(type)});
  if(kind!="stringLiteral")return false;
  size_t a,z;if(!b.source->span(field(v,"range"),a,z)||!m.need(z==a+1&&type=="string","original String token/type differs"))return false;
  const auto &token=b.source->tokens[a];const auto raw=std::u16string_view(b.source->content).substr(token.start,token.end-token.start);
  if(!m.need(raw.size()>=2&&(raw.front()=='\''||raw.front()=='"')&&raw.back()==raw.front(),"original String quoting differs"))return false;
  Array units;const auto digit=[](char16_t c){return c>='0'&&c<='9'?c-'0':c>='a'&&c<='f'?c-'a'+10:c>='A'&&c<='F'?c-'A'+10:-1;};
  for(size_t n=1;n+1<raw.size();++n){if(!m.spend())return false;uint32_t c=raw[n];
    if(c=='\\'){
      if(!m.need(++n+1<raw.size(),"original String escape differs"))return false;c=raw[n];
      if(c=='n')c=10;else if(c=='r')c=13;else if(c=='t')c=9;else if(c=='b')c=8;else if(c=='f')c=12;else if(c=='v')c=11;else if(c=='0')c=0;
      else if(c=='x'||c=='u'){
        const bool braced=c=='u'&&n+1<raw.size()&&raw[n+1]=='{';unsigned count=c=='x'?2:4;if(braced){++n;count=0;}
        uint32_t value=0;unsigned consumed=0;
        while(n+1<raw.size()&&digit(raw[n+1])>=0&&(braced||consumed<count)){
          if(!m.need(++consumed<=6,"String escape length"))return false;value=value*16+digit(raw[++n]);
        }
        if(!m.need(braced?consumed>0&&n+1<raw.size()&&raw[++n]=='}':consumed==count,"original String hexadecimal escape differs"))return false;c=value;
      }
    }
    if(!m.need(c<=0x10ffff,"String code point limit"))return false;
    if(c>65535){c-=65536;units.push_back(int64_t(0xd800+(c>>10)));units.push_back(int64_t(0xdc00+(c&1023)));}
    else units.push_back(int64_t(c));
  }
  return m.need(same(Json(std::move(units)),field(v,"codeUnits")),"original UTF16 String payload differs");
}
}
bool SourceBodies::expression(const Json &v,bool target){
  if(!model.spend())return false;size_t a,b;if(!source->span(field(v,"range"),a,b))return false;
  const auto kind=string(field(v,"kind")),type=string(field(v,"type")),actual=flow(v);
  if(!model.need(model.types.count(type)&&(target||model.types.count(actual)),"expression type catalogue membership differs"))return false;
  if(!target){
    const auto declaredKind=string(field(*model.types.at(type),"kind"));
    if(!model.need(!v.getAsObject()->get("compatibilityRoots"),"M12 expression witness consumption is not supported by this common Source consumer"))return false;
    if(!model.need(logical(actual,type),"expression flow is not a valid declared view")||
      !model.need(!llvm::is_contained(llvm::ArrayRef<llvm::StringRef>{"scalar","string","undefined","null","void"},declaredKind)||actual==type,"primitive declared/flow type differs"))return false;
  }
  const auto sequence=[&](std::vector<Json> parts){return source->sequence(field(v,"range"),parts);};
  const auto child=[&](llvm::StringRef key,bool write=false){return expression(field(v,key),write);};
  if(kind=="bindingReference"||kind=="bindingTarget"){
    const auto id=string(field(v,"binding"));if(!model.need(bindings.count(id)&&resolve(field(v,"range"))==id,"original binding reference resolves to another symbol"))return false;
    const auto &binding=*bindings.at(id);
    return model.need(type==string(field(binding,"declaredType"))&&(!target||field(binding,"writable").getAsBoolean()==true)&&
      (model.globals.count(id)||initialized.count(id)),"binding view/mutability/initialization differs");
  }
  if(kind=="thisReference")return model.need(string(field(*current,"ownerType"))==type,"this nominal owner differs")&&sequence({Json("this")});
  if(llvm::StringRef(kind).ends_with("Literal")&&kind!="arrayLiteral")return model.need(actual==type,"literal flow type differs")&&literal(*this,v);
  if(kind=="parentheses")return child("expression")&&model.need(type==string(field(field(v,"expression"),"type"))&&actual==flow(field(v,"expression")),"parenthesized type/flow differs")&&sequence({Json("("),field(field(v,"expression"),"range"),Json(")")});
  if(kind=="as")return child("expression")&&model.need(assertion(flow(field(v,"expression")),actual),"assertion changes unsupported numeric or nominal view")&&annotation(field(v,"annotationRange"),type)&&source->sequence(field(v,"operatorRange"),{Json("as")})&&
    sequence({field(field(v,"expression"),"range"),Json("as"),field(v,"annotationRange")});
  if(kind=="nonNull")return child("expression")&&source->sequence(field(v,"operatorRange"),{Json("!")})&&sequence({field(field(v,"expression"),"range"),Json("!")});
  if(v.getAsObject()->get("allocationSite")){
    if(!model.need(string(field(v,"allocationSite"))==digest(std::string("tsfg.array-facts.allocation.v8")+std::string(1,'\0')+
      canonical(Object{{"sourcePath",field(*current,"sourcePath")},{"declarationRange",field(v,"range")}})),"original allocation site identity differs"))return false;
  }
  const auto op=string(field(v,"operator"));
  if(v.getAsObject()->get("operatorRange")&&!source->sequence(field(v,"operatorRange"),{Json(op.empty()?"+":op)}))return false;
  if(kind=="unary")return child("expression")&&model.need(scalar(model,type)&&llvm::is_contained(llvm::ArrayRef<llvm::StringRef>{"+","-","!","~"},op),"unary operator/type differs")&&sequence({Json(op),field(field(v,"expression"),"range")});
  if(kind=="binary"||kind=="stringConcat")return child("left")&&child("right")&&
    model.need(kind=="stringConcat"?type=="string":llvm::is_contained(llvm::ArrayRef<llvm::StringRef>{"+","-","*","/","%","<<",">>",">>>","&","|","^","===","!==","<","<=",">",">=","&&","||","??"},op),"binary operator/type differs")&&
    sequence({field(field(v,"left"),"range"),Json(op.empty()?"+":op),field(field(v,"right"),"range")});
  if(kind=="arrayLiteral"){
    if(!model.need(string(field(*model.types.at(type),"kind"))=="array","Array literal catalogue kind differs"))return false;
    const auto element=string(field(*model.types.at(type),"elementType"));std::vector<Json> pieces{Json("[")};size_t i=0;
    for(const auto &e:items(field(v,"elements"))){if(!expression(e)||!model.need(logical(flow(e),element),"Array literal element type differs"))return false;
      if(i++)pieces.push_back(",");pieces.push_back(field(e,"range"));}pieces.push_back("]");return sequence(pieces);
  }
  if(kind=="checkedElementAccess"||kind=="elementTarget"){
    if(!child("receiver")||!child("index"))return false;const auto &receiver=*model.types.at(flow(field(v,"receiver")));
    return model.need((string(field(receiver,"kind"))=="array"||!target&&string(field(receiver,"kind"))=="readSpan")&&
      string(field(receiver,"elementType"))==type&&flow(field(v,"index"))=="u32","element owner/index/result type differs")&&
      sequence({field(field(v,"receiver"),"range"),Json("["),field(field(v,"index"),"range"),Json("]")});
  }
  if(kind=="fieldAccess"||kind=="fieldTarget"||kind=="arrayLength"||kind=="readSpanLength"||kind=="lengthTarget"){
    if(!child("receiver"))return false;const auto receiver=flow(field(v,"receiver")),property=string(field(v,"property"));
    auto owner=receiver;const Json *found=nullptr;std::set<std::string> seen;
    if(kind=="fieldAccess"||kind=="fieldTarget"){
      while(model.types.count(owner)&&seen.insert(owner).second){if(!model.spend())return false;const auto &t=*model.types.at(owner);
        for(const auto &f:items(field(t,"fields"))){if(!model.spend())return false;if(string(field(f,"id"))==property){found=&f;break;}}
        if(found)break;owner=string(field(t,"base"));
      }
      if(!model.need(found&&string(field(*found,"type"))==type,"member field identity/type differs"))return false;
      const auto access=string(field(*found,"access")),fnOwner=string(field(*current,"ownerType"));
      if(!model.need(access=="public"||access=="private"&&fnOwner==owner||access=="protected"&&assignment(model,fnOwner,owner),"member access permission differs"))return false;
      if(target&&!model.need(field(*found,"readonly").getAsBoolean()==false||fnOwner==owner&&string(field(field(*model.types.at(owner),"constructor"),"id"))==string(field(*current,"id"))&&string(field(field(v,"receiver"),"kind"))=="thisReference","readonly member write differs"))return false;
      if(!source->name(field(v,"nameRange"),string(field(*found,"name"))))return false;
    }else{
      const auto ownerKind=string(field(*model.types.at(receiver),"kind"));
      if(!model.need(type=="u32"&&(ownerKind=="array"||!target&&ownerKind=="readSpan")&&property==string(field(field(model.payload,ownerKind=="array"?"arrayLength":"readSpanLength"),"id")),"length catalogue identity/type differs")||!source->name(field(v,"nameRange"),"length"))return false;
    }
    return sequence({field(field(v,"receiver"),"range"),Json("."),field(v,"nameRange")});
  }
  if(llvm::StringRef(kind).ends_with("Assignment")){
    if(!child("target",true)||!child("value")||!model.need(type==string(field(field(v,"target"),"type"))&&logical(flow(field(v,"value")),type),"assignment result/value type differs"))return false;
    return sequence({field(field(v,"target"),"range"),Json(op),field(field(v,"value"),"range")});
  }
  if(llvm::StringRef(kind).ends_with("Update"))return child("target",true)&&model.need(type==string(field(field(v,"target"),"type"))&&(op=="++"||op=="--"),"update type/operator differs")&&
    sequence(field(v,"prefix").getAsBoolean()==true?std::vector<Json>{Json(op),field(field(v,"target"),"range")}:std::vector<Json>{field(field(v,"target"),"range"),Json(op)});
  if(kind=="call"||kind=="new"||kind=="superConstruct"){
    if(v.getAsObject()->get("receiver")&&!child("receiver"))return false;
    const auto &sig=field(v,"signature");const auto callee=string(field(v,"callee")),path=string(field(sig,"sourcePath"));
    if(!model.need(string(field(sig,"id"))==digest(std::string("tsfg.array-facts.signature.v8")+std::string(1,'\0')+
      canonical(Object{{"sourcePath",path},{"declarationRange",field(sig,"declarationRange")}}))&&items(field(sig,"parameters")).size()==items(field(v,"arguments")).size(),"original call signature identity/arity differs"))return false;
    std::vector<Json> pieces;if(kind=="new")pieces.push_back("new");pieces.push_back(field(v,"calleeRange"));pieces.push_back("(");size_t i=0;
    for(const auto &arg:items(field(v,"arguments"))){if(!expression(arg)||!model.need(logical(flow(arg),string(items(field(sig,"parameters"))[i])),"call argument view type differs"))return false;
      if(i++)pieces.push_back(",");pieces.push_back(field(arg,"range"));}pieces.push_back(")");
    if(kind=="call"){
      if(callee==string(field(field(model.payload,"readSpanIntrinsic"),"id"))){
        if(!model.need(items(field(sig,"parameters")).size()==3&&string(items(field(sig,"parameters"))[1])=="u32"&&string(items(field(sig,"parameters"))[2])=="u32","ReadSpan original three-argument signature differs"))return false;
      }else{
        if(!model.need(model.functions.count(callee),"direct call original function missing"))return false;const auto &fn=*model.functions.at(callee);Array expected;
        for(const auto &p:items(field(fn,"parameters")))expected.push_back(field(p,"declaredType"));
        if(!model.need(same(Json(std::move(expected)),field(sig,"parameters"))&&same(field(fn,"returnType"),field(sig,"returnType"))&&
          same(field(fn,"declarationRange"),field(sig,"declarationRange"))&&string(field(fn,"sourcePath"))==path,
          "call signature does not join original declaration"))return false;
        if(field(fn,"ownerType").getAsNull()&&!model.need(resolve(field(v,"calleeRange"))==callee,"direct call spelling resolves to another symbol"))return false;
      }
      if(!model.need(type==string(field(sig,"returnType")),"call result differs from original signature"))return false;
    }else if(!model.need(model.types.count(callee)&&same(field(field(*model.types.at(callee),"construction"),"signature"),sig)&&
      (kind!="new"||model.need(resolve(field(v,"calleeRange"))==callee&&type==callee,"construction spelling resolves to another nominal symbol")),"construction source signature differs"))return false;
    return sequence(pieces);
  }
  return model.need(false,"unsupported complete common Source expression; no partial body admission");
}
bool SourceBodies::logical(const std::string &from,const std::string &to){
  std::function<bool(const std::string &,const std::string &,unsigned)> relation;
  relation=[&](const std::string &a,const std::string &b,unsigned depth){
    if(!model.spend()||!model.need(depth<=128&&model.types.count(a)&&model.types.count(b),"logical relation type/depth differs"))return false;
    if(a==b)return true;const auto &source=*model.types.at(a),&target=*model.types.at(b);
    const auto sk=string(field(source,"kind")),tk=string(field(target,"kind"));
    if(sk=="union"){for(const auto &member:items(field(source,"members")))if(!relation(string(member),b,depth+1))return false;return true;}
    if(tk=="union"){for(const auto &member:items(field(target,"members")))if(relation(a,string(member),depth+1))return true;return false;}
    const auto container=[](const std::string &k){return k=="array"||k=="readSpan";};
    if(container(sk)&&container(tk))return relation(string(field(source,"elementType")),string(field(target,"elementType")),depth+1);
    // Distinct nominal reference slots need the full M12 witness business
    // verifier. This bounded common slice rejects those proofs explicitly.
    return sk=="undefined"&&tk=="void";
  };return relation(from,to,0);
}
bool SourceBodies::assertion(const std::string &from,const std::string &to){
  if(!model.types.count(from)||!model.types.count(to))return false;
  if(string(field(*model.types.at(from),"kind"))=="unknown"||string(field(*model.types.at(to),"kind"))=="unknown")return true;
  const auto container=[](const std::string &k){return k=="array"||k=="readSpan";};
  using Numerics=std::map<unsigned,std::set<std::string>>;
  const auto numerics=[&](const std::string &root,Numerics &out){
    std::vector<std::pair<std::string,unsigned>> pending{{root,0}};std::set<std::pair<std::string,unsigned>> seen;
    while(!pending.empty()){
      auto [id,depth]=std::move(pending.back());pending.pop_back();if(!model.spend()||!model.need(depth<=128&&model.types.count(id),"assertion numeric graph differs"))return false;
      if(!seen.emplace(id,depth).second)continue;const auto &t=*model.types.at(id);const auto k=string(field(t,"kind"));
      if(k=="scalar"&&id!="bool")out[depth].insert(id);
      else if(k=="union")for(const auto &m:items(field(t,"members"))){if(!model.spend())return false;pending.emplace_back(string(m),depth);}
      else if(container(k))pending.emplace_back(string(field(t,"elementType")),depth+1);
    }return true;
  };
  Numerics sourceNumeric,targetNumeric;if(!numerics(from,sourceNumeric)||!numerics(to,targetNumeric))return false;
  for(const auto &[depth,kinds]:sourceNumeric)if(targetNumeric.count(depth)){
    bool overlap=false;for(const auto &id:kinds){if(!model.spend())return false;overlap|=targetNumeric.at(depth).count(id);}
    if(!overlap)return false;
  }
  const auto payload=[&](const Json &t){std::vector<std::string> result;
    if(string(field(t,"kind"))!="union")result.push_back(string(field(t,"id")));
    else for(const auto &m:items(field(t,"members"))){if(!model.spend())return result;if(string(m)!="undefined"&&string(m)!="null")result.push_back(string(m));}return result;};
  std::function<bool(const std::string &,const std::string &,unsigned)> view;
  view=[&](const std::string &a,const std::string &b,unsigned depth){
    if(!model.spend()||!model.need(depth<=128&&model.types.count(a)&&model.types.count(b),"assertion view graph differs"))return false;
    if(a==b)return true;const auto &s=*model.types.at(a),&t=*model.types.at(b);const auto sk=string(field(s,"kind")),tk=string(field(t,"kind"));
    if(tk=="undefined"||tk=="null"||tk=="void")return true;
    if(sk=="union"||tk=="union"){
      const auto sp=payload(s),tp=payload(t);if(!model.error.message.empty())return false;
      if(!model.spend((sp.size()+1)*(tp.size()+1)))return false;
      const auto subset=[](const auto &x,const auto &y){return std::all_of(x.begin(),x.end(),[&](const auto &id){return std::find(y.begin(),y.end(),id)!=y.end();});};
      if(subset(sp,tp)||subset(tp,sp))return true;
      if(sk=="union"){for(const auto &id:sp)if(!view(id,b,depth+1))return false;return true;}
      if(tp.size()==1)return view(a,tp[0],depth+1);
      if(sk=="value"||sk=="reference")return logical(a,b);
    }
    if(container(sk)&&container(tk))return view(string(field(s,"elementType")),string(field(t,"elementType")),depth+1);
    if(sk=="reference"&&tk=="reference")return false;
    return sk!="value"&&tk!="value";
  };return view(from,to,0);
}
} // namespace tsfg::commonProgram
