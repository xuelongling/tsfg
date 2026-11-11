// SPDX-License-Identifier: MIT
#pragma once
#include "common-program.h"
#include <functional>
namespace CommonReturnOriginV4 {struct Graph;}
namespace tsfg::commonProgram {
using exception::field;using exception::items;using exception::string;
inline constexpr llvm::StringLiteral sourceSchema="sha256:6f6af231a779d6c8e55a4d0acde8fa6e5af5d7c7c2f5b54e6aa5487b34bedb78";
inline constexpr llvm::StringLiteral hirSchema="sha256:c669863a42e3a1e77962dfc58f46d7fca68c5fce09ef85c0678a51191d0d378c";
inline constexpr llvm::StringLiteral sourceConstructorSchema="sha256:27ec37bdb71bbfc957906bcf3bbd5fc5594ab2c7394a97efdee9879addc46ae3";
inline constexpr llvm::StringLiteral hirConstructorSchema="sha256:3d5ac4262b5fd1d8fc0eb4f4fd69c7bb13593b7b18836f26ef3d7906fd9ce076";
// Nullable storage retains one original callable signature; absence contributes
// no code target. Other unions do not acquire a callable transfer contract.
template<class Spend> const Json *commonCallableType(const std::map<std::string,const Json *> &types,const std::string &id,Spend spend){
  const auto found=types.find(id);if(found==types.end())return nullptr;const auto *type=found->second;
  const auto kind=string(field(*type,"kind"));if(kind=="function")return type;if(kind!="union")return nullptr;
  const auto &members=items(field(*type,"members"));if(members.size()<2||members.size()>3)return nullptr;
  const Json *payload=nullptr;
  for(const auto &id:members){if(!spend())return nullptr;const auto *member=types.at(string(id));const auto kind=string(field(*member,"kind"));
    if(kind=="null"||kind=="undefined")continue;if(kind!="function"||payload)return nullptr;payload=member;}
  return payload;
}
// Private conversion state. Protocol IDs and semantic IDs never share a map.
struct ScopeDeclaration {
  const Json *row;Array path;std::vector<const Array *> layers;bool repeated,eligible;
};
struct SourceModel {
  Program &p;Error &error;const Json &facts,&payload;
  std::map<std::string,const Json *> types,functions,globals,sources,modules,aliases,hosts;
  std::map<std::string,std::string> labels,typeIds,functionIds,signatures,globalIds,fieldIds,constructionIds;
  std::map<std::string,Json> shapes,declKeys,ownedHosts;
  std::map<std::string,std::string> hostIds,hostSignatures;
  std::set<std::string> active;
  std::map<std::string,std::map<std::string,ScopeDeclaration>> scopeDeclarations;
  std::map<std::string,std::set<std::string>> functionVars;
  explicit SourceModel(Program &p,Error &e):p(p),error(e),facts(field(p.hir,"snapshot")),payload(field(facts,"payload")){}
  bool need(bool condition,llvm::StringRef message){return condition||reject(error,"core-ir-common-source",message);}
  bool spend(size_t n=1){return p.charge(n)||reject(error,"core-ir-common-budget","complete Source reconstruction work exceeded");}
  bool directory();bool scopeDirectory();bool identities();bool sourceText();bool projection();
  const Json *constructionFunction(const Json &);
  std::string label(const std::string &);
  Json shape(const Json &);
  std::string semanticType(const std::string &);
  std::string type(const Json &v)const;
  std::string target(const Json &v)const;
  Json binding(const Json &);
  Json expression(const Json &);
  Json statements(const Json &);
  Json projectType(const Json &);
  Json projectFunction(const Json &);
  Json environments(Array &);
};
bool verifySourceShape(SourceModel &);
// Same pinned shared DTO boundary for independent source families. This does
// not admit a different package as a common Program or invoke its directory.
bool verifySourceShapeValue(SourceModel &,const Json &,llvm::StringRef);
// Diagnostic provenance is observed by the same owned effects derivation.
// It is not a second effect bound or permission table.
struct EffectDiagnostics {std::map<std::string,Json> local;Array calls;};
struct ReturnOriginAccessWitness {std::vector<size_t> values;unsigned flag=0;Json origin=nullptr;};
struct ActualCheck;
bool prepareReturnOriginContracts(Program &,Error &);
bool prepareReturnOriginStorage(ActualCheck &);
bool finishReturnOriginProofs(Program &,Error &);
// Projects an independently admitted normalized CFG using its owned function,
// type/global/environment/binding directories and complete semantic registerViews.
// No Source body or FDI steps are read; callers must own those admission facts.
// The result is raw equations plus direct effects, not reader/inclusion/domain
// proof or cold authorization. The existing cumulative Program charge is shared.
struct ReturnSourceCatalog;
using ReturnSourceCatalogCache=std::shared_ptr<const ReturnSourceCatalog>;
bool projectNormalizedReturnOriginBody(Program &,const Json &ownedFunction,const Function &admittedCFG,Json &,Effects &,Error &,EffectDiagnostics *diagnostics=nullptr,std::vector<ReturnOriginAccessWitness> *accesses=nullptr,ReturnSourceCatalogCache *catalog=nullptr);
bool deriveReturnOriginBody(Program &,const Json &,Json &,Effects &,Error &,EffectDiagnostics *diagnostics=nullptr,std::vector<ReturnOriginAccessWitness> *accesses=nullptr,ReturnSourceCatalogCache *catalog=nullptr);
// Consumes equations derived from the complete independently owned current
// body, with all semantic views/physical Value capabilities admitted. The raw
// input is not the Published graph, and direct effects/witnesses must also be
// independently derived. The typed body and Domain are always checked; supplied
// return graphs additionally require normalization/inclusion. Open proofs remain
// Pending; physical-effect union and final fixed-upper containment stay external.
// Complete effects do not imply a return/holding certificate. A cold caller
// must independently admit a physical void result before using EffectsComplete.
enum class ProjectedReturnEffects { Invalid, Open, EffectsComplete, ReturnCertificateComplete };
// A narrow exception-potential projection, not a return/holding certificate.
// Inputs are independently typed current/fixed Graph5 and the Program-owned,
// Source-corresponded CFG. Only an unintercepted direct language payload route
// is supported; the complete fixed callee permission, never data liveness,
// supplies the potential. The caller must still run Domain and full inclusion.
enum class DirectThrowPotential {Invalid,Pending,Forwarded};
DirectThrowPotential projectDirectThrowPotential(Program &,const Function &checkedCFG,
  const CommonReturnOriginV4::Graph &current,const CommonReturnOriginV4::Graph &fixed,Error &);
ProjectedReturnEffects deriveProjectedEffects(Program &,const Json &ownedFunction,const Json &currentBody,Effects &direct,Error &,EffectDiagnostics *,const std::vector<ReturnOriginAccessWitness> &);
// Warm effects-only completion requires a trusted normalized physical-void CFG.
ProjectedReturnEffects deriveOwnedEffects(Program &,const Json &,Effects &,Error &,EffectDiagnostics *diagnostics=nullptr,ReturnSourceCatalogCache *catalog=nullptr);
bool fixedReturnOriginAvailable(const Program &,const std::string &);
bool scalarReturnOriginProof(Program &,const std::string &,Error &);
bool deriveScalarEffects(Program &,const Json &,Effects &,Error &);
bool returnOriginMetadataCost(Program &,const Json &,Error &);
bool deriveEffectDiagnostics(Program &,const Json &,Effects &,Error &,EffectDiagnostics &);
inline std::string moduleId(llvm::StringRef path){return digest(std::string("tsfg.module")+std::string(1,'\0')+path.str());}
inline std::string initializerId(llvm::StringRef path){return identity("initializer",Object{{"module",moduleId(path)}});}
inline Json declKey(const Json &path,const Json &scope,llvm::StringRef kind,const Json &name){
  return Object{{"sourcePath",path},{"path",scope},{"kind",kind.str()},{"name",name}};
}
} // namespace tsfg::commonProgram
