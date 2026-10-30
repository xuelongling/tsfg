// SPDX-License-Identifier: MIT
#include "common-program-source.h"
#include "common-program-methods.h"
#include "llvm/ADT/STLExtras.h"
#include <tuple>
namespace tsfg::commonProgram {
namespace {
using Origins=std::set<std::string>;using Environment=std::map<std::string,Origins>;
enum Completion:unsigned {Normal=1,Returned=2,Thrown=4};
struct Value {Origins owners;bool throwing=false;};
struct Derive {
  Program &p;const Json &fn;const std::map<std::string,Effects> &upper;Effects &out;Error &e;
  EffectDiagnostics *diagnostics=nullptr;
  std::map<std::string,const Json *> types,functions;std::map<std::string,bool> references;
  Environment environment;std::set<std::string> activeTypes;
  std::string operationSource;
  bool ok(bool c,llvm::StringRef detail){return c||reject(e,"core-ir-common-effects",detail);}
  bool step(size_t n=1){return p.charge(n)||reject(e,"core-ir-common-budget","independent body effects work exceeded");}
  Json origin(const Json *operation=nullptr,llvm::StringRef functionOperation={}){
    Json result=Object{{"kind",operation?"operation":"function"},{"functionId",field(fn,"id")},
      {"source",Object{{"sourceId",operation?Json(operationSource):field(fn,"sourcePath")},{"start",field(field(operation?*operation:fn,"range"),"start")},{"end",field(field(operation?*operation:fn,"range"),"end")}}}};
    if(operation)(*result.getAsObject())["operation"]=field(*operation,"kind");
    else if(!functionOperation.empty())(*result.getAsObject())["operation"]=functionOperation.str();return result;
  }
  void record(const Json &reason,Json selected){
    if(!diagnostics||!step())return;
    const auto key=[](const Json &row){const auto &s=field(row,"source");return std::tuple{string(field(s,"sourceId")),field(s,"start").getAsInteger().value_or(0),
      field(s,"end").getAsInteger().value_or(0),string(field(row,"kind")),string(field(row,"operation"))};};
    const auto reasonKey=canonical(reason);auto old=diagnostics->local.find(reasonKey);
    if(old==diagnostics->local.end()||key(selected)<key(old->second))diagnostics->local.insert_or_assign(reasonKey,std::move(selected));
  }
  void witness(const Json &reason,const Json *operation=nullptr,llvm::StringRef functionOperation={}){
    if(diagnostics)record(reason,origin(operation,functionOperation));
  }
  void facet(llvm::StringRef name,const Json *operation=nullptr,llvm::StringRef functionOperation={}){witness(Object{{"kind","facet"},{"facet",name.str()}},operation,functionOperation);}
  bool reference(const std::string &id){
    if(id=="void")return false;if(references.count(id))return references.at(id);
    if(!step()||!ok(types.count(id)&&activeTypes.insert(id).second,"cyclic/unowned value-containment type"))return false;
    const auto &t=*types.at(id);const auto kind=string(field(t,"kind"));
    if(kind=="reference"||kind=="array"||kind=="readSpan"||kind=="string"||kind=="unknown"){activeTypes.erase(id);return references[id]=true;}
    bool result=false;
    if(kind=="union")for(const auto &member:items(field(t,"members"))){if(!step())return false;result|=reference(string(member));}
    if(kind=="value")for(const auto &f:items(field(t,"fields"))){if(!step())return false;result|=reference(string(field(f,"type")));}
    activeTypes.erase(id);return references[id]=result;
  }
  Environment snapshot(const Environment &env){
    if(!step(env.size()))return {};
    for(const auto &[id,owners]:env){if(!step(id.size()/8+owners.size()+1))return {};
      for(const auto &owner:owners)if(!step(owner.size()/8+1))return {};}
    return env;
  }
  Origins ownerCopy(const Origins &owners){if(!step(owners.size()))return {};
    for(const auto &id:owners)if(!step(id.size()/8+1))return {};return owners;}
  Origins unite(const Origins &a,const Origins &b){Origins out;if(!step(a.size()+b.size()))return out;out=a;out.insert(b.begin(),b.end());return out;}
  void merge(Environment &a,const Environment &b){for(const auto &[id,owners]:b){if(!step())return;a[id]=unite(a[id],owners);}}
  void mark(const Origins &owners,unsigned flag,const Json *operation=nullptr){
    for(const auto &owner:owners){if(!step())return;
      if(llvm::StringRef(owner).starts_with("g:")){if(flag==0)out.reads.insert(owner.substr(2));else out.writes.insert(owner.substr(2));}
      if(llvm::StringRef(owner).starts_with("c:")){auto &access=out.captures[owner.substr(2)];if(flag==0)access.read=true;else if(flag==1)access.write=true;else access.structural=true;
        if(operation)witness(Object{{"kind","capture"},{"slot",owner.substr(2)},{"access",flag==0?"read":flag==1?"write":"structural"}},operation);}
      if(llvm::StringRef(owner).starts_with("p:")){
        unsigned index=0;if(!ok(!llvm::StringRef(owner).drop_front(2).getAsInteger(10,index)&&index<out.parameters.size(),"parameter owner index differs"))return;
        auto &p=out.parameters[index];if(flag==0)p.read=true;else if(flag==1)p.write=true;else p.structural=true;
      }
    }
  }
  const Effects *consume(const std::string &id,const std::vector<Origins> &args,const Json &operation){
    if(!step()||!ok(functions.count(id)&&upper.count(id),"complete fixed callee bound missing"))return nullptr;
    const auto &u=upper.at(id);out.calls.insert(id);
    if(diagnostics){if(!step())return nullptr;diagnostics->calls.push_back(Object{{"caller",field(fn,"id")},{"callee",id},{"kind",field(operation,"kind")},
      {"source",Object{{"sourceId",operationSource},{"start",field(field(operation,"range"),"start")},{"end",field(field(operation,"range"),"end")}}}});}
    if(!step(u.reads.size()+u.writes.size()+u.hostReads.size()+u.hostWrites.size()+u.parameters.size()+u.captures.size()))return nullptr;
    out.hostReads.insert(u.hostReads.begin(),u.hostReads.end());out.hostWrites.insert(u.hostWrites.begin(),u.hostWrites.end());
    out.reads.insert(u.reads.begin(),u.reads.end());out.writes.insert(u.writes.begin(),u.writes.end());
    out.allocation|=u.allocation;out.managedReference|=u.managedReference;out.ehControl|=u.ehControl;
    out.await|=u.await;out.lock|=u.lock;out.escape|=u.escape;out.unknownHost|=u.unknownHost;
    for(const auto &[slot,access]:u.captures){auto &captured=out.captures[slot];
      captured.read|=access.read;captured.write|=access.write;captured.structural|=access.structural;}
    for(size_t i=0;i<u.parameters.size();++i){if(!ok(i<args.size(),"call owner arity differs"))return nullptr;
      if(u.parameters[i].read)mark(args[i],0);if(u.parameters[i].write)mark(args[i],1);if(u.parameters[i].structural)mark(args[i],2);}
    return &u;
  }
  Value expression(const Json &v,Environment &env){
    Value result;if(!step())return result;const auto kind=string(field(v,"kind")),type=string(field(v,"type"));
    if(reference(type)){out.managedReference=true;facet("managedReference",&v);}
    const auto visit=[&](const Json &child){auto value=expression(child,env);result.throwing|=value.throwing;return value.owners;};
    if(kind=="bindingReference"||kind=="bindingTarget"||kind=="thisReference"){
      const auto id=kind=="thisReference"?string(field(fn,"receiverBinding")):string(field(v,"binding"));if(env.count(id))result.owners=ownerCopy(env.at(id));
    }else if(kind=="globalReference"||kind=="globalTarget"){
      const auto id=string(field(v,"global"));result.owners.insert("g:"+id);if(kind=="globalReference")out.reads.insert(id);
    }else if(kind=="parentheses"||kind=="as"||kind=="nonNull")result.owners=visit(field(v,"expression"));
    else if(kind=="arrayLiteral"){
      for(const auto &child:items(field(v,"elements")))visit(child);out.allocation=true;out.managedReference=true;facet("allocation",&v);facet("managedReference",&v);result.owners.insert("local:"+string(field(v,"allocationSite")));
    }else if(kind=="fieldAccess"||kind=="fieldTarget"||kind=="checkedElementAccess"||kind=="elementTarget"||kind=="arrayLength"||kind=="readSpanLength"||kind=="lengthTarget"){
      result.owners=visit(field(v,"receiver"));if(v.getAsObject()->get("index"))visit(field(v,"index"));
      if(kind=="fieldAccess"||kind=="checkedElementAccess"||kind=="arrayLength"||kind=="readSpanLength")mark(result.owners,0,&v);
    }else if(llvm::StringRef(kind).ends_with("Assignment")||llvm::StringRef(kind).ends_with("Update")){
      const auto &target=field(v,"target");auto owners=visit(target);const auto op=string(field(v,"operator"));if(op!="=")mark(owners,0,&v);
      Origins assigned;if(v.getAsObject()->get("value"))assigned=visit(field(v,"value"));mark(owners,1,&v);
      if(kind=="lengthAssignment"||llvm::StringRef(kind).starts_with("element"))mark(owners,2,&v);
      if(op=="="&&target.getAsObject()->get("binding")&&!target.getAsObject()->get("global"))env[string(field(target,"binding"))]=ownerCopy(assigned);
      result.owners=std::move(assigned);
    }else if(kind=="new"||kind=="superConstruct"){
      std::vector<Origins> args;for(const auto &a:items(field(v,"arguments")))args.push_back(visit(a));
      const auto tid=kind=="new"?type:string(field(v,"callee"));if(!ok(types.count(tid),"construction type missing"))return result;
      const auto &t=*types.at(tid);if(string(field(t,"kind"))=="reference"){out.allocation=true;out.managedReference=true;facet("allocation",&v);facet("managedReference",&v);}
      result.owners.insert("local:"+string(v.getAsObject()->get("allocationSite")?field(v,"allocationSite"):field(v,"construction")));
      if(!step(args.size()+1))return result;args.insert(args.begin(),ownerCopy(result.owners));
      const auto initialize=[&](const Json &current){
        std::map<std::string,const Json *> fields;
        for(const auto &f:items(field(current,"fields"))){if(!step())return false;fields.emplace(string(field(f,"id")),&f);}
        for(const auto &id:items(field(field(current,"construction"),"initializationFields"))){
          if(!step())return false;const auto &f=*fields.at(string(id));
          if(f.getAsObject()->get("initializer")){
            const auto previousSource=operationSource;operationSource=string(field(field(f,"origin"),"source"));
            visit(field(f,"initializer"));operationSource=previousSource;if(!e.message.empty())return false;
          }
        }return true;
      };
      // Explicit derived bodies own super; implicit hops forward these saved
      // arguments and initialize their own fields only after successful base.
      const auto construct=[&](auto &&self,const Json &current)->void{
        if(!step())return;const auto fid=string(field(field(current,"construction"),"functionId")),base=string(field(current,"base"));
        if(!fid.empty()){
          if(base.empty()&&!initialize(current))return;
          if(auto *u=consume(fid,args,v))result.throwing|=u->mayThrow;
        }else{
          if(!base.empty())self(self,*types.at(base));
          if(e.message.empty())initialize(current);
        }
      };
      construct(construct,t);
      if(e.message.empty()&&kind=="superConstruct")initialize(*types.at(string(field(fn,"ownerType"))));
    }else if(kind=="indirectCall"){
      // Resolve the saved callee before its arguments. Permission comes from
      // the independently rebuilt complete fixed code-target upper, not SSA
      // arms, physical capacity or this call's narrower actual instances.
      visit(field(v,"expression"));std::vector<Origins> args;
      for(const auto &a:items(field(v,"arguments")))args.push_back(visit(a));
      const auto key=string(field(fn,"id"))+"/"+std::to_string(*field(field(v,"range"),"start").getAsInteger())+":"+
        std::to_string(*field(field(v,"range"),"end").getAsInteger());
      const auto site=p.callableSites.find(key);
      if(!ok(site!=p.callableSites.end(),"independent fixed callable site is missing"))return result;
      if(site->second.top||site->second.functions.empty()){out.unknownHost=true;facet("unknownHost",&v);result.throwing=true;if(reference(type))result.owners.insert("unknown:indirect");}
      for(const auto &target:site->second.functions){if(!step())return result;
        if(auto *u=consume(target,args,v)){result.throwing|=u->mayThrow;if(reference(type))result.owners.insert("unknown:"+target);}
      }
    }else if(kind=="hostCall"){
      for(const auto &arg:items(field(v,"arguments")))visit(arg);if(!ok(p.hosts.count(string(field(v,"callee")))&&!p.hostContractHash.empty(),"verified Host context missing"))return result;
      for(const auto &resource:p.hostResources){if(!step())return result;out.hostReads.insert(resource);out.hostWrites.insert(resource);
        for(auto access:{"read","write"})witness(Object{{"kind","host-resource"},{"resource",resource},{"access",access}},&v);}
      const auto &range=field(v,"range");p.hostOrigins.try_emplace(string(field(fn,"id")),HostOrigin{operationSource,{uint32_t(field(range,"start").getAsInteger().value()),uint32_t(field(range,"end").getAsInteger().value())}});
    }else if(kind=="call"){
      std::vector<Origins> args;if(v.getAsObject()->get("receiver"))args.push_back(visit(field(v,"receiver")));
      for(const auto &a:items(field(v,"arguments")))args.push_back(visit(a));const auto fid=string(field(v,"callee"));
      if(fid=="intrinsic:readSpan"){if(ok(!args.empty(),"ReadSpan actual owner missing"))result.owners=ownerCopy(args[0]);}
      else if(functions.count(fid)&&string(field(*functions.at(fid),"kind"))=="method"){
        Json rows=nullptr;if(!methodDispatch(p,string(field(field(v,"receiver"),"type")),fid,rows,e))return result;std::vector<std::string> targets;
        if(!methodTargets(p,rows,targets,e))return result;
        for(const auto &target:targets)if(auto *u=consume(target,args,v)){result.throwing|=u->mayThrow;if(reference(type))result.owners.insert("unknown:"+target);}
      }else if(auto *u=consume(fid,args,v)){result.throwing|=u->mayThrow;if(reference(type))result.owners.insert("unknown:"+fid);}
    }else{
      for(auto key:{"expression","left","right","receiver","index","value"})if(v.getAsObject()->get(key))visit(field(v,key));
      if(kind=="stringConcat"){out.allocation=true;out.managedReference=true;facet("allocation",&v);facet("managedReference",&v);}
    }
    return result;
  }
  unsigned body(const Json &rows,Environment &env,std::map<std::string,Json> *escapingThrows=nullptr){
    if(!e.message.empty())return 0;
    unsigned completions=Normal;
    for(const auto &row:items(rows)){
      if(!step())return 0;if(!(completions&Normal))break;completions&=~Normal;unsigned current=Normal;
      std::map<std::string,Json> rowThrows;
      const auto inspect=[&](const Json &v){auto result=expression(v,env);if(result.throwing)current|=Thrown;return result.owners;};
      const auto kind=string(field(row,"kind"));
      if(kind=="functionDeclaration"){
        // Hoisted lexical identity is not an observation of its environment.
      }else if(kind=="constDeclaration"||kind=="letDeclaration"||kind=="initialize"){
        env[string(field(row,"binding"))]=inspect(field(row,"initializer"));if(row.getAsObject()->get("global"))out.writes.insert(string(field(row,"global")));
      }else if(kind=="expression")inspect(field(row,"value"));
      else if(kind=="return"){
        if(row.getAsObject()->get("value")){auto owners=inspect(field(row,"value"));const auto type=string(field(fn,"returnType"));
          if(reference(type)){out.escape=true;facet("escape",&row);}if(types.count(type)&&string(field(*types.at(type),"kind"))=="readSpan")
            for(const auto &owner:owners)if(!step()||!ok(!llvm::StringRef(owner).starts_with("local:")&&!llvm::StringRef(owner).starts_with("unknown:"),"ReadSpan returned beyond current owner activation"))return 0;
        }current=(current&~Normal)|Returned;
      }else if(kind=="throw"){inspect(field(row,"value"));out.ehControl=true;facet("ehControl",&row);current=Thrown;
        if(diagnostics){auto selected=origin(&row);rowThrows.emplace(canonical(selected),std::move(selected));}}
      else if(kind=="block"){auto child=snapshot(env);current=body(field(row,"body"),child,&rowThrows);}
      else if(kind=="if"){
        auto condition=expression(field(row,"condition"),env);auto yes=snapshot(env),no=snapshot(env);current=body(field(row,"then"),yes,&rowThrows)|body(field(row,"else"),no,&rowThrows);
        merge(env,yes);merge(env,no);if(condition.throwing)current|=Thrown;
      }else if(kind=="while"){
        auto condition=expression(field(row,"condition"),env);auto loop=snapshot(env);current=Normal|(body(field(row,"body"),loop,&rowThrows)&~Normal);merge(env,loop);if(condition.throwing)current|=Thrown;
      }else if(kind=="try"){
        out.ehControl=true;facet("ehControl",&row);auto attempted=snapshot(env);current=body(field(field(row,"tryBlock"),"body"),attempted,&rowThrows);merge(env,attempted);
        if(row.getAsObject()->get("catchClause")&&(current&Thrown)){
          current&=~Thrown;auto caught=snapshot(env);const auto &c=field(row,"catchClause");const auto binding=string(field(field(c,"binding"),"id"));if(!binding.empty())caught[binding]={"unknown:catch"};
          rowThrows.clear();current|=body(field(field(c,"block"),"body"),caught,&rowThrows);merge(env,caught);
        }
        if(row.getAsObject()->get("finallyBlock")){
          auto final=snapshot(env);std::map<std::string,Json> finalThrows;const auto finished=body(field(field(row,"finallyBlock"),"body"),final,&finalThrows);merge(env,final);
          if(!(finished&Normal))rowThrows.clear();rowThrows.insert(finalThrows.begin(),finalThrows.end());
          current=((finished&Normal)?current:0)|(finished&~Normal);
        }
      }else if(!ok(false,"unknown owned statement in full effect derivation"))return 0;
      completions|=current;
      if(escapingThrows&&(current&Thrown))escapingThrows->insert(rowThrows.begin(),rowThrows.end());
    }
    return completions;
  }
  bool run(){
    operationSource=string(field(fn,"sourcePath"));
    if(!step(items(field(p.hir,"types")).size()+items(field(p.hir,"functions")).size()))return false;
    for(const auto &t:items(field(p.hir,"types")))types.emplace(string(field(t,"id")),&t);
    for(const auto &f:items(field(p.hir,"functions")))functions.emplace(string(field(f,"id")),&f);
    if(!field(fn,"activationEnvironment").getAsNull()){out.allocation=out.managedReference=true;facet("allocation",nullptr,"activationEnvironment");facet("managedReference",nullptr,"activationEnvironment");}
    if(!field(fn,"lexicalEnvironment").getAsNull()){out.managedReference=true;facet("managedReference",nullptr,"lexicalEnvironment");}
    if(!items(field(fn,"captures")).empty()){
      std::map<std::string,std::pair<std::string,std::string>> slots;
      for(const auto &env:items(field(p.hir,"environments")))for(const auto &slot:items(field(env,"slots"))){
        if(!step())return false;slots.emplace(string(field(slot,"binding")),std::pair{string(field(slot,"key")),string(field(slot,"type"))});
      }
      for(const auto &capture:items(field(fn,"captures"))){if(!step())return false;const auto binding=string(field(capture,"binding"));
        if(!ok(slots.count(binding),"captured binding has no owned environment slot"))return false;
        const auto &[key,type]=slots.at(binding);auto &access=out.captures[key];
        const auto &shape=*types.at(type);const auto kind=string(field(shape,"kind"));bool value=kind=="value";
        if(kind=="union")for(const auto &member:items(field(shape,"members"))){if(!step())return false;value|=string(field(*types.at(string(member)),"kind"))=="value";}
        if(reference(type)||value)environment[binding]={"c:"+key};access.read|=field(capture,"read").getAsBoolean()==true;
        access.write|=field(capture,"write").getAsBoolean()==true;
        if(access.read)witness(Object{{"kind","capture"},{"slot",key},{"access","read"}},nullptr,"capture");
        if(access.write)witness(Object{{"kind","capture"},{"slot",key},{"access","write"}},nullptr,"capture");
      }
    }
    std::vector<std::pair<std::string,std::string>> parameters;
    if(!field(fn,"ownerType").getAsNull())parameters.emplace_back(string(field(fn,"receiverBinding")),string(field(fn,"ownerType")));
    for(const auto &b:items(field(fn,"parameters")))parameters.emplace_back(string(field(b,"id")),string(field(b,"type")));
    out.parameters.resize(parameters.size());
    for(size_t i=0;i<parameters.size();++i){if(!step())return false;auto [binding,type]=parameters[i];if(reference(type)){environment[binding]={"p:"+std::to_string(i)};out.managedReference=true;facet("managedReference",nullptr,"signature");}}
    if(reference(string(field(fn,"returnType")))){out.managedReference=true;facet("managedReference",nullptr,"signature");}
    std::map<std::string,Json> throws;out.mayThrow=body(field(fn,"body"),environment,diagnostics?&throws:nullptr)&Thrown;
    if(out.mayThrow)for(const auto &[key,selected]:throws)record(Object{{"kind","facet"},{"facet","mayThrow"}},selected);return e.message.empty();
  }
};
}
bool deriveEffects(Program &p,const Json &fn,const std::map<std::string,Effects> &upper,Effects &out,Error &e){
  Derive derive{p,fn,upper,out,e};return derive.run();
}
bool deriveEffectDiagnostics(Program &p,const Json &fn,const std::map<std::string,Effects> &upper,Effects &out,Error &e,EffectDiagnostics &diagnostics){
  Derive derive{p,fn,upper,out,e,&diagnostics};return derive.run();
}
Json writeEffects(const Effects &e){
  Array hostReads,hostWrites;for(const auto &id:e.hostReads)hostReads.push_back(id);for(const auto &id:e.hostWrites)hostWrites.push_back(id);
  Array reads,writes,parameters,captures;for(const auto &id:e.reads)reads.push_back(id);for(const auto &id:e.writes)writes.push_back(id);
  for(const auto &[slot,access]:e.captures)captures.push_back(Object{{"slot",slot},{"read",access.read},{"write",access.write},{"structural",access.structural}});
  for(size_t i=0;i<e.parameters.size();++i){const auto &p=e.parameters[i];parameters.push_back(Object{{"index",int64_t(i)},{"read",p.read},{"write",p.write},{"structural",p.structural}});}
  return Object{{"hostResources",Object{{"reads",std::move(hostReads)},{"writes",std::move(hostWrites)}}},{"globals",Object{{"reads",std::move(reads)},{"writes",std::move(writes)}}},{"parameters",std::move(parameters)},{"captures",std::move(captures)},
    {"facets",Object{{"allocation",e.allocation},{"managedReference",e.managedReference},{"ehControl",e.ehControl},{"mayThrow",e.mayThrow},
      {"await",e.await},{"lock",e.lock},{"escape",e.escape},{"unknownHost",e.unknownHost}}}};
}
} // namespace tsfg::commonProgram
