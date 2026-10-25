// SPDX-License-Identifier: MIT
#include "common-program-syntax.h"
#include "llvm/ADT/STLExtras.h"
namespace tsfg::commonProgram {
namespace {
const Json *definition(SourceModel &m,const std::string &id){
  if(m.functions.count(id))return m.functions.at(id);if(m.globals.count(id))return &field(*m.globals.at(id),"binding");
  if(m.types.count(id))return m.types.at(id);return nullptr;
}
std::string definingPath(SourceModel &m,const std::string &id){
  if(m.globals.count(id))return string(field(*m.globals.at(id),"sourcePath"));if(m.modules.count(id))return id;
  const auto *d=definition(m,id);return d?string(field(*d,"sourcePath")):std::string();
}
std::string resolved(const std::string &path,const std::string &specifier){
  if(!llvm::StringRef(specifier).starts_with("./")&&!llvm::StringRef(specifier).starts_with("../"))return {};
  std::vector<std::string> parts;llvm::SmallVector<llvm::StringRef> prefix,tail;
  llvm::StringRef(path).drop_front().split(prefix,'/');if(prefix.empty())return {};prefix.pop_back();
  for(auto part:prefix)parts.push_back(part.str());llvm::StringRef(specifier).split(tail,'/');
  for(auto part:tail){if(part.empty()||part==".")continue;if(part==".."){if(parts.empty())return {};parts.pop_back();}else parts.push_back(part.str());}
  std::string out;for(const auto &p:parts)out+="/"+p;if(!llvm::StringRef(out).ends_with(".ts"))out+=".ts";return out;
}
bool exportExists(SourceModel &m,const Json &module,const Json &alias){
  const auto imported=string(field(alias,"imported"));
  if(string(field(alias,"kind"))=="namespace")return string(field(alias,"target"))==string(field(module,"sourcePath"))&&imported=="*";
  for(const auto &e:items(field(module,"exports"))){if(!m.spend())return false;
    if(string(field(e,"name"))==imported&&same(field(e,"target"),field(alias,"target"))&&same(field(e,"targetSourcePath"),field(alias,"targetSourcePath")))return true;
  }return false;
}
}
bool verifyCommonModules(SourceModel &m,std::map<std::string,SourceSyntax> &syntax){
  for(const auto &[path,ptr]:m.modules){const auto &module=*ptr;auto &s=syntax.at(path);
    if(!m.spend()||!m.need(field(module,"external").getAsBoolean()==true,"whole common module must retain explicit external scope"))return false;
    Array expectedGlobals,initialized;
    for(const auto &g:items(field(m.payload,"globals")))if(string(field(g,"sourcePath"))==path){if(!m.spend())return false;expectedGlobals.push_back(field(field(g,"binding"),"id"));}
    for(const auto &row:items(field(module,"initialization")))if(string(field(row,"kind"))=="initialize"){if(!m.spend())return false;initialized.push_back(field(row,"binding"));}
    if(!m.need(same(Json(std::move(expectedGlobals)),field(module,"globals"))&&same(Json(std::move(initialized)),field(module,"globals")),"every global must be initialized once in original source order"))return false;
    for(const auto &edge:items(field(module,"imports"))){
      const auto target=string(field(edge,"sourcePath")),specifier=string(field(edge,"specifier")),kind=string(field(edge,"kind"));
      if(!m.spend()||!m.need(m.modules.count(target)&&resolved(path,specifier)==target&&
        (kind=="import"||kind=="export"||kind=="export-star"),"module edge does not resolve to actual retained module"))return false;
      size_t a,b;if(!s.span(field(edge,"range"),a,b)||!m.need(b>=a+3&&s.tokens[a].text==(kind=="import"?"import":"export"),"original module edge keyword differs"))return false;
      size_t from=b;if(s.tokens[from-1].text==";")--from;
      if(!m.need(from>=a+3&&(s.tokens[from-1].text=="'"+specifier+"'"||s.tokens[from-1].text=="\""+specifier+"\"")&&s.tokens[from-2].text=="from","original module specifier differs"))return false;
      const bool star=s.tokens[a+1].text=="*";std::vector<Json> parts{Json(kind=="import"?"import":"export")};
      if(star){parts.push_back("*");if(kind=="import")parts.push_back("as");}
      else parts.push_back("{");size_t index=0;
      for(const auto &alias:items(field(edge,"bindings"))){
        const auto id=string(field(alias,"target")),aliasKind=string(field(alias,"kind"));
        if(!m.spend()||!m.need(definingPath(m,id)==string(field(alias,"targetSourcePath"))&&
          (aliasKind=="namespace"?m.modules.count(id):aliasKind=="function"?m.functions.count(id):aliasKind=="global"?m.globals.count(id):aliasKind=="type"&&m.types.count(id))&&
          exportExists(m,*m.modules.at(target),alias),"alias target is not the actual exported original declaration"))return false;
        if(!field(alias,"localBinding").getAsNull()){
          if(!m.need(kind=="import"&&string(field(alias,"localBinding"))==digest(std::string("tsfg.array-facts.binding.v1")+std::string(1,'\0')+
            canonical(Object{{"sourcePath",path},{"nameRange",field(alias,"nameRange")}})),"local alias original binding identity differs")||!s.name(field(alias,"nameRange"),string(field(alias,"name"))))return false;
        }else if(!m.need(kind!="import"&&field(alias,"nameRange").getAsNull(),"re-export fabricates a local declaration"))return false;
        if(index++&&!star)parts.push_back(",");
        if(star){if(kind=="import")parts.push_back(field(alias,"nameRange"));}
        else parts.push_back(field(alias,"range"));
        if(!star){
          std::vector<Json> aliasParts{field(alias,"imported")};
          if(string(field(alias,"name"))!=string(field(alias,"imported"))){aliasParts.push_back("as");aliasParts.push_back(field(alias,"name"));}
          if(!s.sequence(field(alias,"range"),aliasParts))return false;
        }
      }
      if(!star)parts.push_back("}");parts.push_back("from");parts.push_back(s.tokens[from-1].text);
      if(!s.sequence(field(edge,"range"),parts,true))return false;
    }
    std::string previous;
    for(const auto &e:items(field(module,"exports"))){const auto id=string(field(e,"target")),name=string(field(e,"name"));const auto *d=definition(m,id);
      if(!m.spend()||!m.need(d&&definingPath(m,id)==string(field(e,"targetSourcePath"))&&(previous.empty()||previous<name)&&
        same(field(e,"definitionRange"),field(*d,"declarationRange")),"export occurrence/definition join differs"))return false;
      previous=name;SourceAnchor occurrence;if(!s.range(field(e,"range"),occurrence))return false;
    }
  }
  return true;
}
} // namespace tsfg::commonProgram
