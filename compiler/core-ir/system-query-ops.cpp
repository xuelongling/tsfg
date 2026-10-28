// SPDX-License-Identifier: MIT
#include "system-query-source.h"
#include "dialect.h"
#include "mlir/IR/Builders.h"
#include "llvm/ADT/STLExtras.h"
namespace tsfg::systemQuery {
namespace {
struct Check {
  Model &m;mlir::MLIRContext *context;
  struct Binding {mlir::Value value;const Json *raw=nullptr;};
  struct Physical {mlir::Operation *op;const Json *component,*field;};
  std::vector<Physical> physical;
  bool need(bool ok,llvm::StringRef message){return ok||reject(m.error,"core-ir-query-operation",message);}
  bool attrs(mlir::Operation *op,std::set<std::string> expected){
    if(!need(op->getAttrs().size()==expected.size(),"operation attribute inventory differs"))return false;
    for(auto a:op->getAttrs())if(!need(expected.count(a.getName().str()),"unknown Query operation attribute"))return false;return true;
  }
  bool text(mlir::Operation *op,llvm::StringRef key,llvm::StringRef value){auto a=op->getAttrOfType<mlir::StringAttr>(key);return need(a&&a.getValue()==value,"operation Source/semantic identity differs");}
  bool integer(mlir::Operation *op,llvm::StringRef key,int64_t value,unsigned width=64){auto a=op->getAttrOfType<mlir::IntegerAttr>(key);return need(a&&a.getType().isSignlessInteger(width)&&a.getInt()==value,"operation numeric anchor/layout differs");}
  bool anchor(mlir::Operation *op,const Json &r){return integer(op,"tsfg_source.start",number(field(r,"start")))&&integer(op,"tsfg_source.end",number(field(r,"end")));}
  mlir::Operation *take(mlir::Block::iterator &it,mlir::Block &block,llvm::StringRef name,llvm::ArrayRef<mlir::Value> operands,unsigned results,unsigned regions=0){
    if(!m.spend()||!need(it!=block.end(),"missing typed Query operation"))return nullptr;auto *op=&*it++;
    if(!need(op->getName().getStringRef()==name&&op->getNumOperands()==operands.size()&&op->getNumResults()==results&&op->getNumRegions()==regions&&op->getNumSuccessors()==0,"typed Query operation shape/order differs"))return nullptr;
    for(size_t i=0;i<operands.size();++i)if(!need(op->getOperand(i)==operands[i],"original evaluation/SSA operand order differs"))return nullptr;return op;
  }
  const Json *component(const std::string &id){for(const auto &t:items(field(m.layouts,"types"))){if(!m.spend())return nullptr;if(string(field(t,"id"))==id)return &t;}need(false,"component DataLayout missing");return nullptr;}
  bool layout(mlir::Operation *op,const Json &component,const Json *field,std::set<std::string> &allowed){
    if(m.bound){for(auto key:{"stride","alignment"}){allowed.insert(key);if(!integer(op,key,number(tsfg::exception::field(component,key))))return false;}
      if(field){allowed.insert("offset");allowed.insert("field_type");if(!integer(op,"offset",number(tsfg::exception::field(*field,"offset")))||!text(op,"field_type",string(tsfg::exception::field(*field,"type"))))return false;}}
    physical.push_back({op,&component,field});return true;
  }
  bool fieldOp(mlir::Operation *op,const Json &value,const Binding &receiver,const Json &r){
    const auto &access=field(*receiver.raw,"componentType").getAsString()?*receiver.raw:field(field(*receiver.raw,"view"),"access");
    const auto componentId=m.source->typeIds.at(string(field(access,"componentType"))),rawField=string(field(value,"property")),semantic=m.source->fieldIds.at(rawField);
    const auto *row=component(componentId);if(!row)return false;const Json *selected=nullptr;
    for(const auto &f:items(field(*row,"fields")))if(string(field(f,"id"))==semantic){selected=&f;break;}
    if(!need(selected,"original selected Field ID missing from physical component"))return false;
    std::set<std::string> allowed={"component_type","field","source_field","tsfg_source.start","tsfg_source.end"};
    return text(op,"component_type",componentId)&&text(op,"field",semantic)&&text(op,"source_field",rawField)&&anchor(op,r)&&layout(op,*row,selected,allowed)&&attrs(op,std::move(allowed));
  }
  mlir::Value arithmetic(mlir::Block::iterator &it,mlir::Block &block,llvm::StringRef name,mlir::Value left,mlir::Value right,const Json &value){
    auto *op=take(it,block,name,{left,right},1);if(!op)return {};
    const auto &r=field(value,"operatorRange");if(!need(left.getType().isF32()&&right.getType().isF32()&&op->getResult(0).getType().isF32(),"f32 arithmetic operand/result type differs")||
      !attrs(op,{"operator_start","operator_end","tsfg_source.start","tsfg_source.end"})||!anchor(op,field(value,"range"))||!integer(op,"operator_start",number(field(r,"start")))||!integer(op,"operator_end",number(field(r,"end"))))return {};return op->getResult(0);
  }
  mlir::Value expression(mlir::Block::iterator &it,mlir::Block &block,const Json &value,std::map<std::string,Binding> &bindings,unsigned depth=0){
    if(!m.spend()||!need(depth<32,"typed expression path exceeds32"))return {};
    const auto kind=string(field(value,"kind"));
    if(kind=="bindingReference")return bindings.at(string(field(value,"binding"))).value;
    if(kind=="parentheses")return expression(it,block,field(value,"expression"),bindings,depth+1);
    if(kind=="call"){
      const auto &helper=m.scalarHelpers[m.helperIndex.at(string(field(value,"callee")))];std::vector<mlir::Value> args;
      size_t index=0;
      for(const auto &arg:items(field(value,"arguments"))){
        auto result=expression(it,block,arg,bindings,depth+1);if(!result)return {};const auto &formal=helper.parameters[index++];
        if(!field(*formal.raw,"view").getAsNull()){
          const auto mode=string(field(field(field(*formal.raw,"view"),"access"),"mode"));const auto expected=ViewType::get(context,formal.type+"#"+mode);
          if(result.getType()!=expected){
            if(!need(mode=="read"&&result.getType()==ViewType::get(context,formal.type+"#write"),"view argument cannot change component or widen permission"))return {};
            auto *borrow=take(it,block,"tsfg.view_borrow",{result},1);
            if(!borrow||!attrs(borrow,{"component_type","mode","tsfg_source.start","tsfg_source.end"})||!text(borrow,"component_type",formal.type)||!text(borrow,"mode",mode)||!anchor(borrow,field(arg,"range"))||!need(borrow->getResult(0).getType()==expected,"borrowed view type differs"))return {};result=borrow->getResult(0);
          }
        }else if(!need(result.getType().isF32(),"ordinary helper argument must be f32"))return {};
        args.push_back(result);
      }
      auto *op=take(it,block,"func.call",args,1);if(!op)return {};
      auto symbol=op->getAttrOfType<mlir::FlatSymbolRefAttr>("callee");const auto &range=field(value,"calleeRange");
      if(!attrs(op,{"callee","tsfg_core.function_id","tsfg_core.signature_hash","tsfg.query_source_callee","callee_start","callee_end","tsfg_source.start","tsfg_source.end"})||
        !need(symbol&&symbol.getValue()=="query_helper_"+helper.id.substr(7)&&op->getResult(0).getType().isF32(),"scalar call symbol/result differs")||
        !text(op,"tsfg_core.function_id",helper.id)||!text(op,"tsfg_core.signature_hash",helper.signature)||!text(op,"tsfg.query_source_callee",string(field(value,"callee")))||
        !integer(op,"callee_start",number(field(range,"start")))||!integer(op,"callee_end",number(field(range,"end")))||!anchor(op,field(value,"range")))return {};
      return op->getResult(0);
    }
    if(kind=="fieldAccess"){
      const auto &receiver=bindings.at(string(field(field(value,"receiver"),"binding")));auto *op=take(it,block,"tsfg.field_load",{receiver.value},1);
      if(!op||!need(op->getResult(0).getType().isF32(),"field load is not typed f32")||!fieldOp(op,value,receiver,field(value,"range")))return {};return op->getResult(0);
    }
    if(kind=="binary"){
      auto left=expression(it,block,field(value,"left"),bindings,depth+1);if(!left)return {};auto right=expression(it,block,field(value,"right"),bindings,depth+1);if(!right)return {};
      const auto op=string(field(value,"operator"));const auto name=op=="+"?"add":op=="-"?"sub":op=="*"?"mul":"div";return arithmetic(it,block,std::string("tsfg_core.")+name,left,right,value);
    }
    const auto &target=field(value,"target");const auto &receiver=bindings.at(string(field(field(target,"receiver"),"binding")));const auto op=string(field(value,"operator"));mlir::Value previous;
    if(op!="="){
      auto *load=take(it,block,"tsfg.field_load",{receiver.value},1);if(!load||!need(load->getResult(0).getType().isF32(),"compound target load is not f32")||!fieldOp(load,target,receiver,field(target,"range")))return {};previous=load->getResult(0);
    }
    auto rhs=expression(it,block,field(value,"value"),bindings,depth+1);if(!rhs)return {};
    const auto name=op=="+="?"add":op=="-="?"sub":op=="*="?"mul":"div";
    auto result=previous?arithmetic(it,block,std::string("tsfg_core.")+name,previous,rhs,value):rhs;if(!result)return {};
    auto *store=take(it,block,"tsfg.field_store",{receiver.value,result},0);return store&&fieldOp(store,target,receiver,field(value,"range"))?result:mlir::Value();
  }
  bool terminator(mlir::Block::iterator &it,mlir::Block &block,llvm::StringRef name){auto *op=take(it,block,name,{},0);return op&&attrs(op,{})&&need(it==block.end(),"unexpected trailing operation in source-owned region");}
  bool loop(mlir::Block::iterator &it,mlir::Block &block,const Json &raw,const System &system,mlir::func::FuncOp fn){
    size_t parameter=0;while(string(field(field(*system.parameters[parameter].raw,"binding"),"id"))!=string(field(raw,"queryBinding")))++parameter;
    const auto &selection=system.parameters[parameter].selection;
    auto *query=take(it,block,"tsfg.query",{fn.getArgument(parameter)},1);
    if(!query||!attrs(query,{"source_binding","tsfg_source.start","tsfg_source.end"})||!text(query,"source_binding",string(field(raw,"queryBinding")))||!anchor(query,field(raw,"queryRange"))||
      !need(query->getResult(0).getType()==QueryType::get(context,selection),"Query result selection type differs"))return false;
    auto *chunk=take(it,block,"tsfg.chunk",{query->getResult(0)},0,1);
    if(!chunk||!attrs(chunk,{"tsfg_source.start","tsfg_source.end"})||!anchor(chunk,field(raw,"range"))||!need(chunk->getRegion(0).hasOneBlock(),"one source-owned chunk block required"))return false;
    auto &chunks=chunk->getRegion(0).front();if(!need(chunks.getNumArguments()==2&&chunks.getArgument(0).getType()==ChunkType::get(context,selection)&&chunks.getArgument(1).getType().isIndex(),"chunk/count block types differ"))return false;
    auto ci=chunks.begin();auto *parallel=take(ci,chunks,"tsfg.parallel_for",{chunks.getArgument(0),chunks.getArgument(1)},0,1);
    if(!parallel||!attrs(parallel,{"tsfg_source.start","tsfg_source.end"})||!anchor(parallel,field(raw,"range"))||!need(parallel->getRegion(0).hasOneBlock(),"one source-owned row block required"))return false;
    auto &rows=parallel->getRegion(0).front();if(!need(rows.getNumArguments()==1&&rows.getArgument(0).getType().isIndex(),"parallel row index type differs"))return false;
    auto ri=rows.begin();std::map<std::string,Binding> bindings;
    for(size_t i=0;i<system.parameters.size();++i)if(system.parameters[i].selection.empty())bindings.emplace(string(field(field(*system.parameters[i].raw,"binding"),"id")),Binding{fn.getArgument(i),system.parameters[i].raw});
    for(const auto &b:items(field(raw,"bindings"))){
      auto *column=take(ri,rows,"tsfg.column",{chunks.getArgument(0),rows.getArgument(0)},1);const auto id=m.source->typeIds.at(string(field(b,"componentType"))),mode=string(field(b,"mode"));
      const auto *row=component(id);if(!column||!row)return false;std::set<std::string> allowed={"component_type","mode","source_binding","tuple_index","tsfg_source.start","tsfg_source.end"};
      if(!need(column->getResult(0).getType()==ViewType::get(context,id+"#"+mode),"column view type/mode differs")||!text(column,"component_type",id)||!text(column,"mode",mode)||!text(column,"source_binding",string(field(field(b,"declaration"),"id")))||
        !integer(column,"tuple_index",number(field(b,"index")))||!anchor(column,field(field(b,"declaration"),"range"))||!layout(column,*row,nullptr,allowed)||!attrs(column,std::move(allowed)))return false;
      bindings.emplace(string(field(field(b,"declaration"),"id")),Binding{column->getResult(0),&b});
    }
    for(const auto &statement:items(field(raw,"statements")))if(!expression(ri,rows,field(statement,"value"),bindings))return false;
    return terminator(ri,rows,"tsfg.yield")&&terminator(ci,chunks,"tsfg.yield");
  }
  bool function(mlir::func::FuncOp fn,const System &system){
    const auto &decl=field(*system.raw,"declaration");
    if(!attrs(fn,{"function_type","sym_name","tsfg_core.function_id","tsfg_core.signature_hash","tsfg.query_source_function","tsfg_source.path","tsfg_source.start","tsfg_source.end"})||
      !text(fn,"tsfg_core.function_id",system.id)||!text(fn,"tsfg_core.signature_hash",system.signature)||!text(fn,"tsfg.query_source_function",string(field(decl,"id")))||
      !text(fn,"tsfg_source.path",string(field(decl,"sourcePath")))||!anchor(fn,field(decl,"range"))||!need(fn.getSymName()=="query_"+system.id.substr(7)&&!fn.isExternal()&&fn.getBody().hasOneBlock()&&fn.getNumArguments()==system.parameters.size()&&fn.getFunctionType().getNumResults()==0,"actual lowered system function shape differs"))return false;
    for(size_t i=0;i<system.parameters.size();++i){const auto &p=system.parameters[i];auto type=fn.getArgument(i).getType();
      if(!p.selection.empty()){if(!need(type==QueryType::get(context,p.selection),"function Query parameter type differs"))return false;}
      else if(!need(tsfg::scalarName(tsfg::typeCode(type))==string(field(*p.raw,"logicalType")),"ordinary scalar parameter type differs"))return false;
    }
    auto &body=fn.getBody().front();auto it=body.begin();for(const auto &l:items(field(*system.raw,"loops")))if(!loop(it,body,l,system,fn))return false;return terminator(it,body,"func.return");
  }
  bool helper(mlir::func::FuncOp fn,const ScalarHelper &helper){
    const auto &raw=*helper.raw,&decl=field(raw,"declaration");
    if(!attrs(fn,{"function_type","sym_name","tsfg_core.function_id","tsfg_core.signature_hash","tsfg.query_source_function","tsfg.query_source_helper","tsfg_source.path","tsfg_source.start","tsfg_source.end"})||
      !text(fn,"tsfg_core.function_id",helper.id)||!text(fn,"tsfg_core.signature_hash",helper.signature)||!text(fn,"tsfg.query_source_function",string(field(decl,"id")))||!text(fn,"tsfg.query_source_helper",string(field(raw,"id")))||
      !text(fn,"tsfg_source.path",string(field(decl,"sourcePath")))||!anchor(fn,field(decl,"range"))||
      !need(fn.getSymName()=="query_helper_"+helper.id.substr(7)&&!fn.isExternal()&&fn.getBody().hasOneBlock()&&fn.getNumArguments()==helper.parameters.size()&&fn.getFunctionType().getNumResults()==1&&fn.getFunctionType().getResult(0).isF32(),"scalar helper function shape differs"))return false;
    std::map<std::string,Binding> bindings;for(size_t i=0;i<helper.parameters.size();++i){const auto &p=helper.parameters[i];
      const auto &view=field(*p.raw,"view");const auto expected=view.getAsNull()?mlir::Type(mlir::Float32Type::get(context)):mlir::Type(ViewType::get(context,p.type+"#"+string(field(field(view,"access"),"mode"))));
      if(!need(fn.getArgument(i).getType()==expected,"helper argument component/permission type differs"))return false;bindings.emplace(string(field(field(*p.raw,"binding"),"id")),Binding{fn.getArgument(i),p.raw});}
    auto &body=fn.getBody().front();auto it=body.begin();auto value=expression(it,body,field(raw,"value"),bindings);if(!value)return false;
    auto *returned=take(it,body,"func.return",{value},0);
    return returned&&attrs(returned,{"tsfg_source.start","tsfg_source.end"})&&anchor(returned,field(raw,"returnRange"))&&need(it==body.end(),"extra scalar helper body operation");
  }
};
}
bool verifyOperations(mlir::ModuleOp module,Model &m){
  Check check{m,module.getContext()};auto it=module.getBody()->begin();
  for(const auto &system:m.systems){if(!m.spend()||!check.need(it!=module.getBody()->end(),"missing complete system function"))return false;
    auto fn=llvm::dyn_cast<mlir::func::FuncOp>(&*it++);if(!check.need(bool(fn),"non-system operation in Query module")||!check.function(fn,system))return false;}
  for(const auto &helper:m.scalarHelpers){if(!m.spend()||!check.need(it!=module.getBody()->end(),"missing reachable scalar helper"))return false;
    auto fn=llvm::dyn_cast<mlir::func::FuncOp>(&*it++);if(!check.need(bool(fn),"non-function helper operation")||!check.helper(fn,helper))return false;}
  if(!check.need(it==module.getBody()->end(),"extra system function or mixed module operation"))return false;
  const auto encoded=canonical(m.layouts);
  if(m.bound){auto attr=module->getAttrOfType<mlir::StringAttr>("tsfg.query_layouts");return check.need(attr&&attr.getValue()==encoded,"independent bound component catalog differs");}
  // Commit physical binding only after the entire owned Source/IR comparison.
  mlir::Builder builder(module.getContext());
  for(const auto &p:check.physical){for(auto key:{"stride","alignment"})p.op->setAttr(key,builder.getI64IntegerAttr(number(field(*p.component,key))));
    if(p.field){p.op->setAttr("offset",builder.getI64IntegerAttr(number(field(*p.field,"offset"))));p.op->setAttr("field_type",builder.getStringAttr(string(field(*p.field,"type"))));}}
  module->setAttr("tsfg.query_layouts",builder.getStringAttr(encoded));module->setAttr("tsfg.query_stage",builder.getStringAttr("bound"));return true;
}
} // namespace tsfg::systemQuery
