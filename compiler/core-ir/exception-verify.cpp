// SPDX-License-Identifier: MIT
#include "exception.h"
#include "exception-cfg.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/IR/Verifier.h"
#include "llvm/Support/raw_ostream.h"

namespace tsfg::exception {
namespace {
bool attributes(mlir::Operation *operation,llvm::ArrayRef<llvm::StringRef> names) {
  if (operation->getAttrs().size() != names.size()) return false;
  for (auto name : names) if (!operation->getAttr(name)) return false;
  return true;
}
bool text(mlir::Operation *operation,llvm::StringRef key,llvm::StringRef expected) {
  auto actual = operation->getAttrOfType<mlir::StringAttr>(key);
  return actual && actual.getValue() == expected;
}
bool integer(mlir::Operation *operation,llvm::StringRef key,uint64_t expected,unsigned bits = 64) {
  auto actual = operation->getAttrOfType<mlir::IntegerAttr>(key);
  return actual && actual.getType().isSignlessInteger(bits) && actual.getInt() >= 0 && uint64_t(actual.getInt()) == expected;
}
Json metadata(mlir::Attribute attribute,Check &check,llvm::StringRef key = "",unsigned depth = 0) {
  if (!check.require(depth <= 128,"limit") || !check.step()) return nullptr;
  if (auto value = llvm::dyn_cast<mlir::StringAttr>(attribute)) {
    if (!check.require(value.getValue().size() <= 1048576,"limit")) return nullptr;
    return value.getValue();
  }
  if (auto value = llvm::dyn_cast<mlir::BoolAttr>(attribute)) return value.getValue();
  if (auto value = llvm::dyn_cast<mlir::IntegerAttr>(attribute)) {
    if (!check.require(value.getType().isSignlessInteger(key == "version" ? 32 : 64)
        && value.getInt() >= 0 && uint64_t(value.getInt()) <= 9007199254740991ULL)) return nullptr;
    return value.getInt();
  }
  if (auto value = llvm::dyn_cast<mlir::ArrayAttr>(attribute)) {
    if (!check.require(value.size() <= 4096,"limit")) return nullptr;
    Array result;
    for (auto entry : value) { result.push_back(metadata(entry,check,"",depth + 1)); if (!check.ok) return nullptr; }
    return result;
  }
  if (auto value = llvm::dyn_cast<mlir::DictionaryAttr>(attribute)) {
    if (!check.require(value.size() <= 32,"limit")) return nullptr;
    Object result;
    for (auto entry : value) {
      result[entry.getName().strref()] = metadata(entry.getValue(),check,entry.getName().strref(),depth + 1);
      if (!check.ok) return nullptr;
    }
    return result;
  }
  check.require(false); return nullptr;
}
bool type(mlir::Type actual,llvm::StringRef expected,const ExpectedGraph &graph) {
  if (expected == i32Id) return actual.isSignlessInteger(32);
  auto carrier = llvm::dyn_cast<PayloadType>(actual);
  return expected == graph.payloadType && carrier && carrier.key() == graph.payloadType;
}
bool anchor(mlir::Operation *operation,const Range &range) {
  return integer(operation,"tsfg_source.start",range.start) && integer(operation,"tsfg_source.end",range.end);
}
bool graph(mlir::func::FuncOp fn,const ExpectedGraph &expected,Check &check) {
  auto &region = fn.getBody();
  if (!check.require(region.getBlocks().size() == expected.blocks.size(),"cfg")) return false;
  std::vector<mlir::Block *> blocks; blocks.reserve(expected.blocks.size());
  std::vector<mlir::Value> values(expected.values.size());
  for (auto &block : region) blocks.push_back(&block);
  for (size_t at = 0; at < blocks.size(); ++at) {
    const auto &block = expected.blocks[at];
    if (!check.require(blocks[at]->getNumArguments() == block.parameters.size(),"cfg")) return false;
    for (unsigned i = 0; i < block.parameters.size(); ++i) {
      unsigned index = block.parameters[i]; auto actual = blocks[at]->getArgument(i);
      if (!check.require(index < values.size() && type(actual.getType(),expected.values[index].type,expected),"type")) return false;
      values[index] = actual;
    }
  }
  for (size_t at = 0; at < blocks.size(); ++at) {
    const auto &block = expected.blocks[at];
    if (!check.require(blocks[at]->getOperations().size() == block.operations.size(),"cfg")) return false;
    auto iterator = blocks[at]->begin();
    for (const auto &operation : block.operations) {
      if (!check.step()) return false;
      auto *actual = &*iterator++;
      llvm::StringRef name = actual->getName().getStringRef();
      llvm::StringRef expectedName = operation.kind == ExpectedOperation::Fuel ? "tsfg_core.fuel"
        : operation.kind == ExpectedOperation::Pack ? "tsfg_exception.pack"
        : operation.kind == ExpectedOperation::Branch ? "cf.br" : "tsfg_exception.propagate";
      if (!check.require(name == expectedName && actual->getNumRegions() == 0
          && actual->getNumOperands() == operation.operands.size() && actual->getNumResults() == operation.results.size()
          && actual->getNumSuccessors() == (operation.destination < 0 ? 0 : 1) && anchor(actual,operation.range),"cfg")) return false;
      if (operation.kind == ExpectedOperation::Fuel) {
        if (!check.require(attributes(actual,{"event","tsfg_source.start","tsfg_source.end"}) && integer(actual,"event",1,32),"cfg")) return false;
      } else if (operation.kind == ExpectedOperation::Pack) {
        if (!check.require(attributes(actual,{"payload_type","tsfg_source.start","tsfg_source.end"}) && text(actual,"payload_type",i32Id),"type")) return false;
      } else if (!check.require(attributes(actual,{"tsfg_source.start","tsfg_source.end"}),"cfg")) return false;
      for (unsigned i = 0; i < operation.operands.size(); ++i)
        if (!check.require(operation.operands[i] < values.size() && values[operation.operands[i]]
            && actual->getOperand(i) == values[operation.operands[i]],"cfg")) return false;
      for (unsigned i = 0; i < operation.results.size(); ++i) {
        unsigned index = operation.results[i];
        if (!check.require(index < values.size() && !values[index] && type(actual->getResult(i).getType(),expected.values[index].type,expected),"type")) return false;
        values[index] = actual->getResult(i);
      }
      if (operation.destination >= 0 && !check.require(unsigned(operation.destination) < blocks.size()
          && actual->getSuccessor(0) == blocks[operation.destination],"cfg")) return false;
    }
  }
  for (auto value : values) if (!check.require(bool(value),"cfg")) return false;
  return check.ok;
}
bool verify(mlir::ModuleOp module,Check &check) {
  if (!check.require(attributes(module.getOperation(),{"tsfg_core.version","tsfg_core.input_identity","tsfg_core.source_hash",
      "tsfg_core.source_path","tsfg_core.target","tsfg_core.triple","tsfg_core.data_layout","tsfg_core.bytecode_schema",
      "tsfg_core.source_length","tsfg_core.exception"}),"marker")) return false;
  auto marker = module->getAttrOfType<mlir::DictionaryAttr>("tsfg_core.exception");
  if (!check.require(bool(marker),"marker")) return false;
  constexpr llvm::StringLiteral markerNames[] = {"family","version","schema","hir_schema","hir_hash","semantic_hir_hash",
    "program_id","hir_jcs","payload_types","frames","blocks","values","bindings","edges"};
  if (!check.require(marker.size() == 14,"marker")) return false;
  for (auto name : markerNames) if (!check.require(bool(marker.get(name)),"marker")) return false;
  struct Bound { llvm::StringRef name; size_t count; };
  for (const auto &bound : {Bound{"payload_types",1},Bound{"frames",1},Bound{"blocks",256},
                           Bound{"values",4096},Bound{"bindings",256},Bound{"edges",256}}) {
    auto array = marker.getAs<mlir::ArrayAttr>(bound.name);
    if (!check.require(bool(array) && array.size() <= bound.count,"limit")) return false;
  }
  if (!check.require(marker.getAs<mlir::StringAttr>("family") && marker.getAs<mlir::StringAttr>("schema")
      && marker.getAs<mlir::StringAttr>("family").getValue() == "tsfg.core-exception-candidate"
      && marker.getAs<mlir::StringAttr>("schema").getValue() == schema,"marker")) return false;
  auto hir = marker.getAs<mlir::StringAttr>("hir_jcs");
  if (!check.require(bool(hir) && hir.getValue().size() <= 1048576,"limit")) return false;
  // No supplied ID, table, verified flag or MLIR operand authorizes Source/HIR.
  Provenance proof;
  if (!verifyProvenance(hir.getValue(),proof,check)) return false;
  ExpectedGraph expected;
  if (!reconstructGraph(proof,expected,check)) return false;
  Json actualMetadata = metadata(marker,check);
  if (!check.ok || !check.require(equal(actualMetadata,expected.marker),"cfg")) return false;
  const auto &target = field(proof.hir,"target");
  if (!check.require(text(module.getOperation(),"tsfg_core.version","0.9.0")
      && text(module.getOperation(),"tsfg_core.input_identity",proof.inputIdentity)
      && text(module.getOperation(),"tsfg_core.source_hash",proof.sourceHash)
      && text(module.getOperation(),"tsfg_core.source_path",proof.source.path)
      && text(module.getOperation(),"tsfg_core.target",string(field(target,"target")))
      && text(module.getOperation(),"tsfg_core.triple",string(field(target,"triple")))
      && text(module.getOperation(),"tsfg_core.data_layout",string(field(target,"llvmDataLayout")))
      && text(module.getOperation(),"tsfg_core.bytecode_schema","sha256:3dea6ce5de996dfa3e7141cced985243ea74ac9bb80f03636c6694343118f2a6")
      && integer(module.getOperation(),"tsfg_core.source_length",proof.source.length),"identity")) return false;
  if (!check.require(module.getBody()->getOperations().size() == 1,"cfg")) return false;
  auto fn = llvm::dyn_cast<mlir::func::FuncOp>(&module.getBody()->front());
  if (!check.require(bool(fn),"cfg")) return false;
  if (!check.require(attributes(fn.getOperation(),{"sym_name","function_type","tsfg_core.function_id","tsfg_core.signature_hash",
      "tsfg_core.type_id","tsfg_core.function_start","tsfg_core.function_end","tsfg_exception.callable_type","tsfg_exception.root_scope"}),"schema")) return false;
  const auto &function = items(field(proof.hir,"functions"))[0];
  auto id = string(field(function,"id"));
  auto signature = fn.getFunctionType();
  if (!check.require(fn.getSymName() == "f" + id.substr(7) && signature.getNumInputs() == proof.source.parameters.size()
      && signature.getNumResults() == 1 && signature.getResult(0).isSignlessInteger(32)
      && text(fn.getOperation(),"tsfg_core.function_id",id)
      && text(fn.getOperation(),"tsfg_core.signature_hash",string(field(function,"signatureHash")))
      && text(fn.getOperation(),"tsfg_core.type_id",i32Id)
      && integer(fn.getOperation(),"tsfg_core.function_start",proof.source.range.start)
      && integer(fn.getOperation(),"tsfg_core.function_end",proof.source.range.end)
      && text(fn.getOperation(),"tsfg_exception.callable_type",string(field(function,"type")))
      && text(fn.getOperation(),"tsfg_exception.root_scope",string(field(field(function,"body"),"scope"))),"identity")) return false;
  for (auto parameter : signature.getInputs()) if (!check.require(parameter.isSignlessInteger(32),"type")) return false;
  if (!graph(fn,expected,check)) return false;
  return check.require(mlir::succeeded(mlir::verify(module)),"cfg");
}
} // namespace
mlir::LogicalResult verifyCandidate(mlir::ModuleOp module) {
  Check check;
  if (verify(module,check)) return mlir::success();
  llvm::errs() << "[core-ir-exception-" << check.category << "] private candidate differs\n";
  return mlir::failure();
}
} // namespace tsfg::exception
