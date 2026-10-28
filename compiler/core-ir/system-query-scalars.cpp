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
    if(!spend()||!need(exact(raw,{"id","declaration","signature","parameters","returnType","returnAnnotationRange","bodyRange","bindings","statements"}),"scalar helper boundary differs"))return false;
    const auto &decl=field(raw,"declaration");auto *node=original(decl);const auto path=string(field(decl,"sourcePath")),id=string(field(raw,"id"));
    if(!node||!need(string(field(decl,"kind"))=="KindFunctionDeclaration"&&!llvm::StringRef(path).ends_with(".d.ts")&&nodes.count(string(field(*node,"parent")))&&
      string(field(*nodes.at(string(field(*node,"parent"))),"kind"))=="KindSourceFile"&&id==sourceId("function",decl)&&previous<id,"original scalar helper identity/scope/order differs"))return false;previous=id;
    const auto returned=string(field(raw,"returnType"));
    if(!need(field(raw,"parameters").getAsArray()&&items(field(raw,"parameters")).size()<=32&&(returned=="f32"||returned=="f64"),"scalar helper requires floating-point signature"))return false;
    ScalarHelper helper;helper.raw=&raw;std::vector<const Json *> parameters;const Json *body=nullptr;
    for(auto *child:children[string(field(*node,"id"))]){const auto kind=string(field(*child,"kind"));if(kind=="KindParameter")parameters.push_back(child);else if(kind=="KindBlock")body=child;}
    if(!need(body&&parameters.size()==items(field(raw,"parameters")).size()&&same(field(*body,"range"),field(raw,"bodyRange")),"scalar helper original body/parameters differ"))return false;
    Array argumentTypes,semanticTypes;
    for(size_t i=0;i<parameters.size();++i){
      const auto &p=items(field(raw,"parameters"))[i];const auto &binding=field(p,"binding");
      if(!need(exact(p,{"index","binding","annotationRange","logicalType","query","view"})&&number(field(p,"index"))==int64_t(i)&&field(p,"query").getAsNull()&&
        string(field(binding,"kind"))=="KindParameter"&&original(binding)==parameters[i],"helper original parameter differs")||
        !grammar(path).sequence(field(binding,"range"),{field(binding,"nameRange"),Json(":"),field(p,"annotationRange")}))return false;
      const auto logical=string(field(p,"logicalType"));std::string semantic;
      if(field(p,"view").getAsNull()){
        if(!need(logical=="f32"||logical=="f64","ordinary helper parameter must be floating-point")||!annotation(path,field(p,"annotationRange"),logical))return false;
        semantic=source->typeIds.at(logical);
      }else{
        if(!view(field(p,"view"),path,field(p,"annotationRange"),logical))return false;
        semantic=digest(std::string("tsfg.query.view.v1")+std::string(1,'\0')+canonical(Object{{"componentType",source->typeIds.at(logical)},{"mode",field(field(field(p,"view"),"access"),"mode")}}));
      }
      helper.parameters.push_back(Parameter{&p,source->typeIds.at(logical),""});argumentTypes.push_back(logical);semanticTypes.push_back(semantic);
    }
    const Json signature=Object{{"id",sourceId("signature",decl)},{"sourcePath",path},{"declarationRange",field(decl,"range")},{"parameters",std::move(argumentTypes)},{"returnType",returned}};
    if(!need(same(field(raw,"signature"),signature),"scalar helper original signature/return width differs")||!annotation(path,field(raw,"returnAnnotationRange"),returned))return false;
    auto &g=grammar(path);size_t a,b,n,z;if(!g.span(field(decl,"range"),a,b)||!g.span(field(decl,"nameRange"),n,z))return false;
    std::vector<Json> pieces;std::string prefix;for(auto i=a;i<n;++i){if(i>a)prefix+=' ';prefix+=g.tokens[i].text;pieces.push_back(g.tokens[i].text);}
    if(!need(prefix=="function"||prefix=="export function","scalar helper modifiers are outside selected syntax"))return false;
    pieces.push_back(field(decl,"nameRange"));pieces.push_back("(");for(size_t i=0;i<parameters.size();++i){if(i)pieces.push_back(",");pieces.push_back(field(*parameters[i],"range"));}
    pieces.push_back(")");pieces.push_back(":");pieces.push_back(field(raw,"returnAnnotationRange"));pieces.push_back(field(raw,"bodyRange"));
    if(!g.sequence(field(decl,"range"),pieces))return false;
    const Json semanticSignature=Object{{"parameters",std::move(semanticTypes)},{"returns",source->typeIds.at(returned)}};
    helper.signature=digest(std::string("tsfg.module-callable-signature.candidate.v1")+std::string(1,'\0')+canonical(semanticSignature));
    helper.id=digest(std::string("tsfg.module-callable-function.candidate.v1")+std::string(1,'\0')+canonical(Object{{"path",path},{"name",canonical(Object{{"path",Array{}},{"kind","function"},{"name",field(decl,"name")}})},{"signatureHash",helper.signature}}));
    helperIndex.emplace(id,scalarHelpers.size());scalarHelpers.push_back(std::move(helper));
  }
  for(const auto &helper:scalarHelpers){
    std::map<std::string,const Json *> scope;for(const auto &p:helper.parameters)scope.emplace(string(field(field(*p.raw,"binding"),"id")),p.raw);
    const auto path=string(field(field(*helper.raw,"declaration"),"sourcePath"));auto *body=at(path,field(*helper.raw,"bodyRange"),"KindBlock");
    if(!body||!statements(field(*helper.raw,"statements"),field(*helper.raw,"bindings"),*body,field(*helper.raw,"declaration"),std::move(scope),path,string(field(*helper.raw,"returnType"))))return false;  }
  return true;
}
bool Model::scalarClosure(){
  std::map<std::string,std::set<std::string>> edges;std::set<std::string> roots,reached,active;std::map<std::string,unsigned> heights;
  std::function<bool(const Json &,std::set<std::string> &)> calls=[&](const Json &v,std::set<std::string> &to){
    if(!spend())return false;if(string(field(v,"kind"))=="call")to.insert(string(field(v,"callee")));
    for(const auto &arg:items(field(v,"arguments")))if(!calls(arg,to))return false;
    for(auto key:{"left","right","target","value","initializer","expression"})if(!field(v,key).getAsNull()&&!calls(field(v,key),to))return false;return true;
  };
  for(const auto &h:scalarHelpers)for(const auto &statement:items(field(*h.raw,"statements")))if(!calls(statement,edges[string(field(*h.raw,"id"))]))return false;
  for(const auto &s:systems)for(const auto &l:items(field(*s.raw,"loops")))for(const auto &stmt:items(field(l,"statements")))if(!calls(stmt,roots))return false;
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
