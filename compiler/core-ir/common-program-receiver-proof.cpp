// SPDX-License-Identifier: MIT
#include "common-program-actual.h"
namespace tsfg::commonProgram {
bool ActualCheck::preparePublicBorrowContexts(){
  // Private roots still participate in the complete ActualCheck fixed point.
  // Only the Source/public graph has printed call provenance and permission
  // rows. A public callee reached exclusively from a private root is not a
  // new published universal entry or a reason to invent such a proof row.
  publicBorrowContexts.clear();std::map<std::string,std::vector<const std::string *>> successors;
  std::vector<const std::string *> pending;if(!step(contexts.size()))return false;
  for(const auto &[id,context]:contexts){
    if(!step(1))return false;if(analysisFunctions.count(context.function->id))continue;
    if(context.root){if(!receiverText(id)||!step(2))return false;publicBorrowContexts.insert(id);pending.push_back(&id);}
    if(!step(context.callers.size()))return false;
    for(const auto &caller:context.callers){
      if(!step(1))return false;const auto found=contexts.find(caller);
      if(!need(found!=contexts.end(),"solved actual caller has no owning context"))return false;
      if(analysisFunctions.count(found->second.function->id))continue;
      if(!receiverText(caller)||!step(2))return false;successors[caller].push_back(&id);
    }
  }
  for(size_t index=0;index<pending.size();++index){
    if(!step(1))return false;auto found=successors.find(*pending[index]);if(found==successors.end())continue;
    if(!step(found->second.size()))return false;
    for(const auto *target:found->second){
      if(!receiverText(*target)||!step(2))return false;if(publicBorrowContexts.insert(*target).second)pending.push_back(target);
    }
  }return e.message.empty();
}
} // namespace tsfg::commonProgram
