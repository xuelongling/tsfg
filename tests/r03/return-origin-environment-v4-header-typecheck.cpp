// SPDX-License-Identifier: MIT
// Unevaluated declarations only: no main, Graph/Scope/Program construction,
// callback execution, solve/read/covered invocation, Native link or behavior.
#include "../../compiler/core-ir/common-program-return-origin-scope-v4.h"
#include <type_traits>
#include <utility>
namespace ReturnOriginEnvironmentV4HeaderTypecheck {
namespace V4=CommonReturnOriginV4;
namespace Domain=CommonReturnOriginDomainV4;
namespace Scope=CommonReturnOriginScopeV4;
using Read=V4::ReadResult (*)(const llvm::json::Value &,const V4::Directory &,const V4::Charge &);
using Covered=V4::InclusionResult (*)(const V4::Graph &,const V4::Graph &,const V4::FixedContracts &,const V4::Charge &);
using Solve=Domain::SolveResult (*)(const V4::Graph &,const Domain::FixedFunctions &,const Domain::Callbacks &,const V4::Charge &);
using Build=Scope::BuildResult (*)(const Scope::FixedScope &,const Scope::FieldIdentity &,const V4::Charge &);
static_assert(std::is_same_v<decltype(&V4::read),Read>);
static_assert(std::is_same_v<decltype(&V4::covered),Covered>);
static_assert(std::is_same_v<decltype(&Domain::solve),Solve>);
static_assert(std::is_same_v<decltype(&Scope::build),Build>);
static_assert(std::is_same_v<decltype(std::declval<V4::Value>().environment),std::optional<std::vector<V4::Ref>>>);
static_assert(std::is_same_v<decltype(std::declval<V4::Value>().parent),std::optional<std::vector<V4::Ref>>>);
static_assert(std::is_same_v<decltype(std::declval<V4::Call>().callee),std::optional<std::vector<V4::Ref>>>);
static_assert(std::is_same_v<decltype(std::declval<V4::Call>().environment),std::optional<std::vector<V4::Ref>>>);
static_assert(std::is_same_v<decltype(std::declval<V4::Directory>().environments),V4::Environments>);
static_assert(std::is_same_v<decltype(std::declval<V4::EnvironmentSlot>().writable),bool>);
static_assert(std::is_same_v<decltype(std::declval<Domain::Callbacks>().environments),const V4::Environments *>);
static_assert(std::is_same_v<decltype(std::declval<Domain::FixedFunction>().protocol),Domain::Protocol>);
static_assert(std::is_same_v<decltype(std::declval<Domain::Summary>().holdsEnvironment),std::vector<bool>>);
static_assert(std::is_same_v<decltype(std::declval<const Scope::ScopeDirectories &>().interpretation()),const V4::Directory &>);
static_assert(std::is_same_v<decltype(std::declval<const Scope::ScopeDirectories &>().protocol(std::declval<llvm::StringRef>(),std::declval<const V4::Charge &>())),Scope::ProtocolResult>);
static_assert(!std::is_copy_constructible_v<Scope::ScopeDirectories>);
static_assert(std::is_move_constructible_v<Scope::ScopeDirectories>);
static_assert(static_cast<std::size_t>(V4::AccessFlag::Read)==0);
static_assert(static_cast<std::size_t>(V4::AccessFlag::Write)==1);
static_assert(static_cast<std::size_t>(V4::AccessFlag::Structural)==2);
}
