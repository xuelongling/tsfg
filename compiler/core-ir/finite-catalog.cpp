// SPDX-License-Identifier: MIT
#include "finite-module.h"
#include "finite-domain.h"
#include <algorithm>

namespace tsfg::finite {
namespace {
uint32_t align(uint32_t value, uint32_t width) { return (value + width - 1) / width * width; }
struct Catalog {
  ModuleProof &proof;
  std::map<std::string, std::string> names;
  std::map<std::string, Json> layouts;
  std::map<std::string, size_t> costs;
  // The catalogue is a flat ID graph: host stack depth must not become a
  // language restriction. Schedule dependencies before their owner, bounded
  // by the module's existing catalogue/work limits, including shared DAGs.
  bool order(const std::string &id, bool naming, std::vector<std::string> &out) {
    struct Task { std::string id; bool exit; };
    std::vector<Task> pending{{id,false}};
    std::set<std::string> active, done;
    while (!pending.empty()) {
      if (!proof.charge()) return false;
      auto task=std::move(pending.back()); pending.pop_back();
      if ((naming?names.count(task.id):layouts.count(task.id)) || done.count(task.id)) continue;
      if (task.exit) { active.erase(task.id); done.insert(task.id); out.push_back(task.id); continue; }
      const auto found=proof.catalog.find(task.id);
      if (found==proof.catalog.end() || !active.insert(task.id).second)
        return proof.reject(naming?"unknown or recursive type name":"recursive inline layout/type");
      const auto &row=*found->second; const auto kind=string(row,"kind");
      std::vector<std::string> children;
      if (naming && (kind=="array" || kind=="readSpan")) children.push_back(string(row,"elementType"));
      else if (kind=="union") {
        const auto *members=row.getArray("members"); std::string previous;
        if (!members || members->size()<2 || members->size()>256) return proof.reject("union members");
        for (const auto &member:*members) {
          const auto child=member.getAsString();
          if (!child || (!previous.empty() && *child<=previous)) return proof.reject("union identity order");
          previous=child->str(); children.push_back(previous);
        }
      } else if (!naming && kind=="value") {
        std::vector<const Object *> members; if (!fields(task.id,members)) return false;
        for (const auto *field:members) children.push_back(string(*field,"type"));
      }
      if (!proof.charge(children.size())) return false;
      pending.push_back({task.id,true});
      for (auto child=children.rbegin();child!=children.rend();++child) pending.push_back({*child,false});
    }
    return true;
  }
  bool name(const std::string &id) {
    std::vector<std::string> ordered; if (!order(id,true,ordered)) return false;
    for (const auto &selected:ordered) if (!nameOne(selected)) return false;
    return true;
  }
  bool nameOne(const std::string &id) {
    const auto &row = *proof.catalog.at(id); const auto kind = string(row, "kind");
    std::string result;
    if (kind == "array" || kind == "readSpan") {
      const auto child = string(row, "elementType");
      result = (kind == "array" ? "Array<" : "ReadSpan<") + names.at(child) + ">";
    } else if (kind == "union") {
      const auto *members = row.getArray("members");
      if (!members || members->size() < 2 || members->size() > 256) return proof.reject("union members");
      std::vector<std::string> values; std::string previous;
      for (const auto &member : *members) {
        const auto selected = member.getAsString();
        if (!selected || (!previous.empty() && *selected <= previous))
          return proof.reject("union identity order");
        previous = selected->str(); values.push_back(names.at(previous));
      }
      std::sort(values.begin(), values.end()); result = "Union<";
      for (const auto &value : values) { if (result != "Union<") result += ','; result += value; }
      result += '>';
    } else if (kind == "reference" || kind == "value") {
      const auto runtime = string(row, "runtimeKey");
      const auto *nominal = row.getObject("nominalKey"); std::string key;
      if (!finiteDomainIdentity(runtime) || !nominal || !canonical(Json(Object(*nominal)), key))
        return proof.reject("nominal/runtime identity");
      llvm::json::Array files;
      for (const auto &source : *proof.sources.getAsArray()) {
        const auto &s = *source.getAsObject();
        files.emplace_back(Object{{"path", string(s, "path")}, {"sha256", string(s, "hash").substr(7)}});
      }
      std::string material;
      if (!canonical(Object{{"files", std::move(files)}, {"nominalKey", Object(*nominal)}}, material) ||
          hash(std::string("tsfg.array-facts.runtime-class.v8\0", 34) + material) != runtime)
        return proof.reject("runtime identity does not bind the complete source closure");
      result = (kind == "reference" ? "ref<" : "value<") + runtime + ">";
    } else if (kind == "scalar") result = string(row, "name");
    else if (kind == "null" || kind == "undefined" || kind == "void" || kind == "string") result = kind;
    else return proof.reject("semantic type kind");
    if (hash(std::string("tsfg.type\0", 10) + result) != id || string(row, "name") != result)
      return proof.reject("owned semantic TypeId/name mismatch");
    names.emplace(id, result); return true;
  }
  bool fields(const std::string &id, std::vector<const Object *> &out) {
    std::vector<std::string> lineage; std::set<std::string> seen;
    for (auto current=id;!current.empty();current=string(*proof.catalog.at(current),"base")) {
      if (!proof.charge() || !proof.catalog.count(current) || !seen.insert(current).second)
        return proof.reject("inheritance cycle/type");
      lineage.push_back(current);
    }
    for (auto current=lineage.rbegin();current!=lineage.rend();++current) {
    const auto &row = *proof.catalog.at(*current);
    const auto *own = row.getArray("fields");
    if (!own) return proof.reject("nominal fields missing");
    for (const auto &field : *own) {
      const auto *value = field.getAsObject();
      if (!proof.charge() || !value || !proof.catalog.count(string(*value, "type")) ||
          !value->getBoolean("readonly") || string(*value, "id") != hash(std::string("tsfg.field\0", 11) + *current + '\0' + string(*value, "name")))
        return proof.reject("owned field identity/type");
      out.push_back(value); if (out.size() > 256) return proof.reject("cell field count");
    }
    }
    return true;
  }
  bool layout(const std::string &id) {
    std::vector<std::string> ordered; if (!order(id,false,ordered)) return false;
    for (const auto &selected:ordered) if (!layoutOne(selected)) return false;
    return true;
  }
  bool layoutOne(const std::string &id) {
    const auto &row = *proof.catalog.at(id); const auto kind = string(row, "kind");
    Physical p; llvm::json::Array variants, scalars, references, children; size_t cost = 2;
    std::string variantKind = "value";
    if (kind == "scalar") {
      static const std::vector<std::string> codes = {"", "i32", "bool", "i8", "i16", "i64", "u8", "u16", "u32", "u64", "isize", "usize", "f32", "f64"};
      static const uint32_t sizes[] = {0,4,1,1,2,8,1,2,4,8,8,8,4,8};
      const auto it = std::find(codes.begin()+1, codes.end(), string(row, "name"));
      if (it == codes.end()) return proof.reject("native scalar representation");
      const unsigned code = static_cast<unsigned>(it - codes.begin()); p.bytes = p.alignment = sizes[code];
      scalars.emplace_back(Object{{"offset", 0}, {"code", code}}); ++cost;
    } else if (kind == "undefined" || kind == "void" || kind == "null") variantKind = kind == "null" ? "null" : "undefined";
    else if (kind == "reference" || kind == "array" || kind == "readSpan" || kind == "string") {
      p.references = 1;
      Object ref{{"slot", 0}, {"kind", kind == "reference" ? "cell" : kind == "string" ? "string" : "array"}};
      if (kind != "string") ref["typeId"] = kind == "reference" ? id : string(row, "elementType");
      references.emplace_back(std::move(ref)); ++cost;
      if (kind == "readSpan") { p.bytes = 8; p.alignment = 4;
        scalars.emplace_back(Object{{"offset",0},{"code",8}}); scalars.emplace_back(Object{{"offset",4},{"code",8}}); cost += 2; }
    } else if (kind == "value") {
      std::vector<const Object *> members; if (!fields(id, members)) return false;
      for (const auto *field : members) {
        const auto child = string(*field, "type"); if (!proof.charge(costs.at(child))) return false;
        const auto c = proof.physical.at(child); const auto tag = align(p.bytes, 2), offset = align(tag + 2, c.alignment);
        children.emplace_back(Object{{"tagOffset", tag}, {"offset", offset}, {"referenceOffset", p.references}, {"layout", layouts.at(child)}});
        p.bytes = offset + c.bytes; p.alignment = std::max({p.alignment, 2u, c.alignment}); p.references += c.references;
        cost += costs[child] + 1;
      }
    } else if (kind == "union") {
      unsigned tag = 0;
      for (const auto &member : *row.getArray("members")) {
        const auto child = member.getAsString()->str();
        if (!proof.charge(costs.at(child))) return false;
        const auto c = proof.physical.at(child); const auto childKind = string(*proof.catalog.at(child), "kind");
        const bool absence = childKind == "null" || childKind == "undefined";
        llvm::json::Array nested;
        if (!absence) { const auto offset = align(2, c.alignment);
          nested.emplace_back(Object{{"tagOffset",0},{"offset",offset},{"referenceOffset",0},{"layout",layouts.at(child)}});
          p.bytes = std::max(p.bytes, offset + c.bytes); }
        p.alignment = std::max({p.alignment, 2u, c.alignment}); p.references = std::max(p.references, c.references);
        variants.emplace_back(Object{{"tag",tag++},{"kind",absence ? childKind : "value"},
          {"fields",llvm::json::Array()},{"references",llvm::json::Array()},{"children",std::move(nested)}});
        cost += costs[child] + 2;
      }
    }
    p.bytes = align(p.bytes, p.alignment);
    if (p.bytes > 65536 || p.references > 256) return proof.reject("physical layout size/root bound");
    if (kind != "union") variants.emplace_back(Object{{"tag",0},{"kind",variantKind},
      {"fields",std::move(scalars)},{"references",std::move(references)},{"children",std::move(children)}});
    layouts.emplace(id, Object{{"typeId",id},{"byteSize",p.bytes},{"alignment",p.alignment},
      {"referenceCount",p.references},{"variants",std::move(variants)}});
    proof.physical.emplace(id, p); costs.emplace(id, cost); return true;
  }
  bool cell(const std::string &id, Json &out) {
    const auto &row = *proof.catalog.at(id); Physical p; llvm::json::Array result;
    std::vector<const Object *> members; if (!fields(id, members)) return false;
    for (const auto *field : members) {
      const auto type = string(*field, "type"); const auto child = proof.physical.at(type);
      if (!proof.charge(costs[type])) return false;
      const auto offset = align(p.bytes, child.alignment);
      result.emplace_back(Object{{"id",string(*field,"id")},{"typeId",type},{"offset",offset},
        {"referenceOffset",p.references},{"readonly",*field->getBoolean("readonly")}});
      p.bytes = offset + child.bytes; p.alignment = std::max(p.alignment, child.alignment); p.references += child.references;
    }
    if (p.bytes > 65536 || p.references > 256) return proof.reject("cell size/root bound");
    out = Object{{"typeId",id},{"runtimeKey",string(row,"runtimeKey")},{"kind",string(row,"kind")},
      {"byteSize",align(p.bytes,p.alignment)},{"alignment",p.alignment},{"referenceCount",p.references},{"fields",std::move(result)}};
    return true;
  }
};
}
bool verifyCatalog(ModuleProof &proof) {
  const auto *types = proof.types.getAsArray(), *intrinsics = proof.intrinsics.getAsArray();
  if (!types || !intrinsics || types->empty() || types->size()+intrinsics->size() > 4096 || intrinsics->size() > 1)
    return proof.reject("semantic catalogue count");
  for (const auto *rows : {types, intrinsics}) {
    std::string previous;
    for (const auto &value : *rows) {
      const auto *row = value.getAsObject(); if (!row || !proof.charge()) return proof.reject("semantic catalogue shape");
      const auto id = string(*row, "id");
      if (!finiteDomainIdentity(id) || (!previous.empty() && id <= previous) || !proof.catalog.emplace(id,row).second)
        return proof.reject("semantic catalogue identity/order");
      if (rows == intrinsics && (string(*row,"kind") != "undefined" || id != hash(std::string("tsfg.type\0undefined",19))))
        return proof.reject("only the canonical undefined intrinsic may extend the catalogue");
      previous = id;
    }
  }
  Catalog builder{proof};
  for (const auto &[id,row] : proof.catalog) if (!builder.name(id) || !builder.layout(id)) return false;
  const auto *root = proof.layouts.getAsObject();
  const auto *entries = root ? root->getArray("entries") : nullptr;
  if (!root || root->size() != 3 || string(*root,"family") != "tsfg.typed-layout-development" ||
      root->getInteger("version") != 1 || !entries || entries->size() != types->size()) return proof.reject("canonical layout registry");
  for (size_t i=0; i<entries->size(); ++i) {
    const auto *entry = (*entries)[i].getAsObject(); const auto id = string(*(*types)[i].getAsObject(),"id");
    const auto kind = string(*proof.catalog.at(id),"kind"); const bool nominal = kind == "reference" || kind == "value";
    if (!entry || entry->size() != (nominal ? 3u : 2u) || string(*entry,"typeId") != id || !proof.charge(builder.costs[id]))
      return proof.reject("canonical layout entry");
    const auto *layout = entry->get("layout"); std::string expected, actual;
    if (!layout || !canonical(builder.layouts.at(id),expected) || !canonical(*layout,actual) || expected != actual)
      return proof.reject("semantic TypeId has a noncanonical physical layout");
    if (nominal) { Json cell = nullptr; const auto *given = entry->get("cell");
      if (!given || !builder.cell(id,cell) || !canonical(cell,expected) || !canonical(*given,actual) || expected != actual)
        return proof.reject("actual cell identity/declared layout mismatch"); }
  }
  return true;
}
} // namespace tsfg::finite
