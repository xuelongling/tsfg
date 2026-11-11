// SPDX-License-Identifier: MIT
#include "common-program-value-lowering.h"
#include "common-program-header.h"
#include "component-layout.h"
#include "aot-lowering.h"
#include "aot-float.h"
#include "dialect.h"
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
#include "llvm/IR/DataLayout.h"
#include "llvm/IR/DerivedTypes.h"
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
// retain the selected plane's identity. Each dynamic definition owns fresh
// frame storage until return, including definitions reached through backedges.
struct Lowering {
  struct Presence { bool tagged; unsigned i32Tag; };
  struct PlaneField { std::string id, sourceBinding, carrier; };
  struct StorageType { std::string mlir; llvm::Type *native; };
  struct Construction { const Operation *bind; uint16_t allocated, bound; };
  Program &program;Error &error;Json layouts=nullptr;Array initializedFields,actualLayouts,numericTraps;
  std::map<std::string,const Json *> declarations,bindings;
  std::map<std::string,Presence> presence;
  std::map<std::string,std::vector<PlaneField>> planes;
  const std::map<std::string,std::string> &singletonStorage;
  llvm::LLVMContext storageContext;
  llvm::DataLayout storageLayout{coreHeader::layout};
  std::map<std::string,StorageType> types;
  std::set<std::string> floatingFunctions;
  std::set<std::string> bottomTypes;
  std::map<std::string,size_t> functions;
  std::map<size_t,std::vector<uint16_t>> reachable;std::set<size_t> active;
  std::map<size_t,std::vector<uint16_t>> emittedBlocks;
  std::map<size_t,std::map<uint16_t,Construction>> constructions;
  std::string text;llvm::raw_string_ostream out;unsigned temporary=0,continuation=0;uint64_t interval=0;
  const Function *function=nullptr;size_t functionIndex=0;
  std::map<uint16_t,std::string> values;std::string sourcePath;SourceAnchor sourceRange;
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
  bool bottomType(const std::string &id)const{return bottomTypes.count(id)!=0;}
  bool hasReturnPayload(const std::string &id)const{return id!="void"&&!bottomType(id);}
  const Presence *presenceType(const std::string &id) const {
    const auto found=presence.find(id);
    return found==presence.end()?nullptr:&found->second;
  }
  bool undefinedOnly(const std::string &id) const {
    const auto *domain=presenceType(id);
    return domain&&!domain->tagged;
  }
  std::string bindingCarrier(const std::string &id) const {
    const auto found=bindings.find(id);
    return found==bindings.end()?std::string{}:string(field(*found->second,"carrier"));
  }
  uint8_t scalarCode(const std::string &id)const{
    const auto found=declarations.find(id);if(found==declarations.end()||string(field(*found->second,"kind"))!="scalar")return 0;
    const auto name=string(field(*found->second,"name"));for(uint8_t code=1;code<=13;++code)if(tsfg::scalarName(code)==name)return code;return 0;
  }
  std::string tmp(){return "%t"+std::to_string(temporary++);}
  // The full verifier already checked each binding against its independently
  // derived storage capacity. A present i32 initializer also fits the exact
  // i32/undefined capacity when a later valid store changes its actual tag.
  bool fullyInitialized(const std::string &id){
    if(planes.count(id))return true;if(!step())return false;
    const auto &decl=*declarations.at(id),&construction=field(decl,"construction");
    sourcePath=string(field(field(decl,"origin"),"sourcePath"));
    const auto &declRange=field(field(decl,"origin"),"range");sourceRange={uint32_t(field(declRange,"start").getAsInteger().value()),uint32_t(field(declRange,"end").getAsInteger().value())};
    const auto &fields=items(field(decl,"fields")),&order=items(field(construction,"initializationFields"));
    if(!need(field(decl,"base").getAsNull()&&string(field(construction,"kind"))=="implicit-base"&&field(construction,"functionId").getAsNull()&&field(construction,"implicitForward").getAsNull()&&fields.size()==order.size(),"fixed values require a complete implicit initialization plan"))return false;
    std::vector<PlaneField> plane;
    for(size_t i=0;i<fields.size();++i){
      const auto &row=fields[i],&initializer=field(row,"initializer");const auto fieldId=string(field(row,"id")),child=string(field(row,"type")),raw=string(field(row,"sourceBinding"));
      sourcePath=string(field(field(row,"origin"),"source"));sourceRange={uint32_t(field(field(row,"origin"),"start").getAsInteger().value()),uint32_t(field(field(row,"origin"),"end").getAsInteger().value())};
      const auto actual=singletonStorage.find(raw);const auto carrier=bindingCarrier(raw);const auto kind=string(field(initializer,"kind"));
      const bool scalar=declarations.count(child)&&string(field(*declarations.at(child),"kind"))=="scalar";
      const bool literal=scalar&&(kind=="numericLiteral"||kind=="booleanLiteral")&&string(field(initializer,"type"))==child;
      const bool nested=valueType(child)&&kind=="new"&&string(field(initializer,"type"))==child&&items(field(initializer,"arguments")).empty();
      const auto *domain=presenceType(carrier);
      const bool fixed=carrier==child&&actual!=singletonStorage.end()&&actual->second==child;
      const bool tagged=literal&&scalarCode(child)==1&&domain&&domain->tagged;
      if(!step()||!need(same(order[i],field(row,"id"))&&(literal||nested)&&(fixed||tagged),"field initialization or independently derived actual storage has no admitted fixed carrier"))return false;
      if(nested&&!fullyInitialized(child))return false;
      plane.push_back({fieldId,raw,carrier});
      initializedFields.push_back(Object{{"owner",id},{"field",fieldId},{"type",child},{"actualType",carrier},{"source",field(row,"origin")},{"initializer",initializer}});
    }
    planes.emplace(id,std::move(plane));
    return true;
  }
  std::string type(const std::string &id){
    if(types.count(id))return types.at(id).mlir;
    if(!step())return {};
    std::string result;
    llvm::Type *native=nullptr;
    Object record;
    if(const auto *domain=presenceType(id)){
      const auto name=domain->tagged?numericPresenceStruct:undefinedPresenceStruct;
      std::vector<llvm::Type *> elements;
      if(domain->tagged)elements={llvm::Type::getInt16Ty(storageContext),llvm::Type::getInt32Ty(storageContext)};
      auto *structure=llvm::StructType::create(storageContext,elements,name);
      native=structure;
      result="!llvm.struct<\""+name.str()+"\", ("+(domain->tagged?"i16, i32":"")+")>";
      record["structName"]=name;
      record["tagBytes"]=domain->tagged?2:0;
      if(domain->tagged){
        const auto *layout=storageLayout.getStructLayout(structure);
        if(!need(layout->getElementOffset(0)==0&&layout->getElementOffset(1)==4,"i32/undefined tag or payload offset differs"))return {};
        record["payloadOffset"]=4;
        record["i32Tag"]=domain->i32Tag;
        record["undefinedTag"]=1-domain->i32Tag;
      }
    }else if(const auto *plane=planes.count(id)?&planes.at(id):nullptr){
      std::vector<llvm::Type *> elements;
      result="!llvm.struct<(";
      for(const auto &member:*plane){
        if(!step())return {};
        const auto child=type(member.carrier);
        if(child.empty())return {};
        if(!elements.empty())result+=", ";
        result+=child;
        elements.push_back(types.at(member.carrier).native);
      }
      result+=")>";
      auto *structure=llvm::StructType::get(storageContext,elements);
      native=structure;
      const auto *layout=storageLayout.getStructLayout(structure);
      const auto &verified=program.layouts.at(id);
      if(!need(verified.fieldOffsets.size()==plane->size(),"actual field layout count differs"))return {};
      Array fields;
      for(size_t i=0;i<plane->size();++i){
        if(!step()||!need(layout->getElementOffset(i)==verified.fieldOffsets[i],"actual field layout offset differs"))return {};
        fields.push_back(Object{{"id",(*plane)[i].id},{"sourceBinding",(*plane)[i].sourceBinding},
          {"carrier",(*plane)[i].carrier},{"offset",verified.fieldOffsets[i]}});
      }
      record["fields"]=std::move(fields);
    }else if(scalarCode(id)){
      const auto name=string(field(*declarations.at(id),"name"));
      if(name=="f32"||name=="f64"){
        result=name;
        native=name=="f32"?llvm::Type::getFloatTy(storageContext):llvm::Type::getDoubleTy(storageContext);
      }else{
        const auto bits=8*program.layouts.at(id).byteSize;
        result="i"+std::to_string(bits);
        native=llvm::Type::getIntNTy(storageContext,bits);
      }
    }else{
      need(false,"carrier is outside the admitted fixed scalar, value or i32/undefined storage");
      return {};
    }
    const auto &verified=program.layouts.at(id);
    if(!need(verified.referenceCount==0&&storageLayout.getTypeAllocSize(native)==verified.byteSize&&
      storageLayout.getABITypeAlign(native).value()==verified.alignment,"LLVM storage size, alignment or GC roots differ from the verified layout"))return {};
    if(!record.empty()){
      record["id"]=id;
      record["byteSize"]=verified.byteSize;
      record["alignment"]=verified.alignment;
      actualLayouts.push_back(std::move(record));
    }
    types.emplace(id,StorageType{result,native});
    return result;
  }
  std::string registerType(const std::string &id){return valueType(id)||llvm::StringRef(id).starts_with("cell:")?"!llvm.ptr":type(id);}
  void locate(size_t fn,uint16_t block,size_t ordinal){
    sourceRange=program.functions[fn].blocks[block].operations[ordinal].range;
    sourcePath=program.operationSources.at(program.functions[fn].id).at({block,uint16_t(ordinal)});
  }
  static bool constructionToken(const Operation &op){
    return op.name=="receiver_create"||op.name=="initialize_begin"||op.name=="initialize_field";
  }
  bool construction(size_t index,uint16_t block,size_t ordinal){
    const auto &fn=program.functions[index];
    const auto &ops=fn.blocks[block].operations;
    const auto &op=ops[ordinal];
    const auto owner=string(field(op.properties,"owner"));
    if(!need(valueType(owner),"implicit construction requires an owned fixed value"))return false;
    auto &sites=constructions[index];
    if(op.name=="receiver_create"){
      // A fresh local frame is allocated and bound before control leaves its
      // defining block. The complete Core verifier already checks newTarget,
      // normal edge ownership and the linear initializer token.
      if(!need(ops.size()-ordinal==3,"fixed construction requires fresh allocation and binding in its defining block"))return false;
      const auto &allocate=ops[ordinal+1],&bind=ops[ordinal+2];
      if(!need(allocate.name=="receiver_allocate"&&allocate.operands[0]==op.result&&bind.name=="receiver_bind"&&
        bind.operands[0]==op.result&&bind.operands[1]==allocate.result,"fixed construction allocation and binding must use the same fresh frame"))return false;
      const auto bound=fn.blocks[bind.successors[0]].parameters[0];
      if(!need(fn.carriers[bound]==owner,"fixed construction binding requires its exact owned carrier"))return false;
      sites.emplace(op.result,Construction{&bind,allocate.result,bound});
      return true;
    }
    if(op.name=="initialize_field"||op.name=="initialize_end")return true;
    const auto found=sites.find(op.operands[0]);
    if(!need(found!=sites.end(),"fixed construction action requires a verified fresh local frame"))return false;
    const auto &site=found->second;
    if(op.name=="receiver_allocate")return need(op.result==site.allocated,"fixed construction frame has a second allocation");
    if(op.name=="receiver_bind")return need(&op==site.bind,"fixed construction frame has a second binding");
    if(op.name=="initialize_begin")return need(op.operands[1]==site.bound,"fixed initialization must use the bound receiver");
    const auto result=fn.blocks[op.successors[0]].parameters[0];
    return need(op.operands.size()==1&&ordinal>0&&ops[ordinal-1].name=="initialize_end"&&
      ops[ordinal-1].operands[1]==site.bound&&fn.carriers[result]==owner,
      "fixed construction must complete initialization before returning the bound receiver");
  }
  bool closure(size_t index){
    if(reachable.count(index))return true;const auto &selected=program.functions[index];sourcePath=selected.path;sourceRange=selected.range;
    if(!step())return false;
    // An active call target already has an owning traversal. That traversal
    // still validates its remaining CFG before any complete closure is emitted.
    if(!active.insert(index).second)return true;
    std::vector<uint16_t> order;std::vector<uint8_t> state(selected.blocks.size());
    std::function<bool(uint16_t)> visit=[&](uint16_t block){
      if(state[block])return true;if(!step())return false;
      state[block]=1;order.push_back(block);
      for(size_t ordinal=0;ordinal<selected.blocks[block].operations.size();++ordinal){
        locate(index,block,ordinal);const auto &op=selected.blocks[block].operations[ordinal];if(!step())return false;
        if(op.name=="invoke"){
          const auto id=string(field(op.properties,"function_id"));
          const auto target=functions.find(id);
          if(!need(target!=functions.end(),"direct fixed callee is absent from the verified inventory"))return false;
          const auto &callee=program.functions[target->second];
          const size_t arity=callee.resultCarrier=="void"?0:1;
          if(!need(selected.blocks[op.successors[0]].parameters.size()==arity,"direct fixed callee normal continuation differs from its verified result")||!closure(target->second))return false;
          locate(index,block,ordinal);if(!visit(op.successors[0]))return false;
        }else if(constructionToken(op)||op.name=="receiver_allocate"||op.name=="receiver_bind"||
                 op.name=="initialize_end"||op.name=="receiver_result"){
          if(!construction(index,block,ordinal))return false;
          if(!op.successors.empty()&&!visit(op.successors[0]))return false;
        }else{
          static const std::set<std::string> supported={"fuel","cell","store","load","value_copy","view","assert","carrier_cast","field_load","field_store","constant","floating","boolean","undefined","strict_equal","numeric_use","binary","unary","func.return","cf.br","cf.cond_br"};
          if(!need(supported.count(op.name),"operation in the selected closure has no fixed-value lowering"))return false;
          if(op.name=="cf.cond_br"&&!need(selected.blocks[op.successors[0]].parameters.empty()&&selected.blocks[op.successors[1]].parameters.empty(),"conditional fixed-value edges require their Source-normalized empty successors"))return false;
          for(auto successor:op.successors)if(!visit(successor))return false;
        }
      }state[block]=2;return true;
    };
    if(!visit(0))return false;active.erase(index);reachable.emplace(index,std::move(order));return true;
  }
  bool emissionCFG(size_t index){
    const auto &selected=program.functions[index];std::vector<uint16_t> order;std::set<uint16_t> seen;
    std::function<bool(uint16_t)> visit=[&](uint16_t block){
      if(!seen.insert(block).second)return true;if(!step())return false;order.push_back(block);
      for(const auto &op:selected.blocks[block].operations){
        if(!step())return false;
        if(op.name=="invoke"){
          if(!bottomType(program.functions[functions.at(string(field(op.properties,"function_id")))].resultCarrier)&&!visit(op.successors[0]))return false;
        }else if(op.name=="receiver_bind"||op.name=="receiver_result"){
          if(!visit(op.successors[0]))return false;
        }else if(op.name!="numeric_use"||!undefinedOnly(selected.carriers[op.operands[0]])){
          for(auto successor:op.successors)if(!visit(successor))return false;
        }
      }return true;
    };
    if(!visit(0))return false;emittedBlocks.emplace(index,std::move(order));return true;
  }
  std::string constant(uint64_t value,llvm::StringRef native="i32"){
    const auto name=tmp();out<<"    "<<name<<" = arith.constant "<<value<<" : "<<native<<'\n';return name;
  }
  std::string allocate(const std::string &element,const std::string &name={}){
    const auto one=constant(1,"i64"),result=name.empty()?tmp():name;
    out<<"    "<<result<<" = llvm.alloca "<<one<<" x "<<element<<" : (i64) -> !llvm.ptr\n";return result;
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
  void guard(const std::string &valid,unsigned trap){
    const auto good="next"+std::to_string(continuation++),bad="trap"+std::to_string(continuation++);
    out<<"    cf.cond_br "<<valid<<", ^"<<good<<", ^"<<bad<<"\n  ^"<<bad<<":\n";
    callback(trap,sourceRange,functionIndex);out<<"    cf.br ^failed\n  ^"<<good<<":\n";
  }
  bool arithmetic(llvm::StringRef name,const std::string &id,const std::string &resultType,const std::string &result,const std::vector<std::string> &operands){
    const auto code=scalarCode(id);if(!need(code!=0,"arithmetic requires an owned scalar identity"))return false;
    tsfg::ScalarArithmeticEmitter emitter{out,temporary,floatingFunctions,[&](const std::string &valid,unsigned trap){guard(valid,trap);}};
    return need(emitter.emit(name,code,type(id),resultType,result,operands),"verified scalar operation has no shared arithmetic lowering");
  }
  std::string zero(const std::string &id){
    const auto native=type(id),result=tmp();
    if(valueType(id)||presenceType(id))out<<"    "<<result<<" = llvm.mlir.zero : "<<native<<'\n';
    else out<<"    "<<result<<" = arith.constant "<<(native=="f32"||native=="f64"?"0.0":"0")<<" : "<<native<<'\n';return result;
  }
  std::string extract(const std::string &value,const std::string &id,unsigned member){
    const auto result=tmp();
    out<<"    "<<result<<" = llvm.extractvalue "<<value<<"["<<member<<"] : "<<type(id)<<'\n';
    return result;
  }
  std::string insert(const std::string &aggregate,const std::string &value,const std::string &id,unsigned member){
    const auto result=tmp();
    out<<"    "<<result<<" = llvm.insertvalue "<<value<<", "<<aggregate<<"["<<member<<"] : "<<type(id)<<'\n';
    return result;
  }
  std::string adapt(const std::string &value,const std::string &from,const std::string &to){
    if(from==to)return value;
    const auto *target=presenceType(to);
    if(target&&target->tagged&&(scalarCode(from)==1||undefinedOnly(from))){
      const bool present=scalarCode(from)==1;
      const auto empty=zero(to),tag=constant(present?target->i32Tag:1-target->i32Tag,"i16");
      const auto tagged=insert(empty,tag,to,0);
      return present?insert(tagged,value,to,1):tagged;
    }
    need(false,"fixed carrier adapter requires identity or exact singleton embedding");
    return {};
  }
  std::string load(const std::string &pointer,const std::string &id){const auto result=tmp();out<<"    "<<result<<" = llvm.load "<<pointer<<" : !llvm.ptr -> "<<type(id)<<'\n';return result;}
  std::string fieldPointer(const std::string &pointer,const std::string &id,size_t index){
    const auto result=tmp();out<<"    "<<result<<" = llvm.getelementptr "<<pointer<<"[0, "<<index<<"] : (!llvm.ptr) -> !llvm.ptr, "<<type(id)<<'\n';return result;
  }
  std::string equal(const std::string &left,const std::string &right,const std::string &id){
    if(!step())return {};
    if(valueType(id)){
      auto result=constant(1,"i1");const auto &fields=planes.at(id);
      for(size_t i=0;i<fields.size();++i){
        const auto &child=fields[i].carrier;
        const auto a=fieldPointer(left,id,i),b=fieldPointer(right,id,i);
        const auto same=equal(valueType(child)?a:load(a,child),valueType(child)?b:load(b,child),child),joined=tmp();if(same.empty())return {};
        out<<"    "<<joined<<" = arith.andi "<<result<<", "<<same<<" : i1\n";result=joined;
      }return result;
    }
    if(const auto *domain=presenceType(id)){
      if(!domain->tagged)return constant(1,"i1");
      const auto leftTag=extract(left,id,0),rightTag=extract(right,id,0);
      const auto leftBits=extract(left,id,1),rightBits=extract(right,id,1);
      const auto undefined=constant(1-domain->i32Tag,"i16"),sameTag=tmp(),absent=tmp(),sameBits=tmp(),compatible=tmp(),result=tmp();
      out<<"    "<<sameTag<<" = arith.cmpi eq, "<<leftTag<<", "<<rightTag<<" : i16\n"
         <<"    "<<absent<<" = arith.cmpi eq, "<<leftTag<<", "<<undefined<<" : i16\n"
         <<"    "<<sameBits<<" = arith.cmpi eq, "<<leftBits<<", "<<rightBits<<" : i32\n"
         <<"    "<<compatible<<" = arith.ori "<<absent<<", "<<sameBits<<" : i1\n"
         <<"    "<<result<<" = arith.andi "<<sameTag<<", "<<compatible<<" : i1\n";
      return result;
    }
    const auto result=tmp();if(!arithmetic("eq",id,"i1",result,{left,right}))return {};return result;
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
    const auto result=op.result==noRegister||constructionToken(op)?std::string():values.at(op.result);
    if(op.name=="receiver_create"||op.name=="initialize_begin"||op.name=="initialize_end"){
      // The checked frame and initializer cursor have no physical value.
    }else if(op.name=="receiver_allocate"){
      allocate(type(carrier(op.result)),result);
    }else if(op.name=="receiver_bind"||op.name=="receiver_result"){
      const auto &site=constructions.at(functionIndex).at(op.operands[0]);
      const auto selected=op.name=="receiver_bind"?site.allocated:site.bound;
      out<<"    cf.br ";edge(op.successors[0],{values.at(selected)});out<<'\n';
    }else if(op.name=="cell"||op.name=="store"||op.name=="load"){
      const auto cell=bindingCarrier(string(field(op.properties,"binding")));
      const auto native=registerType(cell);
      if(native.empty())return false;
      if(op.name=="cell")allocate(native,result);
      else if(op.name=="store"){
        if(!need(cell==carrier(op.operands[1]),"cell store differs from its verified carrier"))return false;
        out<<"    llvm.store "<<operand(1)<<", "<<operand(0)<<" : "<<native<<", !llvm.ptr\n";
      }else{
        if(!need(cell==carrier(op.result),"cell load differs from its verified carrier"))return false;
        out<<"    "<<result<<" = llvm.load "<<operand(0)<<" : !llvm.ptr -> "<<native<<'\n';
      }
    }else if(op.name=="value_copy"||op.name=="view"||op.name=="assert"||op.name=="carrier_cast"){
      const auto &from=carrier(op.operands[0]),&to=carrier(op.result);
      if(from==to&&valueType(to)&&op.name=="value_copy"){
        const auto copied=load(operand(0),to),pointer=allocate(type(to),result);
        out<<"    llvm.store "<<copied<<", "<<pointer<<" : "<<type(to)<<", !llvm.ptr\n";
      }else{
        const auto adjusted=adapt(operand(0),from,to);
        if(adjusted.empty())return false;
        values[op.result]=adjusted;
      }
    }else if(op.name=="field_load"||op.name=="field_store"||op.name=="initialize_field"){
      const size_t receiver=op.name=="initialize_field"?1:0;
      const auto owner=carrier(op.operands[receiver]),selected=string(field(op.properties,"field"));if(!need(planes.count(owner),"field receiver has no fixed-value layout"))return false;
      const auto &fields=planes.at(owner);size_t index=0;
      for(;index<fields.size();++index){if(!step())return false;if(fields[index].id==selected)break;}
      if(!need(index<fields.size(),"field identity differs from the fixed-value layout"))return false;
      const auto &child=fields[index].carrier;
      const auto pointer=fieldPointer(operand(receiver),owner,index);
      if(op.name=="field_load"){
        if(!need(child==carrier(op.result),"field result differs from its verified carrier"))return false;
        if(valueType(child))values[op.result]=pointer;else out<<"    "<<result<<" = llvm.load "<<pointer<<" : !llvm.ptr -> "<<type(child)<<'\n';
      }else{
        if(!need(child==carrier(op.operands[receiver+1]),"field store differs from its verified carrier"))return false;
        const auto &input=operand(receiver+1);
        const auto stored=valueType(child)?load(input,child):input;out<<"    llvm.store "<<stored<<", "<<pointer<<" : "<<type(child)<<", !llvm.ptr\n";
      }
    }else if(op.name=="undefined"){
      if(!need(undefinedOnly(carrier(op.result)),"undefined literal lacks its exact absence carrier"))return false;
      values[op.result]=zero(carrier(op.result));
    }else if(op.name=="floating"){
      const auto native=type(carrier(op.result));const std::string integer=native=="f32"?"i32":"i64";
      const auto bits=llvm::APInt(native=="f32"?32:64,string(field(op.properties,"bits")),16);const auto raw=tmp();
      out<<"    "<<raw<<" = arith.constant "<<bits.getSExtValue()<<" : "<<integer<<"\n    "<<result<<" = arith.bitcast "<<raw<<" : "<<integer<<" to "<<native<<'\n';
    }else if(op.name=="constant"||op.name=="boolean"){
      const auto native=type(carrier(op.result));unsigned width=0;if(!need(!llvm::StringRef(native).drop_front().getAsInteger(10,width),"constant requires a fixed integer carrier"))return false;
      const auto bits=op.name=="boolean"?uint64_t(field(op.properties,"value").getAsBoolean()==true):llvm::APInt(width,string(field(op.properties,"decimal")),10).getZExtValue();
      out<<"    "<<result<<" = arith.constant "<<bits<<" : "<<native<<'\n';
    }else if(op.name=="numeric_use"){
      const auto id=carrier(op.operands[0]);
      const auto *domain=presenceType(id);
      if(!need(scalarCode(id)==1||domain,"numeric consumption requires an admitted actual i32/undefined carrier"))return false;
      auto payload=operand(0);
      if(domain){
        const auto kind=static_cast<unsigned>(FixedValueEvent::UndefinedNumericUse);
        if(domain->tagged){
          const auto tag=extract(payload,id,0),i32=constant(domain->i32Tag,"i16"),present=tmp();
          out<<"    "<<present<<" = arith.cmpi eq, "<<tag<<", "<<i32<<" : i16\n";
          guard(present,kind);
          payload=extract(payload,id,1);
        }else{
          callback(kind,op.range,functionIndex);
          out<<"    cf.br ^failed\n";
        }
        numericTraps.push_back(Object{{"kind",kind},{"functionId",function->id},{"source",sourcePath},
          {"start",op.range.start},{"end",op.range.end},{"operator",field(op.properties,"operator")},
          {"operandIndex",field(op.properties,"index")},{"interval",int64_t(interval)},
          {"trap",undefinedNumericTrap},{"rule",undefinedNumericRule}});
      }
      if(!domain||domain->tagged){out<<"    cf.br ";edge(op.successors[0],{payload});out<<'\n';}
    }else if(op.name=="binary"||op.name=="unary"){
      const auto token=string(field(op.properties,"operator"));
      static const std::map<std::string,std::string> binary={{"+","add"},{"-","sub"},{"*","mul"},{"/","div"},{"%","rem"},{"<<","shl"},{">>","shr"},{">>>","ushr"},{"&","and"},{"|","or"},{"^","xor"},{"<","lt"},{"<=","le"},{">","gt"},{">=","ge"}};
      static const std::map<std::string,std::string> unary={{"+","pos"},{"-","neg"},{"~","not"},{"!","bool_not"}};
      const auto &operators=op.name=="binary"?binary:unary;const auto found=operators.find(token);
      if(!need(found!=operators.end(),"verified scalar operator has no arithmetic mapping"))return false;
      std::vector<std::string> operands;for(auto reg:op.operands)operands.push_back(values.at(reg));
      if(!arithmetic(found->second,carrier(op.operands[0]),type(carrier(op.result)),result,operands))return false;
    }else if(op.name=="strict_equal"){
      if(!need(carrier(op.operands[0])==carrier(op.operands[1]),"fixed equality requires the same owned semantic type"))return false;
      auto comparison=equal(operand(0),operand(1),carrier(op.operands[0]));if(comparison.empty())return false;
      if(string(field(op.properties,"operator"))=="!=="){const auto one=constant(1,"i1"),opposite=tmp();out<<"    "<<opposite<<" = arith.xori "<<comparison<<", "<<one<<" : i1\n";comparison=opposite;}
      out<<"    "<<result<<" = arith.extui "<<comparison<<" : i1 to "<<type(carrier(op.result))<<'\n';
    }else if(op.name=="invoke"){
      const auto target=functions.at(string(field(op.properties,"function_id")));const auto &callee=program.functions[target];allow(callback(0,callee.range,target));std::vector<std::string> arguments;
      for(auto reg:op.operands)arguments.push_back(valueType(carrier(reg))?load(values.at(reg),carrier(reg)):values.at(reg));
      const bool payload=hasReturnPayload(callee.resultCarrier);
      const auto returned=payload?tmp():std::string{};
      out<<"    ";if(payload)out<<returned<<" = ";out<<"func.call @value_"<<callee.id.substr(7)<<"(%state, %event";for(const auto &argument:arguments)out<<", "<<argument;
      out<<") : (!llvm.ptr, !llvm.ptr";for(auto reg:op.operands)out<<", "<<type(carrier(reg));out<<") -> "<<(payload?type(callee.resultCarrier):"()")<<'\n';checkpoint(2,op.range);
      if(bottomType(callee.resultCarrier))out<<"    cf.br ^failed\n";
      else{
        std::vector<std::string> results;
        if(payload){
          auto value=returned;
          if(valueType(callee.resultCarrier)){value=allocate(type(callee.resultCarrier));out<<"    llvm.store "<<returned<<", "<<value<<" : "<<type(callee.resultCarrier)<<", !llvm.ptr\n";}
          results.push_back(std::move(value));
        }
        out<<"    cf.br ";edge(op.successors[0],results);out<<'\n';
      }
    }else if(op.name=="cf.br"){
      std::vector<std::string> arguments;for(auto reg:op.operands)arguments.push_back(values.at(reg));out<<"    cf.br ";edge(op.successors[0],arguments);out<<'\n';
    }else if(op.name=="cf.cond_br"){
      const auto zero=constant(0,type(carrier(op.operands[0]))),condition=tmp();out<<"    "<<condition<<" = arith.cmpi ne, "<<operand(0)<<", "<<zero<<" : "<<type(carrier(op.operands[0]))<<"\n    cf.cond_br "<<condition<<", ";edge(op.successors[0],{});out<<", ";edge(op.successors[1],{});out<<'\n';
    }else if(op.name=="func.return"){
      if(!need(!bottomType(function->resultCarrier),"bottom normal result has no physically inhabited return"))return false;
      callback(4,op.range,functionIndex);callback(3,op.range,functionIndex);
      if(function->resultCarrier=="void")out<<"    func.return\n";
      else{const auto returned=valueType(function->resultCarrier)?load(operand(0),function->resultCarrier):operand(0);out<<"    func.return "<<returned<<" : "<<type(function->resultCarrier)<<'\n';}
    }
    return text.size()<=outputLimit||reject(error,"core-ir-value-llvm-budget","fixed-value IR byte limit exceeded");
  }
  bool emit(size_t index){
    function=&program.functions[index];functionIndex=index;values.clear();const auto &selected=*function;sourcePath=selected.path;sourceRange=selected.range;
    const bool payload=hasReturnPayload(selected.resultCarrier);const auto returned=payload?type(selected.resultCarrier):"()";if(returned.empty())return false;std::set<uint16_t> retained;
    for(auto block:emittedBlocks.at(index)){for(auto reg:selected.blocks[block].parameters)retained.insert(reg);for(const auto &op:selected.blocks[block].operations)if(op.result!=noRegister&&!constructionToken(op))retained.insert(op.result);}
    for(auto reg:retained){if(registerType(selected.carriers[reg]).empty())return false;values.emplace(reg,"%r"+std::to_string(reg));}
    out<<"  func.func private @value_"<<selected.id.substr(7)<<"(%state: !llvm.ptr, %event: !llvm.ptr";for(auto reg:selected.blocks[0].parameters)out<<", %arg"<<reg<<": "<<type(selected.carriers[reg]);out<<") -> "<<returned<<" {\n";
    const auto frame=constant(index,"i64"),shadow=constant(0);out<<"    llvm.call_intrinsic \"llvm.experimental.stackmap\"("<<frame<<", "<<shadow<<") : (i64, i32) -> ()\n";
    for(auto reg:selected.blocks[0].parameters){
      if(valueType(selected.carriers[reg])){const auto slot=allocate(type(selected.carriers[reg]));out<<"    llvm.store %arg"<<reg<<", "<<slot<<" : "<<type(selected.carriers[reg])<<", !llvm.ptr\n";values[reg]=slot;}else values[reg]="%arg"+std::to_string(reg);
    }out<<"    cf.br ^b0\n";
    for(auto block:emittedBlocks.at(index)){
      out<<"  ^b"<<block;if(block&&!selected.blocks[block].parameters.empty()){out<<'(';bool first=true;for(auto reg:selected.blocks[block].parameters){if(!first)out<<", ";first=false;out<<values.at(reg)<<": "<<registerType(selected.carriers[reg]);}out<<')';}out<<":\n";
      for(size_t ordinal=0;ordinal<selected.blocks[block].operations.size();++ordinal){locate(index,block,ordinal);if(!operation(selected.blocks[block].operations[ordinal]))return false;}
    }
    out<<"  ^failed:\n";callback(3,selected.range,index);if(!payload)out<<"    func.return\n";else{const auto failed=zero(selected.resultCarrier);out<<"    func.return "<<failed<<" : "<<returned<<'\n';}out<<"  }\n";return true;
  }
  bool run(size_t index){
    const auto undefined=digest(std::string("tsfg.type")+std::string(1,'\0')+"undefined");
    for(const auto &row:items(field(program.representation,"domains"))){
      if(!step())return false;
      const auto id=string(field(row,"id")),representation=string(field(row,"representation"));
      const auto &members=items(field(row,"actualTypes"));
      if(representation=="bottom"&&members.empty())bottomTypes.insert(id);
      else if(representation=="absence"&&members.size()==1&&string(members[0])==undefined)presence.emplace(id,Presence{false,0});
      else if(representation=="finite-union"&&members.size()==2){
        if(scalarCode(string(members[0]))==1&&string(members[1])==undefined)presence.emplace(id,Presence{true,0});
        if(string(members[0])==undefined&&scalarCode(string(members[1]))==1)presence.emplace(id,Presence{true,1});
      }
    }
    if(!closure(index))return false;for(const auto &[fn,blocks]:reachable)if(!emissionCFG(fn))return false;std::vector<std::string> roots;
    for(const auto &[fn,blocks]:reachable)for(auto block:blocks){const auto &selected=program.functions[fn];if(valueType(selected.resultCarrier))roots.push_back(selected.resultCarrier);for(auto reg:selected.blocks[block].parameters)if(valueType(selected.carriers[reg]))roots.push_back(selected.carriers[reg]);for(const auto &op:selected.blocks[block].operations){if(valueType(op.view))roots.push_back(op.view);if(op.result!=noRegister&&valueType(selected.carriers[op.result]))roots.push_back(selected.carriers[op.result]);}}
    std::sort(roots.begin(),roots.end());roots.erase(std::unique(roots.begin(),roots.end()),roots.end());
    if(!need(!roots.empty(),"selected closure has no fixed-value carrier")||!fixedValueLayoutCatalog(program,roots,layouts,error))return false;
    for(const auto &id:roots)if(!fullyInitialized(id)||type(id).empty())return false;
    out<<"module attributes {llvm.data_layout = \""<<coreHeader::layout<<"\", llvm.target_triple = \""<<coreHeader::triple<<"\"} {\n";for(const auto &[fn,blocks]:reachable)if(!emit(fn))return false;tsfg::declareScalarArithmetic(out,floatingFunctions);out<<"}\n";return true;
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
  std::vector<llvm::Function *> floatingFrames;for(const auto &[fn,blocks]:lowering.reachable)floatingFrames.push_back(native->getFunction("value_"+program.functions[fn].id.substr(7)));
  tsfg::materializeNativeFloating(*native,floatingFrames);
  std::string original;llvm::raw_string_ostream originalStream(original);core.print(originalStream,mlir::OpPrintingFlags().printGenericOpForm());originalStream<<'\n';originalStream.flush();
  Array identities,closure,finalizerFunctions,physicalCFG;for(size_t i=0;i<program.functions.size();++i){const auto &fn=program.functions[i];identities.push_back(Object{{"index",int64_t(i)},{"id",fn.id},{"source",fn.path},{"start",fn.range.start},{"end",fn.range.end}});}for(const auto &[fn,blocks]:lowering.reachable){closure.push_back(program.functions[fn].id);finalizerFunctions.push_back("value_"+program.functions[fn].id.substr(7));Array emitted;for(auto block:lowering.emittedBlocks.at(fn))emitted.push_back(int64_t(block));physicalCFG.push_back(Object{{"functionId",program.functions[fn].id},{"resultCarrier",program.functions[fn].resultCarrier},{"emptyNormalResult",lowering.bottomType(program.functions[fn].resultCarrier)},{"blocks",std::move(emitted)}});}
  const Json stages=Object{{"mlir","converted-intermediate"},{"llvm","finalized"},{"requiresPostExportFinalization",true},{"finalizer","tsfg::materializeNativeFloating"},{"selection","exact-closure"},{"functions",std::move(finalizerFunctions)}};
  const auto proof=canonical(Object{{"version",1},{"functionId",functionId.str()},{"inputIdentity",program.inputIdentity},{"hirDigest",program.hirHash},{"fullCore",original},{"functions",std::move(identities)},{"closure",std::move(closure)},{"physicalCFG",std::move(physicalCFG)},{"irStages",stages},{"layouts",output.layouts},{"actualLayouts",std::move(lowering.actualLayouts)},{"numericTraps",std::move(lowering.numericTraps)},{"initializedFields",std::move(lowering.initializedFields)},{"rootFrame","caller-admitted EventV4; embedding checks existing failure before entry and after return"},{"storageLifetime","entry value parameters once; cells, value copies and aggregate call results fresh at each dynamic definition; storage remains live until function return"},{"resourceProof",nullptr},{"executionAuthority",false}});
  (*module)->setAttr("tsfg_program.fixed_value",mlir::StringAttr::get(&context,proof));
  if(mlir::failed(mlir::verify(*module)))return reject(error,"core-ir-value-llvm-mlir","fixed-value MLIR metadata verification failed");
  llvm::raw_string_ostream dialect(output.mlir);module->print(dialect,mlir::OpPrintingFlags().printGenericOpForm());dialect<<'\n';dialect.flush();
  native->getOrInsertNamedMetadata("tsfg.fixed.value")->addOperand(llvm::MDNode::get(llvmContext,{llvm::MDString::get(llvmContext,proof)}));if(llvm::verifyModule(*native,&llvm::errs()))return reject(error,"core-ir-value-llvm-verifier","official LLVM verifier rejected fixed-value IR");
  llvm::raw_string_ostream printed(output.llvm);native->print(printed,nullptr);printed.flush();if(output.llvm.size()>outputLimit||output.mlir.size()>outputLimit)return reject(error,"core-ir-value-llvm-budget","fixed-value output exceeds 8MiB");result=std::move(output);return true;
}
}
