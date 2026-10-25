// SPDX-License-Identifier: MIT
#pragma once
#include "common-program.h"
#include <functional>
namespace tsfg::commonProgram {
using exception::field;using exception::items;using exception::string;
inline constexpr llvm::StringLiteral sourceSchema="sha256:430f7783911dc9e421278e63fb356236f053a546afa2619a5bad27fd453d417d";
inline constexpr llvm::StringLiteral hirSchema="sha256:532f54c330e52b4fc836e4aeddf13f167c586e73a7b47e051c13d2b82231a091";
// Private conversion state. Protocol IDs and semantic IDs never share a map.
struct SourceModel {
  Program &p;Error &error;const Json &facts,&payload;
  std::map<std::string,const Json *> types,functions,globals,sources,modules;
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
};
bool verifySourceShape(SourceModel &);
inline std::string moduleId(llvm::StringRef path){return digest(std::string("tsfg.module")+std::string(1,'\0')+path.str());}
inline std::string initializerId(llvm::StringRef path){return identity("initializer",Object{{"module",moduleId(path)}});}
inline Json declKey(const Json &path,const Json &scope,llvm::StringRef kind,const Json &name){
  return Object{{"sourcePath",path},{"path",scope},{"kind",kind.str()},{"name",name}};
}
} // namespace tsfg::commonProgram
