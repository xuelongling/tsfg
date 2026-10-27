// SPDX-License-Identifier: MIT
#pragma once
#include "llvm/ADT/StringRef.h"
#include <array>
#include <cstdint>
#include <string>
#include <vector>

// Internal R04 wire encoding; no frontend or Core operation knowledge.
namespace tsfg::bytecode {
using Bytes = std::vector<uint8_t>;
using Hash = std::array<uint8_t, 32>;
Hash hash(llvm::StringRef text);
std::string hex(const Hash &bytes);
bool decodeHash(llvm::StringRef text, Hash &result);
void integer(Bytes &bytes, uint64_t value, unsigned size);
void string(Bytes &bytes, llvm::StringRef value);
void appendHash(Bytes &bytes, const Hash &value);
} // namespace tsfg::bytecode
