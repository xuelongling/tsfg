// SPDX-License-Identifier: MIT
#include "system-query-source.h"
#include "mlir/Dialect/Arith/IR/Arith.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "mlir/Dialect/MemRef/IR/MemRef.h"
#include "mlir/Dialect/SCF/IR/SCF.h"
#include "mlir/IR/Builders.h"
#include "mlir/IR/Verifier.h"
#include "mlir/Parser/Parser.h"
#include "llvm/ADT/DenseMap.h"
#include "llvm/Support/raw_ostream.h"

namespace tsfg::systemQuery {
namespace {
constexpr size_t byteLimit=8388608;
std::string text(mlir::Operation *op,llvm::StringRef key){return op->getAttrOfType<mlir::StringAttr>(key).getValue().str();}
int64_t integer(mlir::Operation *op,llvm::StringRef key){return op->getAttrOfType<mlir::IntegerAttr>(key).getInt();}
std::string printed(mlir::ModuleOp module){std::string value;llvm::raw_string_ostream out(value);module->print(out,mlir::OpPrintingFlags().printGenericOpForm());out<<'\n';return value;}
std::string helperName(const std::string &id){return "batch_helper_"+id.substr(7);}

// This builder consumes only the independently Source/SSA/layout-verified
// Query module. A row view is the original byte buffer plus its byte offset,
// never a copied component or a newly granted borrow capability.
struct Batch {
  Model &m;mlir::OpBuilder b;mlir::Location loc;mlir::OwningOpRef<mlir::ModuleOp> output;
  struct Row {mlir::Value buffer,base;};
  llvm::DenseMap<mlir::Value,mlir::Value> values;
  llvm::DenseMap<mlir::Value,Row> views;
  explicit Batch(Model &model,mlir::MLIRContext *context):m(model),b(context),loc(b.getUnknownLoc()),output(mlir::ModuleOp::create(loc)){
    context->getOrLoadDialect<mlir::arith::ArithDialect>();context->getOrLoadDialect<mlir::scf::SCFDialect>();context->getOrLoadDialect<mlir::memref::MemRefDialect>();
  }
  bool need(bool ok,llvm::StringRef message){return ok||reject(m.error,"core-ir-query-batch",message);}
  mlir::MemRefType bytes(){return mlir::MemRefType::get({mlir::ShapedType::kDynamic},b.getI8Type());}
  mlir::Value index(int64_t n){return b.create<mlir::arith::ConstantIndexOp>(loc,n);}
  void source(mlir::Operation *op,mlir::Operation *original,const std::string &path){
    for(auto key:{"tsfg_source.start","tsfg_source.end","operator_start","operator_end","callee_start","callee_end"})if(auto attr=original->getAttr(key))op->setAttr(key,attr);
    op->setAttr("tsfg_source.path",b.getStringAttr(path));
  }
  bool body(mlir::Block &block,const std::string &path){
    for(auto &op:block){
      if(!m.spend())return false;const auto name=op.getName().getStringRef();
      if(name=="tsfg.column"||name=="tsfg.yield")continue;
      if(name=="tsfg.view_borrow"){views[op.getResult(0)]=views.find(op.getOperand(0))->second;continue;}
      mlir::Operation *lowered=nullptr;
      if(name=="func.call"){
        std::vector<mlir::Value> args;
        for(auto arg:op.getOperands())if(auto it=views.find(arg);it!=views.end()){args.push_back(it->second.buffer);args.push_back(it->second.base);}else args.push_back(values.find(arg)->second);
        auto call=b.create<mlir::func::CallOp>(loc,helperName(text(&op,"tsfg_core.function_id")),mlir::TypeRange{b.getF32Type()},args);
        call->setAttr("tsfg.batch.callee",op.getAttr("tsfg_core.function_id"));call->setAttr("tsfg.batch.source_callee",op.getAttr("tsfg.query_source_callee"));
        call->setAttr("tsfg.batch.logical_signature",op.getAttr("tsfg_core.signature_hash"));values[op.getResult(0)]=call.getResult(0);lowered=call;
      }else if(name=="tsfg.field_load"||name=="tsfg.field_store"){
        const auto row=views.find(op.getOperand(0))->second;
        auto offset=b.create<mlir::arith::AddIOp>(loc,row.base,index(integer(&op,"offset")));
        auto view=b.create<mlir::memref::ViewOp>(loc,mlir::MemRefType::get({1},b.getF32Type()),row.buffer,offset,mlir::ValueRange{});
        source(offset,&op,path);source(view,&op,path);
        if(name=="tsfg.field_load"){auto load=b.create<mlir::memref::LoadOp>(loc,view,mlir::ValueRange{index(0)});values[op.getResult(0)]=load;lowered=load;}
        else lowered=b.create<mlir::memref::StoreOp>(loc,values.find(op.getOperand(1))->second,view,mlir::ValueRange{index(0)});
        for(auto key:{"component_type","field","source_field","offset"})lowered->setAttr(std::string("tsfg.batch.")+key,op.getAttr(key));
      }else if(name=="func.return"){
        std::vector<mlir::Value> args;for(auto arg:op.getOperands())args.push_back(values.find(arg)->second);lowered=b.create<mlir::func::ReturnOp>(loc,args);
      }else{
        const auto left=values.find(op.getOperand(0))->second,right=values.find(op.getOperand(1))->second;mlir::Value result;
        // No fast-math flags, contraction or reassociation are introduced.
        if(name=="tsfg_core.add")result=b.create<mlir::arith::AddFOp>(loc,left,right);
        else if(name=="tsfg_core.sub")result=b.create<mlir::arith::SubFOp>(loc,left,right);
        else if(name=="tsfg_core.mul")result=b.create<mlir::arith::MulFOp>(loc,left,right);
        else if(name=="tsfg_core.div")result=b.create<mlir::arith::DivFOp>(loc,left,right);
        else return need(false,"unselected verified Query operation in batch lowering");
        values[op.getResult(0)]=result;lowered=result.getDefiningOp();
      }
      source(lowered,&op,path);
    }
    return true;
  }
  bool helper(mlir::func::FuncOp original,const ScalarHelper &helper){
    std::vector<mlir::Type> parameters;for(auto arg:original.getArguments())if(llvm::isa<ViewType>(arg.getType())){parameters.push_back(bytes());parameters.push_back(b.getIndexType());}else parameters.push_back(b.getF32Type());
    b.setInsertionPointToEnd(output->getBody());auto fn=b.create<mlir::func::FuncOp>(loc,helperName(helper.id),b.getFunctionType(parameters,{b.getF32Type()}));
    fn.setPrivate();fn->setAttr("tsfg.batch.helper",b.getStringAttr(helper.id));fn->setAttr("tsfg.batch.source_helper",original->getAttr("tsfg.query_source_helper"));
    fn->setAttr("tsfg.batch.source_function",original->getAttr("tsfg.query_source_function"));fn->setAttr("tsfg.batch.logical_signature",original->getAttr("tsfg_core.signature_hash"));
    const auto path=text(original,"tsfg_source.path");source(fn,original,path);auto *entry=fn.addEntryBlock();b.setInsertionPointToStart(entry);values.clear();views.clear();size_t index=0;
    for(auto arg:original.getArguments())if(llvm::isa<ViewType>(arg.getType())){views[arg]={entry->getArgument(index),entry->getArgument(index+1)};index+=2;}else values[arg]=entry->getArgument(index++);
    return body(original.getBody().front(),path);
  }
  bool loop(mlir::func::FuncOp original,mlir::Operation &chunk,size_t ordinal,Json &abi){
    auto &parallel=chunk.getRegion(0).front().front();auto &rows=parallel.getRegion(0).front();const auto path=text(original,"tsfg_source.path"),id=text(original,"tsfg_core.function_id");
    struct Column {std::string mode;const Json *layout=nullptr;size_t argument=0;};std::map<std::string,Column> columns;
    Array tuples,scalars,columnRows;std::vector<mlir::Type> parameters{b.getIndexType()};
    for(auto &op:rows)if(op.getName().getStringRef()=="tsfg.column"){
      auto &column=columns[text(&op,"component_type")];if(column.mode.empty()||text(&op,"mode")=="write")column.mode=text(&op,"mode");
      for(const auto &row:items(field(m.layouts,"types")))if(string(field(row,"id"))==text(&op,"component_type"))column.layout=&row;
    }
    for(auto &[component,column]:columns){
      if(!m.spend()||!need(column.layout,"verified column layout missing"))return false;column.argument=parameters.size();parameters.push_back(bytes());parameters.push_back(b.getIndexType());
      columnRows.push_back(Object{{"componentType",component},{"mode",column.mode},{"bufferArgument",int64_t(column.argument)},{"strideArgument",int64_t(column.argument+1)},
        {"stride",field(*column.layout,"stride")},{"alignment",field(*column.layout,"alignment")}});
    }
    for(size_t i=0;i<original.getNumArguments();++i)if(!llvm::isa<QueryType>(original.getArgument(i).getType())){
      if(!need(original.getArgument(i).getType().isF32(),"batch ordinary parameters require f32"))return false;
      scalars.push_back(Object{{"sourceParameter",int64_t(i)},{"argument",int64_t(parameters.size())}});parameters.push_back(b.getF32Type());
    }
    const auto name="batch_"+id.substr(7)+"_"+std::to_string(ordinal);b.setInsertionPointToEnd(output->getBody());auto fn=b.create<mlir::func::FuncOp>(loc,name,b.getFunctionType(parameters,{}));
    fn->setAttr("tsfg.batch.system",original->getAttr("tsfg_core.function_id"));fn->setAttr("tsfg.batch.source_function",original->getAttr("tsfg.query_source_function"));
    fn->setAttr("tsfg.batch.loop",b.getI64IntegerAttr(ordinal));source(fn,&parallel,path);
    auto *entry=fn.addEntryBlock();b.setInsertionPointToStart(entry);const auto zero=index(0),one=index(1);auto loop=b.create<mlir::scf::ForOp>(loc,zero,entry->getArgument(0),one);source(loop,&parallel,path);
    b.setInsertionPointToStart(loop.getBody());values.clear();views.clear();std::map<std::string,Row> unique;
    for(const auto &[component,column]:columns){auto base=b.create<mlir::arith::MulIOp>(loc,loop.getInductionVar(),entry->getArgument(column.argument+1));base->setAttr("tsfg.batch.component_type",b.getStringAttr(component));unique[component]={entry->getArgument(column.argument),base};}
    size_t scalar=1+columns.size()*2;for(auto arg:original.getArguments())if(!llvm::isa<QueryType>(arg.getType()))values[arg]=entry->getArgument(scalar++);
    for(auto &op:rows)if(op.getName().getStringRef()=="tsfg.column"){
      const auto component=text(&op,"component_type");views[op.getResult(0)]=unique.at(component);
      tuples.push_back(Object{{"tupleIndex",integer(&op,"tuple_index")},{"sourceBinding",text(&op,"source_binding")},{"componentType",component},{"mode",text(&op,"mode")},{"bufferArgument",int64_t(columns.at(component).argument)}});
    }
    if(!body(rows,path))return false;b.setInsertionPointAfter(loop);b.create<mlir::func::ReturnOp>(loc);
    abi=Object{{"symbol",name},{"functionId",id},{"sourceFunctionId",text(original,"tsfg.query_source_function")},{"loop",int64_t(ordinal)},{"rowCountArgument",0},
      {"queryBinding",text(chunk.getOperand(0).getDefiningOp(),"source_binding")},{"columns",std::move(columnRows)},{"tupleOccurrences",std::move(tuples)},{"scalars",std::move(scalars)}};return true;
  }
  bool run(mlir::ModuleOp original,const Json &effects){
    Array entries;auto cursor=original.getBody()->begin();
    for(const auto &system:m.systems){
      auto fn=llvm::cast<mlir::func::FuncOp>(&*cursor++);size_t ordinal=0;
      for(auto &op:fn.getBody().front())if(op.getName().getStringRef()=="tsfg.chunk"){Json row=nullptr;if(!loop(fn,op,ordinal++,row))return false;entries.push_back(std::move(row));}
    }
    for(const auto &h:m.scalarHelpers)if(!helper(llvm::cast<mlir::func::FuncOp>(&*cursor++),h))return false;
    for(auto key:{"tsfg_core.version","tsfg_core.input_identity","tsfg_core.target","tsfg_core.triple","tsfg_core.data_layout"})(*output)->setAttr(key,original->getAttr(key));
    (*output)->setAttr("tsfg.cpu_batch_version",b.getI32IntegerAttr(1));(*output)->setAttr("tsfg.cpu_batch_source",b.getStringAttr(printed(original)));
    const Json abi=Object{{"family","tsfg.query-cpu-batch-abi-candidate"},{"version",1},{"execution","chunk-work-only"},{"maxRows",65536},{"entries",std::move(entries)}};
    (*output)->setAttr("tsfg.cpu_batch_abi",b.getStringAttr(canonical(abi)));(*output)->setAttr("tsfg.cpu_batch_effects",b.getStringAttr(canonical(effects)));
    return need(mlir::succeeded(mlir::verify(*output)),"standard batch dialect verification failed")&&need(printed(*output).size()<=byteLimit,"standard batch text budget exceeded");
  }
};
}

void registerBatchDialects(mlir::DialectRegistry &registry){registry.insert<mlir::arith::ArithDialect,mlir::scf::SCFDialect,mlir::memref::MemRefDialect>();}
bool isCpuBatch(mlir::ModuleOp module){return module->hasAttr("tsfg.cpu_batch_version");}
mlir::LogicalResult lowerCpuBatch(mlir::ModuleOp module){
  Model m;Json effects=nullptr;if(!m.verify(module)||!collectEffects(module,m,effects))return m.diagnose(module);
  Batch batch(m,module.getContext());if(!batch.run(module,effects))return m.diagnose(module);
  module->setAttrs((*batch.output)->getAttrs());module.getBodyRegion().takeBody(batch.output->getBodyRegion());return mlir::success();
}
mlir::LogicalResult verifyCpuBatch(mlir::ModuleOp module,Json *effects){
  const auto version=module->getAttrOfType<mlir::IntegerAttr>("tsfg.cpu_batch_version");const auto snapshot=module->getAttrOfType<mlir::StringAttr>("tsfg.cpu_batch_source");
  if(!version||!version.getType().isSignlessInteger(32)||version.getInt()!=1||!snapshot||snapshot.getValue().empty()||snapshot.getValue().size()>byteLimit)return module.emitError("[core-ir-query-batch] owned batch version/source snapshot required");
  auto original=mlir::parseSourceString<mlir::ModuleOp>(snapshot.getValue(),module.getContext());if(!original)return mlir::failure();
  Model m;Json expectedEffects=nullptr;if(!m.verify(*original)||!collectEffects(*original,m,expectedEffects))return m.diagnose(module);
  Batch batch(m,module.getContext());if(!batch.run(*original,expectedEffects))return m.diagnose(module);
  if(mlir::failed(mlir::verify(module))||printed(module)!=printed(*batch.output))return module.emitError("[core-ir-query-batch] standard batch differs from independently verified Query lowering");
  if(effects)*effects=std::move(expectedEffects);return mlir::success();
}
} // namespace tsfg::systemQuery
