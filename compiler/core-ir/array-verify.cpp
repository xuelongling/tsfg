// SPDX-License-Identifier: MIT
#include "array-core.h"
#include "dialect.h"
#include "managed-liveness.h"
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
struct Scalar { mlir::Value value; Range anchor; int64_t literal=-1; };
class Body {
  const Function &function; Metadata &metadata; size_t &totalElements;
  mlir::func::FuncOp fn; std::vector<mlir::Operation *> ops;
  std::map<std::string,mlir::Value> definitions,parameters;
  std::map<std::string,std::string> owners;
  std::map<std::string,int64_t> lengths;
  std::set<std::string> names;
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
    if (type==13 && kind=="arrayReadChecked") {
      Scalar readResult;
      if (mlir::failed(read(readResult))) return mlir::failure();
      if (!same(readResult.anchor,result.anchor)) return reject("core-ir-array-source","read definition/use ranges differ");
      result.value=readResult.value; return mlir::success();
    }
    return reject("core-ir-array-shape","unsupported scalar-use kind");
  }
  mlir::LogicalResult read(Scalar &result) {
    size_t next=position;
    if (next<ops.size() && ops[next]->getName().getStringRef()=="tsfg_core.constant") ++next;
    if (next>=ops.size() || !operation(ops[next],"tsfg_array.read_checked",2,1))
      return reject("core-ir-array-shape","expected exact checked-read sequence");
    auto *value=ops[next];
    if (!attributes(value,{"receiver_binding","receiver_range","index","tsfg_source.start","tsfg_source.end"}))
      return reject("core-ir-array-metadata","read fields differ");
    if (!value->getResult(0).getType().isF64() || !llvm::isa<ArrayType>(value->getOperand(0).getType()) || tsfg::typeCode(value->getOperand(1).getType())!=8)
      return reject("core-ir-array-type","read types differ");
    if (!range(value,result.anchor)) return reject("core-ir-array-source","read range differs");
    mlir::Value array; Range receiverRange; std::string binding; Scalar index;
    if (mlir::failed(receiver(value->getAttrDictionary(),result.anchor,array,receiverRange,binding)) ||
        mlir::failed(scalar(value->getAttr("index"),8,false,index))) return mlir::failure();
    if (position!=next || value->getOperand(0)!=array || value->getOperand(1)!=index.value)
      return reject("core-ir-array-shape","read uses disconnected or reordered definitions");
    if (result.anchor.start!=receiverRange.start || receiverRange.end>=index.anchor.start || index.anchor.end>=result.anchor.end)
      return reject("core-ir-array-source","checked-read source order differs");
    ++position; result.value=value->getResult(0); return mlir::success();
  }
  mlir::LogicalResult localStatement(size_t endpoint) {
    auto *value=ops[endpoint]; bool create=value->getName().getStringRef()=="tsfg_array.create";
    std::vector<mlir::Value> leaves; std::vector<Range> ranges;
    while (position<endpoint) {
      if (!create || leaves.size()==256) return reject("core-ir-array-shape","detached local scalar leaves");
      Range anchor; uint64_t bits=0;
      if (mlir::failed(constant(ops[position],false,false,anchor,bits))) return mlir::failure();
      leaves.push_back(ops[position++]->getResult(0)); ranges.push_back(anchor);
    }
    if (++locals>17) return reject("core-ir-array-budget","local count exceeds limit");
    if (!operation(value,create ? "tsfg_array.create" : "tsfg_array.alias",create ? leaves.size() : 1,1))
      return reject("core-ir-array-shape","local operation shape differs");
    if (!attributes(value,create ? llvm::ArrayRef<llvm::StringRef>{"allocation_site","local","tsfg_source.start","tsfg_source.end"}
        : llvm::ArrayRef<llvm::StringRef>{"target_binding","local","tsfg_source.start","tsfg_source.end"}))
      return reject("core-ir-array-metadata","local operation fields differ");
    if (!llvm::isa<ArrayType>(value->getResult(0).getType())) return reject("core-ir-array-type","local requires nominal Array");
    Range initializer,statement; std::string identity,owner;
    if (!range(value,initializer)) return reject("core-ir-array-source","initializer range differs");
    if (mlir::failed(local(value,function,metadata,previous,initializer,statement,identity,names))) return mlir::failure();
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
      owner=owners.at(target);
    }
    definitions.emplace(identity,value->getResult(0)); owners.emplace(identity,owner);
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
    if (n<0) length=-1;
    else {
      if (length>=0 && n>length) return reject("core-ir-array-density","proven literal gap or length growth");
      length=store ? length<0 ? -1 : std::max(length,n+1) : n;
    }
    previous=statement.end; ++position; return mlir::success();
  }
  mlir::LogicalResult callStatement(size_t endpoint) {
    auto *value=ops[endpoint]; auto call=llvm::dyn_cast<mlir::func::CallOp>(value);
    if (!call || ++calls>32 || value->getNumResults()!=1 || !value->getResult(0).getType().isF64() ||
        value->getNumRegions() || value->getNumSuccessors()) return reject("core-ir-array-call","call shape differs");
    if (!attributes(value,{"callee","tsfg_core.function_id","tsfg_core.signature_hash","source_callee",
        "callee_range","arguments","statement_range","tsfg_source.start","tsfg_source.end"}))
      return reject("core-ir-array-metadata","call fields differ");
    const Function *target=nullptr;
    for (const auto &candidate : metadata.functions)
      if (llvm::cast<mlir::func::FuncOp>(candidate.operation).getSymName()==call.getCallee()) target=&candidate;
    if (!target || text(value,"tsfg_core.function_id")!=text(target->operation,"tsfg_core.function_id") ||
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
        statement.start!=expression.start || expression.start!=callee.start || !encloses(expression,callee) ||
        expression.end-callee.end<2) return reject("core-ir-array-source","call source anchors differ");
    uint32_t end=callee.end;
    for (size_t i=0;i<arguments.size();++i) {
      auto data=llvm::dyn_cast<mlir::DictionaryAttr>(arguments[i]);
      auto kind=text(data,"kind");
      if (kind!="reference" && kind!="constant" && kind!="floating")
        return reject("core-ir-array-call","call actual requires an original scalar reference/literal");
      Scalar argument;
      if (mlir::failed(scalar(arguments[i],target->parameters[i].type,true,argument))) return mlir::failure();
      if (argument.anchor.start<=end || argument.anchor.end>=expression.end || value->getOperand(i)!=argument.value ||
          value->getOperand(i).getType()!=llvm::cast<mlir::func::FuncOp>(target->operation).getFunctionType().getInput(i))
        return reject("core-ir-array-call","call exact ordered actual differs");
      end=argument.anchor.end;
    }
    if (position!=endpoint) return reject("core-ir-array-call","detached or reordered call actual");
    previous=statement.end; ++position; return mlir::success();
  }
public:
  Body(const Function &function, Metadata &metadata, size_t &elements)
      : function(function),metadata(metadata),totalElements(elements),fn(llvm::cast<mlir::func::FuncOp>(function.operation)),previous(function.annotation.end) {}
  mlir::LogicalResult verify() {
    if (!fn.getBody().hasOneBlock() || fn.getBody().front().getNumArguments()!=function.parameters.size())
      return reject("core-ir-array-shape","one block and exact entry parameters required");
    for (const auto &[i,parameter] : llvm::enumerate(function.parameters)) {
      auto argument=fn.getBody().front().getArgument(i);
      if (tsfg::typeCode(argument.getType())!=parameter.type) return reject("core-ir-array-type","entry parameter type differs");
      parameters.emplace(parameter.id,argument); names.insert(parameter.name);
    }
    registers=function.parameters.size();
    for (auto &value : fn.getBody().front()) {
      if (ops.size()==4245) return reject("core-ir-array-budget","operation count exceeds limit");
      ops.push_back(&value); registers+=value.getNumResults();
      if (registers>4219) return reject("core-ir-array-budget","register count exceeds limit");
    }
    if (ops.size()<4) return reject("core-ir-array-shape","function body incomplete");
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
        if (name!="tsfg_core.constant" && name!="tsfg_array.read_checked") break;
      }
      if (endpoint>=ops.size()) return reject("core-ir-array-shape","detached scalar/read operations");
      auto *value=ops[endpoint]; auto name=value->getName().getStringRef();
      if (name=="tsfg_array.create" || name=="tsfg_array.alias") {
        if (mlir::failed(localStatement(endpoint))) return mlir::failure();
      } else if (name=="tsfg_array.store_dense_checked" || name=="tsfg_array.resize_checked") {
        if (mlir::failed(mutation(endpoint))) return mlir::failure();
      } else if (name=="func.call") {
        if (mlir::failed(callStatement(endpoint))) return mlir::failure();
      } else if (name=="func.return") {
        Scalar result;
        if (mlir::failed(read(result))) return mlir::failure();
        if (position!=endpoint || endpoint+1!=ops.size() || !operation(value,"func.return",1,0) || value->getOperand(0)!=result.value)
          return reject("core-ir-array-shape","final return exact read SSA differs");
        if (!attributes(value,{"tsfg_source.start","tsfg_source.end"})) return reject("core-ir-array-metadata","return fields differ");
        Range anchor;
        if (!range(value,anchor) || !encloses(function.declaration,anchor) || anchor.start<previous || anchor.end>=function.declaration.end ||
            !encloses(anchor,result.anchor) || anchor.start>=result.anchor.start)
          return reject("core-ir-array-source","return source range differs");
        ++position;
      } else return reject("core-ir-array-shape","unsupported body operation");
    }
    if (!locals || ops.back()->getName().getStringRef()!="func.return") return reject("core-ir-array-shape","complete local/final-return grammar required");
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
  // Complete local-owner bodies necessarily allocate; upstream SCC admission
  // excludes such a reachable cyclic domain. Cold IR must enforce the same bound.
  bool reachable[16][16]{}; const auto count=metadata.functions.size();
  for (size_t i=0;i<count;++i)
    for (auto call : llvm::cast<mlir::func::FuncOp>(metadata.functions[i].operation).getOps<mlir::func::CallOp>())
      for (size_t j=0;j<count;++j)
        if (call.getCallee()==llvm::cast<mlir::func::FuncOp>(metadata.functions[j].operation).getSymName()) reachable[i][j]=true;
  for (size_t k=0;k<count;++k) for (size_t i=0;i<count;++i) for (size_t j=0;j<count;++j)
    reachable[i][j]=reachable[i][j] || (reachable[i][k] && reachable[k][j]);
  for (size_t i=0;i<count;++i)
    if (reachable[i][i]) return reject("core-ir-array-call","local-owner ordinary-call graph must be acyclic");
  uint64_t work=0;
  for (const auto &function : metadata.functions) {
    auto fn=llvm::cast<mlir::func::FuncOp>(function.operation);
    ManagedLiveness live;
    if (mlir::failed(recomputeManagedLiveness(fn,ManagedDomain::Array,live))) return mlir::failure();
    work+=live.work;
    if (work>1000000) return reject("core-ir-array-roots","whole-module liveness work budget exceeded");
    mlir::Builder builder(module.getContext()); std::vector<mlir::Attribute> records;
    for (const auto &point : live.points) {
      std::vector<mlir::Attribute> roots;
      for (auto reg : point.registers) roots.push_back(builder.getI64IntegerAttr(reg));
      records.push_back(builder.getDictionaryAttr({
        builder.getNamedAttr("block",builder.getI64IntegerAttr(point.block)),
        builder.getNamedAttr("instruction",builder.getI64IntegerAttr(point.instruction)),
        builder.getNamedAttr("registers",builder.getArrayAttr(roots))}));
    }
    auto expected=builder.getArrayAttr(records);
    auto supplied=fn->getAttr("tsfg_array.call_roots");
    if (supplied && supplied!=expected) return reject("core-ir-array-roots","supplied call roots differ from complete SSA recomputation");
    if (supplied || !records.empty()) fn->setAttr("tsfg_array.call_roots",expected);
  }
  return mlir::success();
}
} // namespace tsfg::arrays
