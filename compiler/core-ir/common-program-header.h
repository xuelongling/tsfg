// SPDX-License-Identifier: MIT
#pragma once
#include "bytecode_encoding.h"
#include "core-source.h"
#include "mlir/IR/BuiltinOps.h"
namespace tsfg::commonProgram::coreHeader {
inline constexpr llvm::StringLiteral bytecodeSchema =
    "fec456a47f509480d96f65e5c03d465c7c204d60f09630e71b19c714d4aaafa7";
inline constexpr llvm::StringLiteral target = "windows-x86_64-msvc";
inline constexpr llvm::StringLiteral triple = "x86_64-pc-windows-msvc";
inline constexpr llvm::StringLiteral layout =
    "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128";
struct Identity {
  llvm::StringRef sourcePath;
  bytecode::Hash input, source;
  uint32_t sourceLength = 0;
};
// Private Program header identity is independent of formal Core/wire0.10.
// This exact 0.12 carrier does not admit the formal frontend or wire protocol.
inline bool read(mlir::ModuleOp module, Identity &out) {
  const auto text = [&](llvm::StringRef key) -> llvm::StringRef {
    const auto value = module->getAttrOfType<mlir::StringAttr>(key);
    return value ? value.getValue() : llvm::StringRef();
  };
  if (text("tsfg_core.version") != "0.12.0" ||
      text("tsfg_core.bytecode_schema") != ("sha256:" + bytecodeSchema).str() ||
      text("tsfg_core.target") != target || text("tsfg_core.triple") != triple ||
      text("tsfg_core.data_layout") != layout) return false;
  Identity value;
  value.sourcePath = text("tsfg_core.source_path");
  const auto length = module->getAttrOfType<mlir::IntegerAttr>("tsfg_core.source_length");
  if (!validSourcePath(value.sourcePath, false) ||
      !bytecode::decodeHash(text("tsfg_core.input_identity"), value.input) ||
      !bytecode::decodeHash(text("tsfg_core.source_hash"), value.source) ||
      !length || !length.getType().isSignlessInteger(64) || length.getInt() < 0 ||
      length.getInt() > UINT32_MAX) return false;
  value.sourceLength = static_cast<uint32_t>(length.getInt());
  out = value; return true;
}
}
