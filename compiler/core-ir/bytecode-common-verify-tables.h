// SPDX-License-Identifier: MIT
#pragma once
#include "bytecode-verify.h"
#include <map>
#include <optional>
#include <vector>

namespace tsfg::wire {
// One cold boundary establishes these directory shapes and references. The
// semantic/layout passes below consume those records, never producer state.
struct CommonTableVerifier {
  using Json=llvm::json::Value;using Object=llvm::json::Object;using Array=llvm::json::Array;
  struct Carrier {uint16_t kind=0;uint32_t ref=0;bool operator==(const Carrier &b)const{return kind==b.kind&&ref==b.ref;}};
  struct Layout {uint32_t bytes=0,alignment=1,roots=0;std::vector<uint32_t> offsets;};
  const Program &program;Error &error;size_t &remaining;
  const Array *sources=nullptr,*types=nullptr,*domains=nullptr,*abis=nullptr;
  const Array *fields=nullptr,*methods=nullptr,*constructions=nullptr,*bindings=nullptr,*concrete=nullptr,*arrays=nullptr;
  const Array *environments=nullptr,*closureFunctions=nullptr,*calls=nullptr,*scopes=nullptr,*cells=nullptr,*handlers=nullptr;
  const Array *environmentLayouts=nullptr,*modules=nullptr,*globals=nullptr,*hosts=nullptr,*initialization=nullptr;
  const Array *compatibilities=nullptr,*dispatch=nullptr,*entries=nullptr;const Object *roots=nullptr;
  std::vector<std::vector<uint32_t>> compatibilityDependencies;
  std::vector<std::vector<uint32_t>> ownFields,ownMethods;
  std::vector<uint32_t> typeConstruction,typeStorage,arrayBinding,sourceModule;
  std::map<std::string,uint32_t> functionIds,typeIds,globalIds,moduleIds,methodIds;
  std::vector<std::string> labels;std::vector<Json> shapes;
  std::vector<uint8_t> labelState,typeState,domainState;
  std::vector<std::optional<Layout>> typeLayouts,domainLayouts;
  bool reject(llvm::StringRef message);
  bool charge(size_t count=1);
  bool ref(const Json *value,size_t count,uint32_t &out,bool nullable=false);
  bool origin(const Json *value,bool nullable=false);
  bool carrier(const Json *value,Carrier &out,bool nullable=false,bool storage=false);
  bool layoutShape(const Object *row,bool offsets=false);
  bool hash(llvm::StringRef domain,const Json &material,llvm::StringRef expected);
  bool canonical(const Json &value,std::string &out);
  bool directory();bool typeRows();bool memberRows();bool storageRows();bool moduleRows();
  bool semanticTypes();bool memberJoins();bool storageJoins();bool moduleJoins();
  bool label(uint32_t type,unsigned depth=0);
  bool typeLayout(uint32_t type,unsigned depth=0);
  bool domainLayout(uint32_t domain,unsigned depth=0);
  bool carrierLayout(Carrier carrier,Layout &out,unsigned depth=0);
  bool bodyLayout(uint32_t type,Layout &out,unsigned depth=0);
  bool append(Layout &parent,const Layout &child);
  bool physical(const Object &given,const Layout &expected,bool offsets=false);
  bool lineage(uint32_t type,std::vector<uint32_t> &out);
};
bool verifyCommonTables(CommonTableVerifier &);
} // namespace tsfg::wire
