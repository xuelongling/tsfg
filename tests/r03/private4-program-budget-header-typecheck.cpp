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
static_assert(sameText(schema,"sha256:03862e52f6bea76ec2825ef02156b8f9e50c18218439d843eacf827aebd92769"));
static_assert(!sameText(schema,"sha256:ab0fd37a7d73e935d1df3b9a068fbb0daac2ff66734bfce10411f4795a0d7bcb"));
static_assert(!sameText(schema,"sha256:6ee9c89feb1fe7106b60e663c74a504ed5b12476c6c2d8ab210f3261f2fe2f0f"));
static_assert(std::is_same_v<decltype(Program::remaining),size_t>);
static_assert(std::is_same_v<decltype(std::declval<Program &>().charge(size_t{})),bool>);
