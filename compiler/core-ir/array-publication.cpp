// SPDX-License-Identifier: MIT
// Exact fixed publication identities and owner-relative effects; no Source preimage.
#include "array-core.h"
#include "dialect.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "llvm/ADT/STLExtras.h"
#include <algorithm>
#include <deque>
#include <map>
namespace tsfg::arrays {
namespace {
constexpr unsigned localSlot=8,slots=9;
bool reference(mlir::Type type) { return llvm::isa<ArrayType,ReadSpanType>(type); }
unsigned bits(Access value) { return unsigned(value.read) | (unsigned(value.write)<<1) | (unsigned(value.structural)<<2); }
bool flags(mlir::DictionaryAttr data, Access &result, bool parameter=false) {
  if (!(parameter ? fields(data,{"index","read","write","structural"}) : fields(data,{"read","write","structural"}))) return false;
  auto read=llvm::dyn_cast_or_null<mlir::BoolAttr>(data.get("read")),write=llvm::dyn_cast_or_null<mlir::BoolAttr>(data.get("write"));
  auto structural=llvm::dyn_cast_or_null<mlir::BoolAttr>(data.get("structural"));
  if (!read || !write || !structural) return false;
  result={read.getValue(),write.getValue(),structural.getValue()}; return true;
}
std::string boolean(bool value) { return value ? "true" : "false"; }
std::string flagJson(Access value) {
  return "\"read\":"+boolean(value.read)+",\"structural\":"+boolean(value.structural)+",\"write\":"+boolean(value.write);
}
std::string upperJson(const Function &function, const PublishedContract &contract) {
  std::string result="{\"local\":{"+flagJson(contract.local)+"},\"parameters\":["; bool first=true;
  for (size_t i=0;i<function.parameters.size();++i) if (reference(function.parameters[i].type)) {
    if (!first) result+=','; first=false;
    result+="{\"index\":"+std::to_string(i)+","+flagJson(contract.parameters[i])+"}";
  }
  return result+"],\"returnOrigin\":"+(contract.returnOrigin<0 ? std::string("null")
    : "{\"index\":"+std::to_string(contract.returnOrigin)+",\"kind\":\"parameter\"}")+"}";
}
std::string domainHash(llvm::StringRef domain, const std::string &json) {
  std::string preimage=domain.str(); preimage+='\0'; preimage+=json; return identityHash(preimage);
}
std::vector<size_t> sortedFunctions(const Metadata &metadata) {
  std::vector<size_t> order; for (size_t i=0;i<metadata.functions.size();++i) order.push_back(i);
  std::sort(order.begin(),order.end(),[&](size_t a,size_t b) {
    return text(metadata.functions[a].operation,"tsfg_core.function_id").compare(text(metadata.functions[b].operation,"tsfg_core.function_id"))<0;
  }); return order;
}
std::string scopeJson(mlir::ModuleOp module, const Metadata &metadata, const std::vector<size_t> &order) {
  std::string result="{\"exports\":["; bool first=true;
  for (auto value : module->getAttrOfType<mlir::ArrayAttr>("tsfg_array.exports")) {
    auto row=llvm::cast<mlir::DictionaryAttr>(value); if (!first) result+=','; first=false;
    result+="{\"functionId\":"+identityQuote(text(row,"function_id"))+",\"name\":"+identityQuote(text(row,"name"))+"}";
  }
  result+="],\"functions\":["; first=true;
  for (auto index : order) {
    const auto &function=metadata.functions[index]; auto *op=function.operation; if (!first) result+=','; first=false;
    result+="{\"functionId\":"+identityQuote(text(op,"tsfg_core.function_id"))+",\"name\":"+identityQuote(text(op,"sym_name"))+",\"parameterTypes\":[";
    bool firstParameter=true;
    for (const auto &parameter : function.parameters) {
      if (!firstParameter) result+=','; firstParameter=false;
      result+=identityQuote(llvm::isa<ArrayType>(parameter.type) ? "array.f64" : llvm::isa<ReadSpanType>(parameter.type) ? "readspan.f64" : typeCode(parameter.type)==8 ? "u32" : "f64");
    }
    result+="],\"returnType\":"+identityQuote(llvm::isa<ReadSpanType>(function.resultType) ? "readspan.f64" : "f64")+",\"signatureHash\":"+identityQuote(text(op,"tsfg_core.signature_hash"))+",\"sourcePath\":"+identityQuote(metadata.path)+"}";
  }
  return result+"],\"profile\":\"array-readspan-array-origin-return-scc-owner-relative-fixed-v4\",\"rootFile\":"+identityQuote(metadata.path)+"}";
}
mlir::LogicalResult publication(mlir::ModuleOp module, Metadata &metadata) {
  auto data=module->getAttrOfType<mlir::DictionaryAttr>("tsfg_array.publication");
  if (!fields(data,{"family","version","mode","scope_digest","expected_digest","contracts"}))
    return reject("core-ir-array-publication","fixed publication fields differ");
  auto version=llvm::dyn_cast_or_null<mlir::IntegerAttr>(data.get("version"));
  if (text(data,"family")!="tsfg.array-publication-context-candidate" || text(data,"mode")!="fixed" ||
      !version || !version.getType().isSignlessInteger(32) || version.getInt()!=4)
    return reject("core-ir-array-publication","fixed publication marker differs");
  auto rows=llvm::dyn_cast_or_null<mlir::ArrayAttr>(data.get("contracts")); const auto order=sortedFunctions(metadata);
  if (!rows || rows.size()!=order.size()) return reject("core-ir-array-publication","complete contract count differs");
  metadata.contracts.resize(order.size()); std::string contracts="["; bool first=true;
  for (size_t rowIndex=0;rowIndex<rows.size();++rowIndex) {
    const size_t index=order[rowIndex]; const auto &function=metadata.functions[index]; auto &contract=metadata.contracts[index];
    auto row=llvm::dyn_cast<mlir::DictionaryAttr>(rows[rowIndex]);
    if (!fields(row,{"function_id","signature_hash","upper","digest"}) || text(row,"function_id")!=text(function.operation,"tsfg_core.function_id") ||
        text(row,"signature_hash")!=text(function.operation,"tsfg_core.signature_hash"))
      return reject("core-ir-array-publication","contract identity/order differs");
    auto upper=llvm::dyn_cast_or_null<mlir::DictionaryAttr>(row.get("upper"));
    if (!fields(upper,{"parameters","local","return_origin"}) ||
        !flags(llvm::dyn_cast_or_null<mlir::DictionaryAttr>(upper.get("local")),contract.local))
      return reject("core-ir-array-publication","upper local/return fields differ");
    if (llvm::isa<ReadSpanType>(function.resultType)) {
      auto origin=llvm::dyn_cast_or_null<mlir::DictionaryAttr>(upper.get("return_origin")); uint32_t slot=0;
      if (!fields(origin,{"kind","index"}) || text(origin,"kind")!="parameter" || !number(origin.get("index"),slot) ||
          slot>=function.parameters.size() || !reference(function.parameters[slot].type))
        return reject("core-ir-array-publication","View upper requires an original full reference return slot");
      contract.returnOrigin=slot;
    } else if (!llvm::isa_and_nonnull<mlir::UnitAttr>(upper.get("return_origin")))
      return reject("core-ir-array-publication","f64 upper requires null return origin");
    auto parameters=llvm::dyn_cast_or_null<mlir::ArrayAttr>(upper.get("parameters"));
    if (!parameters || parameters.size()>8) return reject("core-ir-array-publication","upper parameter table differs");
    contract.parameters.resize(function.parameters.size()); size_t position=0;
    for (size_t slot=0;slot<function.parameters.size();++slot) if (reference(function.parameters[slot].type)) {
      if (position==parameters.size()) return reject("core-ir-array-publication","original reference slot absent");
      auto parameter=llvm::dyn_cast<mlir::DictionaryAttr>(parameters[position++]); uint32_t original=0;
      if (!flags(parameter,contract.parameters[slot],true) || !number(parameter.get("index"),original) || original!=slot ||
          (llvm::isa<ReadSpanType>(function.parameters[slot].type) && (contract.parameters[slot].write || contract.parameters[slot].structural)))
        return reject("core-ir-array-publication","full slot/readonly upper differs");
    }
    if (position!=parameters.size()) return reject("core-ir-array-publication","phantom reference upper slot");
    const auto body="{\"functionId\":"+identityQuote(text(row,"function_id"))+",\"signatureHash\":"+identityQuote(text(row,"signature_hash"))+",\"upper\":"+upperJson(function,contract)+"}";
    contract.digest=domainHash("tsfg.array-published-contract.v4",body);
    if (text(row,"digest")!=contract.digest) return reject("core-ir-array-publication","contract digest differs");
    if (!first) contracts+=','; first=false;
    contracts+="{\"digest\":"+identityQuote(contract.digest)+","+body.substr(1);
  }
  contracts+=']'; const auto scope=domainHash("tsfg.array-call-scope.v4",scopeJson(module,metadata,order));
  const auto published=domainHash("tsfg.array-publication.v4","{\"contracts\":"+contracts+",\"scopeDigest\":"+identityQuote(scope)+"}");
  if (text(data,"scope_digest")!=scope || text(data,"expected_digest")!=published)
    return reject("core-ir-array-publication","scope/whole publication digest differs");
  metadata.scopeDigest=scope; metadata.publishedDigest=published;
  metadata.fixedPublication=true; return mlir::success();
}
struct Call { size_t caller,target; mlir::func::CallOp operation; };
struct Effects { unsigned direct[slots]{},derived[slots]{},effective[slots]{}; OwnerGraph owners; };
mlir::LogicalResult coverage(Metadata &metadata, const std::vector<Call> &calls) {
  const size_t count=metadata.functions.size(); std::vector<Effects> effects(count); uint64_t work=0;
  auto step=[&]() { return ++work<=16384; };
  auto ownerSlot=[&](const OwnerGraph &graph, mlir::Value value, unsigned &slot) {
    auto owner=graph.owners.find(value); if (owner==graph.owners.end()) return false;
    slot=owner->second.parameter ? owner->second.index : localSlot; return slot<slots;
  };
  for (size_t i=0;i<count;++i) {
    auto &effect=effects[i]; if (mlir::failed(collectOwners(metadata.functions[i],metadata,effect.owners))) return mlir::failure();
    for (auto &op : llvm::cast<mlir::func::FuncOp>(metadata.functions[i].operation).getBody().front()) {
      const auto name=op.getName().getStringRef(); unsigned mask=name=="tsfg_array.read_checked" || name=="tsfg_array.view_read_checked" || name=="tsfg_array.view_create_checked" ? 1
        : name=="tsfg_array.store_dense_checked" ? 6 : name=="tsfg_array.resize_checked" ? 4 : 0;
      if (mask) {
        unsigned slot=0;
        if (!ownerSlot(effect.owners,op.getOperand(0),slot)) return reject("core-ir-array-publication","direct effect owner absent");
        if (!step()) return reject("core-ir-array-budget","owner traversal exceeds limit");
        effect.direct[slot]|=mask;
      }
    }
    std::copy(effect.direct,effect.direct+slots,effect.derived); std::copy(effect.direct,effect.direct+slots,effect.effective);
  }
  // Each changed facet crosses a finite original-slot edge at most once. Fresh
  // callee local effects remain caller-local; returned Views map their exact
  // original parameter owner through the independently reconstructed graph.
  std::vector<std::vector<size_t>> outgoing(count*slots);
  for (const auto &call : calls) {
    auto &caller=effects[call.caller]; const auto &callee=metadata.functions[call.target];
    for (size_t slot=0;slot<callee.parameters.size();++slot) if (reference(callee.parameters[slot].type)) {
      unsigned actual=0;
      if (!ownerSlot(caller.owners,call.operation->getOperand(slot),actual)) return reject("core-ir-array-publication","call actual owner absent");
      outgoing[call.target*slots+slot].push_back(call.caller*slots+actual);
      caller.effective[actual]|=bits(metadata.contracts[call.target].parameters[slot]);
    }
    outgoing[call.target*slots+localSlot].push_back(call.caller*slots+localSlot);
    caller.effective[localSlot]|=bits(metadata.contracts[call.target].local);
  }
  std::deque<std::pair<size_t,unsigned>> queue;
  for (size_t i=0;i<count;++i) for (unsigned slot=0;slot<slots;++slot) if (effects[i].direct[slot]) queue.emplace_back(i*slots+slot,effects[i].direct[slot]);
  while (!queue.empty()) {
    const auto [node,delta]=queue.front(); queue.pop_front();
    for (auto destination : outgoing[node]) {
      if (!step()) return reject("core-ir-array-budget","owner traversal exceeds limit");
      auto &value=effects[destination/slots].derived[destination%slots]; const auto added=delta & ~value;
      if (added) { value|=added; queue.emplace_back(destination,added); }
    }
  }
  for (size_t i=0;i<count;++i) for (unsigned slot=0;slot<slots;++slot) {
    const auto allowed=slot==localSlot ? bits(metadata.contracts[i].local)
      : slot<metadata.contracts[i].parameters.size() ? bits(metadata.contracts[i].parameters[slot]) : 0;
    if ((effects[i].effective[slot] | effects[i].derived[slot]) & ~allowed)
      return reject("core-ir-array-publication","actual Derived/Effective effects exceed complete fixed upper");
  }
  return mlir::success();
}
} // namespace
mlir::LogicalResult verifyPublication(mlir::ModuleOp module, Metadata &metadata) {
  const size_t count=metadata.functions.size(); bool reachable[16][16]{}; bool hasView=false,cyclic=false;
  std::vector<Call> calls;
  for (size_t i=0;i<count;++i) {
    const auto &function=metadata.functions[i]; hasView|=llvm::isa<ReadSpanType>(function.resultType);
    for (const auto &parameter : function.parameters) hasView|=llvm::isa<ReadSpanType>(parameter.type);
    for (auto &op : llvm::cast<mlir::func::FuncOp>(function.operation).getBody().front()) {
      for (auto result : op.getResults()) hasView|=llvm::isa<ReadSpanType>(result.getType());
      if (auto call=llvm::dyn_cast<mlir::func::CallOp>(&op)) {
        size_t target=count;
        for (size_t j=0;j<count;++j) if (llvm::cast<mlir::func::FuncOp>(metadata.functions[j].operation).getSymName()==call.getCallee()) target=j;
        if (target==count) return reject("core-ir-array-call","call target absent");
        reachable[i][target]=true; calls.push_back({i,target,call});
      }
    }
  }
  for (size_t k=0;k<count;++k) for (size_t i=0;i<count;++i) for (size_t j=0;j<count;++j)
    reachable[i][j]=reachable[i][j] || (reachable[i][k] && reachable[k][j]);
  for (size_t i=0;i<count;++i) cyclic|=reachable[i][i];
  auto attribute=module->getAttr("tsfg_array.publication");
  if (llvm::isa_and_nonnull<mlir::UnitAttr>(attribute)) {
    if (hasView || cyclic) return reject("core-ir-array-publication","View/cycle requires complete fixed publication");
  } else if (mlir::failed(publication(module,metadata))) return mlir::failure();
  // The entire outgoing union of every SCC is checked, including unreachable
  // functions. A fresh owner passed by an outside acyclic caller is permitted.
  for (size_t i=0;i<count;++i) if (reachable[i][i]) for (size_t j=0;j<count;++j) if (i==j || reachable[i][j]) {
    const auto &function=metadata.functions[j];
    if (llvm::isa<ReadSpanType>(function.resultType)) return reject("core-ir-array-call","cyclic outgoing domain contains a View result");
    for (const auto &parameter : function.parameters) if (llvm::isa<ReadSpanType>(parameter.type))
      return reject("core-ir-array-call","cyclic outgoing domain contains a View parameter");
    for (auto &op : llvm::cast<mlir::func::FuncOp>(function.operation).getBody().front()) {
      if (op.getName().getStringRef()=="tsfg_array.create") return reject("core-ir-array-call","cyclic outgoing domain contains an allocation");
      for (auto value : op.getResults()) if (llvm::isa<ReadSpanType>(value.getType()))
        return reject("core-ir-array-call","cyclic outgoing domain contains a View");
    }
  }
  if (mlir::failed(deriveReturnOrigins(metadata))) return mlir::failure();
  if (metadata.fixedPublication) for (size_t i=0;i<count;++i)
    if (metadata.functions[i].returnOrigin!=metadata.contracts[i].returnOrigin)
      return reject("core-ir-array-publication","fixed return origin differs from complete actual SSA provenance");
  for (const auto &call : calls) {
    const auto consumed=call.operation->getAttr("consumed_digest");
    if (metadata.fixedPublication ? text(call.operation,"consumed_digest")!=metadata.contracts[call.target].digest : !llvm::isa_and_nonnull<mlir::UnitAttr>(consumed))
      return reject("core-ir-array-publication","consumed digest does not name exact fixed target contract");
  }
  if (metadata.fixedPublication && mlir::failed(coverage(metadata,calls))) return mlir::failure();
  return mlir::success();
}
} // namespace tsfg::arrays
