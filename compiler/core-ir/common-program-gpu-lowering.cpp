// SPDX-License-Identifier: MIT
#include "common-program-gpu-lowering.h"
#include "mlir/Dialect/SPIRV/IR/SPIRVDialect.h"
#include "mlir/Dialect/SPIRV/IR/SPIRVOps.h"
#include "mlir/IR/Builders.h"
#include "mlir/IR/Verifier.h"
#include "llvm/ADT/APInt.h"
#include "llvm/Support/raw_ostream.h"
#include <algorithm>
#include <tuple>

namespace tsfg::commonProgram {
namespace {
using exception::field;using exception::items;using exception::string;
namespace spv=mlir::spirv;
using Key=std::tuple<std::string,std::string,std::string>;
struct Site {
  std::string path,operation;SourceAnchor range;int block=-1,index=-1;
};
Json source(const Site &site){return Object{{"sourceId",site.path},{"start",site.range.start},{"end",site.range.end}};}
Json point(const Site &site){return Object{{"block",site.block},{"operation",site.index}};}
struct Scalar {
  mlir::Value bits;bool actualI32=false;std::set<size_t> conditions;
};
struct Cell {mlir::Value pointer;Scalar value;bool initialized=false;};
struct Resource {spv::GlobalVariableOp variable;};

// This pass owns physical IR construction only. Source actual-value proof is
// distinct from its i32 representation: resource bits alone prove no tag or
// initialization, and an unmet numeric guard becomes an explicit condition.
struct Lowering {
  Program &p;Error &error;mlir::OpBuilder b;
  mlir::OwningOpRef<mlir::ModuleOp> module;
  mlir::IntegerType i32;spv::PointerType scalarPointer;
  std::map<Key,Resource> resources;
  Array functions,sourceOperations,obligations;
  Lowering(Program &p,mlir::MLIRContext &context,Error &error):p(p),error(error),b(&context),
      module(mlir::ModuleOp::create(b.getUnknownLoc())),
      i32(mlir::IntegerType::get(&context,32,mlir::IntegerType::Signed)),
      scalarPointer(spv::PointerType::get(i32,spv::StorageClass::StorageBuffer)){}
  bool fail(llvm::StringRef kind,llvm::StringRef message,const Site &site){
    error.path=site.path;error.range=site.range;
    return reject(error,"core-ir-common-gpu-lowering-"+kind.str(),message);
  }
  bool spend(size_t count,const Site &site){return p.charge(count)||fail("budget","GPU function lowering work exceeded",site);}
  Site site(const Function &fn,const Operation &op,size_t block,size_t index){
    auto path=fn.path;auto owner=p.operationSources.find(fn.id);
    if(owner!=p.operationSources.end()){
      auto original=owner->second.find({uint16_t(block),uint16_t(index)});
      if(original!=owner->second.end())path=original->second;
    }
    return {path,op.name,op.range,int(block),int(index)};
  }
  void mark(mlir::Operation *op,const Site &site,llvm::StringRef role){
    op->setAttr("tsfg_source.path",b.getStringAttr(site.path));
    op->setAttr("tsfg_source.start",b.getI64IntegerAttr(site.range.start));
    op->setAttr("tsfg_source.end",b.getI64IntegerAttr(site.range.end));
    op->setAttr("tsfg_gpu.source_operation",b.getStringAttr(site.operation));
    op->setAttr("tsfg_gpu.lowering_role",b.getStringAttr(role));
    if(site.block>=0){
      op->setAttr("tsfg_gpu.source_block",b.getI64IntegerAttr(site.block));
      op->setAttr("tsfg_gpu.source_index",b.getI64IntegerAttr(site.index));
    }
  }
  mlir::Value pointer(const Resource &resource,const Site &site){
    auto address=b.create<spv::AddressOfOp>(b.getUnknownLoc(),resource.variable);
    mark(address,site,"resource-address");
    auto zero=b.create<spv::ConstantOp>(b.getUnknownLoc(),i32,b.getIntegerAttr(i32,0));
    mark(zero,site,"member-zero");
    auto member=b.create<spv::AccessChainOp>(b.getUnknownLoc(),scalarPointer,address.getResult(),mlir::ValueRange{zero.getResult()});
    mark(member,site,"access-chain");return member.getResult();
  }
  size_t obligation(const Function &fn,const Site &site,llvm::StringRef kind,
                    llvm::StringRef condition,Object details={}){
    const auto id=obligations.size();
    details["id"]=int64_t(id);details["functionId"]=fn.id;
    details["kind"]=kind.str();details["status"]="unfulfilled";
    details["condition"]=condition.str();details["source"]=source(site);details["point"]=point(site);
    obligations.push_back(std::move(details));return id;
  }
  bool run(const Json &plan){
    const auto planText=canonical(plan);
    const Site root{p.sourcePath,"abi.module",{0,p.sourceLength}};
    if(!spend(planText.size()+1,root))return false;
    const auto planHash=digest(planText+"\n");
    b.setInsertionPointToEnd(module->getBody());
    const auto blockType=spv::StructType::get({i32},{0},{},
      {{spv::Decoration::Block,b.getUnitAttr()}});
    const auto blockPointer=spv::PointerType::get(blockType,spv::StorageClass::StorageBuffer);
    for(const auto &row:items(field(plan,"bindings"))){
      if(!spend(1,root))return false;
      const auto &anchor=field(row,"source");
      const Site where{string(field(anchor,"sourceId")),"abi.binding",
        {uint32_t(*field(anchor,"start").getAsInteger()),uint32_t(*field(anchor,"end").getAsInteger())}};
      const auto set=uint32_t(*field(row,"set").getAsInteger()),binding=uint32_t(*field(row,"binding").getAsInteger());
      const auto kind=string(field(row,"kind")),id=string(field(row,"id")),kernel=string(field(row,"kernel"));
      const auto symbol="gpu_resource_"+std::to_string(set)+"_"+std::to_string(binding);
      auto variable=b.create<spv::GlobalVariableOp>(b.getUnknownLoc(),blockPointer,symbol,set,binding);
      mark(variable,where,"resource");
      variable->setAttr("tsfg_gpu.resource_kind",b.getStringAttr(kind));
      variable->setAttr("tsfg_gpu.resource_id",b.getStringAttr(id));
      if(!kernel.empty())variable->setAttr("tsfg_gpu.kernel_id",b.getStringAttr(kernel));
      const auto access=string(field(row,"access"));
      if(access=="read")variable->setAttr("non_writable",b.getUnitAttr());
      if(access=="write")variable->setAttr("non_readable",b.getUnitAttr());
      resources.emplace(Key{kind,kernel,id},Resource{variable});
    }
    for(const auto &selection:items(field(plan,"kernels"))){
      const auto id=string(field(selection,"functionId"));
      const auto &fn=*std::find_if(p.functions.begin(),p.functions.end(),[&](const Function &fn){return fn.id==id;});
      const Site entrySite{fn.path,"abi.function",fn.range};
      if(!spend(fn.carriers.size()+fn.blocks.size()+1,entrySite))return false;
      if(fn.resultCarrier!=exception::i32Id&&fn.resultCarrier!="void")return fail("capability","GPU function result carrier is not implemented",entrySite);
      b.setInsertionPointToEnd(module->getBody());
      const auto symbol="gpu_function_"+id.substr(7);
      auto lowered=b.create<spv::FuncOp>(b.getUnknownLoc(),symbol,b.getFunctionType({},{}));
      mark(lowered,entrySite,"function");lowered->setAttr("tsfg_gpu.function_id",b.getStringAttr(id));
      auto *body=new mlir::Block();lowered.getBody().push_back(body);b.setInsertionPointToStart(body);
      std::map<uint16_t,Scalar> values;std::map<uint16_t,Cell> cells;
      std::map<std::string,Scalar> globalValues;
      // Function variables precede all executable instructions. Their source
      // initialization is tracked separately; an unwritten cell is never read.
      for(size_t block=0;block<fn.blocks.size();++block)for(size_t index=0;index<fn.blocks[block].operations.size();++index){
        const auto &op=fn.blocks[block].operations[index];if(op.name!="cell")continue;
        const auto where=site(fn,op,block,index);if(!spend(1,where))return false;
        if(op.view!=exception::i32Id)return fail("capability","GPU local cell type is not implemented",where);
        auto variable=b.create<spv::VariableOp>(b.getUnknownLoc(),spv::PointerType::get(i32,spv::StorageClass::Function),spv::StorageClass::Function,mlir::Value{});
        mark(variable,where,"cell");cells.emplace(op.result,Cell{variable.getResult(),{},false});
      }
      const Json *declaration=nullptr;
      for(const auto &row:items(field(p.hir,"functions")))if(string(field(row,"id"))==id){declaration=&row;break;}
      const auto &parameters=items(field(*declaration,"parameters"));
      for(size_t index=0;index<parameters.size();++index){
        const auto reg=fn.blocks[0].parameters[index];
        const auto &parameter=parameters[index];const auto &range=field(parameter,"range");
        const Site where{fn.path,"abi.parameter",{uint32_t(*field(range,"start").getAsInteger()),uint32_t(*field(range,"end").getAsInteger())}};
        if(!spend(1,where))return false;
        if(fn.carriers[reg]!=exception::i32Id)return fail("capability","GPU parameter actual carrier is not implemented",where);
        auto ptr=pointer(resources.at(Key{"parameter",id,string(field(parameter,"id"))}),where);
        auto value=b.create<spv::LoadOp>(b.getUnknownLoc(),ptr);mark(value,where,"parameter-load");
        values.emplace(reg,Scalar{value.getResult(),false,{}});
      }
      std::set<uint16_t> visited;uint16_t block=0;bool returned=false;
      while(!returned){
        if(!visited.insert(block).second)return fail("cfg","GPU cyclic control flow is not implemented",entrySite);
        bool continued=false;
        for(size_t index=0;index<fn.blocks[block].operations.size();++index){
          const auto &op=fn.blocks[block].operations[index];const auto where=site(fn,op,block,index);
          if(!spend(op.operands.size()+1,where))return false;
          Object original{{"functionId",id},{"name",op.name},{"point",point(where)},{"source",source(where)}};
          if(op.name=="fuel"){
            const auto event=obligation(fn,where,"fuel","gpu-fuel-and-depth-domain",Object{{"event",field(op.properties,"event")}});
            original["obligationId"]=int64_t(event);
          }else if(op.name=="cell"){
            // The hoisted allocation is not source initialization.
          }else if(op.name=="store"){
            auto &cell=cells.at(op.operands[0]);const auto value=values.at(op.operands[1]);
            auto store=b.create<spv::StoreOp>(b.getUnknownLoc(),cell.pointer,value.bits);mark(store,where,"local-store");
            cell.value=value;cell.initialized=true;
          }else if(op.name=="load"){
            const auto &cell=cells.at(op.operands[0]);
            if(!cell.initialized)return fail("actual","uninitialized Source cell has no GPU value representation",where);
            auto value=b.create<spv::LoadOp>(b.getUnknownLoc(),cell.pointer);mark(value,where,"local-load");
            auto state=cell.value;state.bits=value.getResult();values[op.result]=std::move(state);
          }else if(op.name=="constant"){
            if(op.view!=exception::i32Id)return fail("capability","GPU constant type is not implemented",where);
            const llvm::APInt bits(32,string(field(op.properties,"decimal")),10);
            auto value=b.create<spv::ConstantOp>(b.getUnknownLoc(),i32,b.getIntegerAttr(i32,bits));mark(value,where,"constant");
            values[op.result]={value.getResult(),true,{}};
          }else if(op.name=="value_copy"){
            if(op.view!=exception::i32Id)return fail("capability","GPU value copy type is not implemented",where);
            values[op.result]=values.at(op.operands[0]);
          }else if(op.name=="global_load"){
            const auto global=string(field(op.properties,"global"));
            auto ptr=pointer(resources.at(Key{"global","",global}),where);
            auto load=b.create<spv::LoadOp>(b.getUnknownLoc(),ptr);mark(load,where,"global-load");
            // Preserve the physical reload. A preceding Source store can prove
            // its Source value kind on this normal path, never equality to old
            // bits or GPU coherence/dispatch guarantees.
            auto state=globalValues[global];state.bits=load.getResult();values[op.result]=std::move(state);
          }else if(op.name=="global_store"){
            const auto global=string(field(op.properties,"global"));const auto value=values.at(op.operands[0]);
            if(!value.actualI32)return fail("actual","GPU global write needs Source actual-i32 proof on the conditional normal path",where);
            auto ptr=pointer(resources.at(Key{"global","",global}),where);
            auto store=b.create<spv::StoreOp>(b.getUnknownLoc(),ptr,value.bits);mark(store,where,"global-store");globalValues[global]=value;
          }else if(op.name=="numeric_use"){
            auto value=values.at(op.operands[0]);Array dependencies;for(auto condition:value.conditions)dependencies.push_back(int64_t(condition));
            const auto event=obligation(fn,where,"numeric-use","actual-initialized-i32",Object{
              {"operator",field(op.properties,"operator")},{"index",field(op.properties,"index")},
              {"operand",op.operands[0]},{"dependsOn",std::move(dependencies)}});
            if(value.actualI32){
              (*obligations.back().getAsObject())["status"]=value.conditions.empty()?"proven-i32":"conditional-i32";
            }else value.conditions.insert(event);
            value.actualI32=true;const auto next=op.successors[0];
            values[fn.blocks[next].parameters[0]]=std::move(value);original["obligationId"]=int64_t(event);
            sourceOperations.push_back(std::move(original));block=next;continued=true;break;
          }else if(op.name=="binary"){
            if(op.view!=exception::i32Id||string(field(op.properties,"operator"))!="+")return fail("capability","GPU scalar operation is not implemented",where);
            const auto left=values.at(op.operands[0]),right=values.at(op.operands[1]);
            if(!left.actualI32||!right.actualI32)return fail("actual","GPU addition needs Source actual-i32 proof or explicit numeric continuations",where);
            auto conditions=left.conditions;conditions.insert(right.conditions.begin(),right.conditions.end());
            Array dependencies;for(auto condition:conditions)dependencies.push_back(int64_t(condition));
            const auto event=obligation(fn,where,"i32-add","gpu-i32-numeric-relation",Object{
              {"operator","+"},{"semantics","source-i32-modulo-2^32"},{"dependsOn",std::move(dependencies)}});
            conditions.insert(event);auto sum=b.create<spv::IAddOp>(b.getUnknownLoc(),left.bits,right.bits);mark(sum,where,"i32-add");
            values[op.result]={sum.getResult(),true,std::move(conditions)};original["obligationId"]=int64_t(event);
          }else if(op.name=="cf.br"){
            const auto next=op.successors[0];std::vector<Scalar> arguments;
            for(auto operand:op.operands){
              const auto value=values.find(operand);
              if(value==values.end())return fail("capability","GPU branch carrier is not a lowered scalar value",where);
              arguments.push_back(value->second);
            }
            for(size_t i=0;i<arguments.size();++i)values[fn.blocks[next].parameters[i]]=std::move(arguments[i]);
            sourceOperations.push_back(std::move(original));block=next;continued=true;break;
          }else if(op.name=="func.return"){
            if(!op.operands.empty()){
              const auto value=values.at(op.operands[0]);
              if(!value.actualI32)return fail("actual","GPU return actual value is not proven on the conditional normal path",where);
              auto ptr=pointer(resources.at(Key{"return",id,id}),where);
              auto store=b.create<spv::StoreOp>(b.getUnknownLoc(),ptr,value.bits);mark(store,where,"return-cell-store");
            }
            auto done=b.create<spv::ReturnOp>(b.getUnknownLoc());mark(done,where,"return");returned=true;
          }else return fail("capability","GPU function operation is not implemented: "+op.name,where);
          sourceOperations.push_back(std::move(original));if(returned)break;
        }
        if(!returned&&!continued)return fail("cfg","GPU normal-path terminator is not implemented",entrySite);
      }
      if(visited.size()!=fn.blocks.size())return fail("cfg","GPU lowering must cover the complete selected function CFG",entrySite);
      functions.push_back(Object{{"functionId",id},{"symbol",symbol},{"source",field(selection,"source")}});
    }
    (*module)->setAttr("tsfg_gpu.scope",b.getStringAttr("non-launchable"));
    (*module)->setAttr("tsfg_gpu.plan_digest",b.getStringAttr(planHash));
    const auto pending=canonical(Json(Array(obligations)));if(!spend(pending.size(),root))return false;
    (*module)->setAttr("tsfg_gpu.obligations",b.getStringAttr(pending));
    if(mlir::failed(mlir::verify(*module)))return fail("verify","upstream SPIR-V function/resource IR verification failed",root);
    return true;
  }
};
} // namespace

bool lowerGpuBindingFunctions(Program &p,const Json &alreadyVerifiedPlan,
                             mlir::MLIRContext &context,Json &out,Error &error){
  context.getOrLoadDialect<spv::SPIRVDialect>();
  Lowering lowering(p,context,error);if(!lowering.run(alreadyVerifiedPlan))return false;
  std::string text;llvm::raw_string_ostream stream(text);
  lowering.module->print(stream,mlir::OpPrintingFlags().printGenericOpForm());stream<<'\n';stream.flush();
  if(text.size()>=8388608||!p.charge(text.size()))return reject(error,"core-ir-common-gpu-lowering-budget","GPU function IR output budget exceeded");
  out=Object{{"family","tsfg.gpu-binding-functions"},{"version",1},{"scope","non-launchable"},
    {"inputIdentity",field(alreadyVerifiedPlan,"inputIdentity")},
    {"planDigest",digest(canonical(alreadyVerifiedPlan)+"\n")},{"layout",field(alreadyVerifiedPlan,"layout")},
    {"bindings",field(alreadyVerifiedPlan,"bindings")},{"module",std::move(text)},
    {"functions",std::move(lowering.functions)},{"sourceOperations",std::move(lowering.sourceOperations)},
    {"obligations",std::move(lowering.obligations)}};
  return true;
}
} // namespace tsfg::commonProgram
