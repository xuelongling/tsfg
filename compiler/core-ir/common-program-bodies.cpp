// SPDX-License-Identifier: MIT
#include "common-program-syntax.h"
#include "llvm/ADT/STLExtras.h"
namespace tsfg::commonProgram {
namespace {
Json range(const SourceToken &a,const SourceToken &b){return Object{{"start",int64_t(a.start)},{"end",int64_t(b.end)}};}
std::string origin(llvm::StringRef path,const Json &name){
  return digest(std::string("tsfg.array-facts.binding.v1")+std::string(1,'\0')+canonical(Object{{"sourcePath",path},{"nameRange",name}}));
}
}
bool SourceBodies::inventory(){
  for(const auto &[path,module]:model.modules){
    if(!model.spend()||!model.need(syntax.count(path),"module has no exact source text"))return false;
    auto &scope=visible[path];
    if(!model.spend(model.types.size()+model.functions.size()+model.globals.size()))return false;
    for(const auto &[id,t]:model.types)if(string(field(*t,"sourcePath"))==path&&
      (string(field(*t,"kind"))=="value"||string(field(*t,"kind"))=="reference")){
      if(!model.spend()||!model.need(scope.emplace(string(field(*t,"name")),id).second,"duplicate original nominal symbol"))return false;
    }
    for(const auto &[id,fn]:model.functions)if(string(field(*fn,"sourcePath"))==path&&field(*fn,"ownerType").getAsNull()){
      if(!model.spend()||!model.need(scope.emplace(string(field(*fn,"name")),id).second,"duplicate original module symbol"))return false;
    }
    for(const auto &[id,g]:model.globals)if(string(field(*g,"sourcePath"))==path){
      if(!model.spend()||!model.need(scope.emplace(string(field(field(*g,"binding"),"name")),id).second,"duplicate original global symbol"))return false;
    }
    for(const auto &edge:items(field(*module,"imports")))for(const auto &alias:items(field(edge,"bindings"))){
      if(!model.spend())return false;
      if(!field(alias,"localBinding").getAsNull()&&!model.need(scope.emplace(string(field(alias,"name")),string(field(alias,"target"))).second,"duplicate original imported symbol"))return false;
    }
  }
  const auto add=[&](const Json &b,const std::string &path){
    if(!model.spend()||!model.need(syntax.count(path)&&model.types.count(string(field(b,"declaredType"))),"binding source/type missing"))return false;
    const auto id=string(field(b,"id"));auto &s=syntax.at(path);
    if(!model.need(id==origin(path,field(b,"nameRange"))&&bindings.emplace(id,&b).second,"binding identity or uniqueness differs")||
      !s.name(field(b,"nameRange"),string(field(b,"name"))))return false;
    SourceAnchor declaration,name;if(!s.range(field(b,"declarationRange"),declaration)||!s.range(field(b,"nameRange"),name)||
      !model.need(name.start>=declaration.start&&name.end<=declaration.end,"binding name leaves original declaration"))return false;
    return true;
  };
  for(const auto &[id,fn]:model.functions){const auto path=string(field(*fn,"sourcePath"));
    if(!model.need(syntax.count(path)&&id==digest(std::string("tsfg.array-facts.function.v8")+std::string(1,'\0')+
      canonical(Object{{"sourcePath",path},{"declarationRange",field(*fn,"declarationRange")}})),"original function identity differs"))return false;
    for(const auto &b:items(field(*fn,"parameters")))if(!add(b,path))return false;
    for(const auto &b:items(field(*fn,"bindings")))if(!add(b,path))return false;
  }
  for(const auto &[id,g]:model.globals)if(!add(field(*g,"binding"),string(field(*g,"sourcePath"))))return false;
  return true;
}
std::string SourceBodies::resolve(const Json &r){
  size_t a,b;if(!source->span(r,a,b))return {};
  if(b==a+1){auto it=scope.find(source->tokens[a].text);return it==scope.end()?std::string():it->second;}
  if(b==a+3&&source->tokens[a+1].text=="."){
    auto alias=scope.find(source->tokens[a].text);if(alias==scope.end()||!model.modules.count(alias->second))return {};
    for(const auto &e:items(field(*model.modules.at(alias->second),"exports"))){
      if(!model.spend())return {};if(string(field(e,"name"))==source->tokens[a+2].text)return string(field(e,"target"));
    }
  }
  return {};
}
bool SourceBodies::annotation(const Json &r,const std::string &expected){
  size_t a,b;if(!source->span(r,a,b))return false;
  std::function<std::string()> unit,unionType;
  unit=[&]()->std::string{
    if(!model.spend()||a>=b)return {};std::string result;
    if(source->tokens[a].text=="("){
      ++a;result=unionType();if(a>=b||source->tokens[a++].text!=")")return {};
    }else{
      const auto name=source->tokens[a++].text;
      if(name=="Array"||name=="ReadSpan"){
        if(a>=b||source->tokens[a++].text!="<")return {};const auto element=unionType();
        if(a>=b||source->tokens[a++].text!=">")return {};result=(name=="Array"?"array<":"readSpan<")+element+">";
      }else if(model.types.count(name))result=name;
      else {
        auto alias=scope.find(name);if(alias!=scope.end()&&model.types.count(alias->second))result=alias->second;
        else for(const auto &[id,t]:model.types){if(!model.spend())return {};
          if(!string(field(*t,"name")).empty()&&string(field(*t,"name"))==name){if(!result.empty()&&result!=id)return {};result=id;}}
      }
    }
    while(a+1<b&&source->tokens[a].text=="["&&source->tokens[a+1].text=="]"){a+=2;result="array<"+result+">";}
    return model.types.count(result)?result:std::string();
  };
  unionType=[&]()->std::string{
    auto first=unit();if(first.empty())return {};std::set<std::string> members{first};
    while(a<b&&source->tokens[a].text=="|"){++a;auto next=unit();if(next.empty())return {};members.insert(next);}
    if(members.size()==1)return first;std::string id="union<";for(const auto &m:members){if(id.size()>6)id+=",";id+=m;}return id+">";
  };
  const auto actual=unionType();return model.need(actual==expected&&a==b,"original annotation does not name declared semantic type");
}
bool SourceBodies::function(const Json &fn){
  current=&fn;const auto path=string(field(fn,"sourcePath"));source=&syntax.at(path);if(!setScope(visible.at(path)))return false;declared.clear();initialized.clear();
  const auto id=string(field(fn,"id"));
  for(const auto &b:items(field(fn,"parameters"))){
    if(!model.spend()||!model.need(string(field(b,"kind"))=="parameter","original parameter kind differs"))return false;
    scope[string(field(b,"name"))]=string(field(b,"id"));initialized.insert(string(field(b,"id")));declared.insert(string(field(b,"id")));
  }
  size_t a,b;if(!source->span(field(fn,"declarationRange"),a,b))return false;
  std::vector<Json> header;size_t cursor=a;
  while(cursor<b&&(source->tokens[cursor].text=="export"||source->tokens[cursor].text=="default"||
    source->tokens[cursor].text=="public"||source->tokens[cursor].text=="private"||source->tokens[cursor].text=="protected"))header.push_back(source->tokens[cursor++].text);
  Json actualName=field(fn,"nameRange");const auto owner=string(field(fn,"ownerType"));
  const bool constructor=model.types.count(owner)&&string(field(field(*model.types.at(owner),"constructor"),"id"))==id;
  if(constructor){
    // The official constructor DTO anchors nameRange to its entire original
    // declaration. Recover only the keyword token for grammar checking; retain
    // that original DTO span in all protocol/owned provenance.
    if(!model.need(same(field(fn,"nameRange"),field(fn,"declarationRange"))&&cursor<b&&source->tokens[cursor].text=="constructor","original constructor keyword/span differs"))return false;
    actualName=range(source->tokens[cursor],source->tokens[cursor]);
  }
  if(!source->name(actualName,string(field(fn,"name"))))return false;
  if(field(fn,"ownerType").getAsNull())header.push_back("function");
  header.push_back(std::move(actualName));header.push_back("(");size_t index=0;
  for(const auto &p:items(field(fn,"parameters"))){
    if(!model.spend())return false;if(index++)header.push_back(",");
    std::vector<Json> pieces{field(p,"nameRange")};
    if(!field(p,"annotationRange").getAsNull()){
      if(!annotation(field(p,"annotationRange"),string(field(p,"declaredType"))))return false;
      pieces.push_back(":");pieces.push_back(field(p,"annotationRange"));
    }
    if(!source->sequence(field(p,"declarationRange"),pieces))return false;header.push_back(field(p,"declarationRange"));
  }
  header.push_back(")");
  if(!field(fn,"returnAnnotationRange").getAsNull()){
    if(!annotation(field(fn,"returnAnnotationRange"),string(field(fn,"returnType"))))return false;
    header.push_back(":");header.push_back(field(fn,"returnAnnotationRange"));
  }
  size_t body=b;for(size_t n=a;n<b;++n)if(source->tokens[n].text=="{"){body=n;break;}
  if(!model.need(body<b&&source->tokens[b-1].text=="}","original function body missing"))return false;
  header.push_back(range(source->tokens[body],source->tokens[b-1]));
  if(!source->sequence(field(fn,"declarationRange"),header)||!statements(field(fn,"body"),body+1,b-1))return false;
  for(const auto &binding:items(field(fn,"bindings")))if(!model.need(declared.count(string(field(binding,"id"))),"omitted original binding declaration"))return false;
  return true;
}
bool SourceBodies::module(const Json &m){
  const auto path=string(field(m,"sourcePath"));source=&syntax.at(path);if(!setScope(visible.at(path)))return false;initialized.clear();declared.clear();
  const Json fake=Object{{"sourcePath",path},{"returnType","void"},{"parameters",Array{}},{"bindings",Array{}}};current=&fake;
  for(const auto &r:items(field(m,"initialization"))){
    size_t a,b;if(!source->span(field(r,"range"),a,b))return false;
    if(string(field(r,"kind"))=="initialize"){
      if(!model.need(a>0&&(source->tokens[a-1].text=="let"||source->tokens[a-1].text=="const"),"original global declaration prefix differs"))return false;--a;
    }
    if(b<source->tokens.size()&&source->tokens[b].text==";")++b;
    if(!statements(Array{r},a,b))return false;
  }
  return true;
}
bool SourceBodies::setScope(const std::map<std::string,std::string> &from){
  if(!model.spend(from.size()))return false;
  for(const auto &[name,id]:from)if(!model.spend((name.size()+id.size())/8+1))return false;
  scope=from;return true;
}
} // namespace tsfg::commonProgram
