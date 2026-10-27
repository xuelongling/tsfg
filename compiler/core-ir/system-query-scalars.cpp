// SPDX-License-Identifier: MIT
#include "system-query-source.h"
#include <functional>
namespace tsfg::systemQuery {
namespace {
std::string sourceId(llvm::StringRef kind,const Json &declaration){
  return digest("tsfg.array-facts."+kind.str()+".v8"+std::string(1,'\0')+canonical(Object{{"sourcePath",field(declaration,"sourcePath")},{"declarationRange",field(declaration,"range")}}));
}
}
bool Model::scalars(){
  const auto &rows=field(payload(),"scalarHelpers");
  if(!need(rows.getAsArray()&&items(rows).size()<=64,"bounded scalar helper directory required"))return false;
  std::string previous;
  for(const auto &raw:items(rows)){
    if(!spend()||!need(exact(raw,{"id","declaration","signature","parameters","returnType","returnAnnotationRange","bodyRange","returnRange","value"}),"scalar helper boundary differs"))return false;
    const auto &decl=field(raw,"declaration");auto *node=original(decl);const auto path=string(field(decl,"sourcePath")),id=string(field(raw,"id"));
    if(!node||!need(string(field(decl,"kind"))=="KindFunctionDeclaration"&&!llvm::StringRef(path).ends_with(".d.ts")&&nodes.count(string(field(*node,"parent")))&&
      string(field(*nodes.at(string(field(*node,"parent"))),"kind"))=="KindSourceFile"&&id==sourceId("function",decl)&&previous<id,"original scalar helper identity/scope/order differs"))return false;previous=id;
    if(!need(field(raw,"parameters").getAsArray()&&items(field(raw,"parameters")).size()<=32&&string(field(raw,"returnType"))=="f32","scalar helper requires native f32 signature"))return false;
    ScalarHelper helper;helper.raw=&raw;std::vector<const Json *> parameters;const Json *body=nullptr;
    for(auto *child:children[string(field(*node,"id"))]){const auto kind=string(field(*child,"kind"));if(kind=="KindParameter")parameters.push_back(child);else if(kind=="KindBlock")body=child;}
    if(!need(body&&parameters.size()==items(field(raw,"parameters")).size()&&same(field(*body,"range"),field(raw,"bodyRange")),"scalar helper original body/parameters differ"))return false;
    Array argumentTypes,semanticTypes;
    for(size_t i=0;i<parameters.size();++i){
      const auto &p=items(field(raw,"parameters"))[i];const auto &binding=field(p,"binding");
      if(!need(exact(p,{"index","binding","annotationRange","logicalType","query"})&&number(field(p,"index"))==int64_t(i)&&string(field(p,"logicalType"))=="f32"&&field(p,"query").getAsNull()&&
        string(field(binding,"kind"))=="KindParameter"&&original(binding)==parameters[i],"scalar helper original f32 parameter differs")||!annotation(path,field(p,"annotationRange"),"f32")||
        !grammar(path).sequence(field(binding,"range"),{field(binding,"nameRange"),Json(":"),field(p,"annotationRange")}))return false;
      helper.parameters.push_back(Parameter{&p,source->typeIds.at("f32"),""});argumentTypes.push_back("f32");semanticTypes.push_back(source->typeIds.at("f32"));
    }
    const Json signature=Object{{"id",sourceId("signature",decl)},{"sourcePath",path},{"declarationRange",field(decl,"range")},{"parameters",std::move(argumentTypes)},{"returnType","f32"}};
    if(!need(same(field(raw,"signature"),signature),"scalar helper original signature differs")||!annotation(path,field(raw,"returnAnnotationRange"),"f32"))return false;
    const auto &statements=children[string(field(*body,"id"))];
    if(!need(statements.size()==1&&string(field(*statements[0],"kind"))=="KindReturnStatement"&&same(field(*statements[0],"range"),field(raw,"returnRange")),"scalar helper requires exactly one original return"))return false;
    const auto &values=children[string(field(*statements[0],"id"))];
    if(!need(values.size()==1&&same(field(*values[0],"range"),field(field(raw,"value"),"range")),"scalar helper original return value differs"))return false;
    auto &g=grammar(path);size_t a,b,n,z;if(!g.span(field(decl,"range"),a,b)||!g.span(field(decl,"nameRange"),n,z))return false;
    std::vector<Json> pieces;std::string prefix;for(auto i=a;i<n;++i){if(i>a)prefix+=' ';prefix+=g.tokens[i].text;pieces.push_back(g.tokens[i].text);}
    if(!need(prefix=="function"||prefix=="export function","scalar helper modifiers are outside selected syntax"))return false;
    pieces.push_back(field(decl,"nameRange"));pieces.push_back("(");for(size_t i=0;i<parameters.size();++i){if(i)pieces.push_back(",");pieces.push_back(field(*parameters[i],"range"));}
    pieces.push_back(")");pieces.push_back(":");pieces.push_back(field(raw,"returnAnnotationRange"));pieces.push_back(field(raw,"bodyRange"));
    if(!g.sequence(field(decl,"range"),pieces)||!g.sequence(field(raw,"bodyRange"),{Json("{"),field(raw,"returnRange"),Json("}")})||
      !g.sequence(field(raw,"returnRange"),{Json("return"),field(field(raw,"value"),"range")},true))return false;
    const Json semanticSignature=Object{{"parameters",std::move(semanticTypes)},{"returns",source->typeIds.at("f32")}};
    helper.signature=digest(std::string("tsfg.module-callable-signature.candidate.v1")+std::string(1,'\0')+canonical(semanticSignature));
    helper.id=digest(std::string("tsfg.module-callable-function.candidate.v1")+std::string(1,'\0')+canonical(Object{{"path",path},{"name",canonical(Object{{"path",Array{}},{"kind","function"},{"name",field(decl,"name")}})},{"signatureHash",helper.signature}}));
    helperIndex.emplace(id,scalarHelpers.size());scalarHelpers.push_back(std::move(helper));
  }
  for(const auto &helper:scalarHelpers){
    std::map<std::string,const Json *> scope;for(const auto &p:helper.parameters)scope.emplace(string(field(field(*p.raw,"binding"),"id")),p.raw);
    if(!verifySourceShapeValue(*source,field(*helper.raw,"value"),"arrayGenericExpression")||!expression(field(*helper.raw,"value"),field(*helper.raw,"bodyRange"),scope,string(field(field(*helper.raw,"declaration"),"sourcePath")),0,true))return false;
  }
  return true;
}
bool Model::scalarClosure(){
  std::map<std::string,std::set<std::string>> edges;std::set<std::string> roots,reached,active;std::map<std::string,unsigned> heights;
  std::function<bool(const Json &,std::set<std::string> &)> calls=[&](const Json &v,std::set<std::string> &to){
    if(!spend())return false;if(string(field(v,"kind"))=="call")to.insert(string(field(v,"callee")));
    for(const auto &arg:items(field(v,"arguments")))if(!calls(arg,to))return false;
    for(auto key:{"left","right","target","value","expression"})if(!field(v,key).getAsNull()&&!calls(field(v,key),to))return false;return true;
  };
  for(const auto &h:scalarHelpers)if(!calls(field(*h.raw,"value"),edges[string(field(*h.raw,"id"))]))return false;
  for(const auto &s:systems)for(const auto &l:items(field(*s.raw,"loops")))for(const auto &stmt:items(field(l,"statements")))if(!calls(field(stmt,"value"),roots))return false;
  std::function<unsigned(const std::string &)> height=[&](const std::string &id){
    if(!spend()||!need(helperIndex.count(id),"scalar call graph has an unowned target"))return 0u;
    reached.insert(id);if(heights.count(id))return heights.at(id);
    if(!need(active.insert(id).second,"recursive scalar helper graph is outside selected syntax"))return 0u;
    unsigned result=1;for(const auto &target:edges[id]){const auto nested=height(target);if(!nested)return 0u;result=std::max(result,nested+1);}
    active.erase(id);if(!need(result<=32,"scalar call graph exceeds32"))return 0u;return heights[id]=result;
  };
  for(const auto &id:roots)if(!height(id))return false;return need(reached.size()==scalarHelpers.size(),"scalar helper inventory must be exactly reachable");
}
} // namespace tsfg::systemQuery
