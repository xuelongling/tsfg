// SPDX-License-Identifier: MIT
#pragma once
#include "bytecode-program.h"
#include "array-owner-json.h"
#include <set>

namespace tsfg::wire {
struct NumericUse {
  uint16_t target=0,successor=0;uint8_t operation=0,arity=0,index=0;std::string group;
};
bool readNumericUse(const Instruction &op,NumericUse &out);
using DominanceBits=std::array<uint64_t,4>;
struct Verifier {
  const Program &program;Error &error;size_t remaining=maxWork;
  const llvm::json::Array *sources=nullptr,*types=nullptr,*domains=nullptr,*abis=nullptr;
  const llvm::json::Object *members=nullptr,*storage=nullptr,*views=nullptr,*modules=nullptr,*authority=nullptr;
  bool reject(llvm::StringRef message);
  bool charge(size_t n=1);
  bool tables();
  bool functions();
  bool function(size_t index);
  bool instruction(const Function &fn,const Instruction &op,bool terminal);
  bool numericInstruction(const Function &fn,const Instruction &op);
  bool numericGroups(const Function &fn,const std::vector<std::vector<uint16_t>> &predecessors,
    const std::vector<DominanceBits> &dominators,const std::vector<int> &definitions,const std::vector<int> &positions);
  bool field(const Function &fn,const Instruction &op,uint16_t receiver,uint32_t member,uint32_t dispatch,uint16_t rhs);
  bool domainIncludes(uint32_t target,uint32_t source);
  uint8_t native(uint32_t domain)const;
};
bool shape(const llvm::json::Object *value,llvm::ArrayRef<llvm::StringRef> fields);
bool unsignedValue(const llvm::json::Value *value,uint64_t maximum,uint64_t &out);
bool unsignedField(const llvm::json::Object *object,llvm::StringRef key,uint64_t maximum,uint64_t &out);
bool textValue(const llvm::json::Value *value,size_t maximum,bool empty=false);
bool identity(const llvm::json::Value *value);
struct Payload {
  llvm::ArrayRef<uint8_t> bytes;size_t at=0;bool good=true;
  explicit Payload(const bytecode::Bytes &value):bytes(value){}
  uint64_t integer(unsigned width) {
    if(width>bytes.size()-at){good=false;return 0;}uint64_t value=0;
    for(unsigned i=0;i<width;++i)value|=uint64_t(bytes[at++])<<(8*i);return value;
  }
  bool done()const{return good&&at==bytes.size();}
};
} // namespace tsfg::wire
