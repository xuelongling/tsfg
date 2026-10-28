// SPDX-License-Identifier: MIT
#pragma once
#include "exception-json.h"
#include <map>
#include <memory>
#include <vector>

namespace tsfg::exception {
struct Range {
  uint32_t start = 0, end = 0;
  Json json() const { return Object{{"start",int64_t(start)},{"end",int64_t(end)}}; }
};
struct SourceSymbol {
  std::string id, name, type, kind;
  bool writable = false;
  Range range;
  Json presence = nullptr;
  Json json() const;
};
struct SourceRegion;
struct SourceStatement {
  enum Kind { Alias, Throw, Block, Try } kind = Throw;
  Range range, expression, catchRange, declarationRange;
  int declaration = -1, reference = -1, catchBinding = -1;
  std::string readName;
  std::unique_ptr<SourceRegion> region, caught, finalized;
};
struct SourceRegion {
  Range range;
  std::vector<SourceStatement> body;
};
struct SourceProgram {
  std::string path, content, name;
  uint32_t length = 0;
  bool parameterInitializersPresent = true;
  Range range, nameRange;
  std::vector<SourceSymbol> symbols;
  std::vector<unsigned> parameters;
  SourceRegion root;
  Json facts() const;
  Json exports() const;
};
bool readSource(llvm::StringRef content, llvm::StringRef path, SourceProgram &program, Check &check);
// Provenance owns a completely independently reconstructed Source program and HIR.
struct Provenance {
  SourceProgram source;
  Json hir = nullptr;
  std::string hirJcs, inputIdentity, sourceHash;
};
bool verifyProvenance(llvm::StringRef hirJcs, Provenance &result, Check &check);
Json reconstructHir(const SourceProgram &program, const Json &snapshot, Check &check);
} // namespace tsfg::exception
