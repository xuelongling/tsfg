// SPDX-License-Identifier: MIT
#pragma once
#include "common-program-source.h"
#include "reference-contracts.h"
namespace tsfg::commonProgram {
// One Source-occurrence ledger serves assertions/contextual slots, exported
// entry roles and constructor forwarding. Only finish publishes semantic maps.
class SourceRelations {
  using Pair=referenceContracts::Pair;using Key=referenceContracts::OriginKey;
  SourceModel &m;referenceContracts::Types types;
  std::map<std::string,referenceContracts::Members> memberCache;
  std::map<Key,const Json *> records;
  std::map<Key,std::set<Pair>> dependencies;
  std::set<Key> reached,verified;
  std::map<std::string,std::map<std::string,std::set<std::string>>> entryTypes;
  std::map<std::string,std::set<Key>> entryRecords;
  bool fail(const Json &,llvm::StringRef);
  bool members(const std::string &);
  bool select(const Json &,const Json &,std::set<Pair> &);
  bool verify(const Key &);
  bool logical(const std::string &,const std::string &,const std::set<Pair> &,std::set<Pair> &);
  bool assertion(const std::string &,const std::string &,const std::set<Pair> &,std::set<Pair> &);
  bool payloadReferences(const std::string &,std::set<std::string> &);
public:
  explicit SourceRelations(SourceModel &m):m(m){}
  bool read();
  bool plainLogical(const std::string &a,const std::string &b){std::set<Pair> used;return logical(a,b,{},used);}
  bool expression(const Json &,const std::string &,const std::string &);
  bool entry(const Json &);
  bool forward(const Json &);
  bool finish();
};
} // namespace tsfg::commonProgram
