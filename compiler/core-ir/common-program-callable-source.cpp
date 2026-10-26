// SPDX-License-Identifier: MIT
#include "common-program-syntax.h"
#include <algorithm>
#include <optional>
namespace tsfg::commonProgram {
bool SourceBodies::aliases(std::map<std::string,std::vector<Json>> &coverage){
  std::optional<std::pair<std::string,int64_t>> previous;
  for(const auto &a:items(field(model.payload,"typeAliases"))){
    const auto id=string(field(a,"id")),path=string(field(a,"sourcePath")),type=string(field(a,"type"));
    const auto order=std::pair{path,field(field(a,"declarationRange"),"start").getAsInteger().value_or(-1)};
    if(!model.spend()||!model.need((!previous||*previous<order)&&model.sources.count(path)&&syntax.count(path)&&model.types.count(type),"type alias directory identity/order differs"))return false;
    previous=order;source=&syntax.at(path);if(!setScope(visible.at(path)))return false;
    if(!model.need(id==digest(std::string("tsfg.array-facts.binding.v1")+std::string(1,'\0')+canonical(Object{{"sourcePath",path},{"nameRange",field(a,"nameRange")}})),"type alias original Symbol identity differs")||
      !source->name(field(a,"nameRange"),string(field(a,"name")))||!annotation(field(a,"annotationRange"),type)||
      !source->sequence(field(a,"declarationRange"),{Json("type"),field(a,"nameRange"),Json("="),field(a,"annotationRange")},true))return false;
    coverage[path].push_back(field(a,"declarationRange"));
  }
  return true;
}
bool SourceBodies::lexicalScope(const Json &fn){
  captureOccurrences.clear();nestedDeclarations.clear();std::vector<const Json *> chain;std::set<std::string> seen;
  auto parent=string(field(fn,"lexicalParent"));
  while(!parent.empty()){
    if(!model.spend()||!model.need(model.functions.count(parent)&&seen.insert(parent).second,"lexical Source parent cycle or missing declaration"))return false;
    const auto *ancestor=model.functions.at(parent);
    if(!model.need(same(field(fn,"sourcePath"),field(*ancestor,"sourcePath")),"lexical parent Source path differs"))return false;
    chain.push_back(ancestor);parent=string(field(*ancestor,"lexicalParent"));
  }
  const auto layer=[&](const Json &owner,bool parameters){
    if(parameters)for(const auto &b:items(field(owner,"parameters"))){
      if(!model.spend())return false;scope[string(field(b,"name"))]=string(field(b,"id"));
    }
    // Only declarations in the original function body belong to this lexical
    // layer. Block/catch locals are never hoisted into a nested function.
    for(const auto &row:items(field(owner,"body"))){
      if(!model.spend())return false;const auto kind=string(field(row,"kind"));
      if(parameters&&(kind=="letDeclaration"||kind=="constDeclaration")){
        const auto id=string(field(row,"binding"));
        if(!model.need(bindings.count(id)&&same(field(*bindings.at(id),"lexicalOwner"),field(owner,"id")),"function-body declaration has a foreign binding"))return false;
        scope[string(field(*bindings.at(id),"name"))]=id;
      }else if(kind=="functionDeclaration"){
        const auto id=string(field(row,"functionId"));
        if(!model.need(model.functions.count(id)&&same(field(*model.functions.at(id),"lexicalParent"),field(owner,"id"))&&same(field(*model.functions.at(id),"declarationRange"),field(row,"range")),"nested declaration has a foreign lexical parent or range"))return false;
        scope[string(field(*model.functions.at(id),"name"))]=id;
      }
    }
    return true;
  };
  for(auto ancestor=chain.rbegin();ancestor!=chain.rend();++ancestor)if(!layer(**ancestor,true))return false;
  if(!layer(fn,false))return false;
  for(const auto &c:items(field(fn,"captures"))){
    const auto id=string(field(c,"binding"));if(!model.spend()||!model.need(bindings.count(id),"captured Source binding is absent"))return false;
    const auto &b=*bindings.at(id);const auto owner=string(field(b,"lexicalOwner"));bool ancestor=false;
    for(const auto *f:chain){if(!model.spend())return false;ancestor|=string(field(*f,"id"))==owner;}
    const auto type=string(field(b,"declaredType"));
    const auto role=string(field(b,"kind"));
    if(!model.need(ancestor&&model.types.count(type),"captured binding owner or type is absent"))return false;
    const auto kind=string(field(*model.types.at(type),"kind"));
    if(!model.need((role=="local"&&(kind=="scalar"||kind=="readSpan"))||(role=="parameter"&&kind=="readSpan"),
      "unsupported capture outside initialized function-body scalar/ReadSpan local or ReadSpan parameter"))return false;
    bool declaration=false;
    if(role=="parameter")for(const auto &parameter:items(field(*model.functions.at(owner),"parameters"))){
      if(!model.spend())return false;declaration|=string(field(parameter,"id"))==id;
    }else for(const auto &row:items(field(*model.functions.at(owner),"body"))){if(!model.spend())return false;
      const auto declarationKind=string(field(row,"kind"));declaration|=(declarationKind=="letDeclaration"||declarationKind=="constDeclaration")&&string(field(row,"binding"))==id&&row.getAsObject()->get("initializer");}
    if(!model.need(declaration,"capture lacks an original initialized body declaration or parameter"))return false;
    // This is a lexical incoming precondition, not an initialization proof.
    // The independent normalized environment CFG must establish it at use.
    initialized.insert(id);
  }
  return true;
}
bool SourceBodies::capture(const Json &v,bool read,bool write){
  const auto binding=string(field(v,"binding"));if(!model.need(bindings.count(binding),"captured identifier has no owned original binding"))return false;
  const auto &b=*bindings.at(binding);const auto owner=string(field(b,"lexicalOwner")),fn=string(field(*current,"id"));
  if(owner.empty()||owner==fn)return true;
  if(!model.spend()||!model.need(initialized.count(binding),"foreign binding lacks a lexical capture precondition"))return false;
  captureOccurrences[binding].push_back(Object{{"range",field(v,"range")},{"read",read},{"write",write}});return true;
}
bool SourceBodies::captures(){
  Array rebuilt;for(auto &[binding,occurrences]:captureOccurrences){
    size_t rounds=1;for(size_t n=occurrences.size();n>1;n=(n+1)/2)++rounds;
    if(!model.spend(occurrences.size()*(rounds+1)))return false;
    std::sort(occurrences.begin(),occurrences.end(),[](const Json &a,const Json &b){return field(field(a,"range"),"start").getAsInteger()<field(field(b,"range"),"start").getAsInteger();});
    bool read=false,write=false;for(const auto &o:occurrences){if(!model.spend())return false;read|=field(o,"read").getAsBoolean()==true;write|=field(o,"write").getAsBoolean()==true;}
    rebuilt.push_back(Object{{"binding",binding},{"read",read},{"write",write},{"occurrences",Json(Array(occurrences))}});
  }
  size_t rounds=1;for(size_t n=rebuilt.size();n>1;n=(n+1)/2)++rounds;if(!model.spend(rebuilt.size()*rounds))return false;
  std::sort(rebuilt.begin(),rebuilt.end(),[](const Json &a,const Json &b){
    return field(field(items(field(a,"occurrences"))[0],"range"),"start").getAsInteger()<field(field(items(field(b,"occurrences"))[0],"range"),"start").getAsInteger();
  });
  if(!model.need(same(Json(std::move(rebuilt)),field(*current,"captures")),"capture read/write occurrences differ from original identifier uses"))return false;
  for(const auto &[id,fn]:model.functions)if(same(field(*fn,"lexicalParent"),field(*current,"id"))&&
    !model.need(nestedDeclarations.count(id),"nested function original declaration was omitted"))return false;
  return true;
}
bool SourceBodies::callableExpression(const Json &v){
  const auto kind=string(field(v,"kind")),type=string(field(v,"type")),actual=string(field(v,"flowType"));
  if(kind=="functionReference"){
    const auto id=string(field(v,"functionId"));
    if(!model.need(model.functions.count(id)&&field(*model.functions.at(id),"ownerType").getAsNull()&&resolve(field(v,"range"))==id,"function value does not resolve to original named declaration"))return false;
    const auto &fn=*model.functions.at(id);Array parameters;
    for(const auto &p:items(field(fn,"parameters"))){if(!model.spend())return false;parameters.push_back(field(p,"declaredType"));}
    const auto expected=digest(std::string("tsfg.program.function-type.v2")+std::string(1,'\0')+canonical(Object{{"parameters",std::move(parameters)},{"returnType",field(fn,"returnType")}}));
    return model.need(type==expected&&actual==type,"function value type differs from original header");
  }
  if(!expression(field(v,"expression")))return false;
  const auto callee=string(field(field(v,"expression"),"flowType"));
  if(!model.need(model.types.count(callee)&&string(field(*model.types.at(callee),"kind"))=="function"&&same(field(v,"calleeRange"),field(field(v,"expression"),"range")),"saved indirect callee is not the original callable expression"))return false;
  const auto &callable=*model.types.at(callee),&sig=field(v,"signature");const auto path=string(field(sig,"sourcePath"));
  if(!model.need(same(field(sig,"parameters"),field(callable,"parameters"))&&same(field(sig,"returnType"),field(callable,"returnType"))&&type==string(field(sig,"returnType"))&&
    string(field(sig,"id"))==digest(std::string("tsfg.array-facts.signature.v8")+std::string(1,'\0')+canonical(Object{{"sourcePath",path},{"declarationRange",field(sig,"declarationRange")}})),"indirect original signature identity or callable type differs"))return false;
  if(!model.spend())return false;const auto origin=callableOrigins.find(string(field(sig,"id")));
  if(!model.need(origin!=callableOrigins.end()&&origin->second==callee&&items(field(sig,"parameters")).size()==items(field(v,"arguments")).size(),"indirect signature has no exact original function/alias declaration or arity"))return false;
  std::vector<Json> pieces{field(v,"calleeRange"),Json("(")};size_t i=0;
  for(const auto &arg:items(field(v,"arguments"))){
    if(!expression(arg,false,string(items(field(sig,"parameters"))[i])))return false;
    if(i++)pieces.push_back(",");pieces.push_back(field(arg,"range"));
  }
  pieces.push_back(")");return source->sequence(field(v,"range"),pieces);
}

}
