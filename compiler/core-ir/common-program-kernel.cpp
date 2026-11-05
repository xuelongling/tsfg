// SPDX-License-Identifier: MIT
#include "common-program-source.h"
#include "common-program-borrows.h"
#include <algorithm>
#include <tuple>
namespace tsfg::commonProgram {
namespace {
bool step(Program &p,Error &e,size_t n=1){return p.charge(n)||reject(e,"core-ir-common-budget","independent kernel proof work exceeded");}
bool need(bool c,Error &e,llvm::StringRef detail){return c||reject(e,"core-ir-common-kernel",detail);}
Json intersection(Program &p,const std::set<std::string> &a,const std::set<std::string> &b,Error &e){
  Array values;if(!step(p,e,a.size()+b.size()))return values;auto i=a.begin(),j=b.begin();
  while(i!=a.end()&&j!=b.end()){if(*i<*j)++i;else if(*j<*i)++j;else{values.push_back(*i);++i;++j;}}return values;
}
struct Reason {
  std::string kind,key,access;
  Json json()const{
    if(kind=="facet")return Object{{"kind",kind},{"facet",key}};
    return Object{{"kind",kind},{kind=="capture"?"slot":"resource",key},{"access",access}};
  }
  bool contains(const Effects &effect)const{
    if(kind=="host-resource")return (access=="read"?effect.hostReads:effect.hostWrites).count(key);
    if(kind=="capture"){auto selected=effect.captures.find(key);return selected!=effect.captures.end()&&
      (access=="read"?selected->second.read:access=="write"?selected->second.write:selected->second.structural);}
    if(key=="allocation")return effect.allocation;if(key=="managedReference")return effect.managedReference;
    if(key=="ehControl")return effect.ehControl;if(key=="mayThrow")return effect.mayThrow;
    if(key=="await")return effect.await;if(key=="lock")return effect.lock;if(key=="escape")return effect.escape;return effect.unknownHost;
  }
};
void appendCallChain(Program &p,Error &e,const std::string &root,const Reason &reason,
  const std::map<std::string,const Function *> &declarations,const std::map<std::string,const Json *> &contracts){
  std::map<std::string,const Json *> functions;for(const auto &fn:items(field(p.hir,"functions")))functions.emplace(string(field(fn,"id")),&fn);
  const auto source=[&](const std::string &id)->Json{const auto &fn=*declarations.at(id);return Object{{"sourceId",fn.path},{"start",fn.range.start},{"end",fn.range.end}};};
  struct Pending {std::string id;Array edges;};std::vector<Pending> pending{{root,{}}};std::set<std::string> seen{root};
  Json origin=Object{{"kind","unknown"},{"functionId",root},{"source",source(root)}};Array selectedEdges;
  const auto reasonJson=reason.json();
  for(size_t index=0;index<pending.size();++index){
    const auto row=pending[index];selectedEdges=row.edges;origin=Object{{"kind","unknown"},{"functionId",row.id},{"source",source(row.id)}};
    if(!p.charge())break;
    const auto effective=p.effects.find(row.id);
    if(effective==p.effects.end()||!reason.contains(effective->second)){
      origin=Object{{"kind","fixed-upper"},{"functionId",row.id},{"source",source(row.id)},{"contractDigest",field(*contracts.at(row.id),"digest")}};break;
    }
    EffectDiagnostics diagnostics;Effects derived;Error diagnosticError;
    if(!deriveEffectDiagnostics(p,*functions.at(row.id),derived,diagnosticError,diagnostics))break;
    auto local=diagnostics.local.find(canonical(reasonJson));if(local!=diagnostics.local.end()){origin=local->second;break;}
    if(reason.kind=="facet"&&!reason.contains(derived)&&(reason.key=="managedReference"||reason.key=="escape")){
      origin=Object{{"kind","function"},{"functionId",row.id},{"source",source(row.id)},
        {"operation",reason.key=="escape"?"derivedEscape":"derivedManagedReference"}};break;
    }
    const auto order=[](const Json &edge){const auto &s=field(edge,"source");return std::tuple{string(field(s,"sourceId")),field(s,"start").getAsInteger().value(),
      field(s,"end").getAsInteger().value(),string(field(edge,"callee")),string(field(edge,"kind"))};};
    std::sort(diagnostics.calls.begin(),diagnostics.calls.end(),[&](const Json &a,const Json &b){return order(a)<order(b);});
    bool added=false;
    for(const auto &edge:diagnostics.calls){
      if(!p.charge())break;const auto callee=string(field(edge,"callee"));
      if(!reason.contains(p.fixedEffects.at(callee))||!seen.insert(callee).second)continue;
      auto edges=row.edges;edges.push_back(edge);pending.push_back({callee,std::move(edges)});added=true;
    }
    if(!added&&index+1==pending.size())break;
  }
  e.message+="; callChain="+canonical(Json(Object{{"version",1},{"root",Object{{"functionId",root},{"source",source(root)}}},
    {"reason",reasonJson},{"edges",std::move(selectedEdges)},{"origin",std::move(origin)}}));
}
}
bool verifyKernelProof(Program &p,Error &e){
  const auto &targets=items(field(p.request,"targets"));
  if(!need(exact(p.request,{"targets"})&&field(p.request,"targets").getAsArray()&&targets.size()!=1&&targets.size()<=32,e,"bounded explicit kernel group required"))return false;
  if(!step(p,e,p.functions.size()))return false;
  std::map<std::string,const Function *> declarations;
  for(const auto &fn:p.functions)declarations.emplace(fn.id,&fn);
  // The selected root is already joined to the independently rebuilt Source.
  const auto locate=[&](const std::string &id){const auto &fn=*declarations.at(id);e.path=fn.path;e.range=fn.range;};
  std::set<std::string> kernelRoots;
  for(const auto &r:items(field(field(p.hir,"closure"),"roots"))){if(!step(p,e))return false;if(string(field(r,"kind"))=="kernel")kernelRoots.insert(string(field(r,"target")));}
  std::map<std::string,const Json *> contracts;
  for(const auto &c:items(field(p.publication,"contracts"))){if(!step(p,e))return false;contracts.emplace(string(field(c,"functionId")),&c);}
  Array accesses,pairs;std::vector<std::string> ids,unresolved;std::string previous;
  for(const auto &target:targets){
    if(!step(p,e))return false;const auto id=string(target);
    if(!need(kernelRoots.count(id)&&contracts.count(id)&&p.fixedEffects.count(id)&&declarations.count(id)&&(previous.empty()||previous<id),e,"selected target is not an ordered unique declared kernel root"))return false;
    if(!fixedReturnOriginAvailable(p,id)&&!p.scalarReturnOriginVerified.count(id)){
      if(!step(p,e,id.size()/8+1))return false;unresolved.push_back(id);
    }
    const auto &upper=p.fixedEffects.at(id);
    if(!upper.hostReads.empty()||!upper.hostWrites.empty()){
      const Reason reason{"host-resource",!upper.hostReads.empty()?*upper.hostReads.begin():*upper.hostWrites.begin(),!upper.hostReads.empty()?"read":"write"};
      std::set<std::string> seen;std::vector<std::string> pending{id};
      while(!pending.empty()){if(!step(p,e))return false;const auto next=pending.back();pending.pop_back();if(!seen.insert(next).second)continue;
        auto host=p.hostOrigins.find(next);if(host!=p.hostOrigins.end()){e.path=host->second.path;e.range=host->second.range;reject(e,"core-ir-common-kernel-host","fixed Published Host resource access is not kernel-admissible");appendCallChain(p,e,id,reason,declarations,contracts);return false;}
        auto body=p.effects.find(next);if(body!=p.effects.end())for(const auto &target:body->second.calls){if(!step(p,e))return false;pending.push_back(target);}}
      locate(id);reject(e,"core-ir-common-kernel-host","fixed Published Host resource access is not kernel-admissible");appendCallChain(p,e,id,reason,declarations,contracts);return false;
    }
    bool captureAccess=false;for(const auto &[slot,access]:upper.captures){if(!step(p,e))return false;captureAccess|=access.read||access.write||access.structural;}
    if(!need(!captureAccess&&!upper.allocation&&!upper.managedReference&&!upper.ehControl&&!upper.mayThrow&&!upper.await&&!upper.lock&&!upper.escape&&!upper.unknownHost,e,"fixed Published kernel capability is not proved")){
      locate(id);Reason reason;
      if(captureAccess){for(const auto &[slot,access]:upper.captures)if(access.read||access.write||access.structural){reason={"capture",slot,access.read?"read":access.write?"write":"structural"};break;}}
      else for(auto facet:{"allocation","managedReference","ehControl","mayThrow","await","lock","escape","unknownHost"}){
        Reason selected{"facet",facet,{}};if(selected.contains(upper)){reason=std::move(selected);break;}}
      appendCallChain(p,e,id,reason,declarations,contracts);return false;
    }
    const auto effect=writeEffects(upper);accesses.push_back(Object{{"functionId",id},{"publishedContractDigest",field(*contracts.at(id),"digest")},
      {"reads",field(field(effect,"globals"),"reads")},{"writes",field(field(effect,"globals"),"writes")},
      {"hostResources",field(effect,"hostResources")},{"parameters",field(effect,"parameters")},{"captures",field(effect,"captures")},{"facets",field(effect,"facets")}});
    previous=id;ids.push_back(id);
  }
  for(size_t i=0;i<ids.size();++i)for(size_t j=i+1;j<ids.size();++j){
    if(!step(p,e))return false;const auto &a=p.fixedEffects.at(ids[i]),&b=p.fixedEffects.at(ids[j]);
    Json rr=intersection(p,a.reads,b.reads,e),ww=intersection(p,a.writes,b.writes,e),wr=intersection(p,a.writes,b.reads,e),rw=intersection(p,a.reads,b.writes,e);
    if(!e.message.empty())return false;
    if(!need(items(ww).empty()&&items(wr).empty()&&items(rw).empty(),e,"fixed Published GlobalId bounds conflict")){locate(ids[i]);return false;}
    pairs.push_back(Object{{"left",ids[i]},{"right",ids[j]},{"readRead",std::move(rr)},{"writeWrite",std::move(ww)},
      {"writeRead",std::move(wr)},{"readWrite",std::move(rw)}});
  }
  // Fixed permission failures are independent of an unavailable content
  // proof. Report them first; no unresolved root can reach acceptance.
  if(!unresolved.empty()){locate(unresolved.front());return need(false,e,"selected kernel fixed return/content proof remains open");}
  Json rebuilt=Object{{"inputIdentity",p.inputIdentity},{"hirDigest",p.hirHash},{"scopeDigest",field(p.publication,"scopeDigest")},
    {"publishedDigest",field(p.publication,"expectedDigest")},{"targets",field(p.request,"targets")},
    {"accesses",std::move(accesses)},{"pairs",std::move(pairs)}};
  return need(same(p.proof,rebuilt),e,"asserted kernel proof differs from complete independent reconstruction");
}
bool createGpuBindingPlan(Program &p,const Json &request,Json &out,Error &e){
  Json borrowProof=nullptr;
  if(!analyzeCommonBorrowProof(p,e,borrowProof))return false;
  const auto fail=[&](llvm::StringRef kind,llvm::StringRef message){return reject(e,("core-ir-common-gpu-"+kind.str()),message);};
  const auto spend=[&](size_t n=1){return p.charge(n)||fail("budget","logical GPU binding work exceeded");};
  if(!exact(request,{"family","version","target","kernels","bindings"})||
      string(field(request,"family"))!="tsfg.gpu-logical-binding-request"||field(request,"version").getAsInteger()!=2)
    return fail("request","logical GPU binding request identity differs");
  if(string(field(request,"target"))!="vulkan")return fail("target","unsupported logical GPU target");
  const auto &kernels=items(field(request,"kernels")),&bindings=items(field(request,"bindings"));
  if(!field(request,"kernels").getAsArray()||kernels.empty()||kernels.size()>32||
      !field(request,"bindings").getAsArray()||bindings.size()>4096)return fail("request","bounded kernel and binding arrays required");
  if(!spend(items(field(p.hir,"functions")).size()+items(field(p.hir,"globals")).size()+items(field(p.hir,"types")).size()))return false;
  std::map<std::string,const Json *> functions,globals,types;
  for(const auto &row:items(field(p.hir,"functions")))functions.emplace(string(field(row,"id")),&row);
  for(const auto &row:items(field(p.hir,"globals")))globals.emplace(string(field(row,"id")),&row);
  for(const auto &row:items(field(p.hir,"types")))types.emplace(string(field(row,"id")),&row);
  const auto i32=[&](const std::string &id){const auto found=types.find(id);return found!=types.end()&&
    string(field(*found->second,"kind"))=="scalar"&&string(field(*found->second,"name"))=="i32"&&string(field(*found->second,"sourceType"))=="i32";};
  const auto source=[](const Json &row,const std::string &path)->Json{return Object{{"sourceId",path},{"start",field(field(row,"range"),"start")},{"end",field(field(row,"range"),"end")}};};
  const auto locate=[&](const Json &row,const std::string &path){e.path=path;e.range={uint32_t(field(field(row,"range"),"start").getAsInteger().value_or(0)),uint32_t(field(field(row,"range"),"end").getAsInteger().value_or(0))};};
  struct Resource {bool read=false,write=false;Json source=nullptr;};
  using Key=std::tuple<std::string,std::string,std::string>;
  std::map<Key,Resource> required;Array selected;std::set<std::string> group;
  for(const auto &id:items(field(p.request,"targets"))){if(!spend())return false;group.insert(string(id));}
  std::string previous;
  for(const auto &value:kernels){
    if(!spend())return false;const auto id=string(value);const auto found=functions.find(id);
    if(!value.getAsString()||!group.count(id)||found==functions.end()||(!previous.empty()&&previous>=id))
      return fail("kernel","GPU kernels must be an ordered unique subset of the verified kernel group");
    const auto &fn=*found->second;const auto path=string(field(fn,"sourcePath"));locate(fn,path);
    const auto result=string(field(fn,"returnType"));const bool empty=types.count(result)&&string(field(*types.at(result),"kind"))=="void";
    if(!field(fn,"ownerType").getAsNull()||(!empty&&!i32(result)))return fail("capability","unsupported GPU receiver or return type");
    if(!empty)required.emplace(Key{"return",id,id},Resource{false,true,source(fn,path)});
    const auto &upper=p.fixedEffects.at(id);const auto &parameters=items(field(fn,"parameters"));
    for(size_t index=0;index<parameters.size();++index){
      if(!spend())return false;const auto &parameter=parameters[index];locate(parameter,path);
      if(!i32(string(field(parameter,"type")))||upper.parameters[index].write||upper.parameters[index].structural)
        return fail("capability","unsupported GPU parameter type or mutable parameter access");
      required.emplace(Key{"parameter",id,string(field(parameter,"id"))},Resource{true,false,source(parameter,path)});
    }
    for(const auto &access:{std::pair{&upper.reads,false},std::pair{&upper.writes,true}})for(const auto &global:*access.first){
      if(!spend())return false;const auto declared=globals.find(global);
      if(declared==globals.end())return fail("identity","GPU GlobalId is not in the verified Program");
      const auto &row=*declared->second;const auto globalPath=string(field(row,"sourcePath"));locate(row,globalPath);
      if(!i32(string(field(row,"type"))))return fail("capability","unsupported GPU global resource type");
      auto &resource=required[Key{"global","",global}];resource.source=source(row,globalPath);
      if(access.second)resource.write=true;else resource.read=true;
    }
    locate(fn,path);selected.push_back(Object{{"functionId",id},{"source",source(fn,path)}});previous=id;
    if(required.size()>4096)return fail("budget","logical GPU resource count exceeded");
  }
  Array admitted;std::set<Key> seen;std::pair<int64_t,int64_t> previousSlot{-1,-1};
  for(const auto &binding:bindings){
    if(!spend())return false;
    if(!exact(binding,{"kind","id","kernel","set","binding","access"}))return fail("binding","logical descriptor fields differ");
    const auto kind=string(field(binding,"kind")),id=string(field(binding,"id")),kernel=string(field(binding,"kernel"));
    if(!field(binding,"id").getAsString()||(kind!="global"&&kind!="parameter"&&kind!="return")||
        (kind=="global"?!field(binding,"kernel").getAsNull():!field(binding,"kernel").getAsString())||
        (kind=="return"&&id!=kernel))return fail("identity","logical resource identity differs");
    const auto set=field(binding,"set").getAsInteger(),slot=field(binding,"binding").getAsInteger();
    if(!set||!slot||*set<0||*set>UINT32_MAX||*slot<0||*slot>UINT32_MAX)return fail("binding","descriptor set and binding must be uint32");
    const auto order=std::pair{*set,*slot};if(previousSlot>=order)return fail("binding","descriptor slots must be unique and ordered");previousSlot=order;
    const Key key{kind,kernel,id};const auto found=required.find(key);
    if(found==required.end()||!seen.insert(key).second)return fail("identity","logical resource is foreign, extra or repeated");
    const auto &resource=found->second;const auto &anchor=resource.source;e.path=string(field(anchor,"sourceId"));
    e.range={uint32_t(field(anchor,"start").getAsInteger().value_or(0)),uint32_t(field(anchor,"end").getAsInteger().value_or(0))};
    const auto expected=resource.read?(resource.write?"read-write":"read"):"write";
    if(string(field(binding,"access"))!=expected)return fail("access","logical descriptor access must equal the fixed Published access");
    admitted.push_back(Object{{"kind",kind},{"id",id},{"kernel",field(binding,"kernel")},{"set",*set},{"binding",*slot},
      {"access",expected},{"type","i32"},{"source",resource.source}});
  }
  if(seen.size()!=required.size()){
    for(const auto &[key,resource]:required)if(!seen.count(key)){
      const auto &anchor=resource.source;e.path=string(field(anchor,"sourceId"));
      e.range={uint32_t(field(anchor,"start").getAsInteger().value_or(0)),uint32_t(field(anchor,"end").getAsInteger().value_or(0))};break;
    }
    return fail("coverage","logical bindings must cover every selected global, scalar parameter and i32 return");
  }
  out=Object{{"family","tsfg.gpu-logical-binding-plan"},{"version",2},{"target","vulkan"},{"scope","static-buffer-abi"},
    {"layout",Object{{"profile","vulkan-storage-buffer-std430-scalar-i32-v1"},{"memberOffset",0},{"memberBytes",4},{"memberAlignment",4},{"blockBytes",4}}},
    {"inputIdentity",p.inputIdentity},{"hirDigest",p.hirHash},{"scopeDigest",field(p.publication,"scopeDigest")},
    {"publishedDigest",field(p.publication,"expectedDigest")},{"kernelProofDigest",digest(canonical(p.proof)+"\n")},
    {"borrowProofDigest",digest(canonical(borrowProof)+"\n")},{"requestDigest",digest(canonical(request)+"\n")},
    {"groupTargets",field(p.proof,"targets")},{"kernels",std::move(selected)},{"bindings",std::move(admitted)}};
  if(canonical(out).size()>=8388608)return fail("budget","logical GPU plan exceeds the output byte budget");
  return true;
}
} // namespace tsfg::commonProgram
