// SPDX-License-Identifier: MIT
// Unevaluated declarations only: no main, Graph/Program/ActualState construction,
// callback body, solve, receiver transfer or native behavior invocation.
#include "../../compiler/core-ir/common-program-actual.h"
#include <type_traits>
#include <utility>
namespace SourceReceiverActualHeaderTypecheck {
using namespace tsfg::commonProgram;
using Controls=std::set<std::string>;
static_assert(std::is_same_v<decltype(std::declval<ActualValue>().frames),Controls>);
static_assert(std::is_same_v<decltype(std::declval<ActualValue>().cursors),Controls>);
static_assert(std::is_same_v<decltype(std::declval<ActualState>().frames),ActualFrameWorld>);
static_assert(std::is_same_v<decltype(std::declval<ActualContext>().entryFrames),ActualFrameWorld>);
static_assert(std::is_same_v<decltype(std::declval<ActualContext>().normalFrames),ActualFrameWorld>);
static_assert(std::is_same_v<decltype(std::declval<ActualContext>().languageFrames),ActualFrameWorld>);
static_assert(std::is_same_v<ActualFrameWorld::mapped_type,ActualFrameBinding>);
static_assert(std::is_same_v<decltype(std::declval<ActualCheck &>().copyFrames(std::declval<const ActualFrameWorld &>())),ActualFrameWorld>);
static_assert(std::is_same_v<decltype(std::declval<ActualCheck &>().receiverCompletion(std::declval<const ActualFrameWorld &>(),
  std::declval<const Controls &>(),ReceiverAction::Get,nullptr)),ActualReceiverCompletion>);
static_assert(std::is_same_v<decltype(std::declval<ActualCheck &>().retainedFrames(std::declval<const ActualFrameWorld &>())),std::vector<ActualValue>>);
static_assert(std::is_same_v<decltype(std::declval<ActualCheck &>().abortInitializers(std::declval<ActualState &>())),bool>);
static_assert(std::is_same_v<decltype(std::declval<ActualCheck &>().prepareImplicitReceiverPlans()),bool>);
static_assert(std::is_same_v<decltype(std::declval<ActualCheck &>().preparePublicBorrowContexts()),bool>);
static_assert(std::is_same_v<decltype(std::declval<ActualCheck>().analysisFunctions),std::map<std::string,Function>>);
} // namespace SourceReceiverActualHeaderTypecheck
