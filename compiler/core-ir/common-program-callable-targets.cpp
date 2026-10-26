// SPDX-License-Identifier: MIT
// Independent code-target flow over the complete owned Source tree. Neither
// producer SSA arm rows nor physical carriers supply target membership.
#include "common-program-source.h"
#include "common-program-methods.h"
#include <optional>
namespace tsfg::commonProgram {
namespace {
using Targets=CallableTargets;using State=std::map<std::string,Targets>;
struct Bound {std::vector<Targets> parameters;std::optional<Targets> returned;};
struct Summary {const Json *fn=nullptr;bool reached=false;std::vector<Targets> parameters,observations;std::optional<Targets> returned;};
struct TargetFlow {
  Program &p;Error &e;bool fixed=false,dirty=false;
  std::map<std::string,const Json *> types,functions;
  std::map<std::string,Bound> bounds;std::map<std::string,Summary> summaries;
  std::map<std::string,Targets> sites;
  bool step(size_t n=1){return p.charge(n)||reject(e,"core-ir-common-budget","independent callable target work exceeded");}
  bool need(bool c,llvm::StringRef detail){return c||reject(e,"core-ir-common-callable",detail);}
  bool callable(const std::string &id)const{auto t=types.find(id);return t!=types.end()&&string(field(*t->second,"kind"))=="function";}
  bool equal(const Targets &a,const Targets &b){return step(a.functions.size()+b.functions.size()+1)&&a.top==b.top&&a.functions==b.functions;}
  Targets copy(const Targets &v){if(!step(v.functions.size()+1))return {};return v;}
  Targets join(const Targets &a,const Targets &b){
    if(!step(a.functions.size()+b.functions.size()+1))return {};Targets result=a;result.top|=b.top;
    for(const auto &id:b.functions){if(!result.functions.count(id)&&result.functions.size()>=256){reject(e,"core-ir-common-budget","callable target alternatives exceed bound");return {};}result.functions.insert(id);}return result;
  }
  bool merge(Targets &into,const Targets &value){auto next=join(into,value);if(!e.message.empty())return false;
    if(!equal(into,next)){into=std::move(next);dirty=true;}return e.message.empty();}
  State snapshot(const State &state){if(!step(state.size()))return {};size_t members=0;for(const auto &[id,value]:state){if(!step())return {};members+=value.functions.size();}
    if(!step(members))return {};return state;}
  void combine(State &into,const State &from){for(const auto &[id,value]:from){if(!step())return;into[id]=join(into[id],value);if(!e.message.empty())return;}}
  bool equalState(const State &a,const State &b){if(!step(a.size()+b.size())||a.size()!=b.size())return false;
    for(const auto &[id,value]:a){if(!step())return false;auto other=b.find(id);if(other==b.end()||!equal(value,other->second))return false;}return true;}
  Targets readSet(const Json &value){Targets result;result.top=field(value,"top").getAsBoolean()==true;
    const auto &rows=items(field(value,"functions"));if(!step(rows.size()))return result;
    for(const auto &row:rows)result.functions.insert(string(row));return result;}
  bool catalogue(){
    for(const auto &type:items(field(p.hir,"types"))){if(!step())return false;types.emplace(string(field(type,"id")),&type);}
    for(const auto &fn:items(field(p.hir,"functions"))){if(!step())return false;functions.emplace(string(field(fn,"id")),&fn);}
    const auto &contracts=items(field(p.publication,"contracts"));
    if(!need(field(p.publication,"contracts").getAsArray()&&contracts.size()==functions.size(),"complete fixed callable rows required"))return false;
    size_t index=0;for(const auto &fn:items(field(p.hir,"functions"))){
      if(!step())return false;const auto &record=contracts[index++];const auto id=string(field(fn,"id"));
      if(!need(exact(record,{"functionId","signatureHash","upper","callables","digest"})&&same(field(record,"functionId"),field(fn,"id"))&&
        same(field(record,"signatureHash"),field(fn,"signatureHash")),"fixed callable row identity or order differs")||
        !validateCallableBounds(p,fn,field(record,"callables"),e))return false;
      Bound bound;const auto &params=items(field(fn,"parameters"));if(!step(params.size()))return false;bound.parameters.resize(params.size());
      const auto &raw=field(record,"callables");for(const auto &row:items(field(raw,"parameters"))){
        if(!step())return false;bound.parameters[size_t(*field(row,"index").getAsInteger())]=readSet(field(row,"allowed"));}
      if(callable(string(field(fn,"returnType"))))bound.returned=readSet(field(raw,"returns"));bounds.emplace(id,std::move(bound));
    }return e.message.empty();
  }
  Summary *reach(const std::string &id){auto found=summaries.find(id);if(!need(found!=summaries.end(),"call target is not owned"))return nullptr;
    if(!found->second.reached){found->second.reached=true;dirty=true;}return &found->second;}
  void observe(Summary &callee,size_t index,const Targets &value){
    if(!need(index<callee.observations.size(),"callable observation index differs"))return;merge(callee.observations[index],value);
    if(!fixed)merge(callee.parameters[index],value);
  }
  std::string siteKey(const std::string &fn,const Json &value){const auto &r=field(value,"range");return fn+"/"+
    std::to_string(*field(r,"start").getAsInteger())+":"+std::to_string(*field(r,"end").getAsInteger());}
  void arguments(Summary &callee,const std::vector<std::optional<Targets>> &args){
    const auto &params=items(field(*callee.fn,"parameters"));for(size_t i=0;i<params.size();++i){
      if(!step())return;if(!callable(string(field(params[i],"type"))))continue;
      if(!need(i<args.size()&&args[i].has_value(),"callable argument is not represented"))return;observe(callee,i,*args[i]);
    }
  }
  std::optional<Targets> expression(Summary &s,State &state,const Json &value){
    if(!step()||!e.message.empty())return {};const auto kind=string(field(value,"kind")),type=string(field(value,"type"));
    if(kind=="functionReference"){
      const auto id=string(field(value,"functionId"));if(!need(functions.count(id),"function value target is not owned"))return {};
      Targets result;result.functions.insert(id);return result;
    }
    if(kind=="bindingReference"){
      if(!callable(type))return {};auto found=state.find(string(field(value,"binding")));return found==state.end()?Targets{}:copy(found->second);
    }
    if(kind=="parentheses"||kind=="as"||kind=="nonNull"){
      auto result=expression(s,state,field(value,"expression"));if(!result&&callable(type))return Targets{true,{}};return result;
    }
    if(kind=="bindingAssignment"){
      auto result=expression(s,state,field(value,"value"));if(result)state[string(field(field(value,"target"),"binding"))]=copy(*result);return result;
    }
    if(kind=="call"||kind=="indirectCall"){
      Targets saved;const auto callee=string(field(value,"callee"));bool intrinsic=kind=="call"&&callee=="intrinsic:readSpan";
      if(kind=="indirectCall"){auto got=expression(s,state,field(value,"expression"));saved=got?copy(*got):Targets{true,{}};}
      else if(!intrinsic){if(!need(functions.count(callee),"direct call target is not owned"))return {};saved.functions.insert(callee);}
      if(!field(value,"receiver").getAsNull()){
        expression(s,state,field(value,"receiver"));if(functions.count(callee)&&string(field(*functions.at(callee),"kind"))=="method"){
          Json rows=nullptr;if(!methodDispatch(p,string(field(field(value,"receiver"),"type")),callee,rows,e))return {};saved={};
          for(const auto &row:items(rows)){if(!step())return {};saved.functions.insert(string(field(row,"target")));}
        }
      }
      const auto &rawArgs=items(field(value,"arguments"));if(!step(rawArgs.size()))return {};std::vector<std::optional<Targets>> args;args.reserve(rawArgs.size());
      for(const auto &arg:rawArgs)args.push_back(expression(s,state,arg));if(intrinsic)return {};
      if(kind=="indirectCall")merge(sites[siteKey(string(field(*s.fn,"id")),value)],saved);
      std::optional<Targets> result=callable(type)?std::optional<Targets>(Targets{}):std::nullopt;
      for(const auto &id:saved.functions){
        if(!step())return {};auto *target=reach(id);if(!target)return {};arguments(*target,args);
        if(kind=="indirectCall"){
          const auto &signature=field(value,"signature");Json body=Object{{"parameters",field(signature,"parameters")},{"returns",field(signature,"returnType")}};
          const auto expected=digest(std::string("tsfg.module-callable-signature.candidate.v1")+std::string(1,'\0')+canonical(body));
          if(!need(string(field(*target->fn,"signatureHash"))==expected,"indirect target signature differs"))return {};
        }
        const auto &returned=fixed?bounds.at(id).returned:target->returned;
        if(result){if(!need(bool(returned),"callable result transfer is missing"))return {};*result=join(*result,*returned);}
      }
      if(result&&saved.top)result->top=true;return result;
    }
    for(auto key:{"expression","left","right","receiver","index","value","target"})if(!field(value,key).getAsNull())expression(s,state,field(value,key));
    for(const auto &child:items(field(value,"elements")))expression(s,state,child);
    const auto &rawArgs=items(field(value,"arguments"));if(!step(rawArgs.size()))return {};std::vector<std::optional<Targets>> args;args.reserve(rawArgs.size());
    for(const auto &arg:rawArgs)args.push_back(expression(s,state,arg));
    if(kind=="new"||kind=="superConstruct"){
      auto owner=types.find(kind=="new"?type:string(field(value,"callee")));
      while(owner!=types.end()&&field(field(*owner->second,"construction"),"functionId").getAsNull()){
        if(!step())return {};owner=types.find(string(field(*owner->second,"base")));}
      if(owner!=types.end()){auto *target=reach(string(field(field(*owner->second,"construction"),"functionId")));if(target)arguments(*target,args);}
    }
    return callable(type)?std::optional<Targets>(Targets{true,{}}):std::nullopt;
  }
  bool body(Summary &s,State &state,const Json &rows){
    bool live=true;for(const auto &row:items(rows)){
      if(!step()||!e.message.empty())return false;if(!live)break;const auto kind=string(field(row,"kind"));
      if(kind=="constDeclaration"||kind=="letDeclaration"||kind=="initialize"){
        auto value=expression(s,state,field(row,"initializer"));if(value)state[string(field(row,"binding"))]=copy(*value);
      }else if(kind=="expression"||kind=="throw"||kind=="return"){
        auto value=field(row,"value").getAsNull()?std::optional<Targets>{}:expression(s,state,field(row,"value"));
        if(kind=="return"&&s.returned){if(!need(bool(value),"callable return value is not represented"))return false;merge(*s.returned,*value);}if(kind!="expression")live=false;
      }else if(kind=="block")live=body(s,state,field(row,"body"));
      else if(kind=="if"){
        expression(s,state,field(row,"condition"));State yes=snapshot(state),no=snapshot(state);const bool a=body(s,yes,field(row,"then")),b=body(s,no,field(row,"else"));
        if(a&&b){state=std::move(yes);combine(state,no);}else if(a)state=std::move(yes);else if(b)state=std::move(no);live=a||b;
      }else if(kind=="while"){
        State previous;do{previous=snapshot(state);expression(s,state,field(row,"condition"));auto next=snapshot(state);body(s,next,field(row,"body"));combine(state,next);
        }while(e.message.empty()&&!equalState(previous,state));
      }else if(kind=="try"){
        auto attempted=snapshot(state);body(s,attempted,field(field(row,"tryBlock"),"body"));combine(state,attempted);
        if(!field(row,"catchClause").getAsNull()){auto caught=snapshot(state);body(s,caught,field(field(field(row,"catchClause"),"block"),"body"));combine(state,caught);}
        if(!field(row,"finallyBlock").getAsNull())live=body(s,state,field(field(row,"finallyBlock"),"body"));
      }else if(!need(kind=="functionDeclaration","unrepresented callable-flow statement"))return false;
    }return live;
  }
  bool run(bool withFixed){
    fixed=withFixed;summaries.clear();sites.clear();dirty=false;
    for(const auto &[id,fn]:functions){
      const auto &params=items(field(*fn,"parameters"));if(!step(params.size()*2+1))return false;Summary s;s.fn=fn;s.reached=true;s.parameters.resize(params.size());s.observations.resize(params.size());
      if(fixed){if(!step(params.size()))return false;for(const auto &value:bounds.at(id).parameters)if(!step(value.functions.size()))return false;s.parameters=bounds.at(id).parameters;}
      if(callable(string(field(*fn,"returnType"))))s.returned=Targets{};summaries.emplace(id,std::move(s));
    }
    for(const auto &root:items(field(field(p.hir,"closure"),"roots"))){
      if(!step())return false;if(string(field(root,"kind"))=="module-initialization")continue;auto *s=reach(string(field(root,"target")));if(!s)return false;
      const auto &params=items(field(*s->fn,"parameters"));for(size_t i=0;i<params.size();++i){if(!step())return false;if(callable(string(field(params[i],"type"))))observe(*s,i,Targets{true,{}});}
    }
    do{dirty=false;for(auto &[id,s]:summaries)if(s.reached){
      if(!step())return false;State state;const auto &params=items(field(*s.fn,"parameters"));
      for(size_t i=0;i<params.size();++i){if(!step())return false;if(callable(string(field(params[i],"type"))))state.emplace(string(field(params[i],"id")),copy(s.parameters[i]));}
      body(s,state,field(*s.fn,"body"));if(!e.message.empty())return false;
    }}while(dirty);
    return discharge();
  }
  bool subset(const Targets &body,const Targets &upper){if(!step(body.functions.size()+1))return false;
    if(upper.top)return true;if(body.top)return false;for(const auto &id:body.functions)if(!upper.functions.count(id))return false;return true;}
  bool discharge(){
    for(const auto &[id,s]:summaries){if(!step())return false;const auto &upper=bounds.at(id);
      for(size_t i=0;i<s.observations.size();++i)if(!need(subset(s.observations[i],upper.parameters[i]),"argument exceeds fixed callable upper"))return false;
      if(s.returned&&(!fixed?s.reached:true)&&!need(upper.returned&&subset(*s.returned,*upper.returned),"return exceeds fixed callable upper"))return false;
    }return e.message.empty();
  }
};
}
bool verifyCallableTargets(Program &p,Error &e){
  // Atomic reconstruction prevents a second verification on the same owned
  // Program from retaining site or transfer rows from its previous artifact.
  p.callableSites.clear();p.callableParameters.clear();p.callableReturns.clear();TargetFlow flow{p,e};
  if(!flow.catalogue()||!flow.run(false)||!flow.run(true))return false;
  std::map<std::string,std::vector<Targets>> parameters;std::map<std::string,Targets> returns;
  for(const auto &[id,s]:flow.summaries){if(!flow.step(s.parameters.size()+1))return false;for(const auto &value:flow.bounds.at(id).parameters)if(!flow.step(value.functions.size()))return false;if(flow.bounds.at(id).returned&&!flow.step(flow.bounds.at(id).returned->functions.size()))return false;parameters.emplace(id,flow.bounds.at(id).parameters);if(flow.bounds.at(id).returned)returns.emplace(id,*flow.bounds.at(id).returned);}
  p.callableSites=std::move(flow.sites);p.callableParameters=std::move(parameters);p.callableReturns=std::move(returns);return true;
}
} // namespace tsfg::commonProgram
