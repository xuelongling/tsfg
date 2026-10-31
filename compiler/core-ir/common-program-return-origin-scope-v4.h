// SPDX-License-Identifier: MIT
#pragma once
#include "common-program-return-origin-domain-v4.h"

// This typed projection consumes an ALREADY ADMITTED fixed Scope. It does not
// read a replaceable body HIR or admit hashes, owners, brands or permissions.
namespace CommonReturnOriginScopeV4 {
namespace V4=CommonReturnOriginV4;
namespace Domain=CommonReturnOriginDomainV4;

struct Field {std::string name;std::uint64_t index=0;};
struct Shape {V4::TypeKind kind=V4::TypeKind::Future;std::vector<Field> fields;};
struct Type {std::string id,label;Shape shape;};
struct Function {
  std::string functionId;
  V4::FunctionKind kind=V4::FunctionKind::Future;
  // Fixed Scope logical vector: ordinary method receiver ALREADY INCLUDED.
  std::vector<std::string> parameterTypes;
  std::string returnType;
  std::optional<std::string> lexicalEnvironment,activationEnvironment;
};
struct Global {std::string globalId,type;};
using Slot=V4::EnvironmentSlot;
struct Environment {std::string id;std::optional<std::string> parent;std::vector<Slot> slots;};
struct FixedScope {
  std::string profile;
  // Complete interpretation archive, not a stable declaration-ID subset.
  std::vector<Type> types;
  std::vector<Function> functions;
  std::vector<Global> globals;
  std::vector<Environment> environments;
};

// TRUSTED algorithm dependency, not untrusted data or a field permission:
// sha256("tsfg.common-program.field.v1\0" + canonical({owner,name,index})).
// Includes the NUL; canonical keys sort as index,name,owner, use the established
// well-formed string/JSON escaping rules, and returns "sha256:"+64 lowercase hex.
// Bind only to the admitted compiler's existing commonFieldId/commonIdentity
// implementation (or its exact pure equivalent), never a graph-supplied ID.
// The adapter prepays input/worst-escaped/output work before invoking it. The
// callback must perform only that bounded identity computation and not throw.
using FieldIdentity=std::function<std::string(llvm::StringRef,llvm::StringRef,std::uint64_t)>;

enum class BuildStatus {Ready,Rejected,BudgetError};
struct ProtocolResult {BuildStatus status=BuildStatus::Rejected;Domain::Protocol protocol;const char *reason="unprojected";};
struct BuildResult;

namespace Detail {
using Meter=V4::Detail::Meter;

// Key and value are already privately copied and charged. Lookup precharges
// tree comparisons; one unit covers the new tree node before allocation.
template<class T> inline bool put(V4::Symbols<T> &rows,std::string &&key,T &&value,Meter &m){
  if(!m.lookup(rows.size(),key.size())||!m.spend())return false;
  rows.emplace(std::move(key),std::move(value));return true;
}
inline V4::ReadResult rejected(const char *reason){V4::ReadResult result;result.reason=reason;return result;}
inline V4::ReadResult budget(){V4::ReadResult result;result.status=V4::ReadStatus::BudgetError;result.reason="scope-directory-budget";return result;}

inline bool fieldWork(llvm::StringRef owner,llvm::StringRef name,Meter &m){
  // JSON has at most six output bytes per input UTF-8 byte. Four complete
  // worst-escaped passes prepay canonical escaping/allocation, hashing and
  // temporary copying; constants cover prefix, sorted keys, index and hash.
  // Separate spends avoid overflowing arithmetic on attacker-sized strings.
  if(!m.spend(512))return false;
  for(unsigned i=0;i<24;++i)if(!m.spend(owner.size())||!m.spend(name.size()))return false;
  return true;
}
} // namespace Detail

class ScopeDirectories {
  friend BuildResult build(const FixedScope &,const FieldIdentity &,const V4::Charge &);
  V4::Directory directory_;
  bool ready_=false;
public:
  ScopeDirectories()=default;
  // A snapshot cannot be implicitly copied outside the shared budget. Moves
  // transfer ownership without element/string copies.
  ScopeDirectories(const ScopeDirectories &)=delete;
  ScopeDirectories &operator=(const ScopeDirectories &)=delete;
  ScopeDirectories(ScopeDirectories &&)=default;
  ScopeDirectories &operator=(ScopeDirectories &&)=default;

  // Complete immutable directory, including Env layout/slot writable metadata.
  // It remains a typed interpretation projection of the already hashed Scope,
  // not a separate admission source or a current-body environment side table.
  const V4::Directory &interpretation()const{return directory_;}
  // Reused by the entry and every fixed member: protocol comes from THIS same
  // admitted archive, not a caller-authored Env table or a current callee body.
  ProtocolResult protocol(llvm::StringRef functionId,const V4::Charge &charge)const{
    ProtocolResult result;Detail::Meter m(charge);if(!m.spend()||!m.lookup(directory_.functions.size(),functionId.size())){result.status=BuildStatus::BudgetError;return result;}
    if(!ready_){result.reason="scope-directories-unbuilt";return result;}const auto found=directory_.functions.find(V4::Detail::view(functionId));if(found==directory_.functions.end()){result.reason="scope-unowned-function";return result;}const auto &row=found->second;
    result.protocol.kind=row.kind==V4::FunctionKind::Source||row.kind==V4::FunctionKind::Method?Domain::ProtocolKind::Ordinary:row.kind==V4::FunctionKind::ConstructionBody?Domain::ProtocolKind::ConstructionFrame:Domain::ProtocolKind::Future;
    result.protocol.complete=row.environmentMetadataComplete;
    if(row.lexicalEnvironment){std::string copy;if(!m.copy(copy,*row.lexicalEnvironment)){result.status=BuildStatus::BudgetError;return result;}result.protocol.lexicalEnvironment=std::move(copy);}
    if(row.activationEnvironment){std::string copy;if(!m.copy(copy,*row.activationEnvironment)){result.status=BuildStatus::BudgetError;return result;}result.protocol.activationEnvironment=std::move(copy);}
    result.status=BuildStatus::Ready;result.reason=nullptr;return result;
  }

  V4::ReadResult read(llvm::StringRef functionId,const llvm::json::Value &raw,const V4::Charge &charge){
    Detail::Meter m(charge);if(!m.spend())return Detail::budget();if(!ready_)return Detail::rejected("scope-directories-unbuilt");
    if(!m.lookup(directory_.functions.size(),functionId.size()))return Detail::budget();
    if(directory_.functions.find(V4::Detail::view(functionId))==directory_.functions.end())return Detail::rejected("scope-unowned-function");
    if(!m.copy(directory_.functionId,functionId))return Detail::budget();return V4::read(raw,directory_,charge);
  }

};

struct BuildResult {
  BuildStatus status=BuildStatus::Rejected;
  ScopeDirectories directories;
  const char *reason="unbuilt";
};

// Scope rows/semantic kind enums are a typed projection from the admitted
// immutable archive, NOT from current-body HIR or actual storage samples.
// Labels and declarationTypes do not limit archive interpretation. This is not
// a JSON/scope reader and does not replace the formal scope admission boundary.
inline BuildResult build(const FixedScope &scope,const FieldIdentity &fieldIdentity,const V4::Charge &charge){
  BuildResult result;Detail::Meter m(charge);
  const auto budget=[&](){result.status=BuildStatus::BudgetError;result.reason="scope-directory-budget";return std::move(result);};
  if(!m.spend()||!m.text(scope.profile.size()))return budget();
  if(!m.equal(scope.profile,"common-program-fixed-v3")){if(!m.good)return budget();result.reason="fixed-v3-profile-required";return result;}
  if(!fieldIdentity){result.reason="trusted-field-identity-required";return result;}
  if(!m.spend(scope.types.size())||!m.spend(scope.functions.size())||!m.spend(scope.globals.size())||!m.spend(scope.environments.size()))return budget();
  auto &saved=result.directories;
  for(const auto &type:scope.types){
    std::string id;V4::TypeRow row;row.kind=type.shape.kind;
    if(!m.spend()||!m.copy(id,type.id)||!Detail::put(saved.directory_.types,std::move(id),std::move(row),m)||!m.spend(type.shape.fields.size()))return budget();
    for(const auto &field:type.shape.fields){
      if(!m.spend()||!Detail::fieldWork(type.id,field.name,m))return budget();
      auto fieldId=fieldIdentity(type.id,field.name,field.index);
      if(!m.lookup(saved.directory_.fields.size(),fieldId.size())||!m.spend())return budget();
      saved.directory_.fields.emplace(std::move(fieldId));
    }
  }
  for(const auto &fn:scope.functions){
    V4::FunctionRow row;row.kind=fn.kind;row.environmentMetadataComplete=true;
    if(fn.lexicalEnvironment){std::string copy;if(!m.copy(copy,*fn.lexicalEnvironment))return budget();row.lexicalEnvironment=std::move(copy);}
    if(fn.activationEnvironment){std::string copy;if(!m.copy(copy,*fn.activationEnvironment))return budget();row.activationEnvironment=std::move(copy);}
    if(!m.spend()||!V4::Detail::reserve(row.parameterTypes,fn.parameterTypes.size(),m))return budget();
    for(const auto &type:fn.parameterTypes){std::string copy;if(!m.copy(copy,type)||!V4::Detail::push(row.parameterTypes,std::move(copy),m))return budget();}
    std::string key;if(!m.copy(key,fn.functionId)||!m.copy(row.returnType,fn.returnType)||
      !Detail::put(saved.directory_.functions,std::move(key),std::move(row),m))return budget();

  }
  for(const auto &global:scope.globals){
    std::string key,type;if(!m.spend()||!m.copy(key,global.globalId)||!m.copy(type,global.type)||
      !Detail::put(saved.directory_.globals,std::move(key),std::move(type),m))return budget();
  }
  for(const auto &env:scope.environments){
    V4::EnvironmentRow row;std::string key;
    if(!m.spend()||!m.copy(key,env.id)||!V4::Detail::reserve(row.slots,env.slots.size(),m))return budget();
    if(env.parent){std::string copy;if(!m.copy(copy,*env.parent))return budget();row.parent=std::move(copy);}
    for(const auto &slot:env.slots){Slot copy;copy.writable=slot.writable;if(!m.copy(copy.key,slot.key)||!m.copy(copy.type,slot.type)||!V4::Detail::push(row.slots,std::move(copy),m))return budget();}
    if(!Detail::put(saved.directory_.environments,std::move(key),std::move(row),m))return budget();
  }
  saved.ready_=true;result.status=BuildStatus::Ready;result.reason="fixed-scope-directories";return result;
}
} // namespace CommonReturnOriginScopeV4
