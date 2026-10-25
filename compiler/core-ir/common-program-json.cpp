// SPDX-License-Identifier: MIT
#include "common-program.h"
#include "array-owner-json.h"
#include "bytecode_encoding.h"
namespace tsfg::commonProgram {
bool reject(Error &error,llvm::StringRef code,llvm::StringRef message){
  if(error.message.empty()){error.code=code.str();error.message=message.str();}return false;
}
std::string digest(llvm::StringRef bytes){return "sha256:"+bytecode::hex(bytecode::hash(bytes));}
std::string identity(llvm::StringRef kind,const Json &value){
  return digest("tsfg.common-program."+kind.str()+".v1"+std::string(1,'\0')+canonical(value));
}
bool same(const Json &a,const Json &b){return exception::equal(a,b);}
std::string canonical(const Json &value){
  std::string out;if(!arrays::ownerproof::encodeCanonical(value,out))return {};
  if(!out.empty()&&out.back()=='\n')out.pop_back();return out;
}
bool exact(const Json &value,llvm::ArrayRef<llvm::StringRef> keys){return exception::exact(value,keys);}
bool readJson(llvm::StringRef raw,Json &out,Program &p,Error &error){
  if(raw.empty()||raw.size()>arrays::ownerproof::jsonByteLimit||!p.charge(raw.size()/64+1))
    return reject(error,"core-ir-common-budget","metadata bytes/work exceeded before allocation");
  const auto status=arrays::ownerproof::parseCanonical(raw.str()+"\n",out);
  if(!status)return reject(error,"core-ir-common-canonical","canonical bounded metadata required");
  if(!p.charge(status.counts.tokens+status.counts.members))return reject(error,"core-ir-common-budget","metadata token/member work exceeded");
  return true;
}
} // namespace tsfg::commonProgram
