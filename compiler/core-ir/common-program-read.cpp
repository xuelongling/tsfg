// SPDX-License-Identifier: MIT
#include "common-program.h"
#include "dialect.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "llvm/ADT/DenseMap.h"
#include "llvm/ADT/STLExtras.h"
namespace tsfg::commonProgram {
namespace {
llvm::StringRef text(mlir::Operation *op,llvm::StringRef key){
  auto a=op->getAttrOfType<mlir::StringAttr>(key);return a?a.getValue():llvm::StringRef();
}
bool attributes(mlir::Operation *op,llvm::ArrayRef<llvm::StringRef> keys){
  if(op->getAttrs().size()!=keys.size())return false;
  for(const auto &a:op->getAttrs())if(!llvm::is_contained(keys,a.getName().strref()))return false;
  return true;
}
bool anchor(mlir::Operation *op,SourceAnchor &out){
  auto a=op->getAttrOfType<mlir::IntegerAttr>("tsfg_source.start"),b=op->getAttrOfType<mlir::IntegerAttr>("tsfg_source.end");
  if(!a||!b||!a.getType().isSignlessInteger(64)||!b.getType().isSignlessInteger(64)||
    a.getInt()<0||b.getInt()<=a.getInt()||uint64_t(b.getInt())>UINT32_MAX)return false;
  out={uint32_t(a.getInt()),uint32_t(b.getInt())};return true;
}
std::string carrier(mlir::Type t){
  if(auto c=llvm::dyn_cast<CarrierType>(t))return c.key().str();
  if(auto c=llvm::dyn_cast<CellType>(t))return "cell:"+c.key().str();
  const auto code=typeCode(t);if(!code||code>13)return {};
  return digest(std::string("tsfg.type")+std::string(1,'\0')+scalarName(code).str());
}
const std::map<std::string,std::vector<llvm::StringRef>> properties={
  {"constant",{"token","decimal"}},{"floating",{"token","bits"}},{"boolean",{"value"}},
  {"string",{"codeUnits"}},{"undefined",{}},{"null",{}},{"cell",{"binding"}},
  {"load",{"binding"}},{"store",{"binding","initialize"}},
  {"global_load",{"global"}},{"global_store",{"global","initialize"}},
  {"assert",{"operator","annotationRange","operatorRange"}},{"view",{"target"}},
  {"value_copy",{"type"}},{"carrier_cast",{"carrier"}},{"unary",{"operator"}},
  {"binary",{"operator"}},{"strict_equal",{"operator"}},
  {"numeric_use",{"operator","index","operand_view"}},{"field_load",{"field"}},
  {"field_store",{"field","initialize"}},{"construct_value",{"type","construction"}},
  {"allocate_reference",{"type","construction"}},{"array_create",{"allocation"}},
  {"array_read",{"element"}},{"array_store",{"element"}},{"array_resize",{}},
  {"array_length",{}},{"readspan",{}},{"readspan_length",{}},{"pack",{"type"}},
  {"invoke",{"function_id","signature_hash"}},{"invoke_method",{"function_id","signature_hash","dispatch"}},{"enter_handler",{"handler","hasCatch","hasFinally"}},
  {"catch_bind",{"binding"}},{"finally_enter",{"handler","completion"}},
  {"route",{"completion","handler"}},{"return_throw",{}},{"unreachable",{}},{"fuel",{"event"}}
};
bool readFunction(mlir::func::FuncOp source,Program &p,Function &out,Error &e){
  if(source.isExternal()||source.getBody().empty()||source.getNumArguments()>64||source.getNumResults()>1||
    source.getBody().getBlocks().size()>256||!attributes(source,{"sym_name","function_type", "tsfg_program.function_id",
    "tsfg_program.signature_hash","tsfg_program.source_path","tsfg_program.role","tsfg_source.start","tsfg_source.end"}))
    return reject(e,"core-ir-common-function","complete bounded function body/header required");
  out.id=text(source,"tsfg_program.function_id").str();out.signature=text(source,"tsfg_program.signature_hash").str();
  out.path=text(source,"tsfg_program.source_path").str();out.role=text(source,"tsfg_program.role").str();
  out.name=source.getSymName().str();
  if(out.id.empty()||out.signature.empty()||out.path.empty()||out.role.empty()||!anchor(source,out.range))
    return reject(e,"core-ir-common-function","complete stable function and original anchor required");
  out.resultCarrier=source.getNumResults()?carrier(source.getResultTypes()[0]):"void";
  if(out.resultCarrier.empty())return reject(e,"core-ir-common-carrier","unsupported function result carrier");
  llvm::DenseMap<mlir::Value,uint16_t> values;llvm::DenseMap<mlir::Block *,uint16_t> blocks;
  size_t instructions=0;
  for(auto &block:source.getBody()){
    if(!p.charge(block.getNumArguments()+1)||block.getNumArguments()>64)
      return reject(e,"core-ir-common-budget","block arguments/work exceeded");
    blocks[&block]=uint16_t(out.blocks.size());out.blocks.emplace_back();
    const auto add=[&](mlir::Value value){
      if(out.carriers.size()>=4096)return false;auto c=carrier(value.getType());if(c.empty())return false;
      values[value]=uint16_t(out.carriers.size());out.carriers.push_back(std::move(c));return true;
    };
    for(auto a:block.getArguments()){
      if(!add(a))return reject(e,"core-ir-common-carrier","argument carrier/register limit differs");
      out.blocks.back().parameters.push_back(values.lookup(a));
    }
    for(auto &op:block){
      if(!p.charge(op.getNumOperands()+op.getNumResults()+op.getNumSuccessors()+1)||++instructions>8192||
        op.getNumRegions()||op.getNumResults()>1)
        return reject(e,"core-ir-common-budget","operation shape/register/work exceeded");
      for(auto result:op.getResults())if(!add(result))
        return reject(e,"core-ir-common-carrier","result carrier/register limit differs");
    }
  }
  for(auto &block:source.getBody())for(auto &sourceOp:block){
    Operation op;auto name=sourceOp.getName().getStringRef();
    // A construction executes field initializers anchored in their declaring
    // source, possibly another module. The independent Source proof establishes
    // each instruction's provenance rather than assuming the caller's range.
    if(!anchor(&sourceOp,op.range))
      return reject(e,"core-ir-common-anchor","operation lacks an original source anchor");
    if(name=="func.return"||name=="cf.br"||name=="cf.cond_br"){
      op.name=name.str();
      if(!(name=="cf.cond_br"?attributes(&sourceOp,{"operandSegmentSizes","tsfg_source.start","tsfg_source.end"}):
          attributes(&sourceOp,{"tsfg_source.start","tsfg_source.end"})))
        return reject(e,"core-ir-common-operation","standard control attributes differ");
    }else{
      if(!name.consume_front("tsfg_program.")||!properties.count(name.str())||
        !attributes(&sourceOp,{"properties","view_type","tsfg_source.start","tsfg_source.end"}))
        return reject(e,"core-ir-common-operation","foreign or incomplete common operation");
      op.name=name.str();op.view=text(&sourceOp,"view_type").str();
      if(op.view.empty()||!readJson(text(&sourceOp,"properties"),op.properties,p,e)||!exact(op.properties,properties.at(op.name)))
        return reject(e,"core-ir-common-operation","operation property/view contract differs");
    }
    for(auto a:sourceOp.getOperands()){
      auto found=values.find(a);if(found==values.end())return reject(e,"core-ir-common-ssa","operand is not owned by this function");
      op.operands.push_back(found->second);
    }
    if(sourceOp.getNumResults())op.result=values.lookup(sourceOp.getResult(0));
    for(auto *target:sourceOp.getSuccessors()){
      auto found=blocks.find(target);if(found==blocks.end())return reject(e,"core-ir-common-ssa","successor is not owned by this function");
      op.successors.push_back(found->second);
    }
    out.blocks[blocks.lookup(&block)].operations.push_back(std::move(op));
  }
  return true;
}
}
bool readFunctions(mlir::ModuleOp module,Program &p,Error &e){
  std::set<std::string> ids,names;
  for(auto &op:module.getBody()->getOperations()){
    auto source=llvm::dyn_cast<mlir::func::FuncOp>(op);
    if(!source||p.functions.size()>=4096||!p.charge())return reject(e,"core-ir-common-function","only complete bounded function inventory permitted");
    Function f;if(!readFunction(source,p,f,e))return false;
    if(!ids.insert(f.id).second||!names.insert(f.name).second)return reject(e,"core-ir-common-function","duplicate function identity or symbol");
    p.functions.push_back(std::move(f));
  }
  return !p.functions.empty()||reject(e,"core-ir-common-function","complete function inventory is empty");
}
} // namespace tsfg::commonProgram
