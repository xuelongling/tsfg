// SPDX-License-Identifier: MIT
#include "common-program-syntax.h"
#include "common-program-relations.h"
#include "bytecode.h"
#include "llvm/ADT/STLExtras.h"
#include <optional>
namespace tsfg::commonProgram {
namespace {
bool path(llvm::StringRef value){
  if(!value.starts_with("/")||value.contains('\\')||value.contains('\0')||value.contains(':'))return false;
  llvm::SmallVector<llvm::StringRef> parts;value.drop_front().split(parts,'/');
  return !parts.empty()&&llvm::all_of(parts,[](llvm::StringRef part){return !part.empty()&&part!="."&&part!="..";});
}
Json anchor(const Json &v){return Object{{"start",field(v,"start")},{"end",field(v,"end")}};}
bool files(SourceModel &m,std::map<std::string,SourceSyntax> &syntax){
  const auto root=string(field(m.payload,"sourceRoot")),primary=string(field(m.payload,"rootFile"));
  if(!m.need(path(root)&&path(primary)&&llvm::StringRef(primary).starts_with(root+"/")&&
    llvm::StringRef(primary).ends_with(".ts")&&!llvm::StringRef(primary).ends_with(".d.ts")&&m.sources.count(primary)&&
    string(field(m.payload,"positionUnit"))=="utf16"&&same(field(m.payload,"config"),Object{{"strict",true},{"noEmit",true},{"allowJs",false}})&&
    items(field(m.payload,"diagnostics")).empty(),"complete Source root/config/diagnostics differ"))return false;
  size_t bytes=0;std::string previous;
  for(const auto &s:items(field(m.payload,"files"))){
    const auto p=string(field(s,"path")),content=string(field(s,"content"));
    if(!m.spend()||!m.need(path(p)&&llvm::StringRef(p).starts_with(root+"/")&&llvm::StringRef(p).ends_with(".ts")&&
      (previous.empty()||previous<p)&&field(s,"byteLength").getAsInteger()==int64_t(content.size())&&
      string(field(s,"sha256"))==digest(content).substr(7)&&content.size()<=1048576-bytes,"Source path/order/bytes/hash differ"))return false;
    bytes+=content.size();previous=p;SourceSyntax text{m,p};if(!text.read(content)||
      !m.need(field(s,"utf16Length").getAsInteger()==int64_t(text.content.size()),"Source UTF16 length differs"))return false;
    if(p==primary&&!m.need(m.p.sourceHash==digest(content)&&m.p.sourceLength==text.content.size(),"primary Core Source identity differs"))return false;
    if(!llvm::StringRef(p).ends_with(".d.ts"))syntax.emplace(p,std::move(text));
  }
  const auto dts=root+"/minimal-arrays-v8.d.ts";
  if(!m.need(m.sources.size()>=2&&m.sources.count(dts)&&string(field(*m.sources.at(dts),"sha256"))=="0d30a2f626bb7455decf36f5a7a8d3308d4254100d2cb10e7c0d2353d28b141e"&&
    same(field(m.payload,"declarations"),Object{{"version","minimal-arrays-v8"},{"paths",Array{Json(dts)}}})&&syntax.size()==m.modules.size(),"fixed declaration or complete module set differs"))return false;
  const auto &target=field(m.payload,"target");
  return m.need(same(target,Object{{"target",coreHeader::target},{"triple",coreHeader::triple},{"pointerBits","64"},{"llvmDataLayout",coreHeader::layout}}),"ordinary exact target differs");
}
bool closure(SourceModel &m){
  Array roots,required;std::set<std::string> selected;
  const auto read=[&](llvm::StringRef key,Array &out){
    const auto &rows=items(field(field(m.payload,"closure"),key));
    if(!m.need(rows.size()<=128&&(key!="roots"||!rows.empty()),"complete closure bounds differ"))return false;std::string previous;
    for(const auto &r:rows){
      const auto kind=string(field(r,"kind")),p=string(field(r,"sourcePath")),name=string(field(r,"name")),target=string(field(r,"target"));
      const auto order=kind+std::string(1,'\0')+p+std::string(1,'\0')+name;
      if(!m.spend()||!m.need(m.modules.count(p)&&!name.empty()&&name.find('\0')==std::string::npos&&
        (previous.empty()||previous<order)&&llvm::is_contained(llvm::ArrayRef<llvm::StringRef>{"application","module-initialization","host-export","host-callback","hot-function","kernel"},kind),"closure root original tuple differs"))return false;
      previous=order;
      if(kind=="module-initialization"){
        if(!m.need(name=="$moduleInit"&&target==p&&same(field(r,"range"),Object{{"start",0},{"end",field(*m.sources.at(p),"utf16Length")}}),"module initialization root identity differs"))return false;
      }else if(!m.need(m.functions.count(target)&&same(field(*m.functions.at(target),"sourcePath"),field(r,"sourcePath"))&&
        same(field(*m.functions.at(target),"name"),field(r,"name"))&&same(field(*m.functions.at(target),"declarationRange"),field(r,"range")),"function root does not join original full declaration"))return false;
      if(key=="roots")selected.insert(canonical(r));else if(!m.need(selected.count(canonical(r)),"required root missing from selected closure"))return false;
      out.push_back(Object{{"kind",kind},{"sourcePath",p},{"name",name}});
    }return true;
  };
  if(!read("roots",roots)||!read("requiredRoots",required))return false;
  Array sourceFiles;for(const auto &s:items(field(m.payload,"files"))){if(!m.spend())return false;sourceFiles.push_back(Object{{"path",field(s,"path")},{"content",field(s,"content")},{"sha256",field(s,"sha256")}});}
  Json request=Object{{"family","tsfg.program-facts-request-candidate"},{"version",1},{"schemaHash",sourceSchema},
    {"input",Object{{"sourceRoot",field(m.payload,"sourceRoot")},{"rootFile",field(m.payload,"rootFile")},{"files",std::move(sourceFiles)},
      {"declarations",field(m.payload,"declarations")},{"config",field(m.payload,"config")},{"target",field(m.payload,"target")},
      {"compilationClosure",Object{{"roots",std::move(roots)},{"requiredRoots",std::move(required)}}}}}};
  return m.need(string(field(m.facts,"requestId"))==digest(std::string("tsfg.program-facts.request.v1")+std::string(1,'\0')+canonical(request)+"\n"),"whole request identity differs");
}
}
bool SourceModel::sourceText(){
  std::map<std::string,SourceSyntax> syntax;
  if(!files(*this,syntax)||!closure(*this))return false;
  SourceRelations relations{*this};if(!relations.read())return false;
  SourceBodies bodies{*this,syntax};bodies.relations=&relations;if(!bodies.inventory())return false;
  std::set<std::pair<std::string,std::string>> entryParameters,expectedEntries;std::set<std::string> exported;Array expectedExports;
  for(const auto &e:items(field(*modules.at(string(field(payload,"rootFile"))),"exports")))if(string(field(e,"kind"))=="function"){
    if(!spend()||!need(functions.count(string(field(e,"target"))),"root export function missing"))return false;
    expectedExports.push_back(Object{{"name",field(e,"name")},{"functionId",field(e,"target")}});exported.insert(string(field(e,"target")));
  }
  if(!need(same(Json(std::move(expectedExports)),field(payload,"exports")),"function exports differ from actual root module exports"))return false;
  for(const auto &id:exported)for(const auto &p:items(field(*functions.at(id),"parameters"))){if(!spend())return false;expectedEntries.emplace(id,string(field(p,"id")));}
  std::optional<std::pair<std::string,std::string>> priorEntry;
  for(const auto &entry:items(field(payload,"entryCompatibilityRoots"))){
    const auto fn=string(field(entry,"functionId")),binding=string(field(entry,"parameterBinding"));
    const auto identity=std::pair{fn,binding};
    if(!spend()||!need(exported.count(fn)&&entryParameters.insert(identity).second&&(!priorEntry||*priorEntry<identity),"entry exported parameter identity/order differs"))return false;
    priorEntry=identity;
    const auto &owner=*functions.at(fn);const Json *parameter=nullptr;
    for(const auto &p:items(field(owner,"parameters"))){if(!spend())return false;if(string(field(p,"id"))==binding){parameter=&p;break;}}
    if(!need(parameter&&same(field(entry,"viewType"),field(*parameter,"declaredType"))&&same(field(entry,"origin"),Object{{"source",field(owner,"sourcePath")},
      {"start",field(field(*parameter,"declarationRange"),"start")},{"end",field(field(*parameter,"declarationRange"),"end")}}),"entry view/origin does not join original parameter"))return false;
    if(!relations.entry(entry))return false;
  }
  if(!need(entryParameters==expectedEntries,"exported parameter entry directory is incomplete"))return false;
  // The source and declaration envelopes must cover every ordinary token.
  std::map<std::string,std::vector<Json>> coverage;
  for(const auto &[id,fn]:functions){
    if(!bodies.function(*fn))return false;if(field(*fn,"ownerType").getAsNull())coverage[string(field(*fn,"sourcePath"))].push_back(field(*fn,"declarationRange"));
  }
  for(const auto &[path,module]:modules){
    if(!bodies.module(*module))return false;
    for(const auto &edge:items(field(*module,"imports")))coverage[path].push_back(field(edge,"range"));
    for(const auto &r:items(field(*module,"initialization"))){
      auto r2=field(r,"range");if(string(field(r,"kind"))=="initialize"){
        size_t a,b;if(!syntax.at(path).span(r2,a,b)||!need(a>0,"global prefix absent"))return false;--a;
        if(a>0&&syntax.at(path).tokens[a-1].text=="export")--a;
        if(b<syntax.at(path).tokens.size()&&syntax.at(path).tokens[b].text==";")++b;
        r2=Object{{"start",int64_t(syntax.at(path).tokens[a].start)},{"end",int64_t(syntax.at(path).tokens[b-1].end)}};
      }coverage[path].push_back(std::move(r2));
    }
  }
  if(!verifyCommonDeclarations(*this,bodies,syntax,coverage)||!verifyCommonModules(*this,syntax))return false;
  for(auto &[path,text]:syntax){
    std::vector<std::pair<size_t,size_t>> spans;
    for(const auto &r:coverage[path]){if(!spend())return false;size_t a,b;if(!text.span(r,a,b))return false;spans.emplace_back(a,b);}
    std::sort(spans.begin(),spans.end());size_t at=0;
    for(auto [a,b]:spans){if(!need(a==at,"missing, overlapping or repeated complete Source declaration"))return false;at=b;}
    if(!need(at==text.tokens.size(),"unrepresented ordinary Source top-level tokens"))return false;
  }
  return relations.finish();
}
} // namespace tsfg::commonProgram
