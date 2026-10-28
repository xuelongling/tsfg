// SPDX-License-Identifier: MIT
#include "formal-closure.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "llvm/ADT/DenseMap.h"
namespace tsfg::formalClosure {
namespace {
struct Targets {
  bool top=false;std::set<std::string> ids;
};
}
mlir::LogicalResult verifyTargets(mlir::ModuleOp module,const closure::Index &index,const SourceGraph &source) {
  std::map<std::string,mlir::func::FuncOp> functions;
  for(auto fn:module.getOps<mlir::func::FuncOp>())functions.emplace(closure::text(fn,"tsfg_core.function_id").str(),fn);
  llvm::DenseMap<mlir::Value,Targets> values;
  std::map<std::string,Targets> capturedMay;
  std::map<std::string,Targets> returns;
  std::set<std::string> reached=source.roots;
  uint64_t work=0;bool valid=true,changed=false;
  auto spend=[&](){if(++work>1000000)valid=false;return valid;};
  auto merge=[&](Targets &to,const Targets &from){
    if(!spend())return false;bool grew=false;
    if(from.top&&!to.top){to.top=true;grew=true;}
    for(const auto &id:from.ids){if(!spend())return false;grew|=to.ids.insert(id).second;}
    return grew;
  };
  auto get=[&](mlir::Value value){return llvm::isa<closure::ClosureType>(value.getType())?values[value]:Targets{};};
  auto value=[&](mlir::Value target,const Targets &from){if(llvm::isa<closure::ClosureType>(target.getType()))changed|=merge(values[target],from);};
  for(const auto &id:source.roots){
    auto fn=functions.at(id);
    for(auto arg:fn.getBody().front().getArguments())if(llvm::isa<closure::ClosureType>(arg.getType()))values[arg].top=true;
  }
  auto siteFor=[&](const std::string &owner,mlir::Operation *op)->const CallSite *{
    uint32_t start,end;if(!closure::number(op,"tsfg_source.start",start)||!closure::number(op,"tsfg_source.end",end))return nullptr;
    const auto kind=llvm::isa<closure::CallOp>(op)?"indirectCall":"call";
    for(const auto &site:source.calls){if(!spend())return nullptr;if(site.owner==owner&&site.kind==kind&&site.start==start&&site.end==end)return &site;}
    return nullptr;
  };
  // The Source contract publishes context-insensitive may bounds, not concrete
  // environment instance identities. Independently union only actual captured
  // init/store values; no producer target claim seeds this analysis. SSA callee
  // snapshots still precede argument effects and never become mutable cells.
  bool grew=true;
  while(grew&&valid){
    changed=false;
    for(auto &[id,fn]:functions){
      if(!reached.count(id))continue;
      std::vector<mlir::Block *> blocks;for(auto &block:fn.getBody())blocks.push_back(&block);
      std::set<mlir::Block *> available;available.insert(blocks.front());
      Targets result;bool blockGrew=true;
      while(blockGrew&&valid){
        blockGrew=false;
        for(auto *block:blocks){
          if(!available.count(block))continue;
          for(auto &op:*block){
            if(!spend())break;
            if(llvm::isa<closure::MakeOp>(op))value(op.getResult(0),Targets{false,{closure::text(&op,"function_id").str()}});
            else if(llvm::isa<closure::EnvironmentLoadOp>(op))value(op.getResult(0),capturedMay[closure::text(&op,"binding").str()]);
            else if(llvm::isa<closure::EnvironmentInitOp,closure::EnvironmentStoreOp>(op)){
              changed|=merge(capturedMay[closure::text(&op,"binding").str()],get(op.getOperand(1)));
            }else if(llvm::isa<closure::CallOp,mlir::func::CallOp>(op)){
              Targets targets;
              if(llvm::isa<closure::CallOp>(op))targets=get(op.getOperand(0));
              else targets.ids.insert(closure::text(&op,"tsfg_core.function_id").str());
              const auto *site=siteFor(id,&op);if(!site){valid=false;break;}
              Targets returned;
              for(const auto &callee:targets.ids){
                if(!spend()||!functions.count(callee)){valid=false;break;}
                changed|=reached.insert(callee).second;
                const auto &declaration=*index.functions.at(callee);auto target=functions.at(callee);
                const unsigned sourceOffset=llvm::isa<closure::CallOp>(op)?1:declaration.lexicalEnvironment.empty()?0:1;
                const unsigned targetOffset=declaration.lexicalEnvironment.empty()?0:1;
                for(size_t i=0;i<declaration.parameters.size();++i)value(target.getBody().front().getArgument(i+targetOffset),get(op.getOperand(i+sourceOffset)));
                merge(returned,returns[callee]);
              }
              if(op.getNumResults())value(op.getResult(0),returned);
            }else if(auto returned=llvm::dyn_cast<mlir::func::ReturnOp>(op)){
              merge(result,get(returned.getOperand(0)));
            }
          }
          auto route=[&](mlir::Block *next,mlir::ValueRange operands){
            if(!spend())return;
            for(size_t i=0;i<operands.size();++i)value(next->getArgument(i),get(operands[i]));
            blockGrew|=available.insert(next).second;
          };
          if(auto branch=llvm::dyn_cast<mlir::cf::BranchOp>(block->back()))route(branch.getDest(),branch.getDestOperands());
          else if(auto branch=llvm::dyn_cast<mlir::cf::CondBranchOp>(block->back())){route(branch.getTrueDest(),branch.getTrueDestOperands());route(branch.getFalseDest(),branch.getFalseDestOperands());}
        }
      }
      changed|=merge(returns[id],result);
    }
    grew=changed;
  }
  if(!valid)return fail("actual closure target flow budget or graph");
  std::set<const CallSite *> observed;
  for(auto &[id,fn]:functions)if(reached.count(id))for(auto &block:fn.getBody())for(auto &op:block){
    if(!llvm::isa<closure::CallOp,mlir::func::CallOp>(op))continue;
    const auto *site=siteFor(id,&op);if(!site||!site->claimed||!observed.insert(site).second)return fail("complete actual call graph differs");
    Targets targets=llvm::isa<closure::CallOp>(op)?get(op.getOperand(0)):Targets{false,{closure::text(&op,"tsfg_core.function_id").str()}};
    if(targets.top||targets.ids.empty()||targets.ids!=site->targets)return fail("actual indirect targets differ from Source flow");
  }
  for(const auto &site:source.calls)if(site.claimed&&!observed.count(&site))return fail("invented reachable call site");
  return valid?mlir::success():fail("target comparison budget");
}
}
