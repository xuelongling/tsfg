// SPDX-License-Identifier: MIT
#pragma once
#include "common-program-actual.h"
#include <memory>
namespace tsfg::commonProgram {
// Observe the independently solved actual interpreter, not a producer trace.
// Only compact owner/Span events survive; heap reachability is not last use.
class BorrowTrace {
public:
  explicit BorrowTrace(ActualCheck &);
  ~BorrowTrace();
  bool begin(const ActualContext &,const ActualState &);
  bool before(const ActualContext &,const Operation &,size_t,const ActualState &);
  bool after(const ActualContext &,const Operation &,size_t,const ActualState &,bool);
  bool edge(const ActualContext &,const Operation &,size_t,uint16_t);
  bool call(const ActualContext &,const Operation &,size_t,const ActualContext &);
  bool solve();
private:
  struct Impl;std::unique_ptr<Impl> impl;
};
bool verifyCommonBorrows(ActualCheck &);
} // namespace tsfg::commonProgram
