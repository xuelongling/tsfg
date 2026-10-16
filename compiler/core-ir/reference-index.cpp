// SPDX-License-Identifier: MIT
#include "reference-verify.h"
#include "reference.h"
#include "llvm/Support/raw_ostream.h"
#include <algorithm>

namespace tsfg {
ReferenceIndex::ReferenceIndex(const ReferenceMetadata &metadata) : metadata(metadata) {
  for (const auto &owner : metadata.classes) {
    classes[owner.key] = &owner; accesses[owner.access] = &owner;
    callables[owner.constructor.key] = &owner.constructor;
    for (const auto &field : owner.fields) members[field.key] = {&owner, &field, nullptr};
    for (const auto &method : owner.methods) {
      members[method.member] = {&owner, nullptr, &method}; callables[method.key] = &method;
    }
  }
}
const ReferenceClass *ReferenceIndex::classFor(mlir::Type type) const {
  auto reference = llvm::dyn_cast<ReferenceType>(type);
  if (!reference) return nullptr;
  auto found = accesses.find(reference.key().str()); return found == accesses.end() ? nullptr : found->second;
}
const ReferenceClass *ReferenceIndex::classForName(llvm::StringRef name) const {
  if (!name.consume_front("ref:")) return nullptr;
  auto found = accesses.find(name.str()); return found == accesses.end() ? nullptr : found->second;
}
bool ReferenceIndex::ancestor(const ReferenceClass *child, const ReferenceClass *parent) const {
  while (child) {
    if (child == parent) return true;
    auto found = classes.find(child->base); child = found == classes.end() ? nullptr : found->second;
  }
  return false;
}
std::map<std::string, ReferenceMember> ReferenceIndex::visible(const ReferenceClass *owner) const {
  std::vector<const ReferenceClass *> lineage;
  while (owner) {
    lineage.push_back(owner); auto base = classes.find(owner->base); owner = base == classes.end() ? nullptr : base->second;
  }
  std::map<std::string, ReferenceMember> result;
  for (auto next = lineage.rbegin(); next != lineage.rend(); ++next) {
    for (const auto &field : (*next)->fields) result[field.key] = members.at(field.key);
    for (const auto &method : (*next)->methods) {
      if (!method.overridden.empty()) result.erase(method.overridden);
      result[method.member] = members.at(method.member);
    }
  }
  return result;
}
bool ReferenceIndex::permits(const ReferenceMember &member, const ReferenceClass *caller) const {
  return member.access() == "public" || member.owner == caller || member.access() == "protected" && ancestor(caller, member.owner);
}
namespace {
bool sameSignature(const ReferenceCallable &left, const ReferenceCallable &right) {
  return left.result == right.result && left.parameters.size() == right.parameters.size()
    && std::equal(left.parameters.begin() + 1, left.parameters.end(), right.parameters.begin() + 1);
}
} // namespace
bool ReferenceIndex::validate() const {
  auto reject = [](llvm::StringRef reason) { llvm::errs() << "[core-ir-reference-projection] " << reason << '\n'; return false; };
  for (const auto &owner : metadata.classes) for (const auto &method : owner.methods) {
    const ReferenceMember *nearest = nullptr; auto base = classes.find(owner.base);
    while (base != classes.end() && !nearest) {
      for (const auto &field : base->second->fields) if (field.name == method.name) { nearest = &members.at(field.key); break; }
      if (!nearest) for (const auto &candidate : base->second->methods) if (candidate.name == method.name) { nearest = &members.at(candidate.member); break; }
      base = classes.find(base->second->base);
    }
    const bool overrides = nearest && nearest->method && nearest->access() != "private";
    if (overrides ? method.overridden != nearest->method->member : !method.overridden.empty()) return reject("missing or non-nearest override edge");
    if (overrides && !sameSignature(method, *nearest->method)) return reject("signature adaptation capability is not represented");
  }
  for (const auto &view : metadata.views) {
    auto from = visible(classForName(view.source)), to = visible(classForName(view.target));
    std::set<std::string> seen;
    for (const auto &edge : view.members) {
      auto source = from.find(edge.first), target = to.find(edge.second);
      if (source == from.end() || target == to.end() || !seen.insert(edge.second).second
          || source->second.name() != target->second.name() || bool(source->second.field) != bool(target->second.field)) return reject("member projection differs from static access views");
      if (source->second.field && source->second.field->type != target->second.field->type) return reject("field type adaptation capability is not represented");
      if (source->second.method && !sameSignature(*source->second.method, *target->second.method)) return reject("method type adaptation capability is not represented");
    }
    if (seen.size() != to.size()) return reject("member projection is incomplete");
  }
  return true;
}
} // namespace tsfg
