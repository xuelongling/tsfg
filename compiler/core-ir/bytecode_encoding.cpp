// SPDX-License-Identifier: MIT
#include "bytecode_encoding.h"
#include "llvm/ADT/ArrayRef.h"
#include "llvm/Support/SHA256.h"

namespace tsfg::bytecode {
Hash hash(llvm::StringRef text) {
  return llvm::SHA256::hash(llvm::ArrayRef<uint8_t>(
      reinterpret_cast<const uint8_t *>(text.data()), text.size()));
}
std::string hex(const Hash &bytes) {
  std::string result;
  for (uint8_t byte : bytes) {
    result += "0123456789abcdef"[byte >> 4];
    result += "0123456789abcdef"[byte & 15];
  }
  return result;
}
bool decodeHash(llvm::StringRef text, Hash &result) {
  if (!text.consume_front("sha256:") || text.size() != 64) return false;
  for (size_t i = 0; i < result.size(); ++i) {
    auto digit = [](char c) -> int {
      if (c >= '0' && c <= '9') return c - '0';
      if (c >= 'a' && c <= 'f') return c - 'a' + 10;
      return -1;
    };
    int high = digit(text[i * 2]), low = digit(text[i * 2 + 1]);
    if (high < 0 || low < 0) return false;
    result[i] = static_cast<uint8_t>(high * 16 + low);
  }
  return true;
}
void integer(Bytes &bytes, uint64_t value, unsigned size) {
  for (unsigned i = 0; i < size; ++i) bytes.push_back((value >> (i * 8)) & 255);
}
void string(Bytes &bytes, llvm::StringRef value) {
  integer(bytes, static_cast<uint32_t>(value.size()), 4);
  bytes.insert(bytes.end(), value.bytes_begin(), value.bytes_end());
}
void appendHash(Bytes &bytes, const Hash &value) {
  bytes.insert(bytes.end(), value.begin(), value.end());
}
} // namespace tsfg::bytecode
