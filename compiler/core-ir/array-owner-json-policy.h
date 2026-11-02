// SPDX-License-Identifier: MIT
#pragma once
#include "array-owner-json.h"

namespace tsfg::arrays::ownerproof {
// One canonical JSON algorithm with explicit owning-family budgets. Existing
// owner-proof callers retain their original defaults and coreText rule.
struct JsonPolicy {
  size_t bytes=jsonByteLimit, stringBytes=jsonStringLimit;
  size_t tokens=jsonTokenLimit, members=jsonMemberLimit;
  unsigned depth=jsonDepthLimit;
};
JsonStatus parseCanonical(llvm::StringRef raw,Json &admitted,const JsonPolicy &);
JsonStatus encodeCanonical(const Json &,std::string &,const JsonPolicy &,JsonMode mode=JsonMode::Output);
// Synchronous borrowed array of already admitted UTF8 strings, with the same
// policy/count/output boundary as Json. This is not a raw-string admission API.
JsonStatus encodeCanonical(llvm::ArrayRef<llvm::StringRef>,std::string &,
                           const JsonPolicy &policy=JsonPolicy{},JsonMode mode=JsonMode::Output);
} // namespace tsfg::arrays::ownerproof
