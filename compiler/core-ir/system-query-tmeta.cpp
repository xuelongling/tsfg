// SPDX-License-Identifier: MIT
#include "system-query.h"
#include "common-program-header.h"
#include "array-owner-json-policy.h"
#include "mlir/Parser/Parser.h"
#include "llvm/Support/raw_ostream.h"
#include "llvm/Support/Program.h"
#include "llvm/Support/Error.h"

namespace tsfg::systemQuery {
using exception::field;using exception::items;using exception::string;
namespace {
using namespace commonProgram;
constexpr size_t byteLimit=8388608;
constexpr llvm::StringLiteral schema="sha256:d598644bbd5360feb48a17cb2511dc93b4dbb2785d2a3f111759dfb6c1b2c69b";
constexpr llvm::StringLiteral layoutSchema="sha256:26a6e0fe97b3f269eba8aec94061c980c5985eb5f3595c9feb4bc7c13036db8f";
constexpr arrays::ownerproof::JsonPolicy jsonPolicy{byteLimit,byteLimit,1000000,1000000,128};
std::string text(mlir::Operation *op,llvm::StringRef key){return op->getAttrOfType<mlir::StringAttr>(key).getValue().str();}
std::string printed(mlir::ModuleOp module){std::string value;llvm::raw_string_ostream out(value);module->print(out,mlir::OpPrintingFlags().printGenericOpForm());out<<'\n';return value;}
// The transport owns a different string/token policy from the old array proof.
// Both families use the same strict Unicode, numeric and canonical algorithm.
struct TmetaCodec {
  bool valid=true;
  std::string canonical(const Json &value){
    std::string encoded;
    if(!arrays::ownerproof::encodeCanonical(value,encoded,jsonPolicy)||encoded.empty()||encoded.size()>byteLimit){valid=false;return {};}
    encoded.pop_back();return encoded;
  }
  Json envelope(llvm::StringRef family,int64_t version,llvm::StringRef schemaHash,llvm::StringRef domain,const Json &payload){
    const auto body=canonical(payload);
    return Object{{"family",family},{"version",version},{"schemaHash",schemaHash},{"payload",body},{"payloadHash",digest(domain.str()+std::string(1,'\0')+body)}};
  }
};

// Only called after the one owning batch verifier. The source, ABI and layout
// strings are now typed producer values, not a second unknown JSON boundary.
bool metadata(mlir::ModuleOp batch,const Json &effects,Json &out){
  TmetaCodec codec;
  auto source=mlir::parseSourceString<mlir::ModuleOp>(text(batch,"tsfg.cpu_batch_source"),batch.getContext());
  auto packet=llvm::cantFail(llvm::json::parse(text(*source,"tsfg.query_facts")));
  auto request=llvm::cantFail(llvm::json::parse(text(*source,"tsfg.query_request")));
  auto catalog=llvm::cantFail(llvm::json::parse(text(*source,"tsfg.query_layouts")));
  auto abi=llvm::cantFail(llvm::json::parse(text(batch,"tsfg.cpu_batch_abi")));
  const auto &target=field(field(field(packet,"payload"),"program"),"target");
  const Json layoutCatalog=Object{{"components",field(catalog,"components")},{"types",field(catalog,"types")},{"target",target}};
  const Json layouts=Object{{"components",field(catalog,"components")},{"types",field(catalog,"types")},{"target",target},
    {"inputIdentity",field(effects,"inputIdentity")},{"hirDigest",digest(codec.canonical(layoutCatalog)+"\n")}};
  const auto layoutText=codec.canonical(codec.envelope("tsfg.component-layout-candidate",1,layoutSchema,"tsfg.component-layout.v1",layouts))+"\n";
  const auto batchText=printed(batch),effectText=codec.canonical(effects)+"\n";
  std::map<std::string,mlir::func::FuncOp> functions;
  for(auto fn:batch.getOps<mlir::func::FuncOp>())functions.emplace(fn.getSymName().str(),fn);
  std::map<std::string,const Json *> systems,originals;
  for(const auto &system:items(field(effects,"systems")))systems.emplace(string(field(system,"functionId")),&system);
  for(const auto &system:items(field(field(packet,"payload"),"systems")))originals.emplace(string(field(field(system,"declaration"),"id")),&system);
  Array entries;
  for(const auto &row:items(field(abi,"entries"))){
      const auto &system=*systems.at(string(field(row,"functionId")));
      const auto &original=*originals.at(string(field(system,"sourceFunctionId")));
      const auto &loop=items(field(system,"loops"))[static_cast<size_t>(*field(row,"loop").getAsInteger())];
      Array columns,tuples,scalars;
      std::map<std::string,int64_t> indexes;int64_t index=0;
      for(const auto &column:items(field(row,"columns"))){
        const auto component=string(field(column,"componentType"));const Json *selected=nullptr;
        for(const auto &occurrence:items(field(loop,"columns")))if(string(field(occurrence,"componentType"))==component){selected=&occurrence;break;}
        indexes.emplace(component,index);
        columns.push_back(Object{{"index",index++},{"componentType",component},{"sourceComponentType",field(*selected,"sourceComponentType")},
          {"access",field(column,"mode")},{"alignment",field(column,"alignment")},{"stride",field(column,"stride")},
          {"bufferArgument",field(column,"bufferArgument")},{"strideArgument",field(column,"strideArgument")}});
      }
      for(const auto &tuple:items(field(row,"tupleOccurrences")))tuples.push_back(Object{{"tupleIndex",field(tuple,"tupleIndex")},
        {"sourceBinding",field(tuple,"sourceBinding")},{"componentType",field(tuple,"componentType")},{"mode",field(tuple,"mode")},
        {"columnIndex",indexes.at(string(field(tuple,"componentType")))},{"bufferArgument",field(tuple,"bufferArgument")}});
      for(const auto &scalar:items(field(row,"scalars"))){
        const auto &parameter=items(field(original,"parameters"))[static_cast<size_t>(*field(scalar,"sourceParameter").getAsInteger())];
        scalars.push_back(Object{{"argument",field(scalar,"argument")},{"sourceParameter",field(scalar,"sourceParameter")},
          {"sourceBinding",field(field(parameter,"binding"),"id")},{"type",field(parameter,"logicalType")}});
      }
      std::string abiType;llvm::raw_string_ostream typeOut(abiType);functions.at(string(field(row,"symbol"))).getFunctionType().print(typeOut);
      entries.push_back(Object{{"entrySymbol",field(row,"symbol")},{"logicalFunctionId",field(system,"functionId")},
        {"sourceFunctionId",field(system,"sourceFunctionId")},{"signatureHash",field(system,"signatureHash")},{"source",field(loop,"source")},
        {"loop",field(row,"loop")},{"queryBinding",field(row,"queryBinding")},{"rowCountArgument",0},{"abiType",abiType},
        {"columns",std::move(columns)},{"tupleOccurrences",std::move(tuples)},{"scalars",std::move(scalars)}});
  }
  const Json payload=Object{{"batch",batchText},{"batchHash",digest(batchText)},{"componentLayouts",layoutText},{"layoutHash",digest(layoutText)},
    {"effects",effectText},{"effectsHash",digest(effectText)},{"entries",std::move(entries)},
    {"functionIdentityDomain","tsfg.module-callable-function.candidate.v1"},{"inputIdentity",field(effects,"inputIdentity")},
    {"packageId",field(effects,"packageId")},{"sourcePacket",codec.canonical(packet)+"\n"},{"sourceRequest",codec.canonical(request)+"\n"},{"target",target}};
  auto candidate=codec.envelope("tsfg.query-tmeta",2,schema,"tsfg.query-tmeta.v2",payload);
  codec.canonical(candidate);if(!codec.valid)return false;
  out=std::move(candidate);return true;
}
}

mlir::LogicalResult produceTmeta(mlir::ModuleOp module,commonProgram::Json &out){
  // Work on an owning clone: requesting metadata cannot mutate a caller's IR.
  mlir::OwningOpRef<mlir::ModuleOp> batch=llvm::cast<mlir::ModuleOp>(module->clone());
  if(isCpuLLVM(*batch)){
    if(mlir::failed(verifyCpuLLVM(*batch)))return mlir::failure();
    batch=mlir::parseSourceString<mlir::ModuleOp>(text(*batch,"tsfg.cpu_llvm_source"),module.getContext());
  }
  commonProgram::Json effects=nullptr;
  if(isCpuBatch(*batch)){
    if(mlir::failed(verifyCpuBatch(*batch,&effects)))return mlir::failure();
  }else{
    if(mlir::failed(lowerCpuBatch(*batch)))return mlir::failure();
    // lowerCpuBatch already owns full Source/SSA verification and derives this
    // actual report. Do not repeat the Source checker on that typed result.
    effects=llvm::cantFail(llvm::json::parse(text(*batch,"tsfg.cpu_batch_effects")));
  }
  if(!metadata(*batch,effects,out))return module.emitError("[core-ir-query-tmeta] metadata codec/byte budget exceeded");
  return mlir::success();
}

int printTmeta(const commonProgram::Json &value){
  std::string output;
  if(!arrays::ownerproof::encodeCanonical(value,output,jsonPolicy)||output.empty()||output.size()>byteLimit){
    llvm::errs()<<"[core-ir-query-tmeta] canonical output exceeded metadata policy\n";return 3;
  }
  if(llvm::sys::ChangeStdoutToBinary())return 2;
  llvm::outs()<<output;llvm::outs().flush();
  if(llvm::outs().has_error()){llvm::outs().clear_error();return 2;}return 0;
}

int canonicalizeTmeta(llvm::StringRef bytes,mlir::MLIRContext &context){
  using namespace commonProgram;
  const auto reject=[](){llvm::errs()<<"[core-ir-query-tmeta] owned metadata/source/batch identity differs\n";return 3;};
  if(bytes.empty()||bytes.size()>byteLimit)return reject();
  Json root=nullptr;
  if(!arrays::ownerproof::parseCanonical(bytes,root,jsonPolicy)||
    !exact(root,{"family","payload","payloadHash","schemaHash","version"})||string(field(root,"family"))!="tsfg.query-tmeta"||
    field(root,"version").getAsInteger()!=2||string(field(root,"schemaHash"))!=schema)return reject();
  const auto body=field(root,"payload").getAsString();if(!body||body->size()>byteLimit||
    string(field(root,"payloadHash"))!=digest(std::string("tsfg.query-tmeta.v2")+std::string(1,'\0')+body->str()))return reject();
  Json payload=nullptr;if(!arrays::ownerproof::parseCanonical(body->str()+"\n",payload,jsonPolicy))return reject();
  const auto batchText=field(payload,"batch").getAsString();if(!batchText||batchText->empty()||batchText->size()>8388608)return reject();
  auto batch=mlir::parseSourceString<mlir::ModuleOp>(*batchText,&context);if(!batch)return reject();
  Json expected=nullptr;if(mlir::failed(produceTmeta(*batch,expected)))return reject();
  TmetaCodec codec;const auto actual=codec.canonical(root),reconstructed=codec.canonical(expected);
  if(!codec.valid||actual!=reconstructed)return reject();
  return printTmeta(expected);
}
} // namespace tsfg::systemQuery
