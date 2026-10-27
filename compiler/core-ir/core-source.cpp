// SPDX-License-Identifier: MIT
#include "core-source.h"
#include "llvm/Support/ConvertUTF.h"
namespace tsfg {
bool validUtf8(llvm::StringRef text) {
  const auto *cursor = reinterpret_cast<const llvm::UTF8 *>(text.data());
  return llvm::isLegalUTF8String(&cursor, cursor + text.size());
}
bool validSourcePath(llvm::StringRef path, bool allowDeclarations) {
  if (path.empty() || path.size() > 4096 || !path.starts_with("/") || !path.ends_with(".ts") ||
      (!allowDeclarations && path.ends_with(".d.ts")) || path.contains('\0') ||
      path.contains('\\') || path.contains(':') || !validUtf8(path)) return false;
  path = path.drop_front();
  while (true) {
    auto [component, remaining] = path.split('/');
    if (component.empty() || component == "." || component == "..") return false;
    if (remaining.empty()) return true;
    path = remaining;
  }
}
}
