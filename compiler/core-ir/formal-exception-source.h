// SPDX-License-Identifier: MIT
#pragma once
#include "formal-exception.h"
#include <vector>
namespace tsfg::formalException {
std::string hirIdentity(llvm::StringRef,const Json &);
struct SourceToken {std::string text;uint32_t start,end;};
struct SourceText {
  std::u16string content;
  std::vector<SourceToken> tokens;
  bool read(llvm::StringRef,Program &);
  bool range(const Json &,uint32_t &,uint32_t &,Program &)const;
  bool span(const Json &,size_t,size_t,Program &,bool raw=true)const;
  bool expect(size_t &,llvm::StringRef,Program &)const;
  bool name(size_t &,llvm::StringRef,const Json &,Program &,bool trimmed=false)const;
  llvm::StringRef spelling(size_t)const;
};
struct SourceScope {
  std::map<std::string,std::string> visible,names;
  std::map<std::string,unsigned> ordinals;
  std::set<std::string> initialized,narrowed,written;
  std::vector<std::pair<const Json *,std::string>> prefix;
  Array path;
  std::string scope,role;
  bool normal=true;
};
class SourceProof {
  Program &p;
  const Json &snapshot,&facts;
  std::map<std::string,SourceText> sources;
  std::map<std::string,const Json *> symbols,rawFunctions;
  std::map<std::string,std::string> nominalTypes,fields,constructors;
  std::set<std::string> claimedFunctions,claimedSymbols;
  std::set<std::string> usedTypes;
  std::map<std::string,std::map<std::string,std::pair<bool,bool>>> actualCaptures;
  std::string currentOwner,currentSource;
  SourceText *source=nullptr;
  std::string type(const Json &,llvm::StringRef nameKey="type");
  bool types();
  bool nominalSource(const Json &);
  bool modules();
  bool moduleDeclarations(size_t &);
  bool function(const Json &,const Json &,const SourceScope &);
  bool region(const Array &,const Json &,SourceScope &,size_t &,bool braces=true);
  bool expression(const Json &,const Json &,SourceScope &,size_t &,bool write=false,bool trimmed=false);
  bool declaration(const Json &,const Json &,SourceScope &);
  bool annotation(size_t &,const Json &,llvm::StringRef key="type");
  bool statement(const Json &,const Json &,SourceScope &,size_t &);
  bool separator(size_t &);
public:
  explicit SourceProof(Program &p):p(p),snapshot(field(p.hir,"snapshot")),facts(field(snapshot,"facts")){}
  bool run();
};
}
