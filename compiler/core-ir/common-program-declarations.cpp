// SPDX-License-Identifier: MIT
#include "common-program-syntax.h"
#include "llvm/ADT/STLExtras.h"
namespace tsfg::commonProgram {
namespace {
Json span(const Json &v){return Object{{"start",field(v,"start")},{"end",field(v,"end")}};}
bool primitive(SourceModel &m,const Json &t){
  const auto id=string(field(t,"id")),kind=string(field(t,"kind")),name=string(field(t,"name"));
  if(kind=="undefined"||kind=="null"||kind=="void"||kind=="unknown")return m.need(id==kind&&field(t,"constructor").getAsNull(),"absence/unknown raw type identity differs");
  if(kind=="scalar"||kind=="string")return m.need(id==name&&
    (kind=="string"?name=="string":llvm::is_contained(llvm::ArrayRef<llvm::StringRef>{"bool","i8","i16","i32","i64","u8","u16","u32","u64","isize","usize","f32","f64"},name))&&
    string(field(t,"sourcePath"))==string(field(m.payload,"sourceRoot"))+"/minimal-arrays-v8.d.ts"&&field(t,"constructor").getAsNull(),"fixed primitive raw type differs");
  if(kind=="array"||kind=="readSpan")return m.need(m.types.count(string(field(t,"elementType")))&&id==kind+"<"+string(field(t,"elementType"))+">"&&field(t,"constructor").getAsNull()&&
    string(field(t,"sourcePath"))==string(field(m.payload,"sourceRoot"))+"/minimal-arrays-v8.d.ts","container raw type identity differs");
  if(kind=="union"){
    std::string expected="union<",previous;const auto &members=items(field(t,"members"));if(!m.need(members.size()>=2&&field(t,"constructor").getAsNull(),"raw union bound differs"))return false;
    for(const auto &v:members){const auto id=string(v);if(!m.spend()||!m.need(m.types.count(id)&&string(field(*m.types.at(id),"kind"))!="union"&&(previous.empty()||previous<id),"raw union membership/order differs"))return false;
      if(!previous.empty())expected+=",";expected+=id;previous=id;}return m.need(id==expected+">","raw union identity differs");
  }
  return false;
}
bool construction(SourceModel &m,const Json &t){
  const auto id=string(field(t,"id")),base=string(field(t,"base"));const auto &c=field(t,"construction"),&ctor=field(t,"constructor");
  const bool explicitBody=!ctor.getAsNull();const auto &originOwner=explicitBody?ctor:t;
  const Json origin=Object{{"source",field(originOwner,"sourcePath")},{"start",field(field(originOwner,"declarationRange"),"start")},{"end",field(field(originOwner,"declarationRange"),"end")}};
  if(!m.spend()||!m.need(string(field(c,"id"))==id+".ctor"&&string(field(c,"kind"))==(explicitBody?"explicit":base.empty()?"implicit-base":"implicit-derived")&&
    string(field(c,"initializationPhase"))==(base.empty()?"before-body":"after-successful-super")&&same(field(c,"origin"),origin)&&
    llvm::is_contained(llvm::ArrayRef<llvm::StringRef>{"public","protected","private"},string(field(c,"access"))),"construction kind/origin/phase/access differs"))return false;
  if(explicitBody&&!m.need(string(field(ctor,"ownerType"))==id&&string(field(ctor,"returnType"))==id&&string(field(ctor,"name"))=="constructor"&&
    same(field(c,"access"),field(ctor,"access")),"construction body owner/access differs"))return false;
  std::vector<const Json *> normalFields;Array expected;
  if(!m.spend(items(field(t,"fields")).size()))return false;
  for(const auto &f:items(field(t,"fields")))if(field(f,"parameterBinding").getAsNull())normalFields.push_back(&f);
  std::sort(normalFields.begin(),normalFields.end(),[](const Json *a,const Json *b){return field(field(*a,"origin"),"start").getAsInteger()<field(field(*b,"origin"),"start").getAsInteger();});
  for(const auto *f:normalFields)expected.push_back(field(*f,"id"));
  for(const auto &p:items(field(ctor,"parameters")))for(const auto &f:items(field(t,"fields"))){if(!m.spend())return false;
    if(same(field(f,"parameterBinding"),field(p,"id")))expected.push_back(field(f,"id"));}
  if(!m.need(same(Json(std::move(expected)),field(c,"initializationFields"))&&items(field(c,"initializationFields")).size()==items(field(t,"fields")).size(),"construction initialization fields differ from original ordered declarations"))return false;
  const auto &sig=field(c,"signature");const auto path=string(field(sig,"sourcePath"));const auto &params=items(field(c,"parameters"));Array parameterTypes;
  for(const auto &p:params){if(!m.spend()||!m.need(m.types.count(string(field(p,"type"))),"construction parameter type missing"))return false;parameterTypes.push_back(field(p,"type"));}
  if(!m.need(m.sources.count(path)&&string(field(sig,"id"))==digest(std::string("tsfg.array-facts.signature.v8")+std::string(1,'\0')+
    canonical(Object{{"sourcePath",path},{"declarationRange",field(sig,"declarationRange")}}))&&string(field(sig,"returnType"))==id&&
    same(Json(std::move(parameterTypes)),field(sig,"parameters")),"construction signature identity/types differ"))return false;
  const Json *declaration=&t;std::set<std::string> seen;auto ancestor=base;
  while(!explicitBody&&!ancestor.empty()){
    if(!m.spend()||!m.need(m.types.count(ancestor)&&seen.insert(ancestor).second,"construction inheritance cycle/unowned base"))return false;
    const auto *parent=m.types.at(ancestor);if(!field(*parent,"constructor").getAsNull()){declaration=parent;break;}ancestor=string(field(*parent,"base"));
  }
  const auto &signatureOwner=field(*declaration,"constructor").getAsNull()?*declaration:field(*declaration,"constructor");
  if(!m.need(same(field(sig,"sourcePath"),field(signatureOwner,"sourcePath"))&&same(field(sig,"declarationRange"),field(signatureOwner,"declarationRange")),"construction signature does not join original declaration"))return false;
  if(!explicitBody&&!base.empty()){
    // Forwarding carries M12 member mappings. It needs that business verifier,
    // rather than trusting the producer's compatibility flags as a proof.
    return m.need(false,"implicit-derived construction witness is not supported by this common Source consumer");
  }
  if(!m.need(field(c,"implicitForward").getAsNull()&&params.size()==items(field(ctor,"parameters")).size()&&
    (explicitBody||string(field(c,"access"))=="public"),"base construction parameters/access/forwarding differs"))return false;
  for(size_t i=0;i<params.size();++i){const auto &p=params[i],&declared=items(field(ctor,"parameters"))[i];
    if(!m.spend()||!m.need(same(field(p,"symbol"),field(declared,"id"))&&same(field(p,"type"),field(declared,"declaredType"))&&
      string(field(p,"inheritedFrom")).empty()&&same(field(p,"origin"),Object{{"source",field(ctor,"sourcePath")},
        {"start",field(field(declared,"declarationRange"),"start")},{"end",field(field(declared,"declarationRange"),"end")}}),"construction parameter does not join original declaration"))return false;
  }
  return true;
}
bool nominal(SourceModel &m,SourceBodies &b,SourceSyntax &s,const Json &t){
  const auto id=string(field(t,"id")),kind=string(field(t,"kind")),path=string(field(t,"sourcePath"));const auto &key=field(t,"nominalKey");
  if(!construction(m,t))return false;
  if(!m.need((kind=="value"||kind=="reference")&&id=="nominal:"+digest(std::string("tsfg.array-facts.nominal.v8")+std::string(1,'\0')+canonical(key)).substr(7)&&
    string(field(key,"sourcePath"))==path&&items(field(key,"declarationPath")).size()==1&&string(items(field(key,"declarationPath"))[0])==string(field(t,"name")),"nominal declaration identity differs"))return false;
  Array files;for(const auto &f:items(field(m.payload,"files"))){if(!m.spend())return false;files.push_back(Object{{"path",field(f,"path")},{"sha256",field(f,"sha256")}});}
  if(!m.need(string(field(t,"runtimeKey"))==digest(std::string("tsfg.array-facts.runtime-class.v8")+std::string(1,'\0')+canonical(Object{{"files",std::move(files)},{"nominalKey",key}})),"current nominal runtime identity differs"))return false;
  size_t a,z,n,ne;if(!s.span(field(t,"declarationRange"),a,z)||!s.span(field(t,"nameRange"),n,ne)||!s.name(field(t,"nameRange"),string(field(t,"name"))))return false;
  std::vector<Json> pieces;std::vector<std::string> header;for(auto i=a;i<n;++i){if(!m.spend())return false;header.push_back(s.tokens[i].text);pieces.push_back(s.tokens[i].text);}
  if(!m.need(!header.empty()&&header.back()=="class"&&llvm::all_of(header,[](const std::string &v){return v=="@"||v=="tsfgValue"||v=="tsfgComponent"||v=="export"||v=="default"||v=="class";}),"nominal Source header capability differs"))return false;
  const auto &marker=field(t,"markerOrigin");
  if(!marker.getAsNull()){
    const auto dts=string(field(m.payload,"sourceRoot"))+"/minimal-arrays-v8.d.ts";
    const auto expected=kind=="value"?"tsfgValue":"tsfgComponent";
    if(!m.need(string(field(key,"category"))==(kind=="value"?"value":"component")&&string(field(marker,"declarationPath"))==dts&&
      string(field(marker,"declarationSha256"))=="sha256:0d30a2f626bb7455decf36f5a7a8d3308d4254100d2cb10e7c0d2353d28b141e"&&
      string(field(marker,"version"))=="minimal-arrays-v8"&&string(field(marker,"contextName"))=="ClassDecoratorContext"&&field(marker,"contextArity").getAsInteger()==1&&
      string(field(marker,"mode"))=="standard"&&string(field(marker,"entryId"))==digest(std::string("tsfg.array-facts.marker.v8")+std::string(1,'\0')+
        canonical(Object{{"sourcePath",dts},{"declarationRange",field(marker,"declarationRange")}})),"official nominal marker authority differs")||
      !s.sequence(field(marker,"range"),{Json("@"),Json(expected)}))return false;
  }else if(!m.need(kind=="reference"&&string(field(key,"category"))=="reference","nominal value marker missing"))return false;
  pieces.push_back(field(t,"nameRange"));
  const auto base=string(field(t,"base"));
  if(!base.empty()){
    if(!m.need(kind=="reference"&&m.types.count(base)&&string(field(*m.types.at(base),"kind"))=="reference","invalid nominal base"))return false;
    pieces.push_back("extends");pieces.push_back(field(*m.types.at(base),"name"));
  }
  pieces.push_back("{");std::vector<Json> members;std::set<std::string> fields;
  const Json owner=Object{{"id",id},{"ownerType",id},{"sourcePath",path}};b.current=&owner;b.source=&s;
  if(!b.setScope(b.visible.at(path)))return false;b.initialized.clear();
  for(const auto &f:items(field(t,"fields"))){
    if(!m.spend()||!m.need(m.types.count(string(field(f,"type")))&&fields.insert(string(field(f,"id"))).second&&string(field(field(f,"origin"),"source"))==path,"field type/identity/source differs"))return false;
    if(!field(f,"parameterBinding").getAsNull())continue;
    const auto r=span(field(f,"origin"));size_t fa,fb;if(!s.span(r,fa,fb))return false;
    size_t cursor=fa;std::vector<Json> fp;bool readonly=false;std::string access="public";
    while(cursor<fb&&(s.tokens[cursor].text=="public"||s.tokens[cursor].text=="private"||s.tokens[cursor].text=="protected"||s.tokens[cursor].text=="readonly"||s.tokens[cursor].text=="declare")){
      if(s.tokens[cursor].text=="readonly")readonly=true;else if(s.tokens[cursor].text!="declare")access=s.tokens[cursor].text;fp.push_back(s.tokens[cursor++].text);
    }
    if(!m.need(cursor<fb&&s.tokens[cursor].text==string(field(f,"name"))&&field(f,"readonly").getAsBoolean()==readonly&&string(field(f,"access"))==access,"original field name/modifiers differ"))return false;
    Json name=Object{{"start",int64_t(s.tokens[cursor].start)},{"end",int64_t(s.tokens[cursor].end)}};
    if(!s.name(name,string(field(f,"name"))))return false;fp.push_back(name);++cursor;
    if(!m.need(string(field(f,"id"))==digest(std::string("tsfg.array-facts.field.v8")+std::string(1,'\0')+canonical(Object{{"sourcePath",path},{"nameRange",name}}))&&cursor<fb&&s.tokens[cursor++].text==":","original field identity/annotation differs"))return false;
    size_t annotationEnd=fb;if(s.tokens[annotationEnd-1].text==";")--annotationEnd;
    if(!field(f,"initializer").getAsNull()){
      size_t ia,ib;if(!s.span(field(field(f,"initializer"),"range"),ia,ib)||!m.need(ia>cursor&&s.tokens[ia-1].text=="=","field initializer punctuation differs"))return false;
      annotationEnd=ia-1;if(!b.expression(field(f,"initializer"))||!m.need(b.logical(string(field(field(f,"initializer"),"flowType")),string(field(f,"type"))),"field initializer slot differs"))return false;
    }
    if(!m.need(cursor<annotationEnd,"original field type missing"))return false;
    Json annotation=Object{{"start",int64_t(s.tokens[cursor].start)},{"end",int64_t(s.tokens[annotationEnd-1].end)}};
    if(!b.annotation(annotation,string(field(f,"type"))))return false;fp.push_back(":");fp.push_back(annotation);
    if(!field(f,"initializer").getAsNull()){fp.push_back("=");fp.push_back(field(field(f,"initializer"),"range"));}
    if(!s.sequence(r,fp,true))return false;members.push_back(r);
  }
  for(const auto &id:items(field(t,"methods"))){if(!m.spend()||!m.need(m.functions.count(string(id)),"nominal method missing"))return false;members.push_back(field(*m.functions.at(string(id)),"declarationRange"));}
  if(!field(t,"constructor").getAsNull())members.push_back(field(field(t,"constructor"),"declarationRange"));
  std::sort(members.begin(),members.end(),[](const Json &a,const Json &b){return field(a,"start").getAsInteger()<field(b,"start").getAsInteger();});
  for(const auto &r:members)pieces.push_back(r);pieces.push_back("}");
  return s.sequence(field(t,"declarationRange"),pieces);
}
}
bool verifyCommonDeclarations(SourceModel &m,SourceBodies &b,std::map<std::string,SourceSyntax> &syntax,std::map<std::string,std::vector<Json>> &coverage){
  std::string previous;
  for(const auto &row:items(field(m.payload,"types"))){const auto id=string(field(row,"id")),kind=string(field(row,"kind"));
    if(!m.spend()||!m.need(previous.empty()||previous<id,"raw type directory order differs"))return false;previous=id;
    if(kind=="value"||kind=="reference"){
      const auto path=string(field(row,"sourcePath"));if(!m.need(syntax.count(path),"nominal source missing")||!nominal(m,b,syntax.at(path),row))return false;
      coverage[path].push_back(field(row,"declarationRange"));
    }else if(!primitive(m,row))return m.need(false,"unsupported raw type category");
  }
  return true;
}
} // namespace tsfg::commonProgram
