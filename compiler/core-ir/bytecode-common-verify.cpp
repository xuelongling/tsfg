// SPDX-License-Identifier: MIT
#include "bytecode-common.h"
#include "bytecode-common-cold.h"
#include "llvm/Support/raw_ostream.h"
#include <cstdlib>

namespace tsfg::wire {
bool verifyCommonProgram(const Program &program,Error &error){
  error={};size_t remaining=commonProgram::programWorkLimit,bytes=0;CommonTableVerifier tables{program,error,remaining};
  const bool tracing=std::getenv("TSFG_COMMON_ACTUAL_TRACE")!=nullptr;
  const auto phase=[&](const char *name){if(tracing)llvm::errs()<<"[DEBUG-23j-common-cold] "<<name<<" remaining="<<remaining<<'\n';};
  phase("begin");
  for(const auto &table:program.tables){
    const auto measured=arrays::ownerproof::measureCanonical(table);
    if(!measured||measured.counts.depth>32||measured.counts.bytes>maxBytes-bytes||!tables.charge(measured.counts.tokens+measured.counts.members+measured.counts.bytes/64+1))return tables.reject("Common normalized table bytes/depth/work preflight");
    bytes+=measured.counts.bytes;
  }
  phase("tables-preflight");
  if(program.functions.empty()||program.functions.size()>4096)return tables.reject("Common complete function count");
  for(const auto &fn:program.functions){
    if(!tables.charge(fn.blocks.size()+fn.registers.size()+fn.name.size()/64+1)||fn.blocks.empty()||fn.blocks.size()>256||fn.registers.size()>4096||
      fn.name.empty()||fn.name.size()>4096)return tables.reject("Common actual function/block/register preflight");
    const llvm::json::Value name(fn.name);if(!textValue(&name,4096,false))return tables.reject("Common function UTF8/name boundary");
    size_t instructions=0;
    for(const auto &block:fn.blocks){
      if(block.parameters.size()>64||block.instructions.empty()||block.instructions.size()>8192-instructions||!tables.charge(block.parameters.size()+1))return tables.reject("Common actual block/instruction preflight");
      instructions+=block.instructions.size();
      for(const auto &op:block.instructions){
        if(op.operands.size()>4096||op.payload.size()>maxBytes-bytes||!tables.charge(op.operands.size()+op.payload.size()/64+1))return tables.reject("Common instruction payload/operand preflight");
        bytes+=op.payload.size();
      }
    }
  }
  phase("graph-preflight");
  if(!verifyCommonTables(tables)){phase("tables");return false;}
  phase("tables");
  CommonCold cold{tables};
  cold.model.sourcePath=program.sourcePath;cold.model.sourceHash="sha256:"+bytecode::hex(program.sourceHash);
  cold.model.sourceLength=program.sourceLength;cold.model.inputIdentity="sha256:"+bytecode::hex(program.input);
  const auto stage=[&](const char *name,bool (CommonCold::*run)()){const bool valid=(cold.*run)();phase(name);return valid;};
  const bool structural=stage("publication-boundary",&CommonCold::publicationBoundary)&&stage("metadata",&CommonCold::metadata)&&
    stage("interfaces",&CommonCold::interfaces)&&stage("modules",&CommonCold::modules)&&stage("entries",&CommonCold::entries)&&
    stage("publication",&CommonCold::publication)&&stage("graphs",&CommonCold::graphs)&&stage("structure",&CommonCold::graphStructure)&&
    stage("construction",&CommonCold::construction)&&stage("targets",&CommonCold::targets);
  if(!structural)return false;
  // Receiver state first solves storage/ABI; its live check then proves the
  // independent normalized effects before replaying borrow observations.
  // Ordinary programs retain their existing effects-then-actual order.
  if(cold.containsReceiverProtocol)return stage("receiver-state",&CommonCold::actual);
  return stage("effects",&CommonCold::effects)&&cold.actual();
}
} // namespace tsfg::wire
