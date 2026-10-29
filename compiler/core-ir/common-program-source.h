// SPDX-License-Identifier: MIT
#pragma once
#include "common-program.h"
#include <functional>
namespace tsfg::commonProgram {
using exception::field;using exception::items;using exception::string;
inline constexpr llvm::StringLiteral sourceSchema="sha256:6f6af231a779d6c8e55a4d0acde8fa6e5af5d7c7c2f5b54e6aa5487b34bedb78";
inline constexpr llvm::StringLiteral hirSchema="sha256:c669863a42e3a1e77962dfc58f46d7fca68c5fce09ef85c0678a51191d0d378c";
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
  explicit SourceModel(Program &p,Error &e):p(p),error(e),facts(field(p.hir,"snapshot")),payload(field(facts,"payload")){}
  bool need(bool condition,llvm::StringRef message){return condition||reject(error,"core-ir-common-source",message);}
  bool spend(size_t n=1){return p.charge(n)||reject(error,"core-ir-common-budget","complete Source reconstruction work exceeded");}
  bool directory();bool scopeDirectory();bool identities();bool sourceText();bool projection();
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
bool deriveEffectDiagnostics(Program &,const Json &,const std::map<std::string,Effects> &,Effects &,Error &,EffectDiagnostics &);
inline std::string moduleId(llvm::StringRef path){return digest(std::string("tsfg.module")+std::string(1,'\0')+path.str());}
inline std::string initializerId(llvm::StringRef path){return identity("initializer",Object{{"module",moduleId(path)}});}
inline Json declKey(const Json &path,const Json &scope,llvm::StringRef kind,const Json &name){
  return Object{{"sourcePath",path},{"path",scope},{"kind",kind.str()},{"name",name}};
}
} // namespace tsfg::commonProgram
