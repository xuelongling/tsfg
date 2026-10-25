// SPDX-License-Identifier: MIT
#include "common-program-source.h"
#include "llvm/ADT/STLExtras.h"
namespace tsfg::commonProgram {
namespace {
using Origins=std::set<std::string>;using Environment=std::map<std::string,Origins>;
enum Completion:unsigned {Normal=1,Returned=2,Thrown=4};
struct Value {Origins owners;bool throwing=false;};
struct Derive {
  Program &p;const Json &fn;const std::map<std::string,Effects> &upper;Effects &out;Error &e;
  std::map<std::string,const Json *> types,functions;std::map<std::string,bool> references;
  Environment environment;std::set<std::string> activeTypes;
  bool ok(bool c,llvm::StringRef detail){return c||reject(e,"core-ir-common-effects",detail);}
  bool step(size_t n=1){return p.charge(n)||reject(e,"core-ir-common-budget","independent body effects work exceeded");}
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
  void mark(const Origins &owners,unsigned flag){
    for(const auto &owner:owners){if(!step())return;
      if(llvm::StringRef(owner).starts_with("g:")){if(flag==0)out.reads.insert(owner.substr(2));else out.writes.insert(owner.substr(2));}
      if(llvm::StringRef(owner).starts_with("p:")){
        unsigned index=0;if(!ok(!llvm::StringRef(owner).drop_front(2).getAsInteger(10,index)&&index<out.parameters.size(),"parameter owner index differs"))return;
        auto &p=out.parameters[index];if(flag==0)p.read=true;else if(flag==1)p.write=true;else p.structural=true;
      }
    }
  }
  const Effects *consume(const std::string &id,const std::vector<Origins> &args){
    if(!step()||!ok(functions.count(id)&&upper.count(id),"complete fixed callee bound missing"))return nullptr;
    const auto &u=upper.at(id);out.calls.insert(id);
    if(!step(u.reads.size()+u.writes.size()+u.parameters.size()))return nullptr;
    out.reads.insert(u.reads.begin(),u.reads.end());out.writes.insert(u.writes.begin(),u.writes.end());
    out.allocation|=u.allocation;out.managedReference|=u.managedReference;out.ehControl|=u.ehControl;
    out.await|=u.await;out.lock|=u.lock;out.escape|=u.escape;out.unknownHost|=u.unknownHost;
    for(size_t i=0;i<u.parameters.size();++i){if(!ok(i<args.size(),"call owner arity differs"))return nullptr;
      if(u.parameters[i].read)mark(args[i],0);if(u.parameters[i].write)mark(args[i],1);if(u.parameters[i].structural)mark(args[i],2);}
    return &u;
  }
  Value expression(const Json &v,Environment &env){
    Value result;if(!step())return result;const auto kind=string(field(v,"kind")),type=string(field(v,"type"));
    if(reference(type))out.managedReference=true;
    const auto visit=[&](const Json &child){auto value=expression(child,env);result.throwing|=value.throwing;return value.owners;};
    if(kind=="bindingReference"||kind=="bindingTarget"||kind=="thisReference"){
      const auto id=kind=="thisReference"?string(field(fn,"receiverBinding")):string(field(v,"binding"));if(env.count(id))result.owners=ownerCopy(env.at(id));
    }else if(kind=="globalReference"||kind=="globalTarget"){
      const auto id=string(field(v,"global"));result.owners.insert("g:"+id);if(kind=="globalReference")out.reads.insert(id);
    }else if(kind=="parentheses"||kind=="as"||kind=="nonNull")result.owners=visit(field(v,"expression"));
    else if(kind=="arrayLiteral"){
      for(const auto &child:items(field(v,"elements")))visit(child);out.allocation=true;out.managedReference=true;result.owners.insert("local:"+string(field(v,"allocationSite")));
    }else if(kind=="fieldAccess"||kind=="fieldTarget"||kind=="checkedElementAccess"||kind=="elementTarget"||kind=="arrayLength"||kind=="readSpanLength"||kind=="lengthTarget"){
      result.owners=visit(field(v,"receiver"));if(v.getAsObject()->get("index"))visit(field(v,"index"));
      if(kind=="fieldAccess"||kind=="checkedElementAccess"||kind=="arrayLength"||kind=="readSpanLength")mark(result.owners,0);
    }else if(llvm::StringRef(kind).ends_with("Assignment")||llvm::StringRef(kind).ends_with("Update")){
      const auto &target=field(v,"target");auto owners=visit(target);const auto op=string(field(v,"operator"));if(op!="=")mark(owners,0);
      Origins assigned;if(v.getAsObject()->get("value"))assigned=visit(field(v,"value"));mark(owners,1);
      if(kind=="lengthAssignment"||llvm::StringRef(kind).starts_with("element"))mark(owners,2);
      if(op=="="&&target.getAsObject()->get("binding")&&!target.getAsObject()->get("global"))env[string(field(target,"binding"))]=ownerCopy(assigned);
      result.owners=std::move(assigned);
    }else if(kind=="new"||kind=="superConstruct"){
      std::vector<Origins> args;for(const auto &a:items(field(v,"arguments")))args.push_back(visit(a));
      const auto tid=kind=="new"?type:string(field(v,"callee"));if(!ok(types.count(tid),"construction type missing"))return result;
      const auto &t=*types.at(tid);if(string(field(t,"kind"))=="reference"){out.allocation=true;out.managedReference=true;}
      result.owners.insert("local:"+string(v.getAsObject()->get("allocationSite")?field(v,"allocationSite"):field(v,"construction")));
      for(const auto &f:items(field(t,"fields")))if(f.getAsObject()->get("initializer"))visit(field(f,"initializer"));
      const auto fid=string(field(field(t,"construction"),"functionId"));if(!fid.empty()){
        args.insert(args.begin(),ownerCopy(result.owners));if(auto *u=consume(fid,args))result.throwing|=u->mayThrow;
      }
    }else if(kind=="call"){
      std::vector<Origins> args;if(v.getAsObject()->get("receiver"))args.push_back(visit(field(v,"receiver")));
      for(const auto &a:items(field(v,"arguments")))args.push_back(visit(a));const auto fid=string(field(v,"callee"));
      if(fid=="intrinsic:readSpan"){if(ok(!args.empty(),"ReadSpan actual owner missing"))result.owners=ownerCopy(args[0]);}
      else if(auto *u=consume(fid,args)){result.throwing|=u->mayThrow;if(reference(type))result.owners.insert("unknown:"+fid);}
    }else{
      for(auto key:{"expression","left","right","receiver","index","value"})if(v.getAsObject()->get(key))visit(field(v,key));
      if(kind=="stringConcat"){out.allocation=true;out.managedReference=true;}
    }
    return result;
  }
  unsigned body(const Json &rows,Environment &env){
    if(!e.message.empty())return 0;
    unsigned completions=Normal;
    for(const auto &row:items(rows)){
      if(!step())return 0;if(!(completions&Normal))break;completions&=~Normal;unsigned current=Normal;
      const auto inspect=[&](const Json &v){auto result=expression(v,env);if(result.throwing)current|=Thrown;return result.owners;};
      const auto kind=string(field(row,"kind"));
      if(kind=="constDeclaration"||kind=="letDeclaration"||kind=="initialize"){
        env[string(field(row,"binding"))]=inspect(field(row,"initializer"));if(row.getAsObject()->get("global"))out.writes.insert(string(field(row,"global")));
      }else if(kind=="expression")inspect(field(row,"value"));
      else if(kind=="return"){
        if(row.getAsObject()->get("value")){auto owners=inspect(field(row,"value"));const auto type=string(field(fn,"returnType"));
          if(reference(type))out.escape=true;if(types.count(type)&&string(field(*types.at(type),"kind"))=="readSpan")
            for(const auto &owner:owners)if(!step()||!ok(!llvm::StringRef(owner).starts_with("local:")&&!llvm::StringRef(owner).starts_with("unknown:"),"ReadSpan returned beyond current owner activation"))return 0;
        }current=(current&~Normal)|Returned;
      }else if(kind=="throw"){inspect(field(row,"value"));out.ehControl=true;current=Thrown;}
      else if(kind=="block"){auto child=snapshot(env);current=body(field(row,"body"),child);}
      else if(kind=="if"){
        auto condition=expression(field(row,"condition"),env);auto yes=snapshot(env),no=snapshot(env);current=body(field(row,"then"),yes)|body(field(row,"else"),no);
        merge(env,yes);merge(env,no);if(condition.throwing)current|=Thrown;
      }else if(kind=="while"){
        auto condition=expression(field(row,"condition"),env);auto loop=snapshot(env);current=Normal|(body(field(row,"body"),loop)&~Normal);merge(env,loop);if(condition.throwing)current|=Thrown;
      }else if(kind=="try"){
        out.ehControl=true;auto attempted=snapshot(env);current=body(field(field(row,"tryBlock"),"body"),attempted);merge(env,attempted);
        if(row.getAsObject()->get("catchClause")&&(current&Thrown)){
          current&=~Thrown;auto caught=snapshot(env);const auto &c=field(row,"catchClause");const auto binding=string(field(field(c,"binding"),"id"));if(!binding.empty())caught[binding]={"unknown:catch"};
          current|=body(field(field(c,"block"),"body"),caught);merge(env,caught);
        }
        if(row.getAsObject()->get("finallyBlock")){
          auto final=snapshot(env);const auto finished=body(field(field(row,"finallyBlock"),"body"),final);merge(env,final);
          current=((finished&Normal)?current:0)|(finished&~Normal);
        }
      }else if(!ok(false,"unknown owned statement in full effect derivation"))return 0;
      completions|=current;
    }
    return completions;
  }
  bool run(){
    if(!step(items(field(p.hir,"types")).size()+items(field(p.hir,"functions")).size()))return false;
    for(const auto &t:items(field(p.hir,"types")))types.emplace(string(field(t,"id")),&t);
    for(const auto &f:items(field(p.hir,"functions")))functions.emplace(string(field(f,"id")),&f);
    std::vector<std::pair<std::string,std::string>> parameters;
    if(!field(fn,"ownerType").getAsNull())parameters.emplace_back(string(field(fn,"receiverBinding")),string(field(fn,"ownerType")));
    for(const auto &b:items(field(fn,"parameters")))parameters.emplace_back(string(field(b,"id")),string(field(b,"type")));
    out.parameters.resize(parameters.size());
    for(size_t i=0;i<parameters.size();++i){if(!step())return false;auto [binding,type]=parameters[i];if(reference(type)){environment[binding]={"p:"+std::to_string(i)};out.managedReference=true;}}
    if(reference(string(field(fn,"returnType"))))out.managedReference=true;
    out.mayThrow=body(field(fn,"body"),environment)&Thrown;return e.message.empty();
  }
};
}
bool deriveEffects(Program &p,const Json &fn,const std::map<std::string,Effects> &upper,Effects &out,Error &e){
  Derive derive{p,fn,upper,out,e};return derive.run();
}
Json writeEffects(const Effects &e){
  Array reads,writes,parameters;for(const auto &id:e.reads)reads.push_back(id);for(const auto &id:e.writes)writes.push_back(id);
  for(size_t i=0;i<e.parameters.size();++i){const auto &p=e.parameters[i];parameters.push_back(Object{{"index",int64_t(i)},{"read",p.read},{"write",p.write},{"structural",p.structural}});}
  return Object{{"globals",Object{{"reads",std::move(reads)},{"writes",std::move(writes)}}},{"parameters",std::move(parameters)},
    {"facets",Object{{"allocation",e.allocation},{"managedReference",e.managedReference},{"ehControl",e.ehControl},{"mayThrow",e.mayThrow},
      {"await",e.await},{"lock",e.lock},{"escape",e.escape},{"unknownHost",e.unknownHost}}}};
}
} // namespace tsfg::commonProgram
