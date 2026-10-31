// SPDX-License-Identifier: MIT
// Compile-only private4 identity/budget contracts. No Program/Graph is executed.
#include "../../compiler/core-ir/common-program.h"
#include <limits>
#include <type_traits>
#include <utility>
using namespace tsfg::commonProgram;
constexpr bool sameText(llvm::StringRef left,llvm::StringRef right){
  if(left.size()!=right.size())return false;
  for(size_t index=0;index<left.size();++index)if(left.data()[index]!=right.data()[index])return false;
  return true;
}
static_assert(profileVersion==4);
static_assert(programWorkLimit==2000000);
static_assert(std::numeric_limits<size_t>::max()>=programWorkLimit);
static_assert(sameText(schema,"sha256:98c9cf9e7b4c4dce0a8df339264f78d535d4e454af219fd8c71bbaec838ef821"));
static_assert(!sameText(schema,"sha256:6f14a7569cce9d098fa892d9d0809bf0b11e55e7459070ef94aa90fb0392a498"));
static_assert(!sameText(schema,"sha256:928348225e0dcf59c8dbe9a53b8db8e2ce66afef86fe66e66fb77d8c353aa039"));
static_assert(!sameText(schema,"sha256:17aca193ae46b3ac5321d6247e7d3a1e629a643e04db8e86994f359f5f8b42a9"));
static_assert(!sameText(schema,"sha256:8e6bcef004a94baae52bbf83df50adb1d0f8c0f88ad20d0cb7bbf3ceb357499b"));
static_assert(!sameText(schema,"sha256:03862e52f6bea76ec2825ef02156b8f9e50c18218439d843eacf827aebd92769"));
static_assert(!sameText(schema,"sha256:ab0fd37a7d73e935d1df3b9a068fbb0daac2ff66734bfce10411f4795a0d7bcb"));
static_assert(!sameText(schema,"sha256:6ee9c89feb1fe7106b60e663c74a504ed5b12476c6c2d8ab210f3261f2fe2f0f"));
static_assert(std::is_same_v<decltype(Program::remaining),size_t>);
static_assert(std::is_same_v<decltype(std::declval<Program &>().charge(size_t{})),bool>);
