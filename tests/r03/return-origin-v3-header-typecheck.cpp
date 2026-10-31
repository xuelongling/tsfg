// SPDX-License-Identifier: MIT
// Unevaluated type expressions only. No main, graph construction, callback,
// read/covered invocation, Program, Runtime or execution fixture lives here.
#include "../../compiler/core-ir/common-program-return-origins-v3.h"
#include <type_traits>
#include <utility>

namespace ReturnOriginV3HeaderTypecheck {
namespace V3=CommonReturnOriginV3;
using ReadSignature=V3::ReadResult (*)(const llvm::json::Value &,const V3::Directory &,const V3::Charge &);
using CoveredSignature=V3::InclusionResult (*)(const V3::Graph &,const V3::Graph &,const V3::FixedContracts &,const V3::Charge &);
static_assert(std::is_same_v<decltype(&V3::read),ReadSignature>);
static_assert(std::is_same_v<decltype(&V3::covered),CoveredSignature>);
static_assert(std::is_same_v<decltype(V3::read(std::declval<const llvm::json::Value &>(),std::declval<const V3::Directory &>(),std::declval<const V3::Charge &>())),V3::ReadResult>);
static_assert(std::is_same_v<decltype(V3::covered(std::declval<const V3::Graph &>(),std::declval<const V3::Graph &>(),std::declval<const V3::FixedContracts &>(),std::declval<const V3::Charge &>())),V3::InclusionResult>);
static_assert(std::is_enum_v<V3::ReadStatus>);
static_assert(std::is_enum_v<V3::InclusionStatus>);
static_assert(!std::is_same_v<V3::ReadStatus,V3::InclusionStatus>);
static_assert(std::is_same_v<decltype(std::declval<V3::ReadResult>().graph),V3::Graph>);
static_assert(std::is_same_v<V3::FixedContracts::mapped_type,const V3::Graph *>);
} // namespace ReturnOriginV3HeaderTypecheck
