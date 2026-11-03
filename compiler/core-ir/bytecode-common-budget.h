// SPDX-License-Identifier: MIT
#pragma once
#include <common-program.h>
#include <algorithm>

namespace tsfg::wire::common {
// A delegated Common business pass spends the smaller live budget. Restore
// only its unspent Source allowance; neither success nor failure refills work.
class WorkScope {
  commonProgram::Program &source;size_t &normalized;
  size_t original,allowance;
public:
  WorkScope(commonProgram::Program &source,size_t &normalized):source(source),normalized(normalized),original(source.remaining),allowance(std::min(source.remaining,normalized)){
    source.remaining=allowance;
  }
  WorkScope(const WorkScope &)=delete;
  WorkScope &operator=(const WorkScope &)=delete;
  ~WorkScope(){const auto spent=allowance-source.remaining;source.remaining=original-spent;normalized-=spent;}
};
} // namespace tsfg::wire::common
