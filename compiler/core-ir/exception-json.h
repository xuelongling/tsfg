// SPDX-License-Identifier: MIT
#pragma once
#include "llvm/Support/JSON.h"
#include "llvm/ADT/ArrayRef.h"
#include <cstdint>
#include <string>

namespace tsfg::exception {
using Json = llvm::json::Value;
using Object = llvm::json::Object;
using Array = llvm::json::Array;
struct Check {
  bool ok = true;
  std::string category = "schema";
  uint32_t work = 0;
  bool require(bool condition, llvm::StringRef code = "schema");
  bool step(uint32_t count = 1);
};
inline constexpr llvm::StringLiteral schema = "sha256:62e69eda2f22f85d55d132bff04f0b60229db69031ca51113c746d6e9424b359";
inline constexpr llvm::StringLiteral hirSchema = "sha256:af8317d8403ea2817e1eba2c47e1d4ef38090f7127897204b05e369ec545ddfd";
inline constexpr llvm::StringLiteral snapshotSchema = "sha256:5221b50822965c633418462b28a9b58bfbc41b01e0fa4b6d31c50ab83805424d";
inline constexpr llvm::StringLiteral i32Id = "sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727";
std::string digest(llvm::StringRef bytes);
std::string canonical(const Json &value);
bool readCanonical(llvm::StringRef bytes, Json &value, Check &check, bool finalLF = false);
bool exact(const Json &value, llvm::ArrayRef<llvm::StringRef> required,
           llvm::ArrayRef<llvm::StringRef> optional = {});
const Json &field(const Json &value, llvm::StringRef key);
const Array &items(const Json &value);
std::string string(const Json &value);
bool equal(const Json &a, const Json &b);
std::string identity(llvm::StringRef domain, llvm::StringRef schemaHash, const Json &record);
Json format(llvm::StringRef family, llvm::StringRef schemaHash);
} // namespace tsfg::exception
