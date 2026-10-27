// SPDX-License-Identifier: MIT
#include "common-program-hosts.h"
#include "common-program-syntax.h"
#include "llvm/ADT/STLExtras.h"
namespace tsfg::commonProgram {
namespace {
constexpr llvm::StringLiteral profileText=R"HSC({"abi":{"callingConvention":"c-win64","context":{"alignment":8,"bytes":16,"fields":[{"name":"storage","offset":0,"type":"u32"},{"name":"reserved","offset":4,"type":"u32"},{"name":"events","offset":8,"type":"u64"}]},"guest":{"parameters":["i32"],"returns":"i32"},"native":{"parameters":["runtime-owned-counter-pointer","u32"],"returns":"u32"},"target":"windows-x86_64-msvc"},"binding":{"adapter":"counter","id":31,"signatureHash":"sha256:76a2b373b39865c4ebbc583bf6084f46f2cc9d396cb7d36953e67d586f472af4","symbol":"tsfg_host_counter_bridge"},"family":"tsfg.host-counter-semantic-profile","implementation":[{"path":"runtime/host_counter.c","sha256":"sha256:03da2e65ee50df094e34501ed8aa286b564b19356a437b20479257f458ab2b5e"},{"path":"runtime/host_counter_bridge.c","sha256":"sha256:8918919374d087a9c5ab0fed04c6f33e35d5c30dee7c64684c3f017679fdcad4"}],"semantics":{"borrowedParameters":[],"callbacks":[],"callerResources":"scalar-values-only","effects":[{"access":"read-write","operation":"add-modulo-u32","resource":"runtime.counter.storage"},{"access":"read-write","operation":"increment-modulo-u64","resource":"runtime.counter.events"}],"profile":"runtime-owned-counter-wrapping-v1","retainedParameters":[],"return":"post-write-storage-bits"},"version":1})HSC";
bool work(Program &p,Error &e,size_t n=1){return p.charge(n)||reject(e,"core-ir-common-budget","Host identity work exceeded");}
bool need(bool c,Error &e,llvm::StringRef message){return c||reject(e,"core-ir-common-host",message);}
bool hash(llvm::StringRef value){return value.size()==71&&value.starts_with("sha256:")&&llvm::all_of(value.drop_front(7),[](char c){return (c>='0'&&c<='9')||(c>='a'&&c<='f');});}
bool inputPath(llvm::StringRef path){
  llvm::SmallVector<llvm::StringRef> parts;path.split(parts,'/');
  return !parts.empty()&&llvm::all_of(parts,[](llvm::StringRef part){return !part.empty()&&part!="."&&part!=".."&&
    llvm::all_of(part,[](char c){return (c>='A'&&c<='Z')||(c>='a'&&c<='z')||(c>='0'&&c<='9')||c=='_'||c=='-'||c=='.';});});
}
}
bool verifyCommonHostDeclarations(SourceModel &m){
  std::set<std::string> paths;
  for(const auto &path:items(field(field(m.payload,"declarations"),"paths")))paths.insert(string(path));
  if(!m.need(m.hosts.size()<=1,"only the reviewed ambient Counter import is supported"))return false;
  for(const auto &[id,host]:m.hosts){
    const auto path=string(field(*host,"sourcePath")),name=string(field(*host,"name"));
    if(!m.spend()||!m.need(m.sources.count(path)&&llvm::StringRef(path).ends_with(".d.ts")&&paths.insert(path).second&&
      field(*host,"capabilityId").getAsInteger()==31&&same(field(*host,"parameterTypes"),Array{Json("i32")})&&
      string(field(*host,"returnType"))=="i32"&&m.types.count("i32")&&string(field(*m.types.at("i32"),"kind"))=="scalar","Counter ambient source/type/capability differs"))return false;
    SourceSyntax syntax{m,path};if(!syntax.read(string(field(*m.sources.at(path),"content"))))return false;
    size_t begin,end;
    if(!syntax.span(field(*host,"declarationRange"),begin,end)||!m.need(begin==0&&end==syntax.tokens.size()&&end==11,"ambient declaration has extra or missing syntax"))return false;
    const auto &parameter=syntax.tokens[4];Json parameterRange=Object{{"start",int64_t(parameter.start)},{"end",int64_t(parameter.end)}};
    if(!syntax.name(field(*host,"nameRange"),name)||!syntax.name(parameterRange,parameter.text)||!syntax.sequence(field(*host,"declarationRange"),
      {"declare","function",field(*host,"nameRange"),"(",parameter.text,":","i32",")",":","i32",";"}))return false;
    const Json origin=Object{{"sourcePath",path},{"nameRange",field(*host,"nameRange")}};
    const Json signatureOrigin=Object{{"sourcePath",path},{"declarationRange",field(*host,"declarationRange")}};
    const auto signatureId=digest(std::string("tsfg.array-facts.signature.v8")+std::string(1,'\0')+canonical(signatureOrigin));
    if(!m.need(id==digest(std::string("tsfg.array-facts.binding.v1")+std::string(1,'\0')+canonical(origin))&&same(field(*host,"signature"),
      Object{{"id",signatureId},{"sourcePath",path},{"declarationRange",field(*host,"declarationRange")},{"parameters",Array{Json("i32")}},{"returnType","i32"}}),
      "Host binding/signature does not join its original ambient declaration"))return false;
    const auto scalar=m.type(Json("i32"));Json parameters=Array{Json(scalar)};
    const auto signature=digest(std::string("tsfg.module-callable-signature.candidate.v1")+std::string(1,'\0')+canonical(Object{{"parameters",parameters},{"returns",scalar}}));
    const auto owned=identity("host-import",Object{{"sourcePath",path},{"name",name},{"capabilityId",31},{"signatureHash",signature}});
    m.hostIds[id]=owned;m.hostSignatures[id]=signature;
    m.ownedHosts.emplace(id,Json(Object{{"id",owned},{"sourceBinding",id},{"sourcePath",path},{"name",name},{"capabilityId",31},
      {"parameterTypes",parameters},{"returnType",scalar},{"signatureHash",signature},{"sourceSignature",field(*host,"signature")},
      {"range",field(*host,"declarationRange")},{"nameRange",field(*host,"nameRange")}}));
    m.p.hosts.emplace(owned,HostBinding{owned,id,path,name,signature,scalar,{scalar}});
  }
  for(const auto &[path,source]:m.sources)if(!m.spend()||!m.need(!llvm::StringRef(path).ends_with(".d.ts")||paths.count(path),"unrepresented ambient source"))return false;
  return true;
}
bool verifyCommonHostContext(Program &p,Error &e){
  const auto &context=field(p.hir,"hostContext");
  if(p.hosts.empty())return need(bool(context.getAsNull()),e,"Host-free Program has a Host semantics context");
  if(!need(exact(context,{"contract","identity"})&&exact(field(context,"identity"),{"buildIdentity","buildInputSet"}),e,"complete build-owned Host context required"))return false;
  const auto &identity=field(context,"identity"),&bi=field(identity,"buildIdentity"),&inputs=field(identity,"buildInputSet");
  if(!need(exact(bi,{"buildInputSetDigest","options","profile","source_date_epoch","target","toolchainClosureDigest","digest"})&&
    exact(inputs,{"entries","schemaVersion","digest"}),e,"Host build identity shape differs"))return false;
  const auto &options=field(bi,"options");const bool aot=string(field(options,"sourceTarget"))=="tsfg-aot";
  const auto sourceTarget=string(field(options,"sourceTarget")),epoch=string(field(bi,"source_date_epoch"));
  if(!work(p,e,epoch.size()/64+1)||!need((aot?exact(options,{"sourceTarget","simdDispatch","programCore"}):exact(options,{"sourceTarget","simdDispatch"}))&&
    (sourceTarget=="tsfg-vm"||sourceTarget=="tsfg-aot")&&(!aot||hash(string(field(options,"programCore"))))&&
    string(field(bi,"target"))=="windows-x86_64-msvc"&&string(field(bi,"profile"))=="debug"&&
    string(field(options,"simdDispatch"))=="runtime-detected"&&!epoch.empty()&&epoch[0]>='1'&&epoch[0]<='9'&&
    llvm::all_of(epoch,[](char c){return c>='0'&&c<='9';})&&hash(string(field(bi,"toolchainClosureDigest")))&&
    string(field(inputs,"schemaVersion"))=="1"&&field(inputs,"entries").getAsArray()&&!items(field(inputs,"entries")).empty()&&
    items(field(inputs,"entries")).size()<=4096,e,"unsupported Host Runtime build identity"))return false;
  std::map<std::string,std::string> sourceHashes;std::string previous;size_t copyWork=32+epoch.size()/8;
  for(const auto &entry:items(field(inputs,"entries"))){
    const auto path=string(field(entry,"repositoryRelativePath"));
    if(!work(p,e,path.size()/64+5)||!need(exact(entry,{"projectId","repositoryRelativePath","normalizedMode","sha256"})&&
      string(field(entry,"projectId"))=="tsfg"&&inputPath(path)&&(previous.empty()||previous<path)&&
      (string(field(entry,"normalizedMode"))=="100644"||string(field(entry,"normalizedMode"))=="100755")&&hash(string(field(entry,"sha256"))),e,"Host input-set entry differs"))return false;
    copyWork+=5+(path.size()+string(field(entry,"projectId")).size()+string(field(entry,"normalizedMode")).size()+string(field(entry,"sha256")).size())/8;
    previous=path;sourceHashes.emplace(path,string(field(entry,"sha256")));
  }
  // Pay before canonical identity copying and the owned HIR context copy.
  if(!work(p,e,copyWork*2+profileText.size()/4+1))return false;
  Object biBody=*bi.getAsObject();biBody.erase("digest");
  if(!need(digest(canonical(Json(Object(biBody))))==string(field(bi,"digest"))&&
    digest(canonical(Object{{"entries",field(inputs,"entries")},{"schemaVersion",field(inputs,"schemaVersion")}}))==string(field(inputs,"digest"))&&
    same(field(inputs,"digest"),field(bi,"buildInputSetDigest")),e,"Host BuildIdentity/BuildInputSet digest differs"))return false;
  Json profile=nullptr;if(!readJson(profileText,profile,p,e))return false;
  for(const auto &implementation:items(field(profile,"implementation"))){
    if(!work(p,e)||!need(sourceHashes[string(field(implementation,"path"))]==string(field(implementation,"sha256")),e,"Host implementation is not the reviewed Counter"))return false;
  }
  Object body=*profile.getAsObject();body["family"]="tsfg.host-semantic-contract";body["buildIdentityDigest"]=field(bi,"digest");
  const auto contractHash=digest(std::string("tsfg.host-semantic-contract.v1")+std::string(1,'\0')+canonical(Json(Object(body))));
  body["digest"]=contractHash;
  if(!need(same(field(context,"contract"),Json(std::move(body))),e,"complete implementation-bound Host contract differs"))return false;
  p.hostContractHash=contractHash;
  for(const auto &effect:items(field(field(profile,"semantics"),"effects"))){if(!work(p,e))return false;p.hostResources.insert(string(field(effect,"resource")));}
  return true;
}
} // namespace tsfg::commonProgram
