// SPDX-License-Identifier: MIT
#include "common-program-value-lowering.h"
#include "common-program-header.h"
#include "component-layout.h"
#include "mlir/Conversion/ArithToLLVM/ArithToLLVM.h"
#include "mlir/Conversion/ControlFlowToLLVM/ControlFlowToLLVM.h"
#include "mlir/Conversion/FuncToLLVM/ConvertFuncToLLVM.h"
#include "mlir/Conversion/LLVMCommon/ConversionTarget.h"
#include "mlir/Conversion/LLVMCommon/TypeConverter.h"
#include "mlir/Dialect/Arith/IR/Arith.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/Dialect/LLVMIR/LLVMDialect.h"
#include "mlir/IR/Verifier.h"
#include "mlir/Parser/Parser.h"
#include "mlir/Target/LLVMIR/Dialect/Builtin/BuiltinToLLVMIRTranslation.h"
#include "mlir/Target/LLVMIR/Dialect/LLVMIR/LLVMToLLVMIRTranslation.h"
#include "mlir/Target/LLVMIR/Export.h"
#include "llvm/ADT/APInt.h"
#include "llvm/IR/LLVMContext.h"
#include "llvm/IR/Metadata.h"
#include "llvm/IR/Module.h"
#include "llvm/IR/Verifier.h"
#include "llvm/Support/raw_ostream.h"
#include <algorithm>
#include <functional>

namespace tsfg::commonProgram {
namespace {
using exception::field;using exception::items;using exception::string;
constexpr size_t outputLimit=8388608;
// Explicit value_copy owns a new field plane. Loads and nested projections
// retain the selected plane's identity. Acyclic CFGs give each definition one
// fixed entry slot, without a second Runtime lifetime or failure protocol.
struct Lowering {
  Program &program;Error &error;Json layouts=nullptr;Array initializedFields;
  std::map<std::string,const Json *> declarations,physical,bindings;
  const std::map<std::string,std::string> &singletonStorage;
  std::map<std::string,std::string> types;std::set<std::string> initialized;
  std::map<std::string,size_t> functions;
  std::map<size_t,std::vector<uint16_t>> reachable;std::set<size_t> active;
  std::string text;llvm::raw_string_ostream out;unsigned temporary=0,continuation=0;uint64_t interval=0;
  const Function *function=nullptr;size_t functionIndex=0;
  std::map<uint16_t,std::string> values,storage;std::string sourcePath;SourceAnchor sourceRange;
  Lowering(Program &p,Error &e,const std::map<std::string,std::string> &storage):program(p),error(e),singletonStorage(storage),out(text){
    for(const auto &row:items(field(p.hir,"types")))declarations.emplace(string(field(row,"id")),&row);
    for(const auto &row:items(field(p.representation,"bindings")))bindings.emplace(string(field(row,"id")),&row);
    for(size_t i=0;i<p.functions.size();++i)functions.emplace(p.functions[i].id,i);
  }
  bool need(bool value,llvm::StringRef detail){
    if(value)return true;reject(error,"core-ir-value-llvm-capability",detail);error.path=sourcePath;error.range=sourceRange;return false;
  }
  bool step(){return program.charge(1)||reject(error,"core-ir-value-llvm-budget","fixed-value lowering work exceeded");}
  bool valueType(const std::string &id)const{return declarations.count(id)&&string(field(*declarations.at(id),"kind"))=="value";}
  std::string tmp(){return "%t"+std::to_string(temporary++);}
  // These are the existing full verifier's fixed storage bounds, never a new
  // producer assertion. Empty native fields, presence/TOP and retagged stores
  // require the separate actual-value/presence lowering capability.
  bool fullyInitialized(const std::string &id){
    if(initialized.count(id))return true;if(!step())return false;
    const auto &decl=*declarations.at(id),&construction=field(decl,"construction");
    sourcePath=string(field(field(decl,"origin"),"sourcePath"));
    const auto &declRange=field(field(decl,"origin"),"range");sourceRange={uint32_t(field(declRange,"start").getAsInteger().value()),uint32_t(field(declRange,"end").getAsInteger().value())};
    const auto &fields=items(field(decl,"fields")),&order=items(field(construction,"initializationFields"));
    if(!need(field(decl,"base").getAsNull()&&string(field(construction,"kind"))=="implicit-base"&&field(construction,"functionId").getAsNull()&&field(construction,"implicitForward").getAsNull()&&fields.size()==order.size(),"fixed values require a complete implicit initialization plan"))return false;
    for(size_t i=0;i<fields.size();++i){
      const auto &row=fields[i],&initializer=field(row,"initializer");const auto fieldId=string(field(row,"id")),child=string(field(row,"type")),raw=string(field(row,"sourceBinding"));
      sourcePath=string(field(field(row,"origin"),"source"));sourceRange={uint32_t(field(field(row,"origin"),"start").getAsInteger().value()),uint32_t(field(field(row,"origin"),"end").getAsInteger().value())};
      const auto actual=singletonStorage.find(raw);const auto binding=bindings.find(raw);const auto kind=string(field(initializer,"kind"));
      const bool scalar=declarations.count(child)&&string(field(*declarations.at(child),"kind"))=="scalar";
      const bool literal=scalar&&(kind=="numericLiteral"||kind=="booleanLiteral")&&string(field(initializer,"type"))==child;
      const bool nested=valueType(child)&&kind=="new"&&string(field(initializer,"type"))==child&&items(field(initializer,"arguments")).empty();
      if(!step()||!need(same(order[i],field(row,"id"))&&(literal||nested)&&binding!=bindings.end()&&string(field(*binding->second,"carrier"))==child&&actual!=singletonStorage.end()&&actual->second==child,"field initialization or independently derived actual storage may contain absence/non-fixed data"))return false;
      if(nested&&!fullyInitialized(child))return false;
      initializedFields.push_back(Object{{"owner",id},{"field",fieldId},{"type",child},{"actualType",actual->second},{"source",field(row,"origin")},{"initializer",initializer}});
    }initialized.insert(id);return true;
  }
  std::string type(const std::string &id){
    if(types.count(id))return types.at(id);
    if(!step()||!need(declarations.count(id),"carrier does not name an owned semantic type"))return {};
    const auto &decl=*declarations.at(id);const auto kind=string(field(decl,"kind"));std::string result;
    if(kind=="scalar"){
      const auto name=string(field(decl,"name"));
      if(name=="f32"||name=="f64")result=name;
      else if(name=="bool"||name=="i8"||name=="u8")result="i8";
      else if(name=="i16"||name=="u16")result="i16";
      else if(name=="i32"||name=="u32")result="i32";
      else if(name=="i64"||name=="u64"||name=="isize"||name=="usize")result="i64";
      else need(false,"unsupported fixed scalar");
    }else if(kind=="value"&&physical.count(id)){
      result="!llvm.struct<(";bool first=true;
      for(const auto &member:items(field(*physical.at(id),"fields"))){const auto child=type(string(field(member,"type")));if(child.empty())return {};if(!first)result+=", ";first=false;result+=child;}result+=")>";
    }else need(false,"selected closure requires GC-free fixed-value or scalar carriers");
    if(!result.empty())types.emplace(id,result);return result;
  }
  std::string registerType(const std::string &id){return valueType(id)||llvm::StringRef(id).starts_with("cell:")?"!llvm.ptr":type(id);}
  void locate(size_t fn,uint16_t block,size_t ordinal){
    sourceRange=program.functions[fn].blocks[block].operations[ordinal].range;
    sourcePath=program.operationSources.at(program.functions[fn].id).at({block,uint16_t(ordinal)});
  }
  bool closure(size_t index){
    if(reachable.count(index))return true;const auto &selected=program.functions[index];sourcePath=selected.path;sourceRange=selected.range;
    if(!step()||!need(active.insert(index).second,"recursive fixed-value calls require a separate lowering capability"))return false;
    std::vector<uint16_t> order;std::vector<uint8_t> state(selected.blocks.size());
    std::function<bool(uint16_t)> visit=[&](uint16_t block){
      if(state[block]==2)return true;if(!step()||!need(state[block]==0,"cyclic fixed-value CFG requires a separate storage-lifetime capability"))return false;
      state[block]=1;order.push_back(block);
      for(size_t ordinal=0;ordinal<selected.blocks[block].operations.size();++ordinal){
        locate(index,block,ordinal);const auto &op=selected.blocks[block].operations[ordinal];if(!step())return false;
        if(op.name=="invoke"){
          const auto id=string(field(op.properties,"function_id"));
          if(!need(functions.count(id)&&selected.blocks[op.successors[0]].parameters.size()==1,"direct fixed callee requires one normal result in the verified inventory")||!closure(functions.at(id)))return false;
          locate(index,block,ordinal);if(!visit(op.successors[0]))return false;
        }else{
          static const std::set<std::string> supported={"fuel","cell","store","load","value_copy","view","carrier_cast","field_load","field_store","constant","boolean","strict_equal","func.return","cf.br","cf.cond_br"};
          if(!need(supported.count(op.name),"operation in the selected closure has no fixed-value lowering"))return false;
          if(op.name=="cf.cond_br"&&!need(selected.blocks[op.successors[0]].parameters.empty()&&selected.blocks[op.successors[1]].parameters.empty(),"conditional fixed-value edges require their Source-normalized empty successors"))return false;
          for(auto successor:op.successors)if(!visit(successor))return false;
        }
      }state[block]=2;return true;
    };
    if(!visit(0))return false;active.erase(index);reachable.emplace(index,std::move(order));return true;
  }
  std::string constant(uint64_t value,llvm::StringRef native="i32"){
    const auto name=tmp();out<<"    "<<name<<" = arith.constant "<<value<<" : "<<native<<'\n';return name;
  }
  std::string callback(unsigned kind,SourceAnchor source,size_t eventFunction){
    const auto identifier=constant((UINT64_C(1)<<63)|++interval,"i64"),shadow=constant(0);
    out<<"    llvm.call_intrinsic \"llvm.experimental.stackmap\"("<<identifier<<", "<<shadow<<") : (i64, i32) -> ()\n";
    const auto k=constant(kind),fn=constant(eventFunction),start=constant(source.start),end=constant(source.end),site=constant(interval,"i64"),result=tmp();
    out<<"    "<<result<<" = llvm.call %event(%state, "<<k<<", "<<fn<<", "<<start<<", "<<end<<", "<<site<<") : !llvm.ptr, (!llvm.ptr, i32, i32, i32, i32, i64) -> i32\n";return result;
  }
  void allow(const std::string &result){
    const auto zero=constant(0),yes=tmp(),next="next"+std::to_string(continuation++);
    out<<"    "<<yes<<" = arith.cmpi ne, "<<result<<", "<<zero<<" : i32\n    cf.cond_br "<<yes<<", ^"<<next<<", ^failed\n  ^"<<next<<":\n";
  }
  void checkpoint(unsigned kind,SourceAnchor source){allow(callback(kind,source,functionIndex));}
  std::string zero(const std::string &id){
    const auto native=type(id),result=tmp();
    if(valueType(id))out<<"    "<<result<<" = llvm.mlir.zero : "<<native<<'\n';
    else out<<"    "<<result<<" = arith.constant "<<(native=="f32"||native=="f64"?"0.0":"0")<<" : "<<native<<'\n';return result;
  }
  std::string load(const std::string &pointer,const std::string &id){const auto result=tmp();out<<"    "<<result<<" = llvm.load "<<pointer<<" : !llvm.ptr -> "<<type(id)<<'\n';return result;}
  std::string fieldPointer(const std::string &pointer,const std::string &id,size_t index){
    const auto result=tmp();out<<"    "<<result<<" = llvm.getelementptr "<<pointer<<"[0, "<<index<<"] : (!llvm.ptr) -> !llvm.ptr, "<<type(id)<<'\n';return result;
  }
  std::string equal(const std::string &left,const std::string &right,const std::string &id){
    if(!step())return {};
    if(valueType(id)){
      auto result=constant(1,"i1");const auto &fields=items(field(*physical.at(id),"fields"));
      for(size_t i=0;i<fields.size();++i){
        const auto child=string(field(fields[i],"type")),a=fieldPointer(left,id,i),b=fieldPointer(right,id,i);
        const auto same=equal(valueType(child)?a:load(a,child),valueType(child)?b:load(b,child),child),joined=tmp();if(same.empty())return {};
        out<<"    "<<joined<<" = arith.andi "<<result<<", "<<same<<" : i1\n";result=joined;
      }return result;
    }
    const auto native=type(id),result=tmp();out<<"    "<<result<<" = arith."<<(native=="f32"||native=="f64"?"cmpf oeq":"cmpi eq")<<", "<<left<<", "<<right<<" : "<<native<<'\n';return result;
  }
  void edge(uint16_t target,const std::vector<std::string> &arguments){
    out<<"^b"<<target;if(arguments.empty())return;out<<'(';const auto &parameters=function->blocks[target].parameters;
    for(size_t i=0;i<arguments.size();++i){if(i)out<<", ";out<<arguments[i];}out<<" : ";
    for(size_t i=0;i<arguments.size();++i){if(i)out<<", ";out<<registerType(function->carriers[parameters[i]]);}out<<')';
  }
  bool operation(const Operation &op){
    if(!step())return false;if(op.name=="fuel"){checkpoint(1,op.range);return true;}checkpoint(2,op.range);
    const auto operand=[&](size_t index)->const std::string &{return values.at(op.operands[index]);};
    const auto carrier=[&](uint16_t reg)->const std::string &{return function->carriers[reg];};
    const auto result=op.result==noRegister?std::string():values.at(op.result);
    if(op.name=="cell")values[op.result]=storage.at(op.result);
    else if(op.name=="store")out<<"    llvm.store "<<operand(1)<<", "<<operand(0)<<" : "<<registerType(carrier(op.operands[1]))<<", !llvm.ptr\n";
    else if(op.name=="load")out<<"    "<<result<<" = llvm.load "<<operand(0)<<" : !llvm.ptr -> "<<registerType(carrier(op.result))<<'\n';
    else if(op.name=="value_copy"||op.name=="view"||op.name=="carrier_cast"){
      if(!need(carrier(op.operands[0])==carrier(op.result),"fixed-value lowering cannot retag a semantic identity"))return false;
      if(valueType(carrier(op.result))&&op.name=="value_copy"){
        const auto copied=load(operand(0),carrier(op.result));out<<"    llvm.store "<<copied<<", "<<storage.at(op.result)<<" : "<<type(carrier(op.result))<<", !llvm.ptr\n";values[op.result]=storage.at(op.result);
      }else values[op.result]=operand(0);
    }else if(op.name=="field_load"||op.name=="field_store"){
      const auto owner=carrier(op.operands[0]),selected=string(field(op.properties,"field"));if(!need(physical.count(owner),"field receiver has no fixed-value layout"))return false;
      const auto &fields=items(field(*physical.at(owner),"fields"));size_t index=0;for(;index<fields.size();++index)if(string(field(fields[index],"id"))==selected)break;
      if(!need(index<fields.size(),"field identity differs from the fixed-value layout"))return false;
      const auto child=string(field(fields[index],"type")),pointer=fieldPointer(operand(0),owner,index);
      if(op.name=="field_load"){
        if(!need(child==carrier(op.result),"field result differs from its semantic declaration"))return false;
        if(valueType(child))values[op.result]=pointer;else out<<"    "<<result<<" = llvm.load "<<pointer<<" : !llvm.ptr -> "<<type(child)<<'\n';
      }else{
        if(!need(child==carrier(op.operands[1]),"field store differs from its semantic declaration"))return false;
        const auto stored=valueType(child)?load(operand(1),child):operand(1);out<<"    llvm.store "<<stored<<", "<<pointer<<" : "<<type(child)<<", !llvm.ptr\n";
      }
    }else if(op.name=="constant"||op.name=="boolean"){
      const auto native=type(carrier(op.result));unsigned width=0;if(!need(!llvm::StringRef(native).drop_front().getAsInteger(10,width),"constant requires a fixed integer carrier"))return false;
      const auto bits=op.name=="boolean"?uint64_t(field(op.properties,"value").getAsBoolean()==true):llvm::APInt(width,string(field(op.properties,"decimal")),10).getZExtValue();
      out<<"    "<<result<<" = arith.constant "<<bits<<" : "<<native<<'\n';
    }else if(op.name=="strict_equal"){
      if(!need(carrier(op.operands[0])==carrier(op.operands[1]),"fixed equality requires the same owned semantic type"))return false;
      auto comparison=equal(operand(0),operand(1),carrier(op.operands[0]));if(comparison.empty())return false;
      if(string(field(op.properties,"operator"))=="!=="){const auto one=constant(1,"i1"),opposite=tmp();out<<"    "<<opposite<<" = arith.xori "<<comparison<<", "<<one<<" : i1\n";comparison=opposite;}
      out<<"    "<<result<<" = arith.extui "<<comparison<<" : i1 to "<<type(carrier(op.result))<<'\n';
    }else if(op.name=="invoke"){
      const auto target=functions.at(string(field(op.properties,"function_id")));const auto &callee=program.functions[target];allow(callback(0,callee.range,target));std::vector<std::string> arguments;
      for(auto reg:op.operands)arguments.push_back(valueType(carrier(reg))?load(values.at(reg),carrier(reg)):values.at(reg));
      const auto returned=tmp();out<<"    "<<returned<<" = func.call @value_"<<callee.id.substr(7)<<"(%state, %event";for(const auto &argument:arguments)out<<", "<<argument;
      out<<") : (!llvm.ptr, !llvm.ptr";for(auto reg:op.operands)out<<", "<<type(carrier(reg));out<<") -> "<<type(callee.resultCarrier)<<'\n';checkpoint(2,op.range);
      const auto targetBlock=op.successors[0],reg=function->blocks[targetBlock].parameters[0];std::string value=returned;
      if(valueType(callee.resultCarrier)){value=storage.at(reg);out<<"    llvm.store "<<returned<<", "<<value<<" : "<<type(callee.resultCarrier)<<", !llvm.ptr\n";}
      out<<"    cf.br ";edge(targetBlock,{value});out<<'\n';
    }else if(op.name=="cf.br"){
      std::vector<std::string> arguments;for(auto reg:op.operands)arguments.push_back(values.at(reg));out<<"    cf.br ";edge(op.successors[0],arguments);out<<'\n';
    }else if(op.name=="cf.cond_br"){
      const auto zero=constant(0,type(carrier(op.operands[0]))),condition=tmp();out<<"    "<<condition<<" = arith.cmpi ne, "<<operand(0)<<", "<<zero<<" : "<<type(carrier(op.operands[0]))<<"\n    cf.cond_br "<<condition<<", ";edge(op.successors[0],{});out<<", ";edge(op.successors[1],{});out<<'\n';
    }else if(op.name=="func.return"){
      callback(4,op.range,functionIndex);callback(3,op.range,functionIndex);const auto returned=valueType(function->resultCarrier)?load(operand(0),function->resultCarrier):operand(0);out<<"    func.return "<<returned<<" : "<<type(function->resultCarrier)<<'\n';
    }
    return text.size()<=outputLimit||reject(error,"core-ir-value-llvm-budget","fixed-value IR byte limit exceeded");
  }
  bool emit(size_t index){
    function=&program.functions[index];functionIndex=index;values.clear();storage.clear();const auto &selected=*function;sourcePath=selected.path;sourceRange=selected.range;
    const auto returned=type(selected.resultCarrier);if(returned.empty())return false;std::set<uint16_t> retained;
    for(auto block:reachable.at(index)){for(auto reg:selected.blocks[block].parameters)retained.insert(reg);for(const auto &op:selected.blocks[block].operations)if(op.result!=noRegister)retained.insert(op.result);}
    for(auto reg:retained){if(registerType(selected.carriers[reg]).empty())return false;values.emplace(reg,"%r"+std::to_string(reg));}
    out<<"  func.func private @value_"<<selected.id.substr(7)<<"(%state: !llvm.ptr, %event: !llvm.ptr";for(auto reg:selected.blocks[0].parameters)out<<", %arg"<<reg<<": "<<type(selected.carriers[reg]);out<<") -> "<<returned<<" {\n";
    const auto frame=constant(index,"i64"),shadow=constant(0);out<<"    llvm.call_intrinsic \"llvm.experimental.stackmap\"("<<frame<<", "<<shadow<<") : (i64, i32) -> ()\n";
    for(auto reg:retained){
      const auto &id=selected.carriers[reg];if(!valueType(id)&&!llvm::StringRef(id).starts_with("cell:"))continue;
      std::string element;if(valueType(id))element=type(id);else for(auto block:reachable.at(index))for(const auto &op:selected.blocks[block].operations)if(op.result==reg)element=registerType(op.view);
      const auto one=constant(1,"i64"),slot=tmp();out<<"    "<<slot<<" = llvm.alloca "<<one<<" x "<<element<<" : (i64) -> !llvm.ptr\n";storage.emplace(reg,slot);
    }
    for(auto reg:selected.blocks[0].parameters){
      if(valueType(selected.carriers[reg])){out<<"    llvm.store %arg"<<reg<<", "<<storage.at(reg)<<" : "<<type(selected.carriers[reg])<<", !llvm.ptr\n";values[reg]=storage.at(reg);}else values[reg]="%arg"+std::to_string(reg);
    }out<<"    cf.br ^b0\n";
    for(auto block:reachable.at(index)){
      out<<"  ^b"<<block;if(block&&!selected.blocks[block].parameters.empty()){out<<'(';bool first=true;for(auto reg:selected.blocks[block].parameters){if(!first)out<<", ";first=false;out<<values.at(reg)<<": "<<registerType(selected.carriers[reg]);}out<<')';}out<<":\n";
      for(size_t ordinal=0;ordinal<selected.blocks[block].operations.size();++ordinal){locate(index,block,ordinal);if(!operation(selected.blocks[block].operations[ordinal]))return false;}
    }
    out<<"  ^failed:\n";callback(3,selected.range,index);const auto failed=zero(selected.resultCarrier);out<<"    func.return "<<failed<<" : "<<returned<<"\n  }\n";return true;
  }
  bool run(size_t index){
    if(!closure(index))return false;std::vector<std::string> roots;
    for(const auto &[fn,blocks]:reachable)for(auto block:blocks){const auto &selected=program.functions[fn];if(valueType(selected.resultCarrier))roots.push_back(selected.resultCarrier);for(auto reg:selected.blocks[block].parameters)if(valueType(selected.carriers[reg]))roots.push_back(selected.carriers[reg]);for(const auto &op:selected.blocks[block].operations){if(valueType(op.view))roots.push_back(op.view);if(op.result!=noRegister&&valueType(selected.carriers[op.result]))roots.push_back(selected.carriers[op.result]);}}
    std::sort(roots.begin(),roots.end());roots.erase(std::unique(roots.begin(),roots.end()),roots.end());
    if(!need(!roots.empty(),"selected closure has no fixed-value carrier")||!fixedValueLayoutCatalog(program,roots,layouts,error))return false;
    for(const auto &row:items(field(layouts,"types")))physical.emplace(string(field(row,"id")),&row);for(const auto &id:roots)if(!fullyInitialized(id))return false;
    out<<"module attributes {llvm.data_layout = \""<<coreHeader::layout<<"\", llvm.target_triple = \""<<coreHeader::triple<<"\"} {\n";for(const auto &[fn,blocks]:reachable)if(!emit(fn))return false;out<<"}\n";return true;
  }
};
}
bool lowerFixedValueLLVM(mlir::ModuleOp core,llvm::StringRef functionId,FixedValueLLVM &result,Error &error){
  Program program;std::map<std::string,std::string> storage;if(!readCore(core,program,error)||!verifyProgram(program,error,storage))return false;size_t index=0;
  for(;index<program.functions.size();++index)if(program.functions[index].id==functionId)break;
  if(index==program.functions.size())return reject(error,"core-ir-value-llvm-function","selected FunctionId is absent from the complete verified Common Program");
  Lowering lowering(program,error,storage);if(!lowering.run(index))return false;
  mlir::DialectRegistry registry;registerDialect(registry);registry.insert<mlir::arith::ArithDialect,mlir::cf::ControlFlowDialect,mlir::func::FuncDialect,mlir::LLVM::LLVMDialect>();mlir::registerBuiltinDialectTranslation(registry);mlir::registerLLVMDialectTranslation(registry);mlir::MLIRContext context(registry);context.disableMultithreading();
  auto module=mlir::parseSourceString<mlir::ModuleOp>(lowering.text,&context);if(!module||mlir::failed(mlir::verify(*module)))return reject(error,"core-ir-value-llvm-mlir","generated fixed-value MLIR verification failed");
  mlir::LLVMTypeConverter converter(&context);mlir::RewritePatternSet patterns(&context);mlir::arith::populateArithToLLVMConversionPatterns(converter,patterns);mlir::cf::populateControlFlowToLLVMConversionPatterns(converter,patterns);mlir::populateFuncToLLVMConversionPatterns(converter,patterns);mlir::LLVMConversionTarget target(context);target.addLegalOp<mlir::ModuleOp>();
  if(mlir::failed(mlir::applyFullConversion(*module,target,std::move(patterns)))||mlir::failed(mlir::verify(*module)))return reject(error,"core-ir-value-llvm-conversion","official fixed-value generic conversion failed");
  FixedValueLLVM output;output.layouts=std::move(lowering.layouts);
  llvm::LLVMContext llvmContext;auto native=mlir::translateModuleToLLVMIR(*module,llvmContext,"tsfg.fixed-value");if(!native)return reject(error,"core-ir-value-llvm-export","official LLVM export failed");
  std::string original;llvm::raw_string_ostream originalStream(original);core.print(originalStream,mlir::OpPrintingFlags().printGenericOpForm());originalStream<<'\n';originalStream.flush();
  Array identities,closure;for(size_t i=0;i<program.functions.size();++i){const auto &fn=program.functions[i];identities.push_back(Object{{"index",int64_t(i)},{"id",fn.id},{"source",fn.path},{"start",fn.range.start},{"end",fn.range.end}});}for(const auto &[fn,blocks]:lowering.reachable)closure.push_back(program.functions[fn].id);
  const auto proof=canonical(Object{{"version",1},{"functionId",functionId.str()},{"inputIdentity",program.inputIdentity},{"hirDigest",program.hirHash},{"fullCore",original},{"functions",std::move(identities)},{"closure",std::move(closure)},{"layouts",output.layouts},{"initializedFields",std::move(lowering.initializedFields)},{"rootFrame","caller-admitted EventV4; embedding checks existing failure before entry and after return"},{"executionAuthority",false}});
  (*module)->setAttr("tsfg_program.fixed_value",mlir::StringAttr::get(&context,proof));
  if(mlir::failed(mlir::verify(*module)))return reject(error,"core-ir-value-llvm-mlir","fixed-value MLIR metadata verification failed");
  llvm::raw_string_ostream dialect(output.mlir);module->print(dialect,mlir::OpPrintingFlags().printGenericOpForm());dialect<<'\n';dialect.flush();
  native->getOrInsertNamedMetadata("tsfg.fixed.value")->addOperand(llvm::MDNode::get(llvmContext,{llvm::MDString::get(llvmContext,proof)}));if(llvm::verifyModule(*native,&llvm::errs()))return reject(error,"core-ir-value-llvm-verifier","official LLVM verifier rejected fixed-value IR");
  llvm::raw_string_ostream printed(output.llvm);native->print(printed,nullptr);printed.flush();if(output.llvm.size()>outputLimit||output.mlir.size()>outputLimit)return reject(error,"core-ir-value-llvm-budget","fixed-value output exceeds 8MiB");result=std::move(output);return true;
}
}
