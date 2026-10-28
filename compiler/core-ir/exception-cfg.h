// SPDX-License-Identifier: MIT
#pragma once
#include "exception-source.h"
#include <vector>

namespace tsfg::exception {
struct ExpectedOperation {
  enum Kind { Fuel, Pack, Branch, Propagate } kind;
  Range range;
  std::vector<unsigned> operands, results;
  int destination = -1;
};
struct ExpectedBlock {
  std::vector<unsigned> parameters;
  std::vector<ExpectedOperation> operations;
};
struct ExpectedValue { std::string id, type; unsigned block; };
// Immutable after construction; these are expected semantic values, never MLIR
// handles or producer-supplied metadata. Mutable planning stays in cfg.cpp.
struct ExpectedGraph {
  std::string payloadType;
  Json marker = nullptr;
  std::vector<ExpectedBlock> blocks;
  std::vector<ExpectedValue> values;
};
bool reconstructGraph(const Provenance &provenance, ExpectedGraph &graph, Check &check);
} // namespace tsfg::exception
