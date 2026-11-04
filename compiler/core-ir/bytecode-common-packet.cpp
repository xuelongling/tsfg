// SPDX-License-Identifier: MIT
#include "bytecode-common-packet.h"
#include "bytecode-common.h"
#include "array-owner-json.h"
#include "bytecode.h"
#include "llvm/IR/DataLayout.h"
#include "llvm/IR/LLVMContext.h"
#include "llvm/IR/Type.h"
#include "llvm/Support/SHA256.h"

namespace tsfg::wire {
namespace {
// One traversal is used to measure and write. Saturating checks precede every
// allocation/append, including complete dictionary strings and repeated uses.
class Output {
  bytecode::Bytes *bytes;
  size_t count = 0;
  bool good = true;
public:
  explicit Output(bytecode::Bytes *value) : bytes(value) {}
  bool add(size_t n) {
    if (!good || n > maxBytes - 80 - count) { good = false; return false; }
    count += n; return true;
  }
  void integer(uint64_t n, unsigned width) {
    if ((width < 8 && n >> (width * 8)) || !add(width)) { good = false; return; }
    if (bytes) bytecode::integer(*bytes,n,width);
  }
  void data(llvm::ArrayRef<uint8_t> data) {
    if (add(data.size()) && bytes) bytes->insert(bytes->end(),data.begin(),data.end());
  }
  void text(llvm::StringRef value) {
    integer(value.size(),4);
    data(llvm::ArrayRef<uint8_t>(reinterpret_cast<const uint8_t *>(value.data()),value.size()));
  }
  void anchor(Anchor value) { integer(value.start,4); integer(value.end,4); }
  bool ok() const { return good; }
  size_t size() const { return count; }
};
bool payload(const Program &p, const std::array<std::string,static_cast<size_t>(Table::Count)> &tables,
             Output &out) {
  llvm::DataLayout layout(coreHeader::layout); llvm::LLVMContext context;
  const auto i32 = llvm::Type::getInt32Ty(context);
  out.text(coreHeader::target); out.text(coreHeader::triple); out.text(coreHeader::layout);
  out.integer(layout.getTypeAllocSize(i32).getFixedValue(),2);
  out.integer(layout.getABITypeAlign(i32).value(),2);
  out.integer(layout.getPointerSizeInBits(0),2); out.integer(layout.getPointerABIAlignment(0).value(),2);
  out.integer(capability,4); out.data(p.input); out.data(p.sourceHash);
  out.text(p.sourcePath); out.integer(p.sourceLength,4); out.integer(p.rootSource,2);
  out.integer(tables.size(),1);
  for (size_t i=0;i<tables.size();++i) { out.integer(i,1); out.text(tables[i]); }
  out.integer(p.functions.size(),2);
  for (const auto &fn:p.functions) {
    out.data(fn.id); out.data(fn.signature); out.integer(fn.abi,4); out.integer(fn.source,2);
    out.integer(fn.role,1); out.integer(0,1); out.anchor(fn.declaration); out.text(fn.name);
    out.integer(fn.registers.size(),2); out.integer(fn.blocks.size(),2);
    size_t instructions=0;for(const auto &block:fn.blocks)instructions+=block.instructions.size();
    out.integer(instructions,2);
    for(const auto &reg:fn.registers){out.integer(reg.domain,4);out.integer(reg.view,2);out.integer(reg.kind,2);}
    for(const auto &block:fn.blocks) {
      out.integer(block.parameters.size(),2);for(auto reg:block.parameters)out.integer(reg,2);
      out.integer(block.instructions.size(),2);
      for(const auto &op:block.instructions) {
        out.integer(op.opcode,1);out.integer(op.anchorFlags,1);out.integer(op.result,2);
        out.integer(op.operands.size(),4);out.anchor(op.source);out.integer(op.sourceIndex,2);
        for(auto reg:op.operands)out.integer(reg,2);
        for(auto anchor:op.extraAnchors)out.anchor(anchor);
        out.data(op.payload);
      }
    }
  }
  return out.ok();
}
}
bool encodeCommon(const Program &program, bytecode::Bytes &bytes, Error &error) {
  static_assert(version==20 && capability==1020);
  bytes.clear();error={};bytecode::Hash schemaHash;
  if(!bytecode::decodeHash(("sha256:"+coreHeader::commonProgramBytecodeSchema).str(),schemaHash)){
    error.message="Common exact development schema identity";return false;
  }
  // The sole installed prospective codec is Common-only. No legacy dispatcher,
  // warm re-admission, caller-selected hash or body-derived authority is used.
  if(!verifyCommonProgram(program,error))return false;
  std::array<std::string,static_cast<size_t>(Table::Count)> tables;
  size_t textBytes=0;
  for(size_t i=0;i<tables.size();++i) {
    const auto measured=arrays::ownerproof::measureCanonical(program.tables[i]);
    if(!measured||measured.counts.bytes>maxBytes-textBytes) {
      error.message="formal table measurement/byte budget";return false;
    }
    if(!arrays::ownerproof::encodeCanonical(program.tables[i],tables[i])) {
      error.message="noncanonical formal table";return false;
    }
    tables[i].pop_back();
    if(tables[i].size()>maxBytes-textBytes){error.message="formal table byte budget";return false;}
    textBytes+=tables[i].size();
  }
  Output measured(nullptr);
  if(!payload(program,tables,measured)){error.message="formal packet byte budget";return false;}
  bytecode::Bytes body;body.reserve(measured.size());Output written(&body);
  if(!payload(program,tables,written)||body.size()!=measured.size()) {
    error.message="formal measured/emitted bytes differ";return false;
  }
  bytecode::Bytes packet{'T','S','F','G','T','B','C','0'};
  bytecode::integer(packet,version,4);bytecode::appendHash(packet,schemaHash);
  bytecode::integer(packet,80+body.size(),4);bytecode::appendHash(packet,llvm::SHA256::hash(body));
  packet.insert(packet.end(),body.begin(),body.end());bytes=std::move(packet);return true;
}
} // namespace tsfg::wire
