// SPDX-License-Identifier: MIT
#include "system-query-source.h"
#include "common-program-header.h"
#include "component-layout.h"
#include "llvm/ADT/STLExtras.h"
namespace tsfg::systemQuery {
namespace {
constexpr llvm::StringLiteral schema="sha256:7b47b293ae3feb815e10b651ea9e2b0994bb894e96544379dcf2ba3f15eb2e88";
constexpr llvm::StringLiteral profile="/src/system-query-context.d.ts";
constexpr llvm::StringLiteral profileHash="7fefda1fbc86170ff7c6479a4f3646ff8194b8dc5f7476107763c3c11fab604b";
constexpr llvm::StringLiteral standard="/src/minimal-arrays-v8.d.ts";
constexpr llvm::StringLiteral standardHash="0d30a2f626bb7455decf36f5a7a8d3308d4254100d2cb10e7c0d2353d28b141e";
std::string hashed(llvm::StringRef domain,const std::string &body){return digest(domain.str()+std::string(1,'\0')+body);}
bool path(llvm::StringRef v){
  if(!v.starts_with("/")||v.contains('\\')||v.contains('\0')||v.contains(':'))return false;
  llvm::SmallVector<llvm::StringRef> parts;v.drop_front().split(parts,'/');
  return !parts.empty()&&llvm::all_of(parts,[](auto p){return !p.empty()&&p!="."&&p!="..";});
}
}
bool Model::metadata(mlir::ModuleOp module){
  coreHeader::Identity header;
  if(!need(coreHeader::read(module,header),"private Core header differs"))return false;
  const auto text=[&](llvm::StringRef key){auto value=module->getAttrOfType<mlir::StringAttr>(key);return value?value.getValue():llvm::StringRef();};
  const auto version=module->getAttrOfType<mlir::IntegerAttr>("tsfg.query_version");
  bound=text("tsfg.query_stage")=="bound";
  if(!need(version&&version.getType().isSignlessInteger(32)&&version.getInt()==3&&
    (bound||text("tsfg.query_stage")=="logical"),"owned Query stage/version differs"))return false;
  std::set<std::string> attrs={"tsfg_core.version","tsfg_core.bytecode_schema","tsfg_core.input_identity","tsfg_core.source_path",
    "tsfg_core.source_hash","tsfg_core.source_length","tsfg_core.target","tsfg_core.triple","tsfg_core.data_layout",
    "tsfg.query_version","tsfg.query_stage","tsfg.query_facts","tsfg.query_request"};
  if(bound)attrs.insert("tsfg.query_layouts");
  if(!need(module->getAttrs().size()==attrs.size(),"mixed or unknown Core module representation"))return false;
  for(auto attr:module->getAttrs())if(!need(attrs.count(attr.getName().str()),"unknown Query module attribute"))return false;
  Json packet=nullptr;
  if(!readJson(text("tsfg.query_facts"),packet,p,error)||!readJson(text("tsfg.query_request"),request,p,error)||
    !need(exact(packet,{"family","version","schemaHash","requestId","packageId","payload"})&&
      string(field(packet,"family"))=="tsfg.system-query-facts-package-candidate"&&number(field(packet,"version"))==4&&
      string(field(packet,"schemaHash"))==schema,"owned Source package boundary differs"))return false;
  const auto &payload=field(packet,"payload");
  if(!need(exact(payload,{"program","profilePath","profileSHA256","nodes","builtins","types","functions","markerAliases","systems","scalarHelpers"})&&
    string(field(packet,"packageId"))==hashed("tsfg.system-query.package.v4",schema.str()+std::string(1,'\0')+canonical(payload))&&
    string(field(packet,"requestId"))==hashed("tsfg.system-query.request.v4",canonical(request)+"\n"),"original Source package/request identity differs"))return false;
  p.hir=Object{{"snapshot",std::move(packet)}};p.sourcePath=header.sourcePath.str();p.sourceLength=header.sourceLength;
  p.inputIdentity="sha256:"+bytecode::hex(header.input);p.sourceHash="sha256:"+bytecode::hex(header.source);
  source=std::make_unique<SourceModel>(p,error);
  return need(string(field(source->facts,"requestId"))==p.inputIdentity,"Core input identity is not original Source request");
}
bool Model::files(){
  const auto &program=field(payload(),"program");
  if(!need(exact(program,{"sourceRoot","rootFile","files","declarations","config","target","positionUnit","diagnostics"})&&
    field(program,"diagnostics").getAsArray()&&items(field(program,"diagnostics")).empty()&&
    field(program,"files").getAsArray()&&string(field(program,"positionUnit"))=="utf16"&&
    same(field(program,"config"),Object{{"strict",true},{"noEmit",true},{"allowJs",false}})&&
    same(field(program,"target"),Object{{"target",coreHeader::target},{"triple",coreHeader::triple},{"pointerBits","64"},{"llvmDataLayout",coreHeader::layout}})&&
    same(field(program,"declarations"),Object{{"version","minimal-arrays-v8"},{"paths",Array{Json(standard),Json(profile)}}}),"complete Source program/options/target differs"))return false;
  const auto root=string(field(program,"sourceRoot")),primary=string(field(program,"rootFile"));
  if(!need(path(root)&&path(primary)&&primary==p.sourcePath&&llvm::StringRef(primary).starts_with(root+"/")&&!llvm::StringRef(primary).ends_with(".d.ts"),"original primary Source differs"))return false;
  Array requested;size_t total=0;std::string previous;
  for(const auto &file:items(field(program,"files"))){
    const auto name=string(field(file,"path")),content=string(field(file,"content"));
    if(!spend()||!need(exact(file,{"path","content","sha256","byteLength","utf16Length"})&&path(name)&&
      llvm::StringRef(name).starts_with(root+"/")&&llvm::StringRef(name).ends_with(".ts")&&(previous.empty()||previous<name)&&
      number(field(file,"byteLength"))==int64_t(content.size())&&string(field(file,"sha256"))==digest(content).substr(7)&&
      content.size()<=1048576-total,"original Source content/order/budget differs"))return false;
    total+=content.size();previous=name;SourceSyntax grammar{*source,name};
    if(!grammar.read(content)||!need(number(field(file,"utf16Length"))==int64_t(grammar.content.size()),"Source UTF16 length differs"))return false;
    if(name==primary&&!need(p.sourceHash==digest(content)&&p.sourceLength==grammar.content.size(),"Core original Source hash/length differs"))return false;
    source->sources.emplace(name,&file);syntax.emplace(name,std::move(grammar));
    requested.push_back(Object{{"path",name},{"content",content},{"sha256",field(file,"sha256")}});
  }
  const Json expected=Object{{"family","tsfg.system-query-facts-request-candidate"},{"version",4},{"schemaHash",schema},
    {"input",Object{{"sourceRoot",root},{"rootFile",primary},{"files",std::move(requested)},
      {"declarations",field(program,"declarations")},{"config",field(program,"config")},{"target",field(program,"target")}}}};
  return need(source->sources.count(primary)&&source->sources.count(profile.str())&&source->sources.count(standard.str())&&
    string(field(*source->sources.at(profile.str()),"sha256"))==profileHash&&string(field(*source->sources.at(standard.str()),"sha256"))==standardHash&&
    string(field(payload(),"profilePath"))==profile&&string(field(payload(),"profileSHA256"))==profileHash&&same(request,expected),"complete pinned context or original request differs");
}
bool Model::ast(){
  if(!need(field(payload(),"nodes").getAsArray(),"original AST array required"))return false;
  std::set<std::string> roots;
  for(const auto &node:items(field(payload(),"nodes"))){
    const auto id=string(field(node,"id")),parent=string(field(node,"parent")),path=string(field(node,"sourcePath"));
    const auto kind=string(field(node,"kind")),name=string(field(node,"name"));const auto &r=field(node,"range"),&nr=field(node,"nameRange");
    if(!spend()||!need(exact(node,{"id","parent","sourcePath","kind","range","name","nameRange"})&&syntax.count(path)&&!nodes.count(id)&&
      exact(r,{"start","end"})&&number(field(r,"start"))>=0&&number(field(r,"end"))>=number(field(r,"start"))&&
      number(field(r,"end"))<=int64_t(grammar(path).content.size()),"original AST inventory/range differs"))return false;
    auto &text=grammar(path);const auto start=number(field(r,"start")),end=number(field(r,"end"));
    const auto boundary=[&](int64_t n){return n<=0||n>=int64_t(text.content.size())||text.content[n]<0xdc00||text.content[n]>0xdfff||text.content[n-1]<0xd800||text.content[n-1]>0xdbff;};
    if(!need(boundary(start)&&boundary(end),"AST range splits UTF16 pair"))return false;
    if(parent.empty()){if(!need(kind=="KindSourceFile"&&roots.insert(path).second,"one original Source root required"))return false;}
    else if(!need(nodes.count(parent)&&string(field(*nodes.at(parent),"sourcePath"))==path&&
      number(field(field(*nodes.at(parent),"range"),"start"))<=start&&number(field(field(*nodes.at(parent),"range"),"end"))>=end,"original AST parent closure differs"))return false;
    if(nr.getAsNull()){if(!need(name.empty(),"unnamed AST node has spelling"))return false;}
    else if(!text.name(nr,name)||!need(number(field(nr,"start"))>=start&&number(field(nr,"end"))<=end,"AST name outside declaration"))return false;
    if(!need(id==hashed("tsfg.system-query.node.v1",canonical(Object{{"sourcePath",path},{"kind",kind},{"range",r},{"parent",parent}})),"original AST node identity differs"))return false;
    nodes.emplace(id,&node);children[parent].push_back(&node);
  }
  if(!need(roots.size()==syntax.size(),"complete original Source root inventory differs"))return false;
  for(const auto &[id,node]:nodes)if(string(field(*node,"parent")).empty()){
    auto &g=grammar(string(field(*node,"sourcePath")));std::vector<Json> pieces;
    for(auto *child:children[id])if(number(field(field(*child,"range"),"end"))>number(field(field(*child,"range"),"start")))pieces.push_back(field(*child,"range"));
    if(g.tokens.empty()){if(!need(pieces.empty(),"nonempty AST for empty Source file"))return false;continue;}
    const Json envelope=Object{{"start",int64_t(g.tokens.front().start)},{"end",int64_t(g.tokens.back().end)}};
    if(!g.sequence(envelope,pieces))return false;
  }
  return true;
}
const Json *Model::at(llvm::StringRef path,const Json &range,llvm::StringRef kind){
  for(const auto &[id,node]:nodes){if(!spend())return nullptr;if(string(field(*node,"sourcePath"))==path&&same(field(*node,"range"),range)&&(kind.empty()||string(field(*node,"kind"))==kind))return node;}
  need(false,"original AST occurrence missing");return nullptr;
}
const Json *Model::original(const Json &value){
  if(!need(exact(value,{"id","sourcePath","kind","name","range","nameRange"}),"original Source origin boundary differs"))return nullptr;
  const auto path=string(field(value,"sourcePath"));auto *node=at(path,field(value,"range"),string(field(value,"kind")));
  if(!node)return nullptr;
  const auto &nr=field(value,"nameRange");
  if(!need(originId(path,nr)==string(field(value,"id"))&&string(field(*node,"name"))==string(field(value,"name"))&&
    same(field(*node,"nameRange").getAsNull()?field(*node,"range"):field(*node,"nameRange"),nr),"original Source binding/name differs"))return nullptr;
  return node;
}
bool Model::types(){
  const auto &types=field(payload(),"types"),&functions=field(payload(),"functions");
  if(!need(items(types).size()<=4096&&items(functions).size()<=4096,"Source catalog bound exceeded")||
    !verifySourceShapeValue(*source,types,"[]arrayGenericType")||!verifySourceShapeValue(*source,functions,"[]arrayGenericFunction"))return false;
  for(const auto &type:items(types)){
    if(!spend()||!need(source->types.emplace(string(field(type,"id")),&type).second,"duplicate original type"))return false;
    const auto &ctor=field(type,"constructor");if(ctor.getAsObject())source->functions.emplace(string(field(ctor,"id")),&ctor);
    for(const auto &f:items(field(type,"fields")))if(!need(fields.emplace(string(field(f,"id")),&f).second,"duplicate original field"))return false;
  }
  for(const auto &fn:items(functions))if(!need(source->functions.emplace(string(field(fn,"id")),&fn).second,"duplicate original function"))return false;
  if(!source->identities())return false;
  Array rows;for(const auto &[id,type]:source->types){auto translated=source->projectType(*type);if(!error.code.empty())return false;rows.push_back(std::move(translated));}
  Program layoutInput;layoutInput.remaining=p.remaining;layoutInput.hir=Object{{"types",std::move(rows)},{"target",field(field(payload(),"program"),"target")}};
  const bool valid=componentLayoutCatalog(layoutInput,layouts,error);p.remaining=layoutInput.remaining;return valid;
}
std::string Model::selectionId(const Json &query)const{
  Array rows;for(const auto &item:items(field(query,"items")))rows.push_back(Object{{"componentType",source->typeIds.at(string(field(item,"componentType")))},{"mode",field(item,"mode")}});
  return hashed("tsfg.query.type.v1",canonical(Json(std::move(rows))));
}
bool Model::inventory(){
  std::set<std::string> expectedSystems,expectedComponents,seenSystems,seenComponents;
  const auto key=[](const std::string &path,const Json &range){return path+std::string(1,'\0')+canonical(range);};
  for(const auto &system:systems)expectedSystems.insert(key(string(field(field(*system.raw,"declaration"),"sourcePath")),field(*system.raw,"markerRange")));
  for(const auto &[id,t]:source->types)if(!field(*t,"markerOrigin").getAsNull())expectedComponents.insert(key(string(field(*t,"sourcePath")),field(field(*t,"markerOrigin"),"range")));
  for(auto &[path,g]:syntax){if(llvm::StringRef(path).ends_with(".d.ts"))continue;size_t braces=0;
    for(size_t i=0;i<g.tokens.size();++i){if(!spend())return false;const auto &token=g.tokens[i];
      if(!braces&&token.text=="@"&&i+1<g.tokens.size()){
        const auto name=g.tokens[i+1].text;const Json r=Object{{"start",int64_t(token.start)},{"end",int64_t(g.tokens[i+1].end)}};
        if(name=="system")seenSystems.insert(key(path,r));
        else if(name=="component"||name=="tsfgComponent"||name=="tsfgValue")seenComponents.insert(key(path,r));
      }
      if(token.text=="{")++braces;else if(token.text=="}"){if(!need(braces>0,"unbalanced complete Source braces"))return false;--braces;}
    }
    if(!need(braces==0,"unbalanced complete Source braces"))return false;
  }
  return need(expectedSystems==seenSystems&&expectedComponents==seenComponents,"complete Source marked system/component inventory differs");
}
} // namespace tsfg::systemQuery
