// SPDX-License-Identifier: MIT
#include "kernel-access.h"
#include "bytecode.h"
#include "bytecode_encoding.h"
#include "mlir/IR/Builders.h"
#include "mlir/IR/OwningOpRef.h"
#include "llvm/ADT/STLExtras.h"
#include <algorithm>
namespace tsfg::kernelGlobal {
namespace {
llvm::json::Array array(const std::set<std::string> &set){llvm::json::Array out;for(const auto &id:set)out.push_back(id);return out;}
std::set<std::string> intersection(const std::set<std::string> &a,const std::set<std::string> &b,size_t &work,size_t &bytes){
  std::set<std::string> result;auto left=a.begin(),right=b.begin();
  while(left!=a.end()&&right!=b.end()){
    if(++work>1000000)return {};
    if(*left<*right)++left;else if(*right<*left)++right;else{bytes+=left->size()+2+(result.empty()?0:1);if(bytes>8388608)return {};result.insert(*left);++left;++right;}
  }return result;
}
mlir::LogicalResult verifyScalarClone(mlir::ModuleOp module,const Input &input){
  mlir::OwningOpRef<mlir::ModuleOp> clone(llvm::cast<mlir::ModuleOp>(module->clone()));
  clone->getOperation()->removeAttr(marker);mlir::Builder builder(module.getContext());
  std::map<std::string,const Function *> original;
  for(const auto &f:input.functions)original.emplace("f"+f.id.substr(7),&f);
  size_t i=0;
  for(auto fn:clone->getOps<mlir::func::FuncOp>()){
    const auto &f=input.functions[i++];fn.setSymName("f"+f.formalId.substr(7));
    fn->setAttr("tsfg_core.function_id",builder.getStringAttr(f.formalId));
    fn->setAttr("tsfg_core.signature_hash",builder.getStringAttr(f.formalSignature));
    // Validate original call identities before changing any call attribute.
    for(auto &block:fn.getBody())for(auto &op:block)if(auto call=llvm::dyn_cast<mlir::func::CallOp>(&op)){
      auto target=original.find(call.getCallee().str());
      auto id=op.getAttrOfType<mlir::StringAttr>("tsfg_core.function_id"),sig=op.getAttrOfType<mlir::StringAttr>("tsfg_core.signature_hash");
      if(target==original.end()||target->second->initializer||!id||!sig||id.getValue()!=target->second->id||sig.getValue()!=target->second->signature)
        return reject("core-ir-kernel-identity","original private call identity differs before projection");
      const auto &to=*target->second;
      op.setAttr("callee",mlir::FlatSymbolRefAttr::get(module.getContext(),"f"+to.formalId.substr(7)));
      op.setAttr("tsfg_core.function_id",builder.getStringAttr(to.formalId));
      op.setAttr("tsfg_core.signature_hash",builder.getStringAttr(to.formalSignature));
    }
  }
  std::vector<uint8_t> discarded;
  // This is validation only. Never print or execute the projected program.
  return verifiedBytecode(*clone,discarded);
}
} // namespace
mlir::LogicalResult verifyCandidate(mlir::ModuleOp module){
  Input input;if(mlir::failed(readInput(module,input)))return mlir::failure();
  if(mlir::failed(verifyScalarClone(module,input)))return mlir::failure();
  std::map<std::string,size_t> symbols;for(size_t i=0;i<input.functions.size();++i)symbols.emplace("f"+input.functions[i].id.substr(7),i);
  std::vector<Published> local(input.functions.size());std::vector<std::vector<size_t>> calls(input.functions.size());
  size_t work=0,members=0;
  for(size_t i=0;i<input.functions.size();++i){const auto &f=input.functions[i];
    auto operation=f.operation;for(auto &block:operation.getBody())for(auto &op:block){
      if(++work>1000000)return reject("core-ir-kernel-budget","actual Core analysis work exceeded");
      auto name=op.getName().getStringRef();
      if(name=="tsfg_core.global_load"||name=="tsfg_core.global_store"){
        auto index=op.getAttrOfType<mlir::IntegerAttr>("global");
        // The full scalar verifier has proved exact declaration/type/index and
        // initializer ownership. Exclude only its real initialization stores.
        if(!index||index.getInt()<0||size_t(index.getInt())>=input.tables.globals.size())return reject("core-ir-kernel-access","global index differs");
        if(name=="tsfg_core.global_store"){
          auto initialize=op.getAttrOfType<mlir::BoolAttr>("initialize");
          if(initialize&&initialize.getValue()&&f.initializer)continue;
        }
        const auto id="sha256:"+bytecode::hex(input.tables.globals[index.getInt()].id);
        auto &set=name=="tsfg_core.global_load"?local[i].reads:local[i].writes;
        if(set.insert(id).second&&++members>65536)return reject("core-ir-kernel-budget","actual access member bound exceeded");
      }else if(name=="tsfg_core.authorized_host")local[i].unknown=true;
      else if(auto call=llvm::dyn_cast<mlir::func::CallOp>(&op)){
        auto target=symbols.find(call.getCallee().str());if(target==symbols.end())return reject("core-ir-kernel-identity","actual callee absent");
        calls[i].push_back(target->second);
      }
    }
  }
  // Caller-effective = own actual operations plus fixed callee Published upper.
  // This requires no Derived narrowing and handles recursive SCCs directly.
  for(size_t i=0;i<input.functions.size();++i){const auto &f=input.functions[i];if(f.initializer)continue;
    auto effect=local[i];
    for(auto callee:calls[i]){
      if(++work>1000000)return reject("core-ir-kernel-budget","effective call work exceeded");
      const auto &upper=input.contracts.at(input.functions[callee].id);effect.unknown|=upper.unknown;
      for(const auto &id:upper.reads){if(++work>1000000)return reject("core-ir-kernel-budget","effective read work exceeded");if(effect.reads.insert(id).second&&++members>65536)return reject("core-ir-kernel-budget","effective members exceeded");}
      for(const auto &id:upper.writes){if(++work>1000000)return reject("core-ir-kernel-budget","effective write work exceeded");if(effect.writes.insert(id).second&&++members>65536)return reject("core-ir-kernel-budget","effective members exceeded");}
    }
    const auto &upper=input.contracts.at(f.id);
    if(!upper.unknown&&(effect.unknown||!std::includes(upper.reads.begin(),upper.reads.end(),effect.reads.begin(),effect.reads.end())||!std::includes(upper.writes.begin(),upper.writes.end(),effect.writes.begin(),effect.writes.end())))
      return reject("core-ir-kernel-contract","actual implementation exceeds fixed Published upper");
  }
  // Kernel reachability inspects every actual call edge, independently of the
  // supplied proof and record claims. A capability number never proves purity.
  std::set<size_t> seen;std::vector<size_t> pending=input.targets;
  for(size_t next=0;next<pending.size();++next){const auto i=pending[next];if(!seen.insert(i).second)continue;
    if(++work>1000000)return reject("core-ir-kernel-budget","kernel call work exceeded");
    if(local[i].unknown||input.contracts.at(input.functions[i].id).unknown)return reject("core-ir-kernel-unknown","kernel requires known Host/effect semantics");
    pending.insert(pending.end(),calls[i].begin(),calls[i].end());
  }
  auto p=input.payload.getAsObject(),supplied=p->getObject("proof");
  llvm::json::Array targets,accesses,pairs;
  llvm::json::Value empty=llvm::json::Object{{"inputIdentity",text(supplied,"inputIdentity")},{"hirDigest",text(supplied,"hirDigest")},{"publishedDigest",text(supplied,"publishedDigest")},{"targets",llvm::json::Array{}},{"accesses",llvm::json::Array{}},{"pairs",llvm::json::Array{}}};
  size_t bytes=canonical(empty).size();
  for(auto index:input.targets){const auto &f=input.functions[index];const auto &r=input.contracts.at(f.id);targets.push_back(f.id);
    llvm::json::Value access=llvm::json::Object{{"functionId",f.id},{"publishedContractDigest",r.digest},{"reads",array(r.reads)},{"writes",array(r.writes)}};
    bytes+=f.id.size()+2+(targets.size()>1?1:0)+canonical(access).size()+(accesses.empty()?0:1);
    if(bytes>8388608)return reject("core-ir-kernel-budget","proof output byte bound exceeded");
    accesses.push_back(std::move(access));}
  for(size_t i=0;i<input.targets.size();++i)for(size_t j=i+1;j<input.targets.size();++j){
    if(++work>1000000)return reject("core-ir-kernel-budget","pair work exceeded");
    const auto &left=input.functions[input.targets[i]],&right=input.functions[input.targets[j]];
    const auto &a=input.contracts.at(left.id),&b=input.contracts.at(right.id);
    llvm::json::Value pair=llvm::json::Object{{"left",left.id},{"right",right.id},{"readRead",llvm::json::Array{}},{"writeWrite",llvm::json::Array{}},{"writeRead",llvm::json::Array{}},{"readWrite",llvm::json::Array{}}};
    bytes+=canonical(pair).size()+(pairs.empty()?0:1);
    if(bytes>8388608)return reject("core-ir-kernel-budget","pair output byte bound exceeded");
    auto rr=intersection(a.reads,b.reads,work,bytes),ww=intersection(a.writes,b.writes,work,bytes),wr=intersection(a.writes,b.reads,work,bytes),rw=intersection(a.reads,b.writes,work,bytes);
    if(bytes>8388608)return reject("core-ir-kernel-budget","intersection output byte bound exceeded");
    if(work>1000000)return reject("core-ir-kernel-budget","intersection work exceeded");
    if(!ww.empty()||!wr.empty()||!rw.empty())return reject("core-ir-kernel-conflict","fixed Published global accesses conflict");
    pairs.push_back(llvm::json::Object{{"left",left.id},{"right",right.id},{"readRead",array(rr)},{"writeWrite",array(ww)},{"writeRead",array(wr)},{"readWrite",array(rw)}});
  }
  // HIR digest remains opaque provenance; no claim of AST/HIR reconstruction.
  llvm::json::Value expected=llvm::json::Object{{"inputIdentity",text(supplied,"inputIdentity")},{"hirDigest",text(supplied,"hirDigest")},{"publishedDigest",text(supplied,"publishedDigest")},{"targets",std::move(targets)},{"accesses",std::move(accesses)},{"pairs",std::move(pairs)}};
  if(canonical(*p->get("proof"))!=canonical(expected))return reject("core-ir-kernel-proof","proof differs from actual Core and fixed Published recomputation");
  return mlir::success();
}
} // namespace tsfg::kernelGlobal
