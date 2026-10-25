// SPDX-License-Identifier: MIT
#include "formal-closure.h"
#include "array-owner-json.h"
#include "bytecode.h"
#include "mlir/IR/Verifier.h"
namespace tsfg::formalClosure {
bool uses(mlir::ModuleOp module) {return module->hasAttr("tsfg_core.closure_program");}
mlir::LogicalResult verify(mlir::ModuleOp module) {
  using namespace closure;
  coreHeader::Identity identity;
  if(!coreHeader::read(module,identity)||!attributes(module,{"tsfg_core.version","tsfg_core.input_identity",
      "tsfg_core.source_hash","tsfg_core.source_path","tsfg_core.target","tsfg_core.triple",
      "tsfg_core.data_layout","tsfg_core.bytecode_schema","tsfg_core.source_length",
      "tsfg_core.closure_program","tsfg_core.closure_tables"}))return fail("ordinary header or mixed representation");
  const auto manifest=module->getAttrOfType<mlir::DictionaryAttr>("tsfg_core.closure_program");
  const auto tables=module->getAttrOfType<mlir::DictionaryAttr>("tsfg_core.closure_tables");
  if(!manifest||manifest.size()!=5||!tables||tables.size()!=3)return fail("complete program fields");
  const auto schema=manifest.getAs<mlir::StringAttr>("schema"),hir=manifest.getAs<mlir::StringAttr>("hir"),
    hirHash=manifest.getAs<mlir::StringAttr>("hir_hash"),targets=manifest.getAs<mlir::StringAttr>("targets");
  const auto version=manifest.getAs<mlir::IntegerAttr>("version");
  if(!schema||schema.getValue()!="sha256:c8276fa5f945ce1fb934dc1dc709f24805c4ec18a0693e81f1c1e0e16d886795"||!version||!version.getType().isSignlessInteger(64)
      ||version.getInt()!=1||!hir||!hirHash||!targets||hirHash.getValue()!=hash(hir.getValue()))
    return fail("program identity");
  arrays::ownerproof::Json sourceValue=nullptr,targetValue=nullptr;
  if(!arrays::ownerproof::parseCanonical(hir.getValue(),sourceValue)
      ||!arrays::ownerproof::parseCanonical(targets.getValue(),targetValue))return fail("bounded canonical declarations");
  const auto *source=sourceValue.getAsObject(),*target=targetValue.getAsObject();
  if(!source||!target)return fail("source or target declarations");
  Metadata metadata;
  metadata.input=text(module,"tsfg_core.input_identity").str();metadata.sourcePath=identity.sourcePath.str();
  metadata.sourceHash=text(module,"tsfg_core.source_hash").str();metadata.sourceLength=identity.sourceLength;
  metadata.hirHash=hirHash.getValue().str();
  if(mlir::failed(readTables(tables,metadata)))return mlir::failure();
  SourceGraph graph;
  if(mlir::failed(verifySource(module,metadata,*source,*target,graph))
      ||mlir::failed(mlir::verify(module))||mlir::failed(verifyProgram(module,metadata)))return mlir::failure();
  Index index(metadata);
  if(mlir::failed(verifyTargets(module,index,graph)))return mlir::failure();
  ClosureRootAnalysis roots;
  return analyzeProgramRoots(module,metadata,roots);
}
}
