// SPDX-License-Identifier: MIT
#include "finite-module.h"
#include "finite-domain.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"

namespace tsfg::finite {
namespace {
std::string attribute(mlir::Operation *op, llvm::StringRef name) {
  const auto value = op->getAttrOfType<mlir::StringAttr>(name);
  return value ? value.getValue().str() : std::string();
}
bool header(ModuleProof &proof, const Object &row) {
  static const llvm::StringRef required[]={"id","name","sourcePath","range","signatureHash","returnType","parameters","ownerType","construction","overrideTarget","role"};
  for(const auto key:required)if(!row.get(key))return proof.reject("missing callable contract field");
  for(const auto key:{"ownerType","construction","overrideTarget"}) {
    const auto *value=row.get(key);
    if(value->kind()!=Json::Null&&(!value->getAsString()||!finiteDomainIdentity(*value->getAsString())))
      return proof.reject("nullable callable identity field");
  }
  const auto id = string(row,"id"), owner = string(row,"ownerType"), construction = string(row,"construction"),
      path = string(row,"sourcePath"), role = string(row,"role");
  const auto *parameters = row.getArray("parameters"); const auto *range = row.getObject("range");
  uint32_t start=0,end=0;
  if (row.size() != 11 || !finiteDomainIdentity(id) || !parameters || parameters->size() > 256 ||
      !range || range->size() != 2 || !unsignedInteger(*range,"start",start) || !unsignedInteger(*range,"end",end) ||
      start > end || !proof.sourceLengths.count(path) || end > proof.sourceLengths.at(path) ||
      !proof.catalog.count(string(row,"returnType")) || (role != "function" && role != "construction-body"))
    return proof.reject("callable contract fields/original source range");
  std::string arguments; std::set<std::string> bindings;
  size_t ordinal=0;
  for (const auto &parameter : *parameters) {
    const auto *p = parameter.getAsObject();
    if (!proof.charge() || !p || p->size() != 3 || !p->get("origin") || string(*p,"id").empty() ||
        !bindings.insert(string(*p,"id")).second || !proof.catalog.count(string(*p,"type")))
      return proof.reject("ordered callable parameter binding/type");
    const auto *origin=p->getObject("origin"); uint32_t from=0,to=0;
    if ((p->get("origin")->kind()==Json::Null)!=(ordinal++==0 && !owner.empty()))
      return proof.reject("only an implicit receiver lacks a Source parameter declaration");
    if (p->get("origin")->kind()!=Json::Null && (!origin || origin->size()!=3 ||
        !unsignedInteger(*origin,"start",from)||!unsignedInteger(*origin,"end",to)||from>to||
        !proof.sourceLengths.count(string(*origin,"source"))||to>proof.sourceLengths.at(string(*origin,"source"))))
      return proof.reject("ordered parameter original declaration anchor");
    if (!arguments.empty()) arguments += ',';
    arguments += string(*proof.catalog.at(string(*p,"type")),"name");
  }
  const auto resultName = string(*proof.catalog.at(string(row,"returnType")),"name");
  const auto signature = hash(std::string("tsfg.signature\0",15) + '(' + arguments + ")->" + resultName);
  if (signature != string(row,"signatureHash")) return proof.reject("Source callable signature identity");
  if (!owner.empty()) {
    if (!proof.catalog.count(owner) || parameters->empty() || string(*(*parameters)[0].getAsObject(),"type") != owner)
      return proof.reject("callable implicit receiver type");
  }
  if (role == "construction-body") {
    const auto *nominal = owner.empty() ? nullptr : proof.catalog.at(owner);
    const auto *c = nominal ? nominal->getObject("construction") : nullptr;
    if (!c || construction != hash(std::string("tsfg.construction\0",18) + owner) || string(*c,"id") != construction ||
        string(*c,"signatureHash") != signature || string(row,"returnType") != owner)
      return proof.reject("construction body identity/owner/signature");
    const auto *explicitFunction = nominal->get("constructor");
    if (!explicitFunction) return proof.reject("constructor selection missing");
    if (explicitFunction->kind() == Json::Null) {
      if (id != construction || string(row,"name") != "<implicit-construction>") return proof.reject("implicit constructor identity");
      return true;
    }
    if (nominal->getString("constructor") != id) return proof.reject("explicit constructor function mismatch");
  } else if (!construction.empty()) return proof.reject("ordinary function cannot claim construction authority");
  const auto name = owner.empty() ? string(row,"name") : string(*proof.catalog.at(owner),"name") + '.' + string(row,"name");
  return id == hash(std::string("tsfg.function\0",14) + path + '\0' + name + '\0' + signature.substr(7)) ||
      proof.reject("owned FunctionId does not bind its qualified Source signature");
}
bool abiRow(ModuleProof &proof, const Object &row) {
  const auto id = string(row,"functionId"); const auto *parameters = row.getArray("parameters");
  const auto found = proof.callable.find(id); const auto *result = row.get("result");
  if (!proof.charge() || row.size() != 4 || found == proof.callable.end() || !parameters || !result || !proof.abi.emplace(id,&row).second)
    return proof.reject("duplicate or orphan definition ABI");
  const auto &fn = *found->second; const auto &bindings = *fn.getArray("parameters");
  if (parameters->size() != bindings.size()) return proof.reject("definition ABI parameter count");
  for (size_t i=0; i<parameters->size(); ++i) {
    const auto domain = (*parameters)[i].getAsString();
    if (!domain || !proof.domains.count(domain->str())) return proof.reject("unknown parameter domain");
  }
  const bool zero = string(fn,"role") == "construction-body" || string(*proof.catalog.at(string(fn,"returnType")),"kind") == "void";
  if (zero ? result->kind() != Json::Null : !result->getAsString() || !proof.domains.count(result->getAsString()->str()))
    return proof.reject("definition ABI void/value distinction");
  std::string encoded;
  if (!canonical(Object{{"parameters",llvm::json::Array(*parameters)},{"result",*result}},encoded) ||
      string(row,"id") != hash(std::string("tsfg.finite-abi.v1\0",19) + encoded)) return proof.reject("definition ABI hash");
  return true;
}
bool function(ModuleProof &proof, mlir::func::FuncOp fn) {
  const auto id = attribute(fn,"tsfg_core.function_id"); const auto c = proof.callable.find(id), a = proof.abi.find(id);
  if (fn.isExternal() || c == proof.callable.end() || a == proof.abi.end() || !proof.functions.emplace(id,fn).second ||
      fn.getSymName() != "f" + id.substr(7)) return proof.reject("module callable definition closure");
  const auto &contract = *c->second, &abi = *a->second; const auto &parameters = *abi.getArray("parameters");
  if (attribute(fn,"tsfg_core.signature_hash") != string(contract,"signatureHash") ||
      attribute(fn,"tsfg_core.finite_abi") != string(abi,"id") || attribute(fn,"tsfg_source.path") != string(contract,"sourcePath") ||
      fn.getNumArguments() != parameters.size()) return proof.reject("function header ABI/source identity");
  for (size_t i=0;i<parameters.size();++i)
    if (!carrier(proof,*parameters[i].getAsString(),fn.getArgumentTypes()[i])) return proof.reject("parameter carrier differs from its finite ABI");
  const auto *result = abi.get("result");
  if (result->kind() == Json::Null ? fn.getNumResults() != 0 :
      fn.getNumResults() != 1 || !carrier(proof,*result->getAsString(),fn.getResultTypes()[0]))
    return proof.reject("function result carrier differs from its finite ABI");
  if (string(contract,"role") == "construction-body" &&
      (attribute(fn,"tsfg_core.construction") != string(contract,"construction") ||
       attribute(fn,"tsfg_core.owner_type") != string(contract,"ownerType") ||
       attribute(fn,"tsfg_core.receiver_binding") != string(*(*contract.getArray("parameters"))[0].getAsObject(),"id")))
    return proof.reject("constructor frame authority differs from its callable contract");
  return true;
}
}
bool verifyAbi(ModuleProof &proof) {
  const auto *rows = proof.callables.getAsArray(); const auto *plan = proof.plan.getAsObject();
  const auto *abi = plan->getArray("abi"), *nodes = plan->getArray("nodes");
  if (!rows || rows->empty() || rows->size() > 4096 || !abi || !nodes) return proof.reject("callable/ABI/node catalogue");
  std::string previous;
  for (const auto &value : *rows) {
    const auto *row = value.getAsObject();
    if (!proof.charge() || !row || !header(proof,*row)) return false;
    const auto id = string(*row,"id");
    if ((!previous.empty() && id <= previous) || !proof.callable.emplace(id,row).second) return proof.reject("callable identity/order");
    previous = id;
  }
  for (const auto &value : *abi) { const auto *row = value.getAsObject(); if (!row || !abiRow(proof,*row)) return false; }
  if (proof.abi.size() != proof.callable.size()) return proof.reject("missing definition ABI");
  std::map<std::string,std::string> nodeDomains;
  previous.clear();
  for (const auto &value : *nodes) {
    const auto *row = value.getAsObject(); const auto *pending = row ? row->getArray("pending") : nullptr;
    if (!proof.charge() || !row || !pending || !pending->empty() || string(*row,"id").size() > 4096 ||
        !proof.domains.count(string(*row,"domainId")) || !proof.catalog.count(string(*row,"viewType")) ||
        (!previous.empty() && string(*row,"id") <= previous)) return proof.reject("unresolved or unordered definition value domain");
    previous = string(*row,"id"); nodeDomains.emplace(previous,string(*row,"domainId"));
  }
  for (const auto &[id,row] : proof.callable) {
    const auto &parameters = *row->getArray("parameters"), &bounds = *proof.abi.at(id)->getArray("parameters");
    for (size_t i=0;i<parameters.size();++i)
      if (nodeDomains[id+"/binding/"+string(*parameters[i].getAsObject(),"id")] != *bounds[i].getAsString())
        return proof.reject("binding ABI/domain join differs");
    const auto *result = proof.abi.at(id)->get("result");
    if (result->kind() != Json::Null && nodeDomains[id+"/return"] != *result->getAsString()) return proof.reject("return ABI/domain join differs");
  }
  for (auto fn : proof.module.getOps<mlir::func::FuncOp>()) if (!function(proof,fn)) return false;
  if (proof.functions.size() != proof.callable.size()) return proof.reject("whole callable closure omitted a body");
  bool valid = true;
  proof.module.walk([&](mlir::func::CallOp op) {
    if (!valid || !proof.charge()) { valid=false; return; }
    const auto id = attribute(op,"tsfg_core.function_id");
    const auto found = proof.functions.find(id);
    if (found == proof.functions.end() || op.getCallee() != found->second.getSymName() ||
        attribute(op,"tsfg_core.signature_hash") != string(*proof.callable.at(id),"signatureHash") ||
        attribute(op,"tsfg_core.finite_abi") != string(*proof.abi.at(id),"id")) { valid=proof.reject("direct call authority/ABI"); return; }
    const auto &parameters = *proof.abi.at(id)->getArray("parameters");
    const auto *result = proof.abi.at(id)->get("result");
    if (op.getNumOperands() != parameters.size() ||
        (result->kind() == Json::Null ? op.getNumResults() != 0 : op.getNumResults() != 1 || !carrier(proof,*result->getAsString(),op.getResult(0).getType())))
      { valid=proof.reject("call argument/result arity or representation"); return; }
    for (size_t i=0;i<parameters.size();++i) if (!carrier(proof,*parameters[i].getAsString(),op.getOperand(i).getType()))
      { valid=proof.reject("call parameter representation differs"); return; }
  });
  return valid;
}
} // namespace tsfg::finite
