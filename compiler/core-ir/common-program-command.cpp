// SPDX-License-Identifier: MIT
#include "common-program-command.h"
#include "common-program.h"
#include "common-program-borrows.h"
#include "bytecode-common.h"
#include "bytecode-common-packet.h"
#include "component-layout.h"
#include "mlir/IR/Verifier.h"
#include "mlir/Parser/Parser.h"
#include "llvm/Support/Program.h"
#include "llvm/Support/raw_ostream.h"
#include <algorithm>
#include <iostream>
namespace tsfg::commonProgram {
namespace {
class Output final : public llvm::raw_ostream {
  static constexpr size_t limit = 8388608;
  std::string bytes;
  bool overflow = false;
  void write_impl(const char *data, size_t size) override {
    if (overflow) return;
    if (size > limit - bytes.size()) { overflow = true; return; }
    bytes.append(data, size);
  }
  uint64_t current_pos() const override { return bytes.size(); }
public:
  Output() : llvm::raw_ostream(true) {}
  bool exceeded() const { return overflow; }
  llvm::StringRef value() const { return bytes; }
};
int finish(Output &output){
  if(output.exceeded()){llvm::errs()<<"[core-ir-program-budget] output exceeds candidate byte budget\n";return 3;}
  if(llvm::sys::ChangeStdoutToBinary())return 2;
  llvm::outs()<<output.value();llvm::outs().flush();
  if(llvm::outs().has_error()){llvm::outs().clear_error();return 2;}return 0;
}
}
int printCoreModule(mlir::ModuleOp module){
  Output output;module->print(output,mlir::OpPrintingFlags().printGenericOpForm());output<<'\n';return finish(output);
}
int printCoreJson(const Json &value){Output output;output<<canonical(value)<<'\n';return finish(output);}
int readCoreInput(std::string &bytes) {
  if (llvm::sys::ChangeStdinToBinary()) return 2;
  constexpr size_t limit = 8388608;
  char chunk[4096];
  while (true) {
    const auto requested = std::min(sizeof(chunk), limit - bytes.size() + 1);
    std::cin.read(chunk, static_cast<std::streamsize>(requested));
    const auto count = std::cin.gcount();
    if (count < 0) return 2;
    if (static_cast<size_t>(count) > limit - bytes.size()) {
      llvm::errs() << "[core-ir-program-budget] input exceeds candidate byte budget\n";
      return 3;
    }
    bytes.append(chunk, static_cast<size_t>(count));
    if (std::cin.eof()) return 0;
    if (!std::cin) return 2;
  }
}
int runGpuBindingInput(llvm::StringRef bytes,mlir::MLIRContext &context){
  Program budget;Error error;Json input=nullptr,plan=nullptr;
  const auto failure=[&](){
    llvm::errs()<<"["<<error.code<<"] "<<error.message;
    if(!error.path.empty())llvm::errs()<<" ("<<error.path<<":"<<error.range.start<<":"<<error.range.end<<")";
    llvm::errs()<<'\n';return 3;
  };
  if(!bytes.ends_with("\n")){reject(error,"core-ir-common-gpu-canonical","canonical GPU input requires one final LF");return failure();}
  if(!readJson(bytes.drop_back(),input,budget,error))return failure();
  if(!exact(input,{"family","version","core","request","plan"})||
      exception::string(exception::field(input,"family"))!="tsfg.gpu-logical-binding-input"||
      exception::field(input,"version").getAsInteger()!=1||!exception::field(input,"core").getAsString()){
    reject(error,"core-ir-common-gpu-input","logical GPU input identity differs");return failure();
  }
  auto module=mlir::parseSourceString<mlir::ModuleOp>(*exception::field(input,"core").getAsString(),&context);
  if(!module){reject(error,"core-ir-common-gpu-core","complete Common Core parse or verification failed");return failure();}
  Program program;
  if(!readCore(*module,program,error))return failure();
  if(!program.charge(programWorkLimit-budget.remaining)){
    reject(error,"core-ir-common-gpu-budget","GPU input and Core shared work exceeded");return failure();
  }
  if(!createGpuBindingPlan(program,exception::field(input,"request"),plan,error))return failure();
  const auto &asserted=exception::field(input,"plan");
  if(!asserted.getAsNull()&&!same(asserted,plan)){
    reject(error,"core-ir-common-gpu-plan","asserted logical GPU plan differs from independent reconstruction");return failure();
  }
  return printCoreJson(plan);
}
int runCoreModule(mlir::ModuleOp module, llvm::StringRef command) {
  if (mlir::failed(mlir::verify(module))) return 3;
  if (command != "--component-layouts" && command != "--borrow-proof" && command != "--emit-bytecode" && mlir::failed(verify(module))) return 3;
  if (command == "--emit-bytecode") {
    wire::Program program; wire::Error error; bytecode::Bytes packet;
    if (!wire::normalizeCommon(module,program,error) || !wire::encodeCommon(program,packet,error)) {
      llvm::errs()<<"[r04-core-invalid] "<<error.message<<'\n'; return 3;
    }
    if (llvm::sys::ChangeStdoutToBinary()) return 2;
    llvm::outs().write(reinterpret_cast<const char *>(packet.data()),packet.size());
    llvm::outs().flush();
    if (llvm::outs().has_error()) { llvm::outs().clear_error(); return 2; }
    return 0;
  }
  Output output;
  if (command == "--component-layouts" || command == "--borrow-proof") {
    Program program; Error error; Json layouts = nullptr;
    if (!readCore(module, program, error) || !(command=="--borrow-proof"?analyzeCommonBorrowProof(program,error,layouts):verifyProgram(program, error)) ||
        (command=="--component-layouts" && !componentLayouts(program, layouts, error))) {
      llvm::errs() << "[" << error.code << "] " << error.message;
      if (!error.path.empty()) llvm::errs() << " (" << error.path << ":" << error.range.start << ":" << error.range.end << ")";
      llvm::errs() << "\n"; return 3;
    }
    output << canonical(layouts);
  } else return printCoreModule(module);
  output << '\n';
  return finish(output);
}
}
