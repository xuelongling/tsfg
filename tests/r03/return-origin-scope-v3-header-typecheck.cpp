// SPDX-License-Identifier: MIT
// Unevaluated type expressions only: no main, Scope/Graph construction,
// callback definition/invocation, Program, Runtime or behavior fixture.
#include "../../compiler/core-ir/common-program-return-origin-scope-v3.h"
#include <type_traits>
#include <utility>

namespace ReturnOriginScopeV3HeaderTypecheck {
namespace Scope=CommonReturnOriginScopeV3;
namespace V3=CommonReturnOriginV3;
using BuildSignature=Scope::BuildResult (*)(const Scope::FixedScope &,const Scope::FieldIdentity &,const V3::Charge &);
using ReadSignature=V3::ReadResult (Scope::ScopeDirectories::*)(llvm::StringRef,const llvm::json::Value &,const V3::Charge &);
static_assert(std::is_same_v<decltype(&Scope::build),BuildSignature>);
static_assert(std::is_same_v<decltype(&Scope::ScopeDirectories::read),ReadSignature>);
static_assert(std::is_same_v<decltype(Scope::build(std::declval<const Scope::FixedScope &>(),std::declval<const Scope::FieldIdentity &>(),std::declval<const V3::Charge &>())),Scope::BuildResult>);
static_assert(std::is_same_v<decltype(std::declval<Scope::ScopeDirectories &>().read(std::declval<llvm::StringRef>(),std::declval<const llvm::json::Value &>(),std::declval<const V3::Charge &>())),V3::ReadResult>);
static_assert(std::is_same_v<decltype(std::declval<Scope::BuildResult>().directories),Scope::ScopeDirectories>);
static_assert(std::is_enum_v<Scope::BuildStatus>);
static_assert(!std::is_copy_constructible_v<Scope::ScopeDirectories>);
static_assert(std::is_move_constructible_v<Scope::ScopeDirectories>);
static_assert(!std::is_copy_constructible_v<Scope::BuildResult>);
static_assert(std::is_move_constructible_v<Scope::BuildResult>);
} // namespace ReturnOriginScopeV3HeaderTypecheck
