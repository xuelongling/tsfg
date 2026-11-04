// SPDX-License-Identifier: MIT
#include "bytecode-common-verify-tables.h"
#include "bytecode.h"
#include "exception-json.h"
#include "llvm/ADT/STLExtras.h"
#include <algorithm>

namespace tsfg::wire {
// Shared typed value/payload boundaries used by the Common-only table and
// numeric consumers. These are the existing pure rules, not a mode dispatcher.
bool shape(const llvm::json::Object *o,llvm::ArrayRef<llvm::StringRef> fields) {
  if(!o||o->size()!=fields.size())return false;for(auto field:fields)if(!o->get(field))return false;return true;
}
bool unsignedValue(const llvm::json::Value *v,uint64_t maximum,uint64_t &out) {
  const auto n=v?v->getAsInteger():std::nullopt;if(!n||*n<0||uint64_t(*n)>maximum)return false;out=uint64_t(*n);return true;
}
bool unsignedField(const llvm::json::Object *o,llvm::StringRef key,uint64_t maximum,uint64_t &out){return o&&unsignedValue(o->get(key),maximum,out);}
namespace {
bool textValue(llvm::StringRef s,size_t maximum,bool empty) {
  if((!empty&&s.empty())||s.size()>maximum||s.contains('\0'))return false;
  size_t at=0;uint32_t point;while(at<s.size())if(!arrays::ownerproof::jsondetail::nextUtf8(s,at,point))return false;return true;
}
}
bool textValue(const llvm::json::Value *v,size_t maximum,bool empty) {
  const auto s=v?v->getAsString():std::nullopt;
  return s&&textValue(*s,maximum,empty);
}
bool identity(const llvm::json::Value *v){bytecode::Hash hash;const auto s=v?v->getAsString():std::nullopt;return s&&bytecode::decodeHash(*s,hash)&&llvm::any_of(hash,[](auto b){return b!=0;});}
namespace {
uint8_t numericArity(uint8_t code) {
  if((code>=4&&code<=14)||(code>=20&&code<=23))return 2;
  return code==15||code==16||code==33?1:0;
}
}
bool readNumericUse(const Instruction &op,NumericUse &out) {
  Payload p(op.payload);out.target=uint16_t(p.integer(2));out.operation=uint8_t(p.integer(1));
  out.arity=uint8_t(p.integer(1));out.index=uint8_t(p.integer(1));const auto length=p.integer(4);
  if(!p.good||!length||length>4096||length>p.bytes.size()-p.at)return false;
  out.group.assign(reinterpret_cast<const char *>(p.bytes.data()+p.at),size_t(length));p.at+=size_t(length);
  llvm::json::Value group(out.group);out.successor=uint16_t(p.integer(2));
  return p.done()&&textValue(&group,4096)&&out.arity==numericArity(out.operation)&&out.index<out.arity;
}
bool CommonTableVerifier::reject(llvm::StringRef message){if(error.message.empty())error.message=message.str();return false;}
bool CommonTableVerifier::charge(size_t count){if(count>remaining){remaining=0;return reject("Common cold table work budget");}remaining-=count;return true;}
bool CommonTableVerifier::ref(const Json *v,size_t count,uint32_t &out,bool nullable){
  if(nullable&&v&&v->kind()==Json::Null){out=UINT32_MAX;return true;}uint64_t n;
  if(!count||!unsignedValue(v,count-1,n))return false;out=uint32_t(n);return true;
}
bool CommonTableVerifier::origin(const Json *v,bool nullable){
  if(nullable&&v&&v->kind()==Json::Null)return true;const auto *o=v?v->getAsObject():nullptr;uint32_t source;uint64_t a,b;
  return shape(o,{"source","start","end"})&&ref(o->get("source"),sources->size(),source)&&
    unsignedField(o,"start",UINT32_MAX,a)&&unsignedField(o,"end",UINT32_MAX,b)&&a<=b&&
    b<=uint64_t(*(*sources)[source].getAsObject()->getInteger("length"));
}
bool CommonTableVerifier::carrier(const Json *v,Carrier &out,bool nullable,bool storage){
  if(nullable&&v&&v->kind()==Json::Null){out={UINT16_MAX,0};return true;}
  const auto *o=v?v->getAsObject():nullptr;uint64_t kind;uint32_t index;
  if(!shape(o,{"kind","ref"})||!unsignedField(o,"kind",6,kind)||(storage&&(kind==3||kind>=5)))return false;
  const size_t counts[]={domains->size(),environments->size(),types->size(),cells->size(),1,constructions->size(),constructions->size()};
  if(!ref(o->get("ref"),counts[kind],index))return false;
  if(kind==2){const auto k=(*types)[index].getAsObject()->getString("kind");if(k=="union"||k=="void"||k=="unknown")return false;}
  out={uint16_t(kind),index};return true;
}
bool CommonTableVerifier::layoutShape(const Object *o,bool offsets){
  uint64_t bytes,alignment,roots;
  if(!(offsets?shape(o,{"byteSize","alignment","referenceCount","fieldOffsets"}):shape(o,{"byteSize","alignment","referenceCount"}))||
    !unsignedField(o,"byteSize",65536,bytes)||!unsignedField(o,"alignment",8,alignment)||!alignment||(alignment&(alignment-1))||
    !unsignedField(o,"referenceCount",256,roots))return false;
  if(offsets){const auto *rows=o->getArray("fieldOffsets");if(!rows||rows->size()>65536)return false;
    for(const auto &r:*rows){uint64_t n;if(!charge()||!unsignedValue(&r,65536,n))return false;}}
  return true;
}
bool CommonTableVerifier::canonical(const Json &value,std::string &out){
  const auto measured=tsfg::arrays::ownerproof::measureCanonical(value);
  if(!measured||measured.counts.bytes>maxBytes||!charge(measured.counts.tokens+measured.counts.members+measured.counts.bytes/64+1)||
    !tsfg::arrays::ownerproof::encodeCanonical(value,out))return reject("Common cold semantic canonical budget");
  if(!out.empty()&&out.back()=='\n')out.pop_back();return true;
}
bool CommonTableVerifier::hash(llvm::StringRef domain,const Json &value,llvm::StringRef expected){
  std::string bytes;if(!canonical(value,bytes))return false;
  return "sha256:"+bytecode::hex(bytecode::hash(domain.str()+'\0'+bytes))==expected||reject("Common independent semantic identity");
}
bool CommonTableVerifier::directory(){
  sources=program.table(Table::Sources).getAsArray();types=program.table(Table::Types).getAsArray();
  domains=program.table(Table::Domains).getAsArray();abis=program.table(Table::Abis).getAsArray();
  const auto *m=program.table(Table::Members).getAsObject(),*s=program.table(Table::Storage).getAsObject();
  const auto *v=program.table(Table::Views).getAsObject(),*modes=program.table(Table::Modules).getAsObject();
  const auto *c=program.table(Table::Closures).getAsObject(),*e=program.table(Table::Exceptions).getAsObject();
  if(!sources||sources->empty()||sources->size()>128||!types||types->empty()||types->size()>4109||!domains||domains->size()>4096||
    !abis||abis->empty()||abis->size()>4096||abis->size()!=program.functions.size()||
    !shape(m,{"fields","methods","constructions"})||!shape(s,{"bindings","concrete","arrays","environments","payload"})||
    !shape(v,{"compatibility","dispatch","entries"})||!shape(modes,{"modules","globals","hosts","roots","initialization"})||
    !shape(c,{"functions","environments","calls"})||!shape(e,{"functions","bindings","scopes"}))return reject("Common cold table mode/shape/count");
  fields=m->getArray("fields");methods=m->getArray("methods");constructions=m->getArray("constructions");
  bindings=s->getArray("bindings");concrete=s->getArray("concrete");arrays=s->getArray("arrays");environmentLayouts=s->getArray("environments");
  environments=c->getArray("environments");closureFunctions=c->getArray("functions");calls=c->getArray("calls");
  scopes=e->getArray("scopes");cells=e->getArray("bindings");handlers=e->getArray("functions");
  modules=modes->getArray("modules");globals=modes->getArray("globals");hosts=modes->getArray("hosts");
  roots=modes->getObject("roots");initialization=modes->getArray("initialization");compatibilities=v->getArray("compatibility");dispatch=v->getArray("dispatch");entries=v->getArray("entries");
  if(!fields||fields->size()>65536||!methods||methods->size()>4096||!constructions||constructions->size()>4096||
    !bindings||bindings->size()>65536||!concrete||concrete->size()>4109||!arrays||arrays->size()>4096||
    !environmentLayouts||environmentLayouts->size()>4096||!environments||environments->size()>4096||
    !closureFunctions||closureFunctions->size()!=size_t(std::count_if(program.functions.begin(),program.functions.end(),[](const Function &f){return f.role!=2;}))||!calls||calls->size()>100000||
    !scopes||scopes->size()>8192||!cells||cells->size()>65536||!handlers||handlers->size()!=program.functions.size()||
    !modules||modules->empty()||modules->size()>128||!globals||globals->size()>4096||!hosts||hosts->size()>128||
    !initialization||initialization->size()!=modules->size()||!shape(roots,{"roots","requiredRoots"})||
    !compatibilities||compatibilities->size()>100000||!dispatch||dispatch->size()>100000||!entries||entries->size()>65536||!layoutShape(s->getObject("payload")))return reject("Common cold subdirectory bounds");
  const auto &payload=*s->getObject("payload");if(payload.getInteger("byteSize")!=16||payload.getInteger("alignment")!=8||payload.getInteger("referenceCount")!=1)return reject("Common payload layout");
  std::string previous;
  for(const auto &value:*sources){const auto *r=value.getAsObject();uint64_t length;
    if(!charge()||!shape(r,{"path","hash","length"})||!textValue(r->get("path"),4096)||!identity(r->get("hash"))||
      !unsignedField(r,"length",UINT32_MAX,length)||!validSourcePath(*r->getString("path"),true)||
      (!previous.empty()&&previous>=*r->getString("path")))return reject("Common Source identity/order");previous=r->getString("path")->str();}
  if(program.rootSource>=sources->size())return reject("Common root Source index");const auto &root=*(*sources)[program.rootSource].getAsObject();
  if(root.getString("path")!=program.sourcePath||root.getString("hash")!="sha256:"+bytecode::hex(program.sourceHash)||
    root.getInteger("length")!=program.sourceLength||!validSourcePath(program.sourcePath,false))return reject("Common root Source identity join");
  previous.clear();
  for(size_t i=0;i<program.functions.size();++i){const auto &fn=program.functions[i];const auto id="sha256:"+bytecode::hex(fn.id);
    if(!charge()||(!previous.empty()&&previous>=id)||!functionIds.emplace(id,uint32_t(i)).second||fn.source>=sources->size()||fn.abi!=i||fn.role>2||
      fn.declaration.start>fn.declaration.end||fn.declaration.end>uint64_t(*(*sources)[fn.source].getAsObject()->getInteger("length")))return reject("Common function directory/Source join");previous=id;}
  if(!typeRows()||!memberRows()||!storageRows()||!moduleRows())return false;
  // ABI and closure/control rows are admitted here because all following
  // semantic joins and graph checks use these exact records as typed values.
  if(!charge(program.functions.size()+methods->size()))return false;
  std::vector<bool> methodFunctions(program.functions.size(),false);
  for(const auto &method:*methods)methodFunctions[size_t(*method.getAsObject()->getInteger("function"))]=true;
  for(size_t i=0;i<abis->size();++i){const auto *r=(*abis)[i].getAsObject();uint32_t f,n;Carrier value;uint64_t minimum;
    if(!charge(6)||!shape(r,{"kind","function","signature","methodMinimumArgumentCount","ordinaryMinimumArgumentCount","parameters","argumentTypes","receiver","construction","receiverFrame","lexicalEnvironment","physicalParameters","result","resultCarrier","sourcePlan"})||!r->getObject("sourcePlan")||
      r->getString("kind")!="common"||!ref(r->get("function"),program.functions.size(),f)||f!=i||!identity(r->get("signature"))||
      *r->getString("signature")!="sha256:"+bytecode::hex(program.functions[i].signature)||!r->getArray("parameters")||r->getArray("parameters")->size()>64||
      !r->getArray("argumentTypes")||r->getArray("argumentTypes")->size()!=r->getArray("parameters")->size()||
      !r->getArray("physicalParameters")||r->getArray("physicalParameters")->size()>64||!ref(r->get("receiver"),bindings->size(),n,true)||
      !ref(r->get("construction"),constructions->size(),n,true)||!ref(r->get("receiverFrame"),r->getArray("physicalParameters")->size(),n,true)||
      !ref(r->get("lexicalEnvironment"),environments->size(),n,true)||!ref(r->get("result"),types->size(),n,true)||
      !carrier(r->get("resultCarrier"),value,true,true))return reject("Common ABI shape/reference");
    if(!charge()||(methodFunctions[i]?!unsignedField(r,"methodMinimumArgumentCount",r->getArray("parameters")->size(),minimum):
      r->get("methodMinimumArgumentCount")->kind()!=Json::Null))return reject("Common ABI method minimum arity or role");
    if(!charge())return false;
    if(r->get("ordinaryMinimumArgumentCount")->kind()!=Json::Null&&
      (r->getArray("parameters")->empty()||program.functions[i].role!=0||methodFunctions[i]||r->get("receiver")->kind()!=Json::Null||
       r->get("construction")->kind()!=Json::Null||r->get("lexicalEnvironment")->kind()!=Json::Null||
       !unsignedField(r,"ordinaryMinimumArgumentCount",r->getArray("parameters")->size(),minimum)))
      return reject("Common ABI ordinary FDI minimum arity or role");
    for(const auto &p:*r->getArray("parameters"))if(!charge()||!ref(&p,bindings->size(),n))return reject("Common ABI parameter binding");
    for(const auto &p:*r->getArray("argumentTypes"))if(!charge()||!ref(&p,types->size(),n))return reject("Common ABI incoming argument Type reference");
    for(const auto &p:*r->getArray("physicalParameters"))if(!charge()||!carrier(&p,value))return reject("Common ABI physical parameter");
  }
  previous.clear();size_t totalSlots=0;
  for(size_t i=0;i<environments->size();++i){const auto *r=(*environments)[i].getAsObject();uint32_t n;
    if(!charge()||!shape(r,{"id","owner","parent","slots"})||!identity(r->get("id"))||(!previous.empty()&&previous>=*r->getString("id"))||
      !ref(r->get("owner"),program.functions.size(),n)||!ref(r->get("parent"),environments->size(),n,true)||n==i||!r->getArray("slots")||
      r->getArray("slots")->size()>65536-totalSlots)return reject("Common environment shape/identity/reference");previous=r->getString("id")->str();totalSlots+=r->getArray("slots")->size();
    std::string prior;for(const auto &slot:*r->getArray("slots")){const auto *row=slot.getAsObject();
      if(!charge()||!shape(row,{"key","binding","type","writable","kind"})||!identity(row->get("key"))||(!prior.empty()&&prior>=*row->getString("key"))||
        !ref(row->get("binding"),bindings->size(),n)||!ref(row->get("type"),types->size(),n)||!row->getBoolean("writable")||
        (row->getString("kind")!="parameter"&&row->getString("kind")!="local"))return reject("Common environment slot shape/reference");prior=row->getString("key")->str();}
  }
  uint32_t previousFunction=UINT32_MAX;
  for(size_t i=0;i<closureFunctions->size();++i){const auto *r=(*closureFunctions)[i].getAsObject();uint32_t f,n;
    if(!charge()||!shape(r,{"function","parent","lexicalEnvironment","activationEnvironment","captures"})||
      !ref(r->get("function"),program.functions.size(),f)||program.functions[f].role==2||(previousFunction!=UINT32_MAX&&previousFunction>=f)||!ref(r->get("parent"),program.functions.size(),n,true)||n==f||
      !ref(r->get("lexicalEnvironment"),environments->size(),n,true)||!ref(r->get("activationEnvironment"),environments->size(),n,true)||
      !r->getArray("captures")||r->getArray("captures")->size()>65536)return reject("Common closure function shape/reference");previousFunction=f;
    std::pair<uint32_t,uint32_t> previousCapture;bool firstCapture=true;for(const auto &cap:*r->getArray("captures")){const auto *row=cap.getAsObject();uint32_t env,slot;
      if(!charge()||!shape(row,{"environment","slot"})||!ref(row->get("environment"),environments->size(),env)||
        !ref(row->get("slot"),(*environments)[env].getAsObject()->getArray("slots")->size(),slot)||(!firstCapture&&previousCapture>=std::pair{env,slot}))return reject("Common capture slot reference/order");previousCapture={env,slot};firstCapture=false;}
  }
  for(const auto &value:*calls){const auto *r=value.getAsObject();uint32_t f,b,n;
    if(!charge()||!shape(r,{"function","block","instruction","signature","targets"})||!ref(r->get("function"),program.functions.size(),f)||
      !ref(r->get("block"),program.functions[f].blocks.size(),b)||!ref(r->get("instruction"),program.functions[f].blocks[b].instructions.size(),n)||
      !identity(r->get("signature"))||!r->getArray("targets")||r->getArray("targets")->size()>4096)return reject("Common callable site shape/reference");
    uint32_t prior=UINT32_MAX;for(const auto &t:*r->getArray("targets")){if(!charge()||!ref(&t,program.functions.size(),n)||(prior!=UINT32_MAX&&prior>=n))return reject("Common callable target order/reference");prior=n;}
  }
  std::pair<uint32_t,std::vector<std::string>> previousScope;bool firstScope=true;std::set<std::pair<uint32_t,std::vector<std::string>>> scopeKeys;std::set<uint32_t> scopeRoots;
  for(const auto &value:*scopes){const auto *r=value.getAsObject();uint32_t owner;
    if(!charge()||!shape(r,{"owner","path"})||!ref(r->get("owner"),program.functions.size(),owner)||!r->getArray("path")||r->getArray("path")->size()>128)return reject("Common structural scope shape");
    std::vector<std::string> path;for(const auto &part:*r->getArray("path")){if(!charge()||!textValue(&part,4096))return reject("Common structural scope path");const auto s=*part.getAsString();
      const auto colon=s.rfind(':');if(colon==llvm::StringRef::npos)return reject("Common structural scope segment");const auto kind=s.take_front(colon),number=s.drop_front(colon+1);
      if((kind!="block"&&kind!="if:then"&&kind!="if:else"&&kind!="while"&&kind!="try"&&kind!="catch"&&kind!="finally")||number.empty()||
        (number.size()>1&&number.front()=='0')||number.find_first_not_of("0123456789")!=llvm::StringRef::npos)return reject("Common structural scope segment");path.push_back(s.str());}
    const auto key=std::pair{owner,path};if(!firstScope&&previousScope>=key)return reject("Common structural scope unique order");
    if(path.empty())scopeRoots.insert(owner);else{path.pop_back();if(!scopeKeys.count({owner,path}))return reject("Common structural scope parent omission");}
    scopeKeys.insert(key);firstScope=false;previousScope=key;
  }
  if(scopeRoots.size()!=program.functions.size())return reject("Common complete function root scopes");
  uint32_t previousBinding=UINT32_MAX;
  for(const auto &value:*cells){const auto *r=value.getAsObject();uint32_t b,s;
    if(!charge()||!shape(r,{"binding","scope"})||!ref(r->get("binding"),bindings->size(),b)||!ref(r->get("scope"),scopes->size(),s)||
      (previousBinding!=UINT32_MAX&&previousBinding>=b))return reject("Common cell directory reference/order");previousBinding=b;
    const auto &binding=*(*bindings)[b].getAsObject();if((binding.getString("role")!="param"&&binding.getString("role")!="local"&&binding.getString("role")!="receiver")||
      binding.getInteger("scope")!=s)return reject("Common cell/binding scope join");
  }
  for(size_t i=0;i<handlers->size();++i){const auto *r=(*handlers)[i].getAsObject();uint32_t n;
    if(!charge()||!shape(r,{"function","handlers"})||!ref(r->get("function"),program.functions.size(),n)||n!=i||!r->getArray("handlers")||r->getArray("handlers")->size()>8192)return reject("Common handler function shape");
    std::set<std::string> ids;for(const auto &value:*r->getArray("handlers")){const auto *h=value.getAsObject();uint32_t source;uint64_t a,b;
      if(!charge()||!shape(h,{"id","source","range","hasCatch","hasFinally","catchBinding","catchBlock","finallyBlocks"})||!textValue(h->get("id"),4096)||
        !ids.insert(h->getString("id")->str()).second||!ref(h->get("source"),sources->size(),source)||!shape(h->getObject("range"),{"start","end"})||
        !unsignedField(h->getObject("range"),"start",UINT32_MAX,a)||!unsignedField(h->getObject("range"),"end",UINT32_MAX,b)||a>b||b>uint64_t(*(*sources)[source].getAsObject()->getInteger("length"))||
        !h->getBoolean("hasCatch")||!h->getBoolean("hasFinally")||!ref(h->get("catchBinding"),bindings->size(),n,true)||
        !ref(h->get("catchBlock"),program.functions[i].blocks.size(),n,true)||!h->getArray("finallyBlocks")||h->getArray("finallyBlocks")->size()>256)return reject("Common handler shape/range/reference");
      for(const auto &f:*h->getArray("finallyBlocks")){const auto *row=f.getAsObject();if(!charge()||!shape(row,{"block","completion"})||!ref(row->get("block"),program.functions[i].blocks.size(),n)||
        (row->getString("completion")!="normal"&&row->getString("completion")!="return"&&row->getString("completion")!="throw"))return reject("Common finally entry shape/reference");}
    }
  }
  return true;
}
bool verifyCommonTables(CommonTableVerifier &v){
  return v.directory()&&v.semanticTypes()&&v.memberJoins()&&v.storageJoins()&&v.moduleJoins();
}
} // namespace tsfg::wire
