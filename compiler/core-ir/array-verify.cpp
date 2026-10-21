// SPDX-License-Identifier: MIT
#include "array-core.h"
#include "dialect.h"
#include "mlir/IR/Builders.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include <map>
#include <algorithm>
#include "llvm/ADT/STLExtras.h"
namespace tsfg::arrays {
namespace {
bool operation(mlir::Operation *value, llvm::StringRef name, unsigned operands, unsigned results) {
  return value->getName().getStringRef()==name && value->getNumOperands()==operands && value->getNumResults()==results
      && !value->getNumRegions() && !value->getNumSuccessors();
}
mlir::LogicalResult constant(mlir::Operation *value, bool integer, bool length, Range &anchor, uint64_t &bits) {
  if (!operation(value,"tsfg_core.constant",0,1)) return reject("core-ir-array-shape","expected scalar constant");
  if (!attributes(value,{"value","tsfg_source.start","tsfg_source.end"})) return reject("core-ir-array-metadata","constant fields differ");
  if (tsfg::typeCode(value->getResult(0).getType())!=(integer ? 8 : 13) || !tsfg::constantBits(value,bits) ||
      (integer ? bits>(length ? UINT64_C(4294967295) : UINT64_C(4294967294))
        : (bits & UINT64_C(0x7ff0000000000000))==UINT64_C(0x7ff0000000000000)))
    return reject("core-ir-array-type","constant type/bits/domain differs");
  if (!range(value,anchor)) return reject("core-ir-array-source","constant range differs");
  return mlir::success();
}
mlir::LogicalResult local(mlir::Operation *value, const Function &function, Metadata &metadata,
                          uint32_t previous, Range initializer, Range &statement, std::string &identity,
                          std::set<std::string> &names) {
  auto data = value->getAttrOfType<mlir::DictionaryAttr>("local");
  if (!fields(data, {"id", "name", "statement_range", "declaration_range", "name_range", "annotation_range", "element_annotation_range"}))
    return reject("core-ir-array-metadata", "local fields differ");
  auto name = text(data, "name");
  if (name.size() > 1048576) return reject("core-ir-array-budget", "local name exceeds limit");
  if (!validText(name) || !names.insert(name.str()).second) return reject("core-ir-array-identity", "invalid/duplicate local name");
  Range declaration, nameRange, annotation, elementAnnotation;
  if (!span(data.get("statement_range"), statement) || !span(data.get("declaration_range"), declaration) ||
      !span(data.get("name_range"), nameRange) || !span(data.get("annotation_range"), annotation, true) ||
      !span(data.get("element_annotation_range"), elementAnnotation, true) ||
      !encloses(function.declaration, statement) || statement.start < previous || statement.end >= function.declaration.end ||
      statement.start >= declaration.start || declaration.start != nameRange.start ||
      !encloses(statement, declaration) || !encloses(declaration, nameRange) ||
      !encloses(declaration, initializer) || initializer.end != declaration.end || nameRange.end >= initializer.start ||
      (annotation.end == 0) != (elementAnnotation.end == 0) ||
      (annotation.end && (!encloses(declaration, annotation) || !encloses(annotation, elementAnnotation) ||
          annotation.start < nameRange.end || annotation.end >= initializer.start)) ||
      (value->getName().getStringRef() == "tsfg_array.create" && annotation.end == 0))
    return reject("core-ir-array-source", "local source ranges differ");
  identity = sourceIdentity(metadata.path, nameRange);
  if (text(data, "id") != identity || !metadata.bindings.insert(identity).second)
    return reject("core-ir-array-identity", "local binding identity differs");
  return mlir::success();
}
bool viewAnnotation(mlir::Operation *value) {
  auto data=value->getAttrOfType<mlir::DictionaryAttr>("local"); Range annotation,element;
  return data && span(data.get("annotation_range"),annotation,true) && span(data.get("element_annotation_range"),element,true)
      && (annotation.end==0)==(element.end==0)
      && (!annotation.end || (element.start>annotation.start && element.end<annotation.end));
}
struct Scalar { mlir::Value value; Range anchor; int64_t literal=-1; };
class Body {
  const Function &function; Metadata &metadata; size_t &totalElements;
  mlir::func::FuncOp fn; std::vector<mlir::Operation *> ops;
  std::map<std::string,mlir::Value> definitions,parameters;
  std::map<std::string,std::string> owners;
  std::map<std::string,int64_t> lengths;
  std::set<std::string> names,parameterOwners;
  size_t position=1,locals=0,mutations=0,statements=0,registers=0,calls=0;
  uint32_t previous=0;
  mlir::LogicalResult receiver(mlir::DictionaryAttr data, Range parent, mlir::Value &result, Range &anchor, std::string &binding) {
    binding=text(data,"receiver_binding").str(); auto found=definitions.find(binding);
    if (found==definitions.end()) return reject("core-ir-array-identity","receiver binding absent");
    if (!span(data.get("receiver_range"),anchor) || !encloses(parent,anchor))
      return reject("core-ir-array-source","receiver range differs");
    result=found->second; return mlir::success();
  }
  mlir::LogicalResult scalar(mlir::Attribute attribute, unsigned type, bool length, Scalar &result) {
    auto data=llvm::dyn_cast_or_null<mlir::DictionaryAttr>(attribute);
    if (!fields(data,{"kind","binding","type_id","range"})) return reject("core-ir-array-metadata","scalar-use fields differ");
    for (auto key : {"kind","binding","type_id"})
      if (!llvm::isa_and_nonnull<mlir::StringAttr>(data.get(key))) return reject("core-ir-array-metadata","scalar-use field class differs");
    if (text(data,"type_id")!=(type==8 ? u32Id : f64Id)) return reject("core-ir-array-type","scalar-use type differs");
    if (!span(data.get("range"),result.anchor) || !encloses(function.declaration,result.anchor))
      return reject("core-ir-array-source","scalar-use range differs");
    auto kind=text(data,"kind"),binding=text(data,"binding");
    if (kind=="reference") {
      auto found=parameters.find(binding.str());
      if (found==parameters.end()) return reject("core-ir-array-identity","scalar parameter binding absent");
      if (tsfg::typeCode(found->second.getType())!=type) return reject("core-ir-array-type","scalar parameter type differs");
      result.value=found->second; return mlir::success();
    }
    if (!binding.empty()) return reject("core-ir-array-identity","non-reference scalar has binding");
    if (position>=ops.size()) return reject("core-ir-array-shape","scalar definition absent");
    if (kind==(type==8 ? "constant" : "floating")) {
      Range anchor; uint64_t bits=0; auto *value=ops[position++];
      if (mlir::failed(constant(value,type==8,length,anchor,bits))) return mlir::failure();
      if (!same(anchor,result.anchor)) return reject("core-ir-array-source","scalar definition/use ranges differ");
      result.value=value->getResult(0); if (type==8) result.literal=static_cast<int64_t>(bits);
      return mlir::success();
    }
    if (type==13 && (kind=="arrayReadChecked" || kind=="readSpanReadChecked")) {
      Scalar readResult;
      if (mlir::failed(read(readResult,kind))) return mlir::failure();
      if (!same(readResult.anchor,result.anchor)) return reject("core-ir-array-source","read definition/use ranges differ");
      result.value=readResult.value; return mlir::success();
    }
    return reject("core-ir-array-shape","unsupported scalar-use kind");
  }
  mlir::LogicalResult read(Scalar &result, llvm::StringRef kind="", bool standalone=false) {
    size_t next=position;
    if (next<ops.size() && ops[next]->getName().getStringRef()=="tsfg_core.constant") ++next;
    const bool view=next<ops.size() && ops[next]->getName().getStringRef()=="tsfg_array.view_read_checked";
    if ((!kind.empty() && view!=(kind=="readSpanReadChecked")) || next>=ops.size() ||
        !operation(ops[next],view ? "tsfg_array.view_read_checked" : "tsfg_array.read_checked",2,1))
      return reject("core-ir-array-shape","expected exact checked-read sequence");
    auto *value=ops[next];
    std::vector<llvm::StringRef> keys={"receiver_binding","receiver_range","index","tsfg_source.start","tsfg_source.end"};
    if (standalone) keys.push_back("statement_range");
    if (!attributes(value,keys) || (standalone && !view)) return reject("core-ir-array-metadata","read role/fields differ");
    if (!value->getResult(0).getType().isF64() || !(view ? llvm::isa<ReadSpanType>(value->getOperand(0).getType()) : llvm::isa<ArrayType>(value->getOperand(0).getType())) || tsfg::typeCode(value->getOperand(1).getType())!=8)
      return reject("core-ir-array-type","read types differ");
    if (!range(value,result.anchor)) return reject("core-ir-array-source","read range differs");
    mlir::Value array; Range receiverRange; std::string binding; Scalar index;
    if (mlir::failed(receiver(value->getAttrDictionary(),result.anchor,array,receiverRange,binding)) ||
        mlir::failed(scalar(value->getAttr("index"),8,false,index))) return mlir::failure();
    if (position!=next || value->getOperand(0)!=array || value->getOperand(1)!=index.value)
      return reject("core-ir-array-shape","read uses disconnected or reordered definitions");
    if (result.anchor.start!=receiverRange.start || receiverRange.end>=index.anchor.start || index.anchor.end>=result.anchor.end)
      return reject("core-ir-array-source","checked-read source order differs");
    if (standalone) {
      Range statement;
      if (!span(value->getAttr("statement_range"),statement) || !encloses(function.declaration,statement) ||
          !encloses(statement,result.anchor) || statement.start!=result.anchor.start || statement.start<previous || statement.end>=function.declaration.end)
        return reject("core-ir-array-source","standalone checked-read statement differs");
      previous=statement.end;
    }
    ++position; result.value=value->getResult(0); return mlir::success();
  }
  mlir::LogicalResult viewReference(mlir::Attribute attribute, Scalar &result) {
    auto data=llvm::dyn_cast_or_null<mlir::DictionaryAttr>(attribute);
    if (!fields(data,{"kind","binding","type_id","range"}) || text(data,"kind")!="reference" || text(data,"type_id")!=readSpanId)
      return reject("core-ir-array-type","View ReturnUse must be an exact nominal reference");
    auto found=definitions.find(text(data,"binding").str());
    if (found==definitions.end() || !llvm::isa<ReadSpanType>(found->second.getType()))
      return reject("core-ir-array-identity","View return binding absent");
    if (!span(data.get("range"),result.anchor) || !encloses(function.declaration,result.anchor))
      return reject("core-ir-array-source","View return reference range differs");
    result.value=found->second; return mlir::success();
  }
  mlir::LogicalResult viewLocal(size_t endpoint) {
    auto *value=ops[endpoint]; Range initializer,statement,ownerRange,callee; std::string identity,binding; mlir::Value owner; Scalar start,length;
    if (++locals>17 || ++calls>32) return reject("core-ir-array-budget","local/shared call count exceeds limit");
    if (!operation(value,"tsfg_array.view_create_checked",3,1) ||
        !attributes(value,{"intrinsic","receiver_binding","receiver_range","callee_range","start","length","local","tsfg_source.start","tsfg_source.end"}))
      return reject("core-ir-array-shape","checked view create shape/fields differ");
    if (!range(value,initializer) || !span(value->getAttr("callee_range"),callee) ||
        !encloses(initializer,callee) || initializer.start!=callee.start)
      return reject("core-ir-array-source","checked view intrinsic range differs");
    if (text(value,"intrinsic")!=metadata.viewIntrinsic) return reject("core-ir-array-identity","view intrinsic differs");
    if (mlir::failed(receiver(value->getAttrDictionary(),initializer,owner,ownerRange,binding)) ||
        mlir::failed(scalar(value->getAttr("start"),8,true,start)) || mlir::failed(scalar(value->getAttr("length"),8,true,length))) return mlir::failure();
    if (position!=endpoint || value->getOperand(0)!=owner || value->getOperand(1)!=start.value || value->getOperand(2)!=length.value)
      return reject("core-ir-array-shape","view requires exact owner/start/length SSA order");
    if (!llvm::isa<ArrayType>(owner.getType()) || !llvm::isa<ReadSpanType>(value->getResult(0).getType()))
      return reject("core-ir-array-type","view requires distinct nominal owner/view types");
    if (callee.end>=ownerRange.start || ownerRange.end>=start.anchor.start || start.anchor.end>=length.anchor.start || length.anchor.end>=initializer.end)
      return reject("core-ir-array-source","view owner/start/length source order differs");
    if (mlir::failed(local(value,function,metadata,previous,initializer,statement,identity,names))) return mlir::failure();
    if (!viewAnnotation(value))
      return reject("core-ir-array-source","view requires original nominal element annotation");
    definitions.emplace(identity,value->getResult(0)); previous=statement.end; ++position; return mlir::success();
  }
  mlir::LogicalResult viewLength(size_t endpoint) {
    auto *value=ops[endpoint]; Range expression,statement,property,receiverRange; mlir::Value view; std::string binding;
    if (position!=endpoint || !operation(value,"tsfg_array.view_length",1,1) ||
        !attributes(value,{"receiver_binding","receiver_range","property","property_name_range","statement_range","tsfg_source.start","tsfg_source.end"}))
      return reject("core-ir-array-shape","view length shape/fields differ");
    if (!range(value,expression) || !span(value->getAttr("statement_range"),statement) ||
        !span(value->getAttr("property_name_range"),property) || !encloses(function.declaration,statement) ||
        statement.start<previous || statement.end>=function.declaration.end || statement.start!=expression.start ||
        expression.end>=statement.end || !encloses(statement,expression) || !encloses(expression,property))
      return reject("core-ir-array-source","view length source/statement differs");
    if (mlir::failed(receiver(value->getAttrDictionary(),expression,view,receiverRange,binding))) return mlir::failure();
    if (text(value,"property")!=metadata.viewLengthProperty) return reject("core-ir-array-identity","view length property differs");
    if (value->getOperand(0)!=view) return reject("core-ir-array-shape","view length receiver SSA differs");
    if (!llvm::isa<ReadSpanType>(view.getType()) || tsfg::typeCode(value->getResult(0).getType())!=8)
      return reject("core-ir-array-type","view length nominal type differs");
    if (expression.start!=receiverRange.start || receiverRange.end>=property.start || property.end!=expression.end)
      return reject("core-ir-array-source","view length receiver/property order differs");
    previous=statement.end; ++position; return mlir::success();
  }
  mlir::LogicalResult localStatement(size_t endpoint) {
    auto *value=ops[endpoint]; bool create=value->getName().getStringRef()=="tsfg_array.create";
    const bool view=value->getName().getStringRef()=="tsfg_array.view_alias";
    std::vector<mlir::Value> leaves; std::vector<Range> ranges;
    while (position<endpoint) {
      if (!create || leaves.size()==256) return reject("core-ir-array-shape","detached local scalar leaves");
      Range anchor; uint64_t bits=0;
      if (mlir::failed(constant(ops[position],false,false,anchor,bits))) return mlir::failure();
      leaves.push_back(ops[position++]->getResult(0)); ranges.push_back(anchor);
    }
    if (++locals>17) return reject("core-ir-array-budget","local count exceeds limit");
    if (!operation(value,create ? "tsfg_array.create" : view ? "tsfg_array.view_alias" : "tsfg_array.alias",create ? leaves.size() : 1,1))
      return reject("core-ir-array-shape","local operation shape differs");
    if (!attributes(value,create ? llvm::ArrayRef<llvm::StringRef>{"allocation_site","local","tsfg_source.start","tsfg_source.end"}
        : llvm::ArrayRef<llvm::StringRef>{"target_binding","local","tsfg_source.start","tsfg_source.end"}))
      return reject("core-ir-array-metadata","local operation fields differ");
    if (!(view ? llvm::isa<ReadSpanType>(value->getResult(0).getType()) : llvm::isa<ArrayType>(value->getResult(0).getType())))
      return reject("core-ir-array-type","local nominal type differs");
    Range initializer,statement; std::string identity,owner;
    if (!range(value,initializer)) return reject("core-ir-array-source","initializer range differs");
    if (mlir::failed(local(value,function,metadata,previous,initializer,statement,identity,names))) return mlir::failure();
    if (view && !viewAnnotation(value)) return reject("core-ir-array-source","view alias requires original nominal element annotation");
    if (create) {
      if (initializer.end-initializer.start<2) return reject("core-ir-array-source","literal extent differs");
      uint32_t end=initializer.start;
      for (size_t i=0;i<leaves.size();++i) {
        if (value->getOperand(i)!=leaves[i]) return reject("core-ir-array-shape","create requires exact ordered leaves");
        if (!leaves[i].getType().isF64()) return reject("core-ir-array-type","create leaf type differs");
        if (ranges[i].start<=initializer.start || ranges[i].start<end || ranges[i].end>=initializer.end)
          return reject("core-ir-array-source","literal element ranges differ");
        end=ranges[i].end;
      }
      owner=sourceIdentity(metadata.path,initializer,true);
      if (text(value,"allocation_site")!=owner || !metadata.sites.insert(owner).second)
        return reject("core-ir-array-identity","allocation site differs or repeats");
      totalElements+=leaves.size(); if (totalElements>4096) return reject("core-ir-array-budget","package element budget exceeded");
      lengths[owner]=leaves.size();
    } else {
      auto target=text(value,"target_binding").str(); auto found=definitions.find(target);
      if (found==definitions.end()) return reject("core-ir-array-identity","alias target must be an earlier binding");
      if (found->second!=value->getOperand(0)) return reject("core-ir-array-shape","alias exact target SSA differs");
      if (found->second.getType()!=value->getResult(0).getType()) return reject("core-ir-array-type","alias target nominal type differs");
      if (!view) owner=owners.at(target);
    }
    definitions.emplace(identity,value->getResult(0)); if (!view) owners.emplace(identity,owner);
    previous=statement.end; ++position; return mlir::success();
  }
  mlir::LogicalResult mutation(size_t endpoint) {
    if (++mutations>32) return reject("core-ir-array-budget","mutation count exceeds limit");
    auto *value=ops[endpoint]; bool store=value->getName().getStringRef()=="tsfg_array.store_dense_checked";
    if (!operation(value,store ? "tsfg_array.store_dense_checked" : "tsfg_array.resize_checked",store ? 3 : 2,0))
      return reject("core-ir-array-shape","mutation operation shape differs");
    if (!attributes(value,store
        ? llvm::ArrayRef<llvm::StringRef>{"target","value","expression_range","operator_range","tsfg_source.start","tsfg_source.end"}
        : llvm::ArrayRef<llvm::StringRef>{"receiver_binding","receiver_range","property","property_name_range","target_range","new_length","expression_range","operator_range","tsfg_source.start","tsfg_source.end"}))
      return reject("core-ir-array-metadata","mutation fields differ");
    Range statement,expression,op,target,receiverRange; mlir::Value array; std::string binding; Scalar index,rhs;
    if (!range(value,statement) || !span(value->getAttr("expression_range"),expression) || !span(value->getAttr("operator_range"),op) ||
        !encloses(function.declaration,statement) || statement.start<previous || statement.end>=function.declaration.end ||
        !encloses(statement,expression) || expression.start!=statement.start || !encloses(expression,op) || op.end-op.start!=1)
      return reject("core-ir-array-source","mutation source anchors differ");
    auto targetData=store ? value->getAttrOfType<mlir::DictionaryAttr>("target") : value->getAttrDictionary();
    if (store && !fields(targetData,{"receiver_binding","receiver_range","index","range"}))
      return reject("core-ir-array-metadata","element target fields differ");
    if (!span(targetData.get(store ? "range" : "target_range"),target) || !encloses(expression,target) || target.start!=expression.start)
      return reject("core-ir-array-source","target range differs");
    if (mlir::failed(receiver(targetData,target,array,receiverRange,binding))) return mlir::failure();
    if (target.start!=receiverRange.start) return reject("core-ir-array-source","receiver target start differs");
    if (store) {
      if (mlir::failed(scalar(targetData.get("index"),8,false,index)) || mlir::failed(scalar(value->getAttr("value"),13,false,rhs))) return mlir::failure();
      if (receiverRange.end>=index.anchor.start || index.anchor.end>=target.end)
        return reject("core-ir-array-source","target index source order differs");
    } else {
      Range propertyName;
      if (text(value,"property")!=metadata.lengthProperty) return reject("core-ir-array-identity","length target property differs");
      if (!span(value->getAttr("property_name_range"),propertyName) || !encloses(target,propertyName) ||
          receiverRange.end>=propertyName.start || target.end!=propertyName.end)
        return reject("core-ir-array-source","length property use ranges differ");
      if (mlir::failed(scalar(value->getAttr("new_length"),8,true,rhs))) return mlir::failure();
    }
    if (position!=endpoint || value->getOperand(0)!=array ||
        (store ? value->getOperand(1)!=index.value || value->getOperand(2)!=rhs.value : value->getOperand(1)!=rhs.value))
      return reject("core-ir-array-shape","mutation uses disconnected/reordered definitions");
    if (!llvm::isa<ArrayType>(array.getType()) || tsfg::typeCode((store ? index.value : rhs.value).getType())!=8 ||
        (store && !rhs.value.getType().isF64())) return reject("core-ir-array-type","mutation operand types differ");
    if (target.end>op.start || op.end>rhs.anchor.start || rhs.anchor.end!=expression.end || !encloses(expression,rhs.anchor))
      return reject("core-ir-array-source","mutation target/operator/value order differs");
    // This finite proof follows successful continuation only; all checked ops remain.
    auto &length=lengths.at(owners.at(binding)); int64_t n=store ? index.literal : rhs.literal;
    if (n<0 || parameterOwners.count(owners.at(binding))) length=-1;
    else {
      if (length>=0 && n>length) return reject("core-ir-array-density","proven literal gap or length growth");
      length=store ? length<0 ? -1 : std::max(length,n+1) : n;
    }
    previous=statement.end; ++position; return mlir::success();
  }
  mlir::LogicalResult callStatement(size_t endpoint, bool returning, Scalar &result, Range &callStatementRange) {
    auto *value=ops[endpoint]; auto call=llvm::dyn_cast<mlir::func::CallOp>(value);
    const bool localCall=value->hasAttr("local");
    if (!call || ++calls>32 || value->getNumResults()!=1 ||
        (!value->getResult(0).getType().isF64() && !llvm::isa<ReadSpanType>(value->getResult(0).getType())) ||
        value->getNumRegions() || value->getNumSuccessors()) return reject("core-ir-array-call","call shape differs");
    std::vector<llvm::StringRef> keys={"callee","tsfg_core.function_id","tsfg_core.signature_hash","source_callee",
        "callee_range","arguments","statement_range","consumed_digest","tsfg_source.start","tsfg_source.end"};
    if (localCall) keys.push_back("local");
    if (!attributes(value,keys))
      return reject("core-ir-array-metadata","call fields differ");
    const Function *target=nullptr;
    for (const auto &candidate : metadata.functions)
      if (llvm::cast<mlir::func::FuncOp>(candidate.operation).getSymName()==call.getCallee()) target=&candidate;
    if (!target || value->getResult(0).getType()!=target->resultType ||
        (localCall && (returning || !llvm::isa<ReadSpanType>(target->resultType))) || text(value,"tsfg_core.function_id")!=text(target->operation,"tsfg_core.function_id") ||
        text(value,"tsfg_core.signature_hash")!=text(target->operation,"tsfg_core.signature_hash") ||
        text(value,"source_callee")!=text(target->operation,"tsfg_array.source_binding"))
      return reject("core-ir-array-call","callee identity differs");
    auto arguments=value->getAttrOfType<mlir::ArrayAttr>("arguments");
    if (!arguments || arguments.size()!=target->parameters.size() || value->getNumOperands()!=arguments.size())
      return reject("core-ir-array-call","call arity differs");
    Range expression,callee,statement;
    if (!range(value,expression) || !span(value->getAttr("callee_range"),callee) ||
        !span(value->getAttr("statement_range"),statement) || !encloses(function.declaration,statement) ||
        !encloses(statement,expression) || statement.start<previous || statement.end>=function.declaration.end ||
        (returning || localCall ? statement.start>=expression.start : statement.start!=expression.start) || expression.start!=callee.start || !encloses(expression,callee) ||
        expression.end-callee.end<2) return reject("core-ir-array-source","call source anchors differ");
    uint32_t end=callee.end;
    for (size_t i=0;i<arguments.size();++i) {
      auto data=llvm::dyn_cast<mlir::DictionaryAttr>(arguments[i]);
      auto kind=text(data,"kind");
      if (kind!="reference" && kind!="constant" && kind!="floating")
        return reject("core-ir-array-call","call actual requires an original scalar reference/literal");
      Scalar argument;
      const auto expected=target->parameters[i].type;
      if (llvm::isa<ArrayType,ReadSpanType>(expected)) {
        if (!fields(data,{"kind","binding","type_id","range"}) || kind!="reference" || text(data,"type_id")!=(llvm::isa<ArrayType>(expected) ? arrayId : readSpanId))
          return reject("core-ir-array-call","Array actual requires a nominal reference");
        auto found=definitions.find(text(data,"binding").str());
        if (found==definitions.end() || found->second.getType()!=expected)
          return reject("core-ir-array-call","Array actual binding absent");
        if (!span(data.get("range"),argument.anchor) || !encloses(function.declaration,argument.anchor))
          return reject("core-ir-array-source","Array actual range differs");
        argument.value=found->second;
        // No call carries a length hint. Aliases share the affected caller root.
        if (llvm::isa<ArrayType>(expected)) lengths.at(owners.at(text(data,"binding").str()))=-1;
      } else if (mlir::failed(scalar(arguments[i],tsfg::typeCode(expected),true,argument))) return mlir::failure();
      if (argument.anchor.start<=end || argument.anchor.end>=expression.end || value->getOperand(i)!=argument.value ||
          value->getOperand(i).getType()!=llvm::cast<mlir::func::FuncOp>(target->operation).getFunctionType().getInput(i))
        return reject("core-ir-array-call","call exact ordered actual differs");
      end=argument.anchor.end;
    }
    if (position!=endpoint) return reject("core-ir-array-call","detached or reordered call actual");
    if (localCall) {
      Range localStatementRange; std::string identity;
      if (++locals>17) return reject("core-ir-array-budget","local count exceeds limit");
      if (mlir::failed(local(value,function,metadata,previous,expression,localStatementRange,identity,names))) return mlir::failure();
      if (!same(statement,localStatementRange) || !viewAnnotation(value))
        return reject("core-ir-array-source","View call local annotation/statement differs");
      definitions.emplace(identity,value->getResult(0));
    }
    result.value=value->getResult(0); result.anchor=expression; callStatementRange=statement;
    if (!returning) previous=statement.end;
    ++position; return mlir::success();
  }
public:
  Body(const Function &function, Metadata &metadata, size_t &elements)
      : function(function),metadata(metadata),totalElements(elements),fn(llvm::cast<mlir::func::FuncOp>(function.operation)),previous(function.annotation.end) {}
  mlir::LogicalResult verify() {
    if (!fn.getBody().hasOneBlock() || fn.getBody().front().getNumArguments()!=function.parameters.size())
      return reject("core-ir-array-shape","one block and exact entry parameters required");
    for (const auto &[i,parameter] : llvm::enumerate(function.parameters)) {
      auto argument=fn.getBody().front().getArgument(i);
      if (argument.getType()!=parameter.type) return reject("core-ir-array-type","entry parameter type differs");
      parameters.emplace(parameter.id,argument); names.insert(parameter.name);
      if (llvm::isa<ArrayType,ReadSpanType>(parameter.type)) definitions.emplace(parameter.id,argument);
      if (llvm::isa<ArrayType>(parameter.type)) {
        owners.emplace(parameter.id,parameter.id);
        lengths.emplace(parameter.id,-1); parameterOwners.insert(parameter.id);
      }
    }
    registers=function.parameters.size();
    for (auto &value : fn.getBody().front()) {
      if (ops.size()==4245) return reject("core-ir-array-budget","operation count exceeds limit");
      ops.push_back(&value); registers+=value.getNumResults();
      if (registers>4219) return reject("core-ir-array-budget","register count exceeds limit");
    }
    if (ops.size()<2) return reject("core-ir-array-shape","function body incomplete");
    auto *fuel=ops.front();
    if (!operation(fuel,"tsfg_core.fuel",0,0) || !attributes(fuel,{"event","tsfg_source.start","tsfg_source.end"}))
      return reject("core-ir-array-shape","requires one entry fuel");
    auto event=fuel->getAttrOfType<mlir::IntegerAttr>("event"); Range entry;
    if (!event || !event.getType().isSignlessInteger(32) || event.getInt()!=1)
      return reject("core-ir-array-shape","requires entry fuel1");
    if (!range(fuel,entry) || !same(entry,function.declaration)) return reject("core-ir-array-source","entry fuel range differs");
    while (position<ops.size()) {
      if (++statements>50) return reject("core-ir-array-budget","statement count exceeds limit");
      size_t endpoint=position;
      for (;endpoint<ops.size();++endpoint) {
        auto name=ops[endpoint]->getName().getStringRef();
        if ((name=="tsfg_array.view_read_checked" && ops[endpoint]->hasAttr("statement_range")) ||
            (name!="tsfg_core.constant" && name!="tsfg_array.read_checked" && name!="tsfg_array.view_read_checked")) break;
      }
      if (endpoint>=ops.size()) return reject("core-ir-array-shape","detached scalar/read operations");
      auto *value=ops[endpoint]; auto name=value->getName().getStringRef();
      if (name=="tsfg_array.view_create_checked") {
        if (mlir::failed(viewLocal(endpoint))) return mlir::failure();
      } else if (name=="tsfg_array.view_length") {
        if (mlir::failed(viewLength(endpoint))) return mlir::failure();
      } else if (name=="tsfg_array.view_read_checked") {
        Scalar result; if (mlir::failed(read(result,"readSpanReadChecked",true))) return mlir::failure();
      } else if (name=="tsfg_array.create" || name=="tsfg_array.alias" || name=="tsfg_array.view_alias") {
        if (mlir::failed(localStatement(endpoint))) return mlir::failure();
      } else if (name=="tsfg_array.store_dense_checked" || name=="tsfg_array.resize_checked") {
        if (mlir::failed(mutation(endpoint))) return mlir::failure();
      } else if (name=="func.call") {
        const bool returning=!value->hasAttr("local") && value->getNumResults()==1 && endpoint+2==ops.size() && ops[endpoint+1]->getName().getStringRef()=="func.return"
            && ops[endpoint+1]->getNumOperands()==1 && ops[endpoint+1]->getOperand(0)==value->getResult(0);
        Scalar result; Range statement;
        if (mlir::failed(callStatement(endpoint,returning,result,statement))) return mlir::failure();
        if (returning) {
          auto *ret=ops[position]; Range anchor;
          if (!operation(ret,"func.return",1,0) || !attributes(ret,{"tsfg_array.value","tsfg_source.start","tsfg_source.end"}) ||
              !range(ret,anchor) || !same(anchor,statement) || result.value.getType()!=function.resultType) return reject("core-ir-array-call","final call return range differs");
          auto data=ret->getAttrOfType<mlir::DictionaryAttr>("tsfg_array.value"); Range use;
          if (!fields(data,{"kind","binding","type_id","range"}) || text(data,"kind")!="arrayDirectCall" ||
              !llvm::isa_and_nonnull<mlir::StringAttr>(data.get("binding")) || !text(data,"binding").empty() ||
              text(data,"type_id")!=(llvm::isa<ReadSpanType>(function.resultType) ? readSpanId : f64Id) || !span(data.get("range"),use) || !same(use,result.anchor))
            return reject("core-ir-array-call","final call ReturnUse differs");
          ++position;
        }
      } else if (name=="func.return") {
        Scalar result;
        if (llvm::isa<ReadSpanType>(function.resultType)) {
          if (mlir::failed(viewReference(value->getAttr("tsfg_array.value"),result))) return mlir::failure();
        } else if (mlir::failed(scalar(value->getAttr("tsfg_array.value"),13,false,result))) return mlir::failure();
        if (position!=endpoint || endpoint+1!=ops.size() || !operation(value,"func.return",1,0) || value->getOperand(0)!=result.value || result.value.getType()!=function.resultType)
          return reject("core-ir-array-shape","final return exact read SSA differs");
        if (!attributes(value,{"tsfg_array.value","tsfg_source.start","tsfg_source.end"})) return reject("core-ir-array-metadata","return fields differ");
        Range anchor;
        if (!range(value,anchor) || !encloses(function.declaration,anchor) || anchor.start<previous || anchor.end>=function.declaration.end ||
            !encloses(anchor,result.anchor) || anchor.start>=result.anchor.start)
          return reject("core-ir-array-source","return source range differs");
        ++position;
      } else return reject("core-ir-array-shape","unsupported body operation");
    }
    if (ops.back()->getName().getStringRef()!="func.return") return reject("core-ir-array-shape","complete local/final-return grammar required");
    return mlir::success();
  }
};
} // namespace
mlir::LogicalResult verifyCandidate(mlir::ModuleOp module) {
  Metadata metadata;
  if (mlir::failed(verifyMetadata(module,metadata))) return mlir::failure();
  size_t elements=0;
  for (const auto &function : metadata.functions)
    if (mlir::failed(Body(function,metadata,elements).verify())) return mlir::failure();
  if (mlir::failed(verifyPublication(module,metadata))) return mlir::failure();
  uint64_t work=0;
  for (const auto &function : metadata.functions) {
    OwnerGraph graph;
    if (mlir::failed(collectOwners(function,metadata,graph)) || mlir::failed(verifyViewLifetimes(function,metadata,graph)) ||
        mlir::failed(verifyCallRoots(function,graph,work))) return mlir::failure();
  }
  return mlir::success();
}
} // namespace tsfg::arrays
