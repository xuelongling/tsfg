// SPDX-License-Identifier: MIT
#include "formal-closure.h"
#include "array-owner-json.h"
#include "bytecode.h"
#include "llvm/ADT/STLExtras.h"
#include <functional>
#include <tuple>
namespace tsfg::formalClosure {
namespace {
using Object=llvm::json::Object;
using Value=llvm::json::Value;
std::string str(const Object &o,llvm::StringRef key) {auto s=o.getString(key);return s?s->str():std::string();}
bool exact(const Object &o,llvm::ArrayRef<llvm::StringRef> keys) {
  if(o.size()!=keys.size())return false;
  for(auto key:keys)if(!o.get(key))return false;
  return true;
}
bool range(const Object &o,uint32_t &start,uint32_t &end,uint32_t maximum) {
  const auto *r=o.getObject("range");if(!r||!exact(*r,{"start","end"}))return false;
  const auto a=r->getInteger("start"),b=r->getInteger("end");
  if(!a||!b||*a<0||*b<=*a||uint64_t(*b)>maximum)return false;
  start=uint32_t(*a);end=uint32_t(*b);return true;
}
struct Binding {std::string owner,type;bool writable;};
using Access=std::pair<bool,bool>;
using Site=std::tuple<std::string,uint32_t,uint32_t,std::string>;
}
mlir::LogicalResult verifySource(mlir::ModuleOp module,const closure::Metadata &metadata,
    const Object &hir,const Object &report,SourceGraph &graph) {
  const auto *format=hir.getObject("format"),*source=hir.getObject("source"),*origin=hir.getObject("sourceOrigin");
  if(!exact(hir,{"format","inputIdentity","source","sourceOrigin","target","types","functions"})
      ||!format||!exact(*format,{"family","version"})||str(*format,"family")!="tsfg.closure-hir-candidate"
      ||format->getInteger("version")!=1||!source||!exact(*source,{"path","content","hash"})||!origin
      ||str(hir,"inputIdentity")!=metadata.input||str(*source,"path")!=metadata.sourcePath
      ||str(*source,"hash")!=metadata.sourceHash||closure::hash(str(*source,"content"))!=metadata.sourceHash)
    return fail("Source/HIR identity join");
  const auto content=str(*source,"content");size_t cursor=0,length=0;
  while(cursor<content.size()) {uint32_t point;if(!arrays::ownerproof::jsondetail::nextUtf8(content,cursor,point))return fail("Source UTF8");length+=point>0xffff?2:1;}
  if(length!=metadata.sourceLength||!exact(*origin,{"kind","producerBaseOid","producerDirty","requestSha256","responseSha256","testedInputSetHash"})
      ||str(*origin,"kind")!="owned-go-response"||!origin->getBoolean("producerDirty")
      ||str(*origin,"producerBaseOid").size()!=40)return fail("Source origin/UTF16");
  for(auto key:{"requestSha256","responseSha256","testedInputSetHash"})if(!closure::digest(str(*origin,key)))return fail("Source origin digest");
  const auto *target=hir.getObject("target");
  if(!target||str(*target,"target")!=coreHeader::target||str(*target,"triple")!=coreHeader::triple
      ||str(*target,"llvmDataLayout")!=coreHeader::layout)return fail("Source target");
  closure::Index index(metadata);
  const auto *types=hir.getArray("types"),*functions=hir.getArray("functions");
  if(!types||types->size()!=metadata.types.size()||!functions||functions->size()!=metadata.functions.size())return fail("complete Source tables");
  std::set<std::string> typeIds,functionIds;
  for(const auto &raw:*types) {
    const auto *t=raw.getAsObject();if(!t)return fail("Source type");
    const auto found=index.types.find(str(*t,"id"));
    if(found==index.types.end()||!typeIds.insert(found->first).second||str(*t,"kind")!=found->second->kind)return fail("Source type identity");
    if(found->second->kind=="scalar") {if(!exact(*t,{"id","kind","name"})||str(*t,"name")!=found->second->name)return fail("Source scalar");}
    else {
      const auto *args=t->getArray("parameters");if(!exact(*t,{"id","kind","parameters","returnType"})||!args
          ||args->size()!=found->second->parameters.size()||str(*t,"returnType")!=found->second->result)return fail("Source callable");
      for(size_t i=0;i<args->size();++i)if((*args)[i].getAsString()!=found->second->parameters[i])return fail("Source callable parameter");
    }
  }
  std::map<std::string,Binding> bindings;
  std::map<std::string,const Object *> declarations;
  uint64_t work=0;
  std::function<bool(const Value &,const std::string &)> collect=[&](const Value &v,const std::string &owner) {
    if(++work>1000000)return false;
    if(const auto *a=v.getAsArray()){for(const auto &child:*a)if(!collect(child,owner))return false;return true;}
    const auto *o=v.getAsObject();if(!o)return true;
    if(str(*o,"kind")=="local") {
      const auto *b=o->getObject("binding");if(!b||str(*b,"owner")!=owner||!b->getBoolean("writable")
          ||!bindings.emplace(str(*b,"id"),Binding{owner,str(*b,"type"),*b->getBoolean("writable")}).second)return false;
    }
    for(const auto &child:*o)if(!collect(child.second,owner))return false;
    return true;
  };
  for(const auto &raw:*functions) {
    const auto *fn=raw.getAsObject();if(!fn)return fail("Source function");
    const auto id=str(*fn,"id");const auto found=index.functions.find(id);
    if(found==index.functions.end()||!functionIds.insert(id).second)return fail("Source function identity");
    const auto &f=*found->second;uint32_t start,end;
    const auto *parent=fn->get("lexicalParent");
    if(!parent||(!parent->getAsNull()&&parent->getAsString()!=f.parent)
        ||parent->getAsNull()&&!f.parent.empty()||str(*fn,"name")!=f.name||str(*fn,"lexicalScope")!=f.scope
        ||str(*fn,"signature")!=f.signature||str(*fn,"signatureHash")!=f.signatureHash||str(*fn,"returnType")!=f.result
        ||!range(*fn,start,end,metadata.sourceLength)||start!=f.start||end!=f.end)return fail("Source function declaration");
    if(f.parent.empty())graph.roots.insert(id);
    const auto *parameters=fn->getArray("parameters"),*body=fn->getArray("body");
    if(!parameters||parameters->size()!=f.parameters.size()||!body)return fail("Source function body/parameters");
    for(size_t i=0;i<parameters->size();++i) {
      const auto *b=(*parameters)[i].getAsObject();if(!b||str(*b,"id")!=f.parameters[i].binding||str(*b,"owner")!=id
          ||str(*b,"type")!=f.parameters[i].type||!b->getBoolean("writable")
          ||!bindings.emplace(str(*b,"id"),Binding{id,str(*b,"type"),*b->getBoolean("writable")}).second)return fail("Source parameter binding");
    }
    if(!collect(*fn->get("body"),id))return fail("Source binding/work budget");
    declarations.emplace(id,fn);
  }
  std::map<std::string,std::map<std::string,Access>> captures;
  std::set<Site> reads,writes,closures;
  std::function<bool(const Value &,const std::string &,bool)> scan=[&](const Value &v,const std::string &owner,bool write) {
    if(++work>1000000)return false;
    if(const auto *a=v.getAsArray()){for(const auto &child:*a)if(!scan(child,owner,false))return false;return true;}
    const auto *o=v.getAsObject();if(!o)return true;
    const auto kind=str(*o,"kind");uint32_t start=0,end=0;
    if(kind=="reference") {
      const auto id=str(*o,"binding");const auto found=bindings.find(id);if(found==bindings.end()||!range(*o,start,end,metadata.sourceLength))return false;
      (write?writes:reads).emplace(owner,start,end,id);
      if(found->second.owner!=owner){auto &use=captures[owner][id];if(write)use.second=true;else use.first=true;}
      return true;
    }
    if(kind=="assign") {
      const auto *to=o->get("target"),*value=o->get("value");
      if(!to||!value||!scan(*to,owner,true)||!scan(*value,owner,false)||!range(*o,start,end,metadata.sourceLength))return false;
      if(const auto *ref=to->getAsObject())if(str(*ref,"kind")=="reference")writes.emplace(owner,start,end,str(*ref,"binding"));
      return true;
    }
    if(kind=="functionReference") {
      if(!range(*o,start,end,metadata.sourceLength)||!index.functions.count(str(*o,"target")))return false;
      closures.emplace(owner,start,end,str(*o,"target"));
    }
    if(kind=="call"||kind=="indirectCall") {
      if(!range(*o,start,end,metadata.sourceLength))return false;
      graph.calls.push_back({owner,kind,str(*o,"target"),start,end,{}});
    }
    for(const auto &child:*o)if(!scan(child.second,owner,false))return false;
    return true;
  };
  for(const auto &[id,fn]:declarations) {
    if(!scan(*fn->get("body"),id,false))return fail("Source capture/call traversal");
    const auto *list=fn->getArray("captures");if(!list)return fail("Source capture declarations");
    std::map<std::string,Access> claimed;
    for(const auto &raw:*list){const auto *c=raw.getAsObject();if(!c||!exact(*c,{"binding","read","write"})
        ||!c->getBoolean("read")||!c->getBoolean("write")||!claimed.emplace(str(*c,"binding"),Access{*c->getBoolean("read"),*c->getBoolean("write")}).second)return fail("Source capture shape");}
    if(claimed!=captures[id])return fail("Source captures differ from original binding uses");
  }
  std::set<std::string> captured,slots;
  for(const auto &[owner,uses]:captures)for(const auto &[id,use]:uses)captured.insert(id);
  for(const auto &env:metadata.environments)for(const auto &slot:env.slots){const auto b=bindings.find(slot.binding);
    if(b==bindings.end()||b->second.owner!=env.owner||b->second.type!=slot.type||b->second.writable!=slot.writable||!slots.insert(slot.binding).second)return fail("actual environment/Source binding join");}
  if(slots!=captured)return fail("capture slots are incomplete or invented");
  for(auto fn:module.getOps<mlir::func::FuncOp>())for(auto &block:fn.getBody())for(auto &op:block){
    if(++work>1000000)return fail("Source/SSA join budget");uint32_t start,end;
    if(!llvm::isa<closure::EnvironmentLoadOp,closure::EnvironmentStoreOp,closure::MakeOp,closure::CallOp,mlir::func::CallOp>(op))continue;
    if(!closure::number(&op,"tsfg_source.start",start)||!closure::number(&op,"tsfg_source.end",end))return fail("SSA source anchor");
    const auto owner=closure::text(fn,"tsfg_core.function_id").str();
    if(llvm::isa<closure::EnvironmentLoadOp>(op)&&!reads.count({owner,start,end,closure::text(&op,"binding").str()}))return fail("environment read is not an original Source read");
    if(llvm::isa<closure::EnvironmentStoreOp>(op)&&!writes.count({owner,start,end,closure::text(&op,"binding").str()}))return fail("environment write is not an original Source write");
    if(llvm::isa<closure::MakeOp>(op)&&!closures.count({owner,start,end,closure::text(&op,"function_id").str()}))return fail("closure creation is not an original function reference");
    if(llvm::isa<closure::CallOp,mlir::func::CallOp>(op)) {
      const auto kind=llvm::isa<closure::CallOp>(op)?"indirectCall":"call";
      auto site=std::find_if(graph.calls.begin(),graph.calls.end(),[&](const CallSite &s){return s.owner==owner&&s.start==start&&s.end==end&&s.kind==kind;});
      if(site==graph.calls.end()||kind==std::string("call")&&site->target!=closure::text(&op,"tsfg_core.function_id"))return fail("actual call differs from Source relation");
    }
  }
  const auto *roots=report.getArray("roots"),*calls=report.getArray("calls");
  if(str(report,"hirHash")!=metadata.hirHash||report.getBoolean("complete")!=true||!roots||!calls)return fail("target report identity/completeness");
  std::set<std::string> rootIds;for(const auto &r:*roots){const auto s=r.getAsString();if(!s||!rootIds.insert(s->str()).second)return fail("target roots");}
  if(rootIds!=graph.roots)return fail("conservative external roots differ");
  for(const auto &raw:*calls){const auto *c=raw.getAsObject();uint32_t start,end;if(!c||!range(*c,start,end,metadata.sourceLength))return fail("target site");
    auto site=std::find_if(graph.calls.begin(),graph.calls.end(),[&](const CallSite &s){return s.owner==str(*c,"function")&&s.start==start&&s.end==end&&s.kind==str(*c,"kind");});
    const auto *set=c->getObject("targets");const auto *ids=set?set->getArray("functions"):nullptr;
    if(site==graph.calls.end()||site->claimed||!set||set->getBoolean("top")!=false||!ids)return fail("target site/unknown set");
    site->claimed=true;for(const auto &id:*ids){const auto s=id.getAsString();if(!s||!index.functions.count(s->str())||!site->targets.insert(s->str()).second)return fail("target identity");}
  }
  return mlir::success();
}
}
