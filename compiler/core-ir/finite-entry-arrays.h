// SPDX-License-Identifier: MIT
#pragma once
#include <functional>
#include <map>
#include <set>
#include <string>
#include <vector>

namespace tsfg::finite {
// The IR adapter supplies an independently verified owned catalogue and
// declaration-role M12 roots. No producer domain/owner ledger enters here.
struct EntryArrayType {
  std::string kind,elementType,base;
  std::set<std::string> members;
  // Keys encode owned FieldId/MethodId plus parameter/result role, not names.
  std::map<std::string,std::string> relations;
};
struct EntryArraySeed {
  std::string id,type;
  // A present target key (including an empty set) says its complete selected
  // declaration-role M12 relation was verified. An absent target is unknown.
  std::map<std::string,std::set<std::string>> references;
  bool nominalReceiver=false,completeAuthority=true;
};
struct EntryArrayBound {
  std::string semanticType;
  std::set<std::string> elementTypes,elementOwners,aliases;
  bool aliasesComplete=true;
};
struct EntryArrayBounds {
  std::map<std::string,EntryArrayBound> resources;
  std::map<std::string,std::set<std::string>> owners;
  std::string error;
};
// Bounds describe every possible entry payload, never current allocations,
// lengths, initialized elements or a reached runtime observation. Failure
// publishes no partial authority. Work/cancellation cover graph and aliases.
bool deriveEntryArrayBounds(const std::map<std::string,EntryArrayType> &types,
    const std::vector<EntryArraySeed> &seeds,EntryArrayBounds &out,size_t &remaining,
    const std::function<bool()> &cancelled={});
} // namespace tsfg::finite
