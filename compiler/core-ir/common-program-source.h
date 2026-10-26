// SPDX-License-Identifier: MIT
#pragma once
#include "common-program.h"
#include <functional>
namespace tsfg::commonProgram {
using exception::field;using exception::items;using exception::string;
inline constexpr llvm::StringLiteral sourceSchema="sha256:a8f649d600a0f57be48c60415e856b4849898f96f07ecdf443926c555d0642cf";
inline constexpr llvm::StringLiteral hirSchema="sha256:9d8a0772f2111516b02a87bac1cff44b95b40ac6768bab4fb690e2b7275e91ee";
// Private conversion state. Protocol IDs and semantic IDs never share a map.
struct SourceModel {
  Program &p;Error &error;const Json &facts,&payload;
  std::map<std::string,const Json *> types,functions,globals,sources,modules,aliases;
  std::map<std::string,std::string> labels,typeIds,functionIds,signatures,globalIds,fieldIds,constructionIds;
  std::map<std::string,Json> shapes,declKeys;
  std::set<std::string> active;
  explicit SourceModel(Program &p,Error &e):p(p),error(e),facts(field(p.hir,"snapshot")),payload(field(facts,"payload")){}
  bool need(bool condition,llvm::StringRef message){return condition||reject(error,"core-ir-common-source",message);}
  bool spend(size_t n=1){return p.charge(n)||reject(error,"core-ir-common-budget","complete Source reconstruction work exceeded");}
  bool directory();bool identities();bool sourceText();bool projection();
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
inline std::string moduleId(llvm::StringRef path){return digest(std::string("tsfg.module")+std::string(1,'\0')+path.str());}
inline std::string initializerId(llvm::StringRef path){return identity("initializer",Object{{"module",moduleId(path)}});}
inline Json declKey(const Json &path,const Json &scope,llvm::StringRef kind,const Json &name){
  return Object{{"sourcePath",path},{"path",scope},{"kind",kind.str()},{"name",name}};
}
} // namespace tsfg::commonProgram
