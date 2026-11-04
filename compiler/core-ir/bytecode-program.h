// SPDX-License-Identifier: MIT
#pragma once
#include "bytecode_encoding.h"
#include "bytecode-bounds.h"
#include "mlir/IR/BuiltinOps.h"
#include "llvm/Support/JSON.h"
#include <array>
#include <limits>
#include <string>
#include <vector>

namespace tsfg::wire {
inline constexpr uint32_t version = 20, capability = 1020;
inline constexpr uint16_t noRegister = UINT16_MAX;
inline constexpr uint32_t noDomain = UINT32_MAX;
enum class Table : uint8_t { Sources, Types, Members, Domains, Storage, Views, Abis, Modules, Authority, Closures, Exceptions, Count };
// Environment handles are compiler storage references, never Source nominals.
// kind0 indexes actual domains; kind1 indexes the typed environment directory.
// Common-only kinds5/6 index constructions and have no data static view.
struct Register { uint32_t domain = noDomain; uint16_t view = UINT16_MAX, kind = 0; };
struct Anchor { uint32_t start = 0, end = 0; };
struct Instruction {
  uint8_t opcode = 0, anchorFlags = 0;
  uint16_t result = noRegister, sourceIndex = UINT16_MAX;
  Anchor source;
  std::vector<uint16_t> operands;
  std::vector<Anchor> extraAnchors;
  bytecode::Bytes payload;
};
struct Block { std::vector<uint16_t> parameters; std::vector<Instruction> instructions; };
struct Function {
  bytecode::Hash id{}, signature{};
  uint32_t abi = 0;
  uint16_t source = 0;
  uint8_t role = 0; // 0 ordinary, 1 construction body, 2 module initializer.
  Anchor declaration;
  std::string name;
  std::vector<Register> registers;
  std::vector<Block> blocks;
};
// A successful normalizer publishes this whole owned value once. No MLIR
// pointer, mutable proof state, Source AST or borrowed JSON escapes into it.
struct Program {
  bytecode::Hash input{}, sourceHash{};
  std::string sourcePath;
  uint32_t sourceLength = 0;
  uint16_t rootSource = 0;
  std::array<llvm::json::Value, static_cast<size_t>(Table::Count)> tables = {
    llvm::json::Array(), llvm::json::Array(), llvm::json::Object(),
    llvm::json::Array(), llvm::json::Object(), llvm::json::Object(),
    llvm::json::Array(), llvm::json::Object(), llvm::json::Object(),
    llvm::json::Object{{"functions",llvm::json::Array()},{"environments",llvm::json::Array()},{"calls",llvm::json::Array()}},
    llvm::json::Object{{"functions",llvm::json::Array()},{"bindings",llvm::json::Array()},{"scopes",llvm::json::Array()}}};
  std::vector<Function> functions;
  size_t remaining = maxWork;
  bool charge(size_t n = 1) { if(n>remaining){remaining=0;return false;}remaining-=n;return true; }
  llvm::json::Value &table(Table key) { return tables[static_cast<size_t>(key)]; }
  const llvm::json::Value &table(Table key) const { return tables[static_cast<size_t>(key)]; }
};
struct Error { std::string message; size_t offset = 0; };
// Common-only packet composition is declared by bytecode-common-packet.h.
// The data model exposes no uninstalled legacy normalization/verification API.
} // namespace tsfg::wire
