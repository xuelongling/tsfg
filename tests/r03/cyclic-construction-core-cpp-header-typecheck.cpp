// SPDX-License-Identifier: MIT
// Unevaluated declarations only; no object, Graph/Program/State, solver,
// Source factory, callback, main, native behavior or runtime invocation.
#include "../../compiler/core-ir/common-program-plan.h"
#include <type_traits>
#include <utility>
namespace CyclicConstructionCoreHeaderTypecheck {
using namespace tsfg::commonProgram;
static_assert(std::is_same_v<decltype(std::declval<Program>().functions),std::vector<Function>>);
static_assert(std::is_same_v<decltype(std::declval<Program>().internalFunctions),std::vector<Function>>);
static_assert(&Program::functions!=&Program::internalFunctions);
static_assert(std::is_same_v<decltype(std::declval<Program>().internalOwners),std::map<std::string,Json>>);
static_assert(std::is_same_v<decltype(std::declval<Program>().internalDeclarations),std::map<std::string,const Json *>>);
static_assert(std::is_same_v<decltype(std::declval<Program>().internalEffects),std::map<std::string,Effects>>);
static_assert(std::is_same_v<decltype(&prepareInternalConstructors),bool(*)(Program &,Error &)>);
static_assert(std::is_same_v<decltype(&projectInternalConstruction),bool(*)(Program &,const Json &,bool &,Error &)>);
static_assert(std::is_same_v<decltype(&deriveInternalEffects),bool(*)(Program &,const std::map<std::string,Effects> &,Error &)>);
static_assert(std::is_same_v<decltype(std::declval<ActualCheck &>().verifyInternalConstructorClosure()),bool>);
static_assert(std::is_same_v<decltype(std::declval<SourcePlan>().projected),bool>);
}