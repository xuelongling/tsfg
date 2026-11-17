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

struct ModuleExports;
struct ExportLink {
  const ModuleExports *owner;
  llvm::StringRef name;
};
struct NamedExport {
  const Json *alias;
  const ModuleExports *upstream;
};
struct ModuleEdge {
  SourceAnchor range;
  bool named;
};
struct OriginalExport {
  std::string name,target;
  const Json *range;
};
struct ModuleExports {
  std::map<llvm::StringRef,const Json *> rows,claims,localRows;
  std::map<llvm::StringRef,NamedExport> named;
  std::map<llvm::StringRef,ExportLink> imports;
  std::vector<const ModuleExports *> stars;
  std::vector<SourceAnchor> declarations;
  std::vector<OriginalExport> originals;
  std::vector<ModuleEdge> edges;
};
bool contains(SourceAnchor parent,SourceAnchor child){
  return parent.start<=child.start&&child.end<=parent.end;
}
bool directExport(SourceModel &m,ModuleExports &exports,std::set<const Json *> &direct,
  const std::string &name,const std::string &id,const Json &range){
  const auto claim=exports.claims.find(name);
  if(!m.spend()||!m.need(claim!=exports.claims.end()&&string(field(*claim->second,"target"))==id&&
      same(field(*claim->second,"range"),range),"direct export does not match its original declaration"))return false;
  direct.insert(claim->second);exports.claims.erase(claim);return true;
}
// The existing declaration/body readers validate each complete grammar.
// This step classifies only those original export modifiers and ranges.
bool declarationPrefix(SourceModel &m,SourceSyntax &s,const Json &row,bool nominal,bool &exported,bool &isDefault,SourceAnchor &anchor){
  size_t first,end,name,nameEnd;
  if(!s.span(field(row,"declarationRange"),first,end)||!s.span(field(row,"nameRange"),name,nameEnd))return false;
  if(!m.need(first<=name&&nameEnd<=end,"export declaration header differs"))return false;
  anchor={s.tokens[first].start,s.tokens[end-1].end};exported=false;isDefault=false;
  const auto count=name-first;
  if(!m.spend(count))return false;
  if(!nominal){
    const auto &tokens=s.tokens;
    const bool ordinary=count==1&&tokens[first].text=="function";
    exported=count==2&&tokens[first].text=="export"&&tokens[first+1].text=="function";
    isDefault=count==3&&tokens[first].text=="export"&&tokens[first+1].text=="default"&&tokens[first+2].text=="function";
    if(!m.need(ordinary||exported||isDefault,"original top-level function export prefix differs"))return false;
    exported=exported||isDefault;
    return true;
  }
  for(auto index=first;index<name;++index){
    const auto &token=s.tokens[index].text;
    if(token=="export")exported=true;
    if(token=="default")isDefault=true;
  }
  return true;
}
bool reachesDeclaration(SourceModel &m,const std::set<const Json *> &direct,const std::map<const Json *,ExportLink> &named,
  const ModuleExports &source,llvm::StringRef name,const Json &claim){
  const auto id=field(claim,"target").getAsString();
  std::vector<ExportLink> pending{{&source,name}};
  std::set<const Json *> seen;
  for(size_t index=0;index<pending.size();++index){
    if(!m.spend())return false;
    const auto step=pending[index];const auto &owner=*step.owner;
    const auto found=owner.rows.find(step.name);
    if(found==owner.rows.end()||field(*found->second,"target").getAsString()!=id||!seen.insert(found->second).second)continue;
    const auto *row=found->second;
    if(direct.count(row))return true;
    const auto forward=named.find(row);
    if(forward!=named.end())pending.push_back(forward->second);
    else if(step.name!="default"&&same(field(*row,"range"),field(*row,"definitionRange"))){
      for(const auto &upstream:owner.stars){
        if(!m.spend())return false;
        pending.push_back({upstream,step.name});
      }
    }
  }
  return m.need(false,"export occurrence has no original declaration");
}

bool completeModuleSource(SourceModel &m,SourceSyntax &source,const std::vector<Json> &coverage,
  const std::map<std::string,std::string> &scope,ModuleExports &exports,
  std::set<const Json *> &declared,std::map<const Json *,ExportLink> &named){
  std::vector<std::pair<size_t,size_t>> spans;
  for(const auto &range:coverage){
    size_t first,end;if(!m.spend()||!source.span(range,first,end))return false;
    spans.emplace_back(first,end);
  }
  std::sort(spans.begin(),spans.end());
  const auto &tokens=source.tokens;size_t at=0;
  const auto localClauses=[&](size_t limit){
    while(at+1<limit&&tokens[at].text=="export"&&tokens[at+1].text=="{"){
      if(!m.spend(2))return false;
      at+=2;
      while(at<limit&&tokens[at].text!="}"){
        const auto start=tokens[at].start;
        std::string local,publicName;
        if(!source.cookedIdentifier(at++,local))return false;
        if(at<limit&&tokens[at].text=="as"){
          if(!m.spend()||!m.need(++at<limit,"local export alias name missing")||
            !source.cookedIdentifier(at++,publicName))return false;
        }
        const llvm::StringRef exported=publicName.empty()?llvm::StringRef(local):llvm::StringRef(publicName);
        if(!m.spend())return false;
        const auto occurrence=exports.localRows.find(exported);
        const auto binding=scope.find(local);
        const Json range=Object{{"start",int64_t(start)},{"end",int64_t(tokens[at-1].end)}};
        if(!m.need(occurrence!=exports.localRows.end()&&binding!=scope.end()&&
          field(*occurrence->second,"target").getAsString()==llvm::StringRef(binding->second)&&
          same(field(*occurrence->second,"range"),range),"local export differs from its original binding"))return false;
        const auto *row=occurrence->second;
        const auto forward=exports.imports.find(local);
        if(forward!=exports.imports.end()){
          named.emplace(row,forward->second);exports.claims.emplace(occurrence->first,row);
        }else declared.insert(row);
        exports.localRows.erase(occurrence);
        if(at>=limit||tokens[at].text!=",")break;
        if(!m.spend())return false;
        ++at;
      }
      if(!m.spend()||!m.need(at<limit&&tokens[at].text=="}","original local export clause differs"))return false;
      ++at;
      if(at<limit&&tokens[at].text==";"){if(!m.spend())return false;++at;}
    }
    return true;
  };
  for(auto [first,end]:spans){
    if(!localClauses(first)||!m.need(at==first,"missing, overlapping or repeated complete Source declaration"))return false;
    at=end;
  }
  return localClauses(tokens.size())&&m.need(at==tokens.size(),"unrepresented ordinary Source top-level tokens")&&
    m.need(exports.localRows.empty(),"module export has no original local specifier");
}
}
bool verifyCommonModules(SourceModel &m,SourceBodies &bodies,const std::map<std::string,std::vector<Json>> &coverage){
  auto &syntax=bodies.syntax;
  std::map<std::string,ModuleExports> evidence;
  std::set<const Json *> direct;
  std::map<const Json *,ExportLink> named;
  for(const auto &module:m.modules){
    if(!m.spend())return false;
    evidence.try_emplace(module.first);
  }
  const auto addDeclaration=[&](const Json &row,bool nominal){
    if(!m.spend())return false;
    const auto path=string(field(row,"sourcePath"));auto &exports=evidence.at(path);
    bool exported,isDefault;SourceAnchor anchor;
    if(!declarationPrefix(m,syntax.at(path),row,nominal,exported,isDefault,anchor))return false;
    exports.declarations.push_back(anchor);
    if(exported)exports.originals.push_back({isDefault?"default":string(field(row,"name")),
      string(field(row,"id")),&field(row,"declarationRange")});
    return true;
  };
  for(const auto &entry:m.functions){
    if(!m.spend())return false;
    const auto &row=*entry.second;
    if(field(row,"ownerType").getAsNull()&&field(row,"lexicalParent").getAsNull()&&!addDeclaration(row,false))return false;
  }
  for(const auto &entry:m.types){
    if(!m.spend())return false;
    const auto &row=*entry.second;
    const auto kind=string(field(row,"kind"));
    if((kind=="value"||kind=="reference")&&!addDeclaration(row,true))return false;
  }
  for(const auto &[path,ptr]:m.modules){const auto &module=*ptr;auto &s=syntax.at(path);
    if(!m.spend()||!m.need(field(module,"external").getAsBoolean()==true,"whole common module must retain explicit external scope"))return false;
    Array expectedGlobals,initialized;
    for(const auto &g:items(field(m.payload,"globals")))if(string(field(g,"sourcePath"))==path){if(!m.spend())return false;expectedGlobals.push_back(field(field(g,"binding"),"id"));}
    for(const auto &row:items(field(module,"initialization")))if(string(field(row,"kind"))=="initialize"){if(!m.spend())return false;initialized.push_back(field(row,"binding"));}
    if(!m.need(same(Json(std::move(expectedGlobals)),field(module,"globals"))&&same(Json(std::move(initialized)),field(module,"globals")),"every global must be initialized once in original source order"))return false;
    auto &exports=evidence.at(path);
    for(const auto &row:items(field(module,"initialization"))){
      SourceAnchor range;
      if(!m.spend()||!s.range(field(row,"range"),range))return false;
      exports.declarations.push_back(range);
      if(string(field(row,"kind"))!="initialize")continue;
      size_t first,end;
      if(!s.span(field(row,"range"),first,end)||!m.need(first>0,"global export declaration prefix missing"))return false;
      if(first<2||s.tokens[first-2].text!="export")continue;
      const auto id=string(field(row,"binding"));const auto &binding=field(*m.globals.at(id),"binding");
      exports.originals.push_back({string(field(binding,"name")),id,&field(binding,"declarationRange")});
    }
    uint32_t previousEdgeEnd=0;
    for(const auto &edge:items(field(module,"imports"))){
      const auto target=string(field(edge,"sourcePath")),specifier=string(field(edge,"specifier")),kind=string(field(edge,"kind"));
      if(!m.spend()||!m.need(m.modules.count(target)&&resolved(path,specifier)==target&&
        (kind=="import"||kind=="export"||kind=="export-star"),"module edge does not resolve to actual retained module"))return false;
      size_t a,b;if(!s.span(field(edge,"range"),a,b)||!m.need(b>=a+3&&s.tokens[a].text==(kind=="import"?"import":"export"),"original module edge keyword differs"))return false;
      size_t from=b;if(s.tokens[from-1].text==";")--from;
      if(!m.need(from>=a+3&&(s.tokens[from-1].text=="'"+specifier+"'"||s.tokens[from-1].text=="\""+specifier+"\"")&&s.tokens[from-2].text=="from","original module specifier differs"))return false;
      const bool star=s.tokens[a+1].text=="*",namedExport=kind!="import"&&!star;
      SourceAnchor occurrence;if(!s.range(field(edge,"range"),occurrence))return false;
      if(!m.need(occurrence.start>=previousEdgeEnd,"original module edge order differs"))return false;
      previousEdgeEnd=occurrence.end;
      exports.edges.push_back({occurrence,namedExport});
      if(kind!="import"&&star)exports.stars.push_back(&evidence.at(target));
      std::vector<Json> parts{Json(kind=="import"?"import":"export")};
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
          if(aliasKind!="namespace")exports.imports.emplace(field(alias,"name").getAsString().value_or(""),
            ExportLink{&evidence.at(target),field(alias,"imported").getAsString().value_or("")});
        }else if(!m.need(kind!="import"&&field(alias,"nameRange").getAsNull(),"re-export fabricates a local declaration"))return false;
        if(index++&&!star)parts.push_back(",");
        if(star){if(kind=="import")parts.push_back(field(alias,"nameRange"));}
        else parts.push_back(field(alias,"range"));
        if(!star){
          std::vector<Json> aliasParts{field(alias,"imported")};
          if(string(field(alias,"name"))!=string(field(alias,"imported"))){aliasParts.push_back("as");aliasParts.push_back(field(alias,"name"));}
          if(!s.sequence(field(alias,"range"),aliasParts))return false;
          if(namedExport&&!m.need(exports.named.emplace(field(alias,"name").getAsString().value_or(""),
            NamedExport{&alias,&evidence.at(target)}).second,
            "duplicate original named re-export"))return false;
        }
      }
      if(!star)parts.push_back("}");parts.push_back("from");parts.push_back(s.tokens[from-1].text);
      if(!s.sequence(field(edge,"range"),parts,true))return false;
    }
    llvm::StringRef previous;size_t matchedNamed=0;
    for(const auto &e:items(field(module,"exports"))){
      const auto id=string(field(e,"target"));const auto *d=definition(m,id);
      const auto name=field(e,"name").getAsString().value_or("");
      const auto typeKind=d?string(field(*d,"kind")):std::string();
      const char *kind=m.functions.count(id)?"function":m.globals.count(id)?"global":
        typeKind=="value"||typeKind=="reference"?"type":"";
      if(!m.spend()||!m.need(d&&*kind&&kind==string(field(e,"kind"))&&definingPath(m,id)==string(field(e,"targetSourcePath"))&&
        (previous.empty()||previous<name)&&same(field(e,"definitionRange"),field(*d,"declarationRange")),
        "export kind, occurrence or definition differs"))return false;
      previous=name;SourceAnchor occurrence;if(!s.range(field(e,"range"),occurrence))return false;
      exports.rows.emplace(name,&e);
      const ModuleEdge *enclosing=nullptr;
      for(const auto &edge:exports.edges){
        if(!m.spend())return false;
        if(contains(edge.range,occurrence)){enclosing=&edge;break;}
      }
      const auto forward=exports.named.find(name);
      if(forward!=exports.named.end()||(enclosing&&enclosing->named)){
        if(!m.need(forward!=exports.named.end()&&same(field(*forward->second.alias,"target"),field(e,"target"))&&
          same(field(*forward->second.alias,"range"),field(e,"range")),"named re-export differs from original alias"))return false;
        named.emplace(&e,ExportLink{forward->second.upstream,field(*forward->second.alias,"imported").getAsString().value_or("")});++matchedNamed;
      }
      if(enclosing){
        if(forward==exports.named.end())exports.claims.emplace(name,&e);
        continue;
      }
      bool withinDeclaration=false;
      for(const auto &range:exports.declarations){
        if(!m.spend())return false;
        if(contains(range,occurrence)){withinDeclaration=true;break;}
      }
      (withinDeclaration?exports.claims:exports.localRows).emplace(name,&e);
    }
    if(!m.need(matchedNamed==exports.named.size(),"original named re-export directory is incomplete"))return false;
    for(const auto &original:exports.originals)
      if(!directExport(m,exports,direct,original.name,original.target,*original.range))return false;
  }
  const std::vector<Json> emptyCoverage;
  for(auto &[path,exports]:evidence){
    const auto spans=coverage.find(path);
    const auto &segments=spans==coverage.end()?emptyCoverage:spans->second;
    if(!completeModuleSource(m,syntax.at(path),segments,bodies.visible.at(path),exports,direct,named))return false;
  }
  for(const auto &module:evidence){
    const auto &exports=module.second;
    for(const auto &[name,claim]:exports.claims)
      if(!reachesDeclaration(m,direct,named,exports,name,*claim))return false;
  }
  return true;
}
} // namespace tsfg::commonProgram
