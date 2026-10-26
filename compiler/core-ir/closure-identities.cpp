// SPDX-License-Identifier: MIT
#include "closure-metadata.h"
#include "environment-contracts.h"
#include "dialect.h"
#include <algorithm>
#include <functional>

namespace tsfg::closure {
std::string quoted(llvm::StringRef value) {
  static const char digits[] = "0123456789abcdef";
  std::string output = "\"";
  for (unsigned char c : value.bytes()) {
    switch (c) {
    case '"': output += "\\\""; break;
    case '\\': output += "\\\\"; break;
    case '\b': output += "\\b"; break;
    case '\f': output += "\\f"; break;
    case '\n': output += "\\n"; break;
    case '\r': output += "\\r"; break;
    case '\t': output += "\\t"; break;
    default:
      if (c < 32) { output += "\\u00"; output += digits[c >> 4]; output += digits[c & 15]; }
      else output += static_cast<char>(c);
    }
  }
  return output + '"';
}
namespace {
std::string domainHash(llvm::StringRef domain, llvm::StringRef payload) {
  return hash(domain.str() + std::string(1,'\0') + payload.str());
}
bool scope(llvm::StringRef value) {
  if (value == "root") return true;
  if (!value.consume_front("0")) return false;
  while (!value.empty()) {
    if (!value.consume_front("/")) return false;
    auto segment = value.take_until([](char c) { return c == '/'; });
    if (segment.empty() || (segment.size() > 1 && segment.front() == '0')) return false;
    for (char c : segment) if (c < '0' || c > '9') return false;
    value = value.drop_front(segment.size());
  }
  return true;
}
}
Index::Index(const Metadata &value) : metadata(value) {
  for (const auto &item : value.types) types.emplace(item.id,&item);
  for (const auto &item : value.environments) { environments.emplace(item.id,&item); owners.emplace(item.owner,&item); }
  for (const auto &item : value.functions) functions.emplace(item.id,&item);
}
mlir::Type Index::coreType(mlir::MLIRContext *context, llvm::StringRef id) const {
  auto found = types.find(id.str());
  if (found == types.end()) return {};
  const auto &value = *found->second;
  return value.kind == "function" ? mlir::Type(ClosureType::get(context,id)) : scalarType(context,value.name);
}
const Environment *Index::environment(mlir::Type type) const {
  auto value = llvm::dyn_cast<EnvironmentType>(type); if (!value) return nullptr;
  auto found = environments.find(value.key().str()); return found == environments.end() ? nullptr : found->second;
}
const Type *Index::callable(mlir::Type type) const {
  auto value = llvm::dyn_cast<ClosureType>(type); if (!value) return nullptr;
  auto found = types.find(value.key().str());
  return found == types.end() || found->second->kind != "function" ? nullptr : found->second;
}
bool Index::validate() {
  signatureHashes.clear();
  if (types.size() != metadata.types.size() || environments.size() != metadata.environments.size()
      || owners.size() != environments.size() || functions.size() != metadata.functions.size()) return false;
  size_t work = 0, bytes = 0;
  environmentContracts::Catalogue environments;
  for(const auto &fn:metadata.functions){
    if(fn.parameters.size()+1>1000000-work)return false;work+=fn.parameters.size()+1;
    environmentContracts::Function row{fn.parent,fn.lexicalEnvironment,fn.activationEnvironment,metadata.sourcePath,fn.start,fn.end,{}};
    for(const auto &p:fn.parameters)row.parameters.push_back({p.binding,p.type});environments.functions.emplace(fn.id,std::move(row));
  }
  for(const auto &env:metadata.environments){
    if(env.slots.size()+1>1000000-work)return false;work+=env.slots.size()+1;
    environmentContracts::Environment row{env.owner,env.parent,{}};
    for(const auto &s:env.slots)row.slots.push_back({s.binding,s.type,s.role,s.declarationIndex,s.writable});environments.environments.emplace(env.id,std::move(row));
  }
  std::map<std::string,std::string> descriptions;
  std::set<std::string> active;
  std::function<bool(const std::string &,unsigned)> describe = [&](const std::string &id,unsigned depth) {
    if (++work > 1000000 || depth > 64) return false;
    if (descriptions.count(id)) return true;
    auto found = types.find(id); if (found == types.end() || !active.insert(id).second) return false;
    const auto &value = *found->second; std::string description;
    if (value.kind == "scalar") {
      bool valid = false;
      for (unsigned code = 1; code <= 13; ++code) if (value.name == scalarName(code)) valid = true;
      if (!valid || value.id != domainHash("tsfg.type",value.name)) return false;
      description = quoted(value.name);
    } else {
      description = "{\"parameters\":[";
      for (size_t i = 0; i < value.parameters.size(); ++i) {
        if (!describe(value.parameters[i],depth+1)) return false;
        if (i) description += ',';
        description += descriptions.at(value.parameters[i]);
        if (description.size() > byteLimit) return false;
      }
      if (!describe(value.result,depth+1)) return false;
      description += "],\"returns\":" + descriptions.at(value.result) + '}';
      if (value.id != domainHash("tsfg.closure-callable.candidate.v1",description)) return false;
    }
    bytes += description.size(); if (bytes > byteLimit) return false;
    if (value.kind == "function") signatureHashes[id] = domainHash("tsfg.closure-signature.candidate.v1",description);
    active.erase(id); descriptions.emplace(id,std::move(description)); return true;
  };
  for (const auto &entry : types) if (!describe(entry.first,0)) return false;
  std::set<std::string> declarations, bindings;
  for (const auto &fn : metadata.functions) {
    if (!scope(fn.scope) || fn.parent.empty() != (fn.scope == "root") || fn.symbol != "f" + fn.id.substr(7)) return false;
    auto signature = types.find(fn.signature);
    if (signature == types.end() || signature->second->kind != "function") return false;
    const auto &type = *signature->second;
    if (type.result != fn.result || type.parameters.size() != fn.parameters.size()
        || fn.signatureHash != domainHash("tsfg.closure-signature.candidate.v1",descriptions.at(fn.signature))) return false;
    std::string preimage = "{\"name\":" + quoted(fn.name) + ",\"parent\":" + (fn.parent.empty() ? "null" : quoted(fn.parent))
        + ",\"path\":" + quoted(metadata.sourcePath) + ",\"scope\":" + quoted(fn.scope) + ",\"signature\":" + quoted(fn.signatureHash) + '}';
    if (fn.id != domainHash("tsfg.lexical-function.candidate.v1",preimage)
        || !declarations.insert(fn.parent + '\0' + fn.scope + '\0' + fn.name).second) return false;
    for (size_t i = 0; i < fn.parameters.size(); ++i) {
      const auto &parameter = fn.parameters[i];
      auto expected = domainHash("tsfg.lexical-binding.candidate.v1",
          fn.id + '\0' + "parameter" + '\0' + "0:" + std::to_string(i));
      if (parameter.type != type.parameters[i] || parameter.binding != expected || !bindings.insert(parameter.binding).second) return false;
    }
  }
  for (const auto &env : metadata.environments) {
    if (!functions.count(env.owner)) return false;
    const auto &fn = *functions.at(env.owner);
    if (env.parent != fn.lexicalEnvironment) return false;
    std::string slots = "["; std::string previous;
    std::set<std::pair<std::string,uint32_t>> positions;
    for (const auto &slot : env.slots) {
      if (++work > 1000000 || !types.count(slot.type) || (!previous.empty() && previous >= slot.binding)
          || !positions.emplace(slot.role,slot.declarationIndex).second) return false;
      if (slot.role == "parameter") {
        if (slot.declarationIndex >= fn.parameters.size() || !slot.writable) return false;
        const auto &parameter = fn.parameters[slot.declarationIndex];
        if (parameter.binding != slot.binding || parameter.type != slot.type) return false;
      } else if (slot.role == "local") {
        auto expected = domainHash("tsfg.lexical-binding.candidate.v1",
            fn.id + '\0' + "local" + '\0' + "0:" + std::to_string(slot.declarationIndex));
        if (slot.binding != expected || !bindings.insert(slot.binding).second) return false;
      } else return false;
      if (!previous.empty()) slots += ',';
      slots += "{\"binding\":" + quoted(slot.binding) + ",\"type\":" + quoted(slot.type)
          + ",\"writable\":" + (slot.writable ? "true" : "false") + "}";
      previous = slot.binding;
    }
    slots += ']';
    auto preimage = "{\"owner\":" + quoted(env.owner) + ",\"parent\":" + (env.parent.empty() ? "null" : quoted(env.parent)) + ",\"slots\":" + slots + '}';
    if (env.id != domainHash("tsfg.closure-environment-layout.v1",preimage)) return false;
  }
  std::string error;
  return environmentContracts::validate(environments,[&](size_t n){if(n>1000000-work)return false;work+=n;return true;},error);
}
} // namespace tsfg::closure
