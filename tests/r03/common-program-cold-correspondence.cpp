// SPDX-License-Identifier: MIT
// Passive test main: replace normal role238, retain role097. This is not a
// Bytes-to-Program decoder. The production Core normalizer supplies the owned
// Program; exact production encoding joins it to the separately emitted packet.
#include "bytecode-common.h"
#include "bytecode-common-packet.h"
#include "bytecode.h"
#include "dialect.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "mlir/IR/DialectRegistry.h"
#include "mlir/IR/Verifier.h"
#include "mlir/Parser/Parser.h"
#include "llvm/Support/raw_ostream.h"
#include <algorithm>
#include <array>
#include <fstream>
#include <optional>
#include <string>

namespace {
using tsfg::wire::Program;

bool readFile(const char *path,std::string &out){
  std::ifstream input(path,std::ios::binary);
  if(!input){llvm::errs()<<"FAIL input open: "<<path<<'\n';return false;}
  char buffer[4096];
  while(true){
    const auto count=std::min(sizeof(buffer),tsfg::wire::maxBytes-out.size()+1);
    input.read(buffer,static_cast<std::streamsize>(count));const auto bytes=input.gcount();
    if(bytes<0||static_cast<size_t>(bytes)>tsfg::wire::maxBytes-out.size()){
      llvm::errs()<<"FAIL bounded input: "<<path<<'\n';return false;
    }
    out.append(buffer,static_cast<size_t>(bytes));
    if(input.eof())return true;
    if(!input){llvm::errs()<<"FAIL input read: "<<path<<'\n';return false;}
  }
}

enum class Mutation {MissingPlan,DuplicateDefinition,OperandBound,StaticView,Operation,Anchor,Constant};
struct Test {const char *name;Mutation mutation;const char *gate;const char *alternate="";};
struct Selection {size_t function=0,block=0,operation=0;int64_t reg=-1;};

// Only normalized, already encoded baseline values enter this internal helper.
// Each case changes one real witness field; none reconstructs warm authority.
std::optional<Selection> mutate(Program &program,Mutation mutation){
  auto &abis=*program.table(tsfg::wire::Table::Abis).getAsArray();
  if(mutation==Mutation::MissingPlan){
    if(abis.empty())return std::nullopt;
    abis[0].getAsObject()->erase("sourcePlan");return Selection{};
  }
  for(size_t f=0;f<abis.size();++f){
    auto &plan=*abis[f].getAsObject()->getObject("sourcePlan");
    auto &carriers=*plan.getArray("carriers"),&blocks=*plan.getArray("blocks");
    std::optional<int64_t> firstDefinition;
    for(size_t b=0;b<blocks.size();++b){
      auto &block=*blocks[b].getAsObject();
      for(const auto &parameter:*block.getArray("parameters"))
        if(!firstDefinition)firstDefinition=*parameter.getAsInteger();
      auto &operations=*block.getArray("operations");
      for(size_t n=0;n<operations.size();++n){
        auto &op=*operations[n].getAsObject();const auto result=op.getInteger("result");
        const auto name=*op.getString("name");Selection selected{f,b,n,result?*result:-1};
        if(mutation==Mutation::DuplicateDefinition&&result&&firstDefinition&&*result!=*firstDefinition){
          op["result"]=*firstDefinition;return selected;
        }
        if(result&&!firstDefinition)firstDefinition=*result;
        if(mutation==Mutation::OperandBound&&!op.getArray("operands")->empty()){
          (*op.getArray("operands"))[0]=static_cast<int64_t>(carriers.size());return selected;
        }
        if(mutation==Mutation::StaticView&&name=="receiver_create"&&result){
          auto &view=carriers[static_cast<size_t>(*result)];
          view=view.getAsString()->str()+"/cold-witness-mutant";return selected;
        }
        // Constants have no numeric-use prefix. Keep properties/operands and
        // the actual wire instruction intact, so these exercise correspondence.
        if(name!="constant")continue;
        if(mutation==Mutation::Operation){op["name"]="boolean";return selected;}
        if(mutation==Mutation::Anchor){
          auto &source=*op.getObject("source");const auto start=*source.getInteger("start");
          if(start<*source.getInteger("end")){source["start"]=start+1;return selected;}
        }
        if(mutation==Mutation::Constant){
          auto &properties=*op.getObject("properties");
          if(const auto decimal=properties.getString("decimal")){
            properties["decimal"]=*decimal=="1"?"2":"1";return selected;
          }
        }
      }
    }
  }
  return std::nullopt;
}
} // namespace

int main(int argc,char **argv){
  if(argc!=3){llvm::errs()<<"usage: cold-correspondence <same-core.mlir> <actual-positive.packet>\n";return 2;}
  std::string core,packet;
  if(!readFile(argv[1],core)||!readFile(argv[2],packet))return 2;
  mlir::DialectRegistry registry;tsfg::registerCoreDialect(registry);
  tsfg::commonProgram::registerDialect(registry);
  registry.insert<mlir::func::FuncDialect,mlir::cf::ControlFlowDialect>();
  mlir::MLIRContext context(registry);context.disableMultithreading();
  auto module=mlir::parseSourceString<mlir::ModuleOp>(core,&context);
  if(!module||mlir::failed(mlir::verify(*module))){llvm::errs()<<"FAIL production Core parser/verifier\n";return 1;}
  Program baseline;tsfg::wire::Error error;
  if(!tsfg::wire::normalizeCommon(*module,baseline,error)){
    llvm::errs()<<"FAIL normalizeCommon: "<<error.message<<" offset="<<error.offset<<'\n';return 1;
  }
  tsfg::bytecode::Bytes encoded;
  // encodeCommon owns baseline cold validation; do not verify it again.
  if(!tsfg::wire::encodeCommon(baseline,encoded,error)){
    llvm::errs()<<"FAIL baseline encode: "<<error.message<<" offset="<<error.offset<<'\n';return 1;
  }
  if(encoded.size()!=packet.size()||!std::equal(encoded.begin(),encoded.end(),packet.begin(),
      [](uint8_t a,char b){return a==static_cast<uint8_t>(b);})){llvm::errs()<<"FAIL complete positive packet bytes differ\n";return 1;}
  llvm::outs()<<"PASS production baseline packet byte-exact bytes="<<encoded.size()<<'\n';
  const std::array<Test,7> tests={{
    {"required-sourcePlan",Mutation::MissingPlan,"Common ABI shape/reference"},
    {"duplicate-semantic-definition",Mutation::DuplicateDefinition,"Common sourcePlan duplicate/invalid result"},
    {"semantic-operand-out-of-bounds",Mutation::OperandBound,"Common sourcePlan operand reference"},
    {"original-static-view",Mutation::StaticView,"Common sourcePlan raw/semantic original static view differs","carrier adapter changed the original view or anchor"},
    {"logical-operation-name",Mutation::Operation,"actual instruction differs from complete Source lowering"},
    {"logical-source-anchor",Mutation::Anchor,"actual instruction differs from complete Source lowering"},
    {"constant-typed-value",Mutation::Constant,"actual instruction differs from complete Source lowering"}
  }};
  size_t passed=0,missing=0,failed=0;
  for(const auto &test:tests){
    Program changed=baseline;const auto selected=mutate(changed,test.mutation);
    if(!selected){++missing;llvm::outs()<<"NOT_APPLICABLE "<<test.name<<" actual selector absent; no coverage credit\n";continue;}
    llvm::outs()<<"SELECT "<<test.name<<" function=sha256:"<<tsfg::bytecode::hex(baseline.functions[selected->function].id)
      <<" abi="<<selected->function<<" block="<<selected->block<<" operation="<<selected->operation<<" register="<<selected->reg<<'\n';
    tsfg::wire::Error rejection;
    // No warm re-admission or encoding after mutation: this is the real cold
    // verifier consuming the copied owned Program under its ordinary work cap.
    const bool accepted=tsfg::wire::verifyCommonProgram(changed,rejection);
    const bool expected=!accepted&&(rejection.message==test.gate||
      (*test.alternate&&rejection.message==test.alternate));
    const auto message=llvm::StringRef(rejection.message);
    const bool budget=message.contains("budget")||message.contains("exhaust");
    if(expected&&!budget)++passed;else ++failed;
    llvm::outs()<<(expected&&!budget?"PASS ":"FAIL ")<<test.name<<" accepted="<<accepted
      <<" category="<<(budget?"BUDGET_REJECTION":expected?"EXPECTED_GATE":"WRONG_GATE")
      <<" error="<<rejection.message<<" offset="<<rejection.offset<<'\n';
  }
  // The supplied Source248 has no catch/empty-source/env_parent coverage here.
  llvm::outs()<<"SUMMARY selected="<<passed+failed<<" passed="<<passed<<" failed="<<failed
    <<" notApplicable="<<missing<<" planned="<<tests.size()<<'\n';
  return failed||missing?1:0;
}
