// SPDX-License-Identifier: MIT
#include "formal-exception-source.h"
#include "array-owner-json.h"
#include "bytecode.h"
#include "llvm/Support/ConvertUTF.h"
#include <algorithm>
namespace tsfg::formalException {
namespace {
bool document(llvm::StringRef raw,Json &out){return bool(arrays::ownerproof::parseCanonical((raw+"\n").str(),out));}
std::string domainHash(llvm::StringRef domain,llvm::StringRef raw){return digest((domain+llvm::StringRef("\0",1)+raw).str());}
bool lowerHex(llvm::StringRef text,size_t length){return text.size()==length&&std::all_of(text.begin(),text.end(),
  [](char c){return (c>='0'&&c<='9')||(c>='a'&&c<='f');});}
bool hashShape(const Json &value){const auto text=string(value);return llvm::StringRef(text).starts_with("sha256:")&&lowerHex(llvm::StringRef(text).drop_front(7),64);}
bool utf16(llvm::StringRef raw,std::u16string &out){
  out.resize(raw.size());auto *s=reinterpret_cast<const llvm::UTF8 *>(raw.data()),*end=s+raw.size();
  auto *begin=reinterpret_cast<llvm::UTF16 *>(out.data()),*t=begin;
  if(llvm::ConvertUTF8toUTF16(&s,end,&t,begin+out.size(),llvm::strictConversion)!=llvm::conversionOK)return false;
  out.resize(t-begin);return true;
}
const std::map<std::string,std::string> declarations={
  {"minimal-aggregates-v1.d.ts","sha256:6e55208fcb05c4383ce87a058fc3bf69834bcf04ac51011109771b963729d9a9"},
  {"minimal-conversions-v5.d.ts","sha256:60974c1fa82cc549da3a9268f5d82ab10b58f52e2612a377ee4577f05af52c86"},
  {"minimal-floats-v4.d.ts","sha256:edb7bfe80718ba47175a87a65f2688f1b91420995e7c118dd2c3e4c85c193693"},
  {"minimal-integers-v3.d.ts","sha256:9fc1955899e303b5815590f7150f60662f3cece0a633c94a2a06669cf509a96e"},
  {"minimal-scalars-v2.d.ts","sha256:d629059f5175a580a8a7b19531c7d8cff1bfa7b61320f6638cf4ee25fbf5a141"}};
}
std::string hirIdentity(llvm::StringRef kind,const Json &record){
  return exception::identity("tsfg.exception-hir-candidate."+kind.str()+".v1","sha256:fb37661820a43016639059f0b9e82275414da0de87d2320e5efdfe8423921ee5",record);
}
bool verifySource(Program &p){
  const auto &hir=p.hir,&snapshot=field(hir,"snapshot"),&capture=field(snapshot,"capture"),&origin=field(snapshot,"sourceOrigin");
  if(!p.require(exception::exact(snapshot,{"format","snapshotId","sourceOrigin","inputIdentity","identityInput","sources","target","facts","exports","capture"})
    &&equal(field(snapshot,"format"),exception::format("tsfg.frontend-exception-candidate",exception::snapshotSchema))
    &&equal(field(hir,"format"),Object{{"family","tsfg.exception-hir-candidate"},{"version",2},{"schemaHash","sha256:fb37661820a43016639059f0b9e82275414da0de87d2320e5efdfe8423921ee5"}})
    &&exception::exact(capture,{"request","response"})
    &&exception::exact(origin,{"kind","producerBaseOid","producerDirty","requestSha256","responseSha256","testedInputSetHash"})
    &&string(field(origin,"kind"))=="owned-go-exception-response"&&field(origin,"producerDirty").getAsBoolean().has_value()
    &&lowerHex(string(field(origin,"producerBaseOid")),40)&&hashShape(field(origin,"requestSha256"))
    &&hashShape(field(origin,"responseSha256"))&&hashShape(field(origin,"testedInputSetHash")),"complete owned Source envelope"))return false;
  const auto requestText=string(field(capture,"request")),responseText=string(field(capture,"response"));
  Json request=nullptr,response=nullptr;
  if(!p.require(digest(requestText)==string(field(origin,"requestSha256"))&&digest(responseText)==string(field(origin,"responseSha256"))
    &&document(requestText,request)&&document(responseText,response),"retained Source bytes or bounded canonical frames"))return false;
  if(!p.require(exception::exact(request,{"family","version","schemaHash","input"})
    &&string(field(request,"family"))=="tsfg.exception-facts-request-candidate"&&field(request,"version").getAsInteger()==1
    &&string(field(request,"schemaHash"))==exception::snapshotSchema
    &&exception::exact(response,{"family","version","schemaHash","requestId","packageId","payload"})
    &&string(field(response,"family"))=="tsfg.exception-facts-package-candidate"&&field(response,"version").getAsInteger()==1
    &&string(field(response,"schemaHash"))==exception::snapshotSchema,"Source protocol identity"))return false;
  const auto &input=field(request,"input"),&payload=field(response,"payload");
  if(!p.require(exception::exact(input,{"sourceRoot","rootFile","files","declarations","config"},{"target","compilationClosure"})
    &&exception::exact(payload,{"inputIdentity","files","facts","exports"}),"complete Source input/payload"))return false;
  const auto root=string(field(input,"sourceRoot")),rootFile=string(field(input,"rootFile"));
  const auto &decl=field(input,"declarations");const auto version=string(field(decl,"version"));
  const bool aggregate=version=="minimal-conversions-v5";
  if(!p.require(validSourcePath(root+"/__root__.ts",true)&&root!="/"&&validSourcePath(rootFile,true)
    &&llvm::StringRef(rootFile).starts_with(root+"/")&&llvm::StringRef(rootFile).ends_with(".ts")
    &&!llvm::StringRef(rootFile).ends_with(".d.ts")
    &&exception::exact(decl,{"version","paths"},aggregate?llvm::ArrayRef<llvm::StringRef>{"markerProfile"}:llvm::ArrayRef<llvm::StringRef>{})
    &&(version=="minimal-integers-v3"||version=="minimal-floats-v4"||aggregate),"Source logical roots or declaration profile"))return false;
  Array declarationPaths{root+"/"+version+".d.ts"};Object config{{"strict",true},{"noEmit",true},{"allowJs",false}};
  if(aggregate){
    const auto markerPath=root+"/minimal-aggregates-v1.d.ts";declarationPaths.push_back(markerPath);config["decoratorMode"]="standard";
    const Json expected(Object{{"version","minimal-aggregates-v1"},{"path",markerPath},
      {"sha256",declarations.at("minimal-aggregates-v1.d.ts")},{"contextName","ClassDecoratorContext"},{"contextArity",1},
      {"mode","standard"},{"entries",Array{Object{{"name","tsfgValue"},{"category","value"}},Object{{"name","tsfgComponent"},{"category","component"}}}}});
    if(!p.require(equal(field(decl,"markerProfile"),expected)&&!input.getAsObject()->get("compilationClosure"),"exact Source marker profile"))return false;
  }
  if(!p.require(equal(field(decl,"paths"),Json(Array(declarationPaths)))&&equal(field(input,"config"),Json(std::move(config)))
    &&items(field(input,"files")).size()<=256,"Source declaration/configuration contract"))return false;
  Object normalized=*input.getAsObject();std::map<std::string,std::string> files;
  for(const auto &f:items(field(input,"files"))){
    const auto path=string(field(f,"path")),content=string(field(f,"content"));
    if(!p.step()||!p.require(exception::exact(f,{"path","content"},{"sha256"})&&validSourcePath(path,true)
      &&llvm::StringRef(path).starts_with(root+"/")
      &&field(f,"content").getAsString().has_value()&&files.emplace(path,content).second
      &&(!f.getAsObject()->get("sha256")||string(field(f,"sha256"))==digest(content)),"Source file identity"))return false;
  }
  Array normalizedFiles,manifest,sources;
  std::set<std::string> actualDeclarations;
  for(const auto &[path,content]:files){
    std::u16string units;if(!p.require(utf16(content,units),"Source UTF8/UTF16"))return false;
    normalizedFiles.push_back(Object{{"path",path},{"content",content}});
    manifest.push_back(Object{{"path",path},{"digest",digest(content)},{"byteLength",int64_t(content.size())},
      {"length",int64_t(units.size())},{"positionUnit","utf16"}});
    if(llvm::StringRef(path).ends_with(".d.ts")){
      const auto slash=path.find_last_of('/');const auto found=declarations.find(path.substr(slash+1));
      if(!p.require(found!=declarations.end()&&found->second==digest(content),"unapproved declaration bytes"))return false;
      actualDeclarations.insert(path);
    }else sources.push_back(Object{{"path",path},{"content",content},{"hash",digest(content)},
      {"length",int64_t(units.size())},{"positionUnit","utf16"}});
  }
  std::set<std::string> declared;
  for(const auto &path:items(field(field(input,"declarations"),"paths")))
    if(!p.require(path.getAsString()&&declared.insert(string(path)).second,"duplicate declaration path"))return false;
  if(!p.require(!sources.empty()&&files.count(rootFile)&&declared==actualDeclarations
    &&(input.getAsObject()->get("compilationClosure")||sources.size()==1),"whole Source/declaration closure"))return false;
  normalized["files"]=std::move(normalizedFiles);const Json identityInput(std::move(normalized));
  const auto inputId=digest(canonical(identityInput));
  const auto &target=field(input,"target");
  if(!p.require(string(field(target,"target"))==coreHeader::target&&string(field(target,"triple"))==coreHeader::triple
    &&string(field(target,"llvmDataLayout"))==coreHeader::layout&&string(field(target,"pointerBits"))=="64"
    &&equal(field(snapshot,"identityInput"),identityInput)&&equal(field(snapshot,"sources"),Json(Array(sources)))
    &&equal(field(hir,"sources"),Json(Array(sources)))&&equal(field(payload,"files"),Json(std::move(manifest)))
    &&equal(field(snapshot,"target"),target)&&equal(field(hir,"target"),target)
    &&string(field(snapshot,"inputIdentity"))==inputId&&string(field(hir,"inputIdentity"))==inputId
    &&string(field(payload,"inputIdentity"))==inputId&&equal(field(payload,"facts"),field(snapshot,"facts"))
    &&equal(field(payload,"exports"),field(snapshot,"exports")),"cold Source input, manifest or semantic evidence join"))return false;
  const auto package=digest((llvm::StringRef("tsfg.exception-facts.package.v1")+llvm::StringRef("\0",1)
    +exception::snapshotSchema+llvm::StringRef("\0",1)+canonical(payload)).str());
  const auto snapshotId=digest((llvm::StringRef("tsfg.frontend-exception-candidate.snapshot.v1")+llvm::StringRef("\0",1)
    +exception::snapshotSchema+llvm::StringRef("\0",1)+canonical(Object{{"inputIdentity",inputId},{"sourceOrigin",origin}})).str());
  if(!p.require(string(field(response,"requestId"))==domainHash("tsfg.exception-facts.request.v1",requestText)
    &&string(field(response,"packageId"))==package&&string(field(snapshot,"snapshotId"))==snapshotId,"Source custody identities"))return false;
  return SourceProof(p).run();
}
}
