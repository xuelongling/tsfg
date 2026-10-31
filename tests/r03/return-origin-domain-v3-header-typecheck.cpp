// SPDX-License-Identifier: MIT
// Unevaluated type expressions only. No main, callbacks, Scope/Graph/Program
// construction, solver invocation, Runtime or behavior fixture is present.
#include "../../compiler/core-ir/common-program-return-origin-domain-v3.h"
#include <type_traits>
#include <utility>

namespace ReturnOriginDomainV3HeaderTypecheck {
namespace Domain=CommonReturnOriginDomainV3;
namespace V3=CommonReturnOriginV3;
using Signature=Domain::SolveResult (*)(const V3::Graph &,const Domain::FixedFunctions &,const Domain::Callbacks &,const V3::Charge &);
static_assert(std::is_same_v<decltype(&Domain::solve),Signature>);
static_assert(std::is_same_v<decltype(Domain::solve(std::declval<const V3::Graph &>(),std::declval<const Domain::FixedFunctions &>(),std::declval<const Domain::Callbacks &>(),std::declval<const V3::Charge &>())),Domain::SolveResult>);
static_assert(std::is_enum_v<Domain::Status>);
static_assert(std::is_enum_v<Domain::Protocol>);
static_assert(static_cast<std::size_t>(V3::AccessFlag::Read)==0);
static_assert(static_cast<std::size_t>(V3::AccessFlag::Write)==1);
static_assert(static_cast<std::size_t>(V3::AccessFlag::Structural)==2);
static_assert(std::is_same_v<decltype(std::declval<Domain::FixedFunction>().graph),const V3::Graph *>);
static_assert(std::is_same_v<decltype(std::declval<Domain::FixedFunction>().upper),const Domain::PublishedEffects *>);
static_assert(std::is_same_v<decltype(std::declval<Domain::SolveResult>().summary),Domain::Summary>);
static_assert(std::is_same_v<decltype(std::declval<Domain::Summary>().owners),std::vector<V3::SymbolSet>>);
static_assert(std::is_same_v<decltype(std::declval<Domain::Summary>().live),std::vector<bool>>);
static_assert(std::is_same_v<std::invoke_result_t<decltype(std::declval<Domain::Callbacks>().actualType),llvm::StringRef,const V3::Charge &>,const Domain::ActualShape *>);
static_assert(std::is_same_v<std::invoke_result_t<decltype(std::declval<Domain::Callbacks>().projectField),llvm::StringRef,llvm::StringRef,llvm::StringRef,const V3::Charge &>,std::optional<llvm::StringRef>>);
static_assert(std::is_same_v<std::invoke_result_t<decltype(std::declval<Domain::Callbacks>().mayAlias),const Domain::LocationView &,const Domain::LocationView &,const V3::Charge &>,bool>);
} // namespace ReturnOriginDomainV3HeaderTypecheck
