// SPDX-License-Identifier: MIT
#include "closure-initialization.h"
#include "environment-contracts.h"
#include "llvm/ADT/DenseMap.h"

namespace tsfg::closure {
mlir::LogicalResult verifyInitializationFlow(mlir::func::FuncOp function,const Function &fn,InitializationContext &context){
  const auto budget=[](){return initializationFailure(nullptr,"initialization work/growth budget exceeded");};
  environmentContracts::InitializationGraph graph;
  if(!fn.activationEnvironment.empty())for(const auto &slot:context.index.environments.at(fn.activationEnvironment)->slots){
    if(!context.step())return budget();graph.slots.push_back(slot.binding);
  }
  llvm::DenseMap<mlir::Block *,size_t> indices;std::vector<mlir::Block *> blocks;
  for(auto &block:function.getBody()){
    if(!context.step())return budget();indices[&block]=blocks.size();blocks.push_back(&block);
  }
  if(!context.step(2*blocks.size()))return budget();graph.blocks.resize(blocks.size());
  std::vector<std::vector<mlir::Operation *>> operations(blocks.size());
  for(size_t b=0;b<blocks.size();++b){
    for(auto *next:blocks[b]->back().getSuccessors()){
      if(!context.step())return budget();if(!indices.count(next))return initializationFailure(&blocks[b]->back(),"foreign initialization successor");
      graph.blocks[b].successors.push_back(indices.lookup(next));
    }
    const auto event=[&](environmentContracts::EventKind kind,const std::string &binding,mlir::Operation *operation){
      if(!context.step())return false;
      if(kind==environmentContracts::EventKind::Observe){
        const auto &cell=context.cells.at(binding);
        if(context.ancestors.at(fn.id).count(cell.environment->owner)&&
          (cell.slot->role=="parameter"||context.needs.at(fn.id).count(binding)))graph.incoming.insert(binding);
      }
      graph.blocks[b].events.push_back({kind,binding});operations[b].push_back(operation);return true;
    };
    for(auto &operation:*blocks[b]){
      if(!context.step())return budget();
      if(llvm::isa<EnvironmentInitOp>(operation)){
        if(!event(environmentContracts::EventKind::Initialize,text(&operation,"binding").str(),&operation))return budget();
      }else if(llvm::isa<EnvironmentLoadOp,EnvironmentStoreOp>(operation)){
        if(!event(environmentContracts::EventKind::Observe,text(&operation,"binding").str(),&operation))return budget();
      }else if(llvm::isa<MakeOp,mlir::func::CallOp>(operation)){
        const auto target=text(&operation,llvm::isa<MakeOp>(operation)?"function_id":"tsfg_core.function_id").str();
        for(const auto &binding:context.needs.at(target))if(!event(environmentContracts::EventKind::Observe,binding,&operation))return budget();
      }
    }
  }
  environmentContracts::Failure failure;
  if(environmentContracts::initialize(graph,[&](size_t n){return context.step(n);},failure))return mlir::success();
  if(llvm::StringRef(failure.message).contains("work exceeded"))return budget();
  mlir::Operation *operation=nullptr;
  if(failure.block<blocks.size())operation=failure.event<operations[failure.block].size()?operations[failure.block][failure.event]:&blocks[failure.block]->back();
  return initializationFailure(operation,failure.message,failure.binding);
}
} // namespace tsfg::closure
