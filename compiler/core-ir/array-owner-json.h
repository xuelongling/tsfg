// SPDX-License-Identifier: MIT
#pragma once
#include "llvm/Support/JSON.h"
#include <cstddef>
#include <cstdint>
#include <string>

namespace tsfg::arrays::ownerproof {
using Json = llvm::json::Value;
inline constexpr size_t jsonByteLimit = 8388608;
inline constexpr size_t jsonStringLimit = 1048576;
inline constexpr size_t jsonTokenLimit = 200000;
inline constexpr size_t jsonMemberLimit = 65536;
inline constexpr unsigned jsonDepthLimit = 128;
enum class JsonError { None, Input, Limit, Canonical };
enum class JsonMode { Output, Envelope };
struct JsonCounts {
  size_t bytes = 0, tokens = 0, members = 0;
  unsigned depth = 0;
};
struct JsonStatus {
  JsonError error = JsonError::None;
  JsonCounts counts;
  explicit operator bool() const { return error == JsonError::None; }
};
// Counts exclude the terminal LF. Envelope mode grants the 8MiB decoded-string
// exception only to a string at root-object key coreText, never nested keys.
// On failure neither admitted nor output is changed. All numbers use binary64.
JsonStatus parseCanonical(llvm::StringRef raw, Json &admitted);
JsonStatus measureCanonical(const Json &value, JsonMode mode = JsonMode::Output);
JsonStatus encodeCanonical(const Json &value, std::string &output,
                           JsonMode mode = JsonMode::Output);
namespace jsondetail {
// Shared strict Unicode and numeric primitives; not an alternate transport.
bool nextUtf8(llvm::StringRef text, size_t &at, uint32_t &point);
bool numberText(double value, std::string &text);
} // namespace jsondetail
} // namespace tsfg::arrays::ownerproof
