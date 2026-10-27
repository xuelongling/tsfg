// SPDX-License-Identifier: MIT
#pragma once
#include "common-program-source.h"
namespace tsfg::commonProgram {
class SourceRelations;
struct SourceToken {std::string text;uint32_t start=0,end=0;};
struct SourceSyntax {
  SourceModel &model;std::string path;std::u16string content;std::vector<SourceToken> tokens;
  bool read(llvm::StringRef);
  bool span(const Json &,size_t &,size_t &)const;
  bool name(const Json &,llvm::StringRef)const;
  bool sequence(const Json &,const std::vector<Json> &,bool semicolon=false)const;
  bool range(const Json &,SourceAnchor &)const;
};
// Scalar/string token payload validation is independent of a Program relation
// ledger; a caller checks its contextual type before entering this boundary.
bool verifySourceLiteral(SourceSyntax &,const Json &);
struct SourceBodies {
  SourceModel &model;std::map<std::string,SourceSyntax> &syntax;
  std::map<std::string,const Json *> bindings;
  std::map<std::string,std::map<std::string,std::string>> visible;
  const Json *current=nullptr;SourceSyntax *source=nullptr;
  std::map<std::string,std::string> scope;std::set<std::string> initialized,declared;
  SourceRelations *relations=nullptr;
  std::map<std::string,Array> captureOccurrences;
  std::set<std::string> nestedDeclarations;
  using AnnotationKey=std::pair<std::string,std::pair<uint32_t,uint32_t>>;
  std::map<AnnotationKey,std::string> annotationTypes;
  std::map<std::string,std::string> callableOrigins;
  bool inventory();bool function(const Json &);bool module(const Json &);
  bool annotations();
  std::string resolve(const Json &);
  bool expression(const Json &,bool target=false,const std::string &expected={},bool readTarget=false);
  bool statements(const Json &,size_t,size_t);
  bool annotation(const Json &,const std::string &);
  bool setScope(const std::map<std::string,std::string> &);
  bool logical(const std::string &,const std::string &);
  bool callableExpression(const Json &);
  bool aliases(std::map<std::string,std::vector<Json>> &);
  bool lexicalScope(const Json &);bool capture(const Json &,bool,bool);bool captures();
};
bool verifyCommonDeclarations(SourceModel &,SourceBodies &,std::map<std::string,SourceSyntax> &,
  std::map<std::string,std::vector<Json>> &);
bool verifyCommonModules(SourceModel &,std::map<std::string,SourceSyntax> &);
} // namespace tsfg::commonProgram
