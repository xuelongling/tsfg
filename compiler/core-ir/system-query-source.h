// SPDX-License-Identifier: MIT
#pragma once
#include "system-query.h"
#include "common-program-syntax.h"
#include <memory>
namespace tsfg::systemQuery {
using namespace commonProgram;
struct Parameter {const Json *raw=nullptr;std::string type,selection;};
struct System {const Json *raw=nullptr;std::string id,signature;std::vector<Parameter> parameters;};
struct Model {
  Program p;Error error;Json request=nullptr,layouts=nullptr;
  std::unique_ptr<SourceModel> source;
  std::map<std::string,SourceSyntax> syntax;
  std::map<std::string,const Json *> nodes,builtins,fields;
  std::map<std::string,std::string> declarationNames;
  std::map<std::string,std::vector<const Json *>> children;
  std::vector<System> systems;bool bound=false;
  bool need(bool condition,llvm::StringRef message){return condition||reject(error,"core-ir-query-source",message);}
  bool spend(size_t n=1){return p.charge(n)||reject(error,"core-ir-query-budget","owned Query work exceeded");}
  const Json &payload()const{return source->payload;}
  SourceSyntax &grammar(const std::string &path){return syntax.at(path);}
  const Json *at(llvm::StringRef path,const Json &range,llvm::StringRef kind={});
  const Json *original(const Json &);
  bool metadata(mlir::ModuleOp);bool files();bool ast();bool types();bool declarations();bool bodies();bool inventory();
  bool selection(const Json &,const std::string &,const Json &);
  bool annotation(const std::string &,const Json &,const std::string &,unsigned=0);
  bool ownedMarker(const std::string &,const Json &,const Json &);
  bool sourceName(const Json &,std::string &);
  bool expression(const Json &,const Json &,const std::map<std::string,const Json *> &,const std::string &,unsigned=0);
  bool loop(const Json &,const Json &,const Json &,const std::vector<Parameter> &);
  std::string selectionId(const Json &)const;
};
bool verifyOperations(mlir::ModuleOp,Model &);
bool collectEffects(mlir::ModuleOp,Model &,Json &);
inline int64_t number(const Json &value){return value.getAsInteger().value_or(-1);}
inline std::string originId(llvm::StringRef path,const Json &nameRange){
  return digest(std::string("tsfg.array-facts.binding.v1")+std::string(1,'\0')+canonical(Object{{"sourcePath",path.str()},{"nameRange",nameRange}}));
}
} // namespace tsfg::systemQuery
