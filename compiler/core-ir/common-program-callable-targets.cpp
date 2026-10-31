// SPDX-License-Identifier: MIT
// Independent code-target flow over the complete owned Source tree. Neither
// producer SSA arm rows nor physical carriers supply target membership.
#include "common-program-source.h"
#include "common-program-methods.h"
#include "common-program-array-targets.h"
#include <optional>
namespace tsfg::commonProgram {
namespace {
using Targets=CallableTargets;using State=std::map<std::string,Targets>;
struct Bound {std::vector<Targets> parameters;std::optional<Targets> returned;bool unknownHost=false;};
struct Summary {const Json *fn=nullptr;bool reached=false;std::vector<Targets> parameters,observations;std::optional<Targets> returned;};
struct TargetFlow {
  Program &p;Error &e;bool fixed=false,dirty=false;
  std::map<std::string,const Json *> types,functions;
  std::map<std::string,Bound> bounds;std::map<std::string,Summary> summaries;
  std::map<std::string,Targets> sites;
  std::map<std::string,const Json *> fields;std::map<std::string,std::string> slots;
  std::map<std::string,Targets> fieldValues,fieldCaptures;std::set<std::string> exposed,exposedFields,callableSlots;
  std::map<std::string,std::string> bindingTypes;
  // Original shared parameter code bounds, never a runtime code/Env pair.
  std::map<std::string,std::pair<std::string,size_t>> capturedParameters;
  std::map<std::string,Targets> capturedLocals;
  std::set<std::string> externalFunctions,globalIds;
  std::vector<const Json *> defaultLiterals;
  struct Initializer {std::optional<State> inputs;bool grew=false;};
  std::map<std::string,Initializer> activeInitializers;
  ArrayTargets arrays{p,e,types,dirty,[this](const Targets &a,const Targets &b){return join(a,b);},[this](const Targets &value){exposeClosures(value);}};
  bool step(size_t n=1){return p.charge(n)||reject(e,"core-ir-common-budget","independent callable target work exceeded");}
  bool need(bool c,llvm::StringRef detail){return c||reject(e,"core-ir-common-callable",detail);}
  bool callable(const std::string &id){return commonCallableType(types,id,[&]{return step();})!=nullptr;}
  bool equal(const Targets &a,const Targets &b){return step(a.functions.size()+b.functions.size()+1)&&a.top==b.top&&a.functions==b.functions;}
  Targets copy(const Targets &v){if(!step(v.functions.size()+1))return {};return v;}
  Targets join(const Targets &a,const Targets &b){
    if(!step(a.functions.size()+b.functions.size()+1))return {};Targets result=a;result.top|=b.top;
    for(const auto &id:b.functions){if(!result.functions.count(id)&&result.functions.size()>=256){reject(e,"core-ir-common-budget","callable target alternatives exceed bound");return {};}result.functions.insert(id);}return result;
  }
  bool merge(Targets &into,const Targets &value){auto next=join(into,value);if(!e.message.empty())return false;
    if(!equal(into,next)){into=std::move(next);dirty=true;}return e.message.empty();}
  std::string slot(const std::string &id){if(!step()||!need(slots.count(id),"callable field is not owned"))return {};
    return slots.at(id)==id?id:slot(slots.at(id));}
  void write(const std::string &id,const std::optional<Targets> &value){
    if(!need(fields.count(id),"callable field writer is not owned"))return;
    const auto key=slot(id);const Targets top{true,{}};if(callableSlots.count(key))merge(fieldValues[key],value?*value:top);
    if(value||arrays.mayCallable(string(field(*fields.at(id),"type")))){const auto &observed=value?*value:top;
      merge(fieldCaptures[key],observed);if(exposedFields.count(key))exposeClosures(observed);}
  }
  void expose(const std::string &id){
    if(!step()||!exposed.insert(id).second)return;auto found=types.find(id);if(found==types.end())return;
    const auto &type=*found->second;const auto kind=string(field(type,"kind"));
    if(kind=="union")for(const auto &member:items(field(type,"members"))){if(!step())return;expose(string(member));}
    if(kind=="array"||kind=="readSpan"){arrays.expose(id);expose(string(field(type,"elementType")));}
    if(kind=="function"){for(const auto &parameter:items(field(type,"parameters"))){if(!step())return;expose(string(parameter));}expose(string(field(type,"returnType")));}
    if(kind=="reference"||kind=="value"){
      const Json *owner=&type;std::set<std::string> seen;
      while(owner){if(!step()||!need(seen.insert(string(field(*owner,"id"))).second,"field inheritance cycle"))return;
        for(const auto &member:items(field(*owner,"fields"))){if(!step())return;const auto key=slot(string(field(member,"id")));
          if(exposedFields.insert(key).second&&fieldCaptures.count(key))exposeClosures(copy(fieldCaptures.at(key)));
          if(callableSlots.count(key))merge(fieldValues[key],Targets{true,{}});
          expose(string(field(member,"type")));}
        auto base=types.find(string(field(*owner,"base")));owner=base==types.end()?nullptr:base->second;
      }
      for(const auto &[candidate,row]:types){if(!step())return;if(string(field(*row,"base"))==id)expose(candidate);}
    }
  }
  void erase(const std::string &expected,const std::string &actual,const std::optional<Targets> &value=std::nullopt){auto found=types.find(expected);
    if(found!=types.end()&&string(field(*found->second,"kind"))=="unknown"){expose(actual);exposeClosures(value);}
    else if(!arrays.families(expected).empty()&&!arrays.families(actual).empty()){
      std::set<std::pair<std::string,std::string>> seen;Json roots=nullptr;
      if(verifiedView(actual,expected,roots,seen))arrays.link(actual,expected);else{expose(actual);expose(expected);}}
  }
  bool verifiedView(const std::string &from,const std::string &to,const Json &roots,std::set<std::pair<std::string,std::string>> &seen){
    if(!step())return false;if(from==to)return true;
    auto source=types.find(from),target=types.find(to);if(source==types.end()||target==types.end())return false;
    const auto key=std::pair{from,to};if(!seen.insert(key).second)return false;bool accepted=false;
    const auto a=string(field(*source->second,"kind")),b=string(field(*target->second,"kind"));
    if(a=="union"){accepted=true;for(const auto &member:items(field(*source->second,"members"))){if(!step())return false;const auto id=string(member),kind=types.count(id)?string(field(*types.at(id),"kind")):"";
        if(kind!="null"&&kind!="undefined"&&!verifiedView(id,to,roots,seen)){accepted=false;break;}}}
    else if(b=="union"){for(const auto &member:items(field(*target->second,"members"))){if(!step())return false;if(verifiedView(from,string(member),roots,seen)){accepted=true;break;}}}
    else if((a=="array"||a=="readSpan")&&(b=="array"||b=="readSpan"))accepted=verifiedView(string(field(*source->second,"elementType")),string(field(*target->second,"elementType")),roots,seen);
    else for(const auto &row:items(roots)){if(!step())return false;if(string(field(row,"sourceType"))==from&&string(field(row,"targetType"))==to){accepted=true;break;}}
    seen.erase(key);return accepted;
  }
  void exposeClosures(const std::optional<Targets> &value){
    std::set<std::string> seen;std::vector<std::string> pending;
    const auto add=[&](const std::string &id){if(!step(id.size()/64+1)||!seen.insert(id).second)return;
      if(pending.size()==pending.capacity()&&!step(pending.size()+1))return;pending.push_back(id);};
    if(value&&value->top)for(const auto &[id,fn]:functions)add(id);else if(value)for(const auto &id:value->functions)add(id);
    for(size_t at=0;at<pending.size();++at){if(!step()||!e.message.empty())return;const auto found=functions.find(pending[at]);if(found==functions.end())continue;
      for(const auto &capture:items(field(*found->second,"captures"))){if(!step())return;const auto binding=bindingTypes.find(string(field(capture,"binding")));if(binding==bindingTypes.end())continue;expose(binding->second);
        if(callable(binding->second))for(const auto &[id,fn]:functions)add(id);}}
  }
  void unknownCall(const Json &value,const std::vector<std::optional<Targets>> &args,const std::optional<Targets> &called=std::nullopt){exposeClosures(called);size_t index=0;
    for(const auto &arg:items(field(value,"arguments"))){if(!step())return;expose(string(field(arg,"type")));
      if(index<args.size())exposeClosures(args[index]);
      ++index;}
    if(!field(value,"receiver").getAsNull())expose(string(field(field(value,"receiver"),"type")));expose(string(field(value,"type")));}
  State snapshot(const State &state){if(!step(state.size()))return {};size_t members=0;for(const auto &[id,value]:state){if(!step())return {};members+=value.functions.size();}
    if(!step(members))return {};return state;}
  void combine(State &into,const State &from){for(const auto &[id,value]:from){if(!step())return;into[id]=join(into[id],value);if(!e.message.empty())return;}}
  bool equalState(const State &a,const State &b){if(!step(a.size()+b.size())||a.size()!=b.size())return false;
    for(const auto &[id,value]:a){if(!step())return false;auto other=b.find(id);if(other==b.end()||!equal(value,other->second))return false;}return true;}
  bool growInitializerState(State &into,const State &from){
    if(!step(from.size()))return false;bool changed=false;
    for(const auto &[id,value]:from){
      if(!step(id.size()/64+1))return false;auto found=into.find(id);
      if(found==into.end()){into.emplace(id,copy(value));changed=true;}
      else {auto next=join(found->second,value);if(!e.message.empty())return false;
        if(!equal(found->second,next)){found->second=std::move(next);changed=true;}}
    }return changed;
  }
  Targets readSet(const Json &value){Targets result;result.top=field(value,"top").getAsBoolean()==true;
    const auto &rows=items(field(value,"functions"));if(!step(rows.size()))return result;
    for(const auto &row:rows)result.functions.insert(string(row));return result;}
  bool catalogue(){
    for(const auto &type:items(field(p.hir,"types"))){if(!step())return false;types.emplace(string(field(type,"id")),&type);}
    if(!arrays.build())return false;
    for(const auto &fn:items(field(p.hir,"functions"))){if(!step())return false;functions.emplace(string(field(fn,"id")),&fn);
      for(auto key:{"parameters","bindings"})for(const auto &binding:items(field(fn,key))){if(!step())return false;bindingTypes[string(field(binding,"id"))]=string(field(binding,"type"));}}
    std::set<std::string> captured;
    for(const auto &[id,fn]:functions){if(!step())return false;
      for(const auto &row:items(field(*fn,"captures"))){
        const auto key=field(row,"binding").getAsString().value_or("");if(!step(key.size()/64+2))return false;captured.insert(key.str());
      }
    }
    for(const auto &[id,fn]:functions){if(!step())return false;const auto &parameters=items(field(*fn,"parameters"));
      for(size_t index=0;index<parameters.size();++index){const auto key=field(parameters[index],"id").getAsString().value_or("");
        if(!step((key.size()+id.size())/64+3))return false;auto binding=key.str();
        if(captured.count(binding)&&callable(bindingTypes.at(binding)))capturedParameters.emplace(std::move(binding),std::pair{id,index});
      }
      for(const auto &binding:items(field(*fn,"bindings"))){if(!step())return false;const auto key=string(field(binding,"id"));
        if(captured.count(key)&&callable(bindingTypes.at(key)))capturedLocals.emplace(key,Targets{});}
    }
    for(const auto &global:items(field(p.hir,"globals"))){if(!step())return false;bindingTypes[string(field(global,"sourceBinding"))]=string(field(global,"type"));globalIds.insert(string(field(global,"id")));}
    // The complete verified field directory and original compatibility pairs
    // supply storage identity. Callable type equality supplies no alias edge.
    std::map<std::string,std::string> rawFields;
    for(const auto &[id,type]:types)for(const auto &member:items(field(*type,"fields"))){if(!step())return false;
      const auto key=string(field(member,"id"));fields.emplace(key,&member);slots.emplace(key,key);rawFields.emplace(string(field(member,"sourceBinding")),key);}
    for(const auto &row:items(field(field(field(p.hir,"snapshot"),"payload"),"compatibilityWitnesses")))
      for(const auto &pair:items(field(field(row,"compatibility"),"members"))){if(!step())return false;
        auto from=rawFields.find(string(field(pair,"source"))),to=rawFields.find(string(field(pair,"target")));
        if(from!=rawFields.end()&&to!=rawFields.end()){const auto a=slot(from->second),b=slot(to->second);if(a!=b)slots[a]=b;arrays.link(string(field(*fields.at(from->second),"type")),string(field(*fields.at(to->second),"type")));}}
    for(const auto &[id,member]:fields){if(!step())return false;if(callable(string(field(*member,"type"))))callableSlots.insert(slot(id));}
    const auto &contracts=items(field(p.publication,"contracts"));
    if(!need(field(p.publication,"contracts").getAsArray()&&contracts.size()==functions.size(),"complete fixed callable rows required"))return false;
    size_t index=0;for(const auto &fn:items(field(p.hir,"functions"))){
      if(!step())return false;const auto &record=contracts[index++];const auto id=string(field(fn,"id"));
      if(!need(exact(record,{"functionId","signatureHash","upper","callables","digest"})&&same(field(record,"functionId"),field(fn,"id"))&&
        same(field(record,"signatureHash"),field(fn,"signatureHash")),"fixed callable row identity or order differs")||
        !validateCallableBounds(p,fn,field(record,"callables"),e))return false;
      Bound bound;bound.unknownHost=field(field(field(record,"upper"),"facets"),"unknownHost").getAsBoolean()==true;
      const auto &params=items(field(fn,"parameters"));if(!step(params.size()))return false;bound.parameters.resize(params.size());
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
  void initialize(Summary &s,State &state,const Json &type,const std::vector<std::optional<Targets>> &args){
    if(!step())return;const auto identity=field(type,"id").getAsString().value_or("");if(!step(identity.size()/64+2))return;
    const auto id=identity.str();auto active=activeInitializers.find(id);
    if(active!=activeInitializers.end()){
      // Preserve original argument/parameter transfer at the expression site;
      // only initializer expansion feeds State back to the active transfer.
      if(!active->second.inputs){active->second.inputs=snapshot(state);active->second.grew=true;}
      else active->second.grew=growInitializerState(*active->second.inputs,state)||active->second.grew;
      return;
    }
    if(!step(1))return;auto inserted=activeInitializers.emplace(id,Initializer{});
    struct ActiveGuard{std::map<std::string,Initializer> &active;std::map<std::string,Initializer>::iterator item;~ActiveGuard(){active.erase(item);}} guard{activeInitializers,inserted.first};
    auto &frame=inserted.first->second;bool repeat;
    do{
    if(!step())return;frame.grew=false;if(frame.inputs)growInitializerState(state,*frame.inputs);
    const auto &construction=field(type,"construction");const auto fn=string(field(construction,"functionId")),base=string(field(type,"base"));
    if(!base.empty()&&fn.empty()&&types.count(base))initialize(s,state,*types.at(base),args);
    for(const auto &id:items(field(construction,"initializationFields"))){
      if(!step()||!need(fields.count(string(id)),"construction field is not owned"))return;const auto &member=*fields.at(string(id));std::optional<Targets> initial;
      const auto parameter=string(field(member,"parameterBinding"));
      if(!parameter.empty()){
        size_t index=0;const auto &parameters=items(field(construction,"parameters"));
        for(;index<parameters.size();++index){if(!step())return;if(string(field(parameters[index],"symbol"))==parameter)break;}
        if(!need(index<parameters.size(),"construction parameter field has no original parameter"))return;
        if(!fn.empty()){auto *callee=reach(fn);if(!callee||!need(index<callee->parameters.size(),"construction parameter transfer differs"))return;initial=copy(callee->parameters[index]);}
        else if(index<args.size()&&args[index])initial=copy(*args[index]);
      }else if(!field(member,"initializer").getAsNull()){initial=expression(s,state,field(member,"initializer"));erase(string(field(member,"type")),string(field(field(member,"initializer"),"type")),initial);}
      write(string(id),initial);
    }
    repeat=false;
    if(frame.inputs){repeat=growInitializerState(*frame.inputs,state)||frame.grew;growInitializerState(state,*frame.inputs);}
    }while(repeat&&e.message.empty());
  }
  std::optional<Targets> expression(Summary &s,State &state,const Json &value){
    if(!step()||!e.message.empty())return {};const auto kind=string(field(value,"kind")),type=string(field(value,"type"));
    if(kind=="nullLiteral"||kind=="undefinedLiteral")return Targets{};
    if(kind=="functionReference"){
      const auto id=string(field(value,"functionId"));if(!need(functions.count(id),"function value target is not owned"))return {};
      Targets result;result.functions.insert(id);return result;
    }
    if(kind=="bindingReference"){
      if(!callable(type))return {};const auto key=field(value,"binding").getAsString().value_or("");if(!step(key.size()/64+1))return {};
      const auto binding=key.str();auto owner=capturedParameters.find(binding);
      if(owner!=capturedParameters.end())return copy(summaries.at(owner->second.first).parameters.at(owner->second.second));
      auto local=capturedLocals.find(binding);if(local!=capturedLocals.end())return copy(local->second);
      auto found=state.find(binding);return found==state.end()?Targets{}:copy(found->second);
    }
    if(kind=="parentheses"||kind=="as"||kind=="nonNull"){
      auto result=expression(s,state,field(value,"expression"));const auto from=string(field(field(value,"expression"),"type"));
      if(kind=="as"){erase(type,from,result);std::set<std::pair<std::string,std::string>> seen;if(!verifiedView(from,type,field(value,"compatibilityRoots"),seen)){expose(from);expose(type);exposeClosures(result);}else arrays.link(from,type);}
      if(!result&&callable(type))return Targets{true,{}};return result;
    }
    if(kind=="bindingAssignment"){
      auto result=expression(s,state,field(value,"value"));const auto &target=field(value,"target");erase(string(field(target,"type")),string(field(field(value,"value"),"type")),result);
      if(string(field(target,"kind"))=="globalTarget"){expose(string(field(field(value,"value"),"type")));exposeClosures(result);}
      else if(result){const auto key=field(target,"binding").getAsString().value_or("");if(!step(key.size()/64+2))return {};const auto binding=key.str();
        state[binding]=copy(*result);auto owner=capturedParameters.find(binding);
        if(owner!=capturedParameters.end())observe(summaries.at(owner->second.first),owner->second.second,*result);
        else if(capturedLocals.count(binding))merge(capturedLocals.at(binding),*result);
      }return result;
    }
    if(kind=="fieldAccess"){
      expression(s,state,field(value,"receiver"));return callable(type)?std::optional<Targets>(copy(fieldValues[slot(string(field(value,"property")))])):std::nullopt;
    }
    if(kind=="fieldAssignment"){
      const Json *target=&field(value,"target");while(string(field(*target,"kind"))=="parentheses"){if(!step())return {};target=&field(*target,"expression");}
      expression(s,state,field(*target,"receiver"));auto result=expression(s,state,field(value,"value"));erase(string(field(*target,"type")),string(field(field(value,"value"),"type")),result);write(string(field(*target,"property")),result);
      if(result)return result;
      return callable(type)?std::optional<Targets>(Targets{true,{}}):std::nullopt;
    }
    if(kind=="arrayLiteral"){
      for(const auto &child:items(field(value,"elements"))){if(!step())return {};auto result=expression(s,state,child);erase(string(field(*types.at(type),"elementType")),string(field(child,"type")),result);arrays.write(type,result);}return {};
    }
    if(kind=="elementAssignment"){
      const Json *target=&field(value,"target");while(string(field(*target,"kind"))=="parentheses"){if(!step())return {};target=&field(*target,"expression");}
      expression(s,state,field(*target,"receiver"));expression(s,state,field(*target,"index"));auto result=expression(s,state,field(value,"value"));erase(string(field(*target,"type")),string(field(field(value,"value"),"type")),result);
      arrays.write(string(field(field(*target,"receiver"),"type")),result);return result?result:callable(type)?std::optional<Targets>(Targets{true,{}}):std::nullopt;
    }
    if(kind=="checkedElementAccess"){
      expression(s,state,field(value,"receiver"));expression(s,state,field(value,"index"));if(!callable(type)){expose(type);return {};}
      return arrays.read(string(field(field(value,"receiver"),"type")));
    }
    if(kind=="globalReference")expose(type);
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
      if(kind=="indirectCall"&&s.fn)merge(sites[siteKey(string(field(*s.fn,"id")),value)],saved);
      std::optional<Targets> result=callable(type)?std::optional<Targets>(Targets{}):std::nullopt;
      for(const auto &id:saved.functions){
        if(!step())return {};auto *target=reach(id);if(!target)return {};arguments(*target,args);
        const auto &parameters=items(field(*target->fn,"parameters"));for(size_t i=0;i<parameters.size()&&i<rawArgs.size();++i){if(!step())return {};erase(string(field(parameters[i],"type")),string(field(rawArgs[i],"type")),args[i]);}
        if(kind=="indirectCall"){
          const auto &signature=field(value,"signature");Json body=Object{{"parameters",field(signature,"parameters")},{"returns",field(signature,"returnType")}};
          const auto expected=digest(std::string("tsfg.module-callable-signature.candidate.v1")+std::string(1,'\0')+canonical(body));
          if(!need(string(field(*target->fn,"signatureHash"))==expected,"indirect target signature differs"))return {};
        }
        const auto &returned=fixed?bounds.at(id).returned:target->returned;
        if(result){if(!need(bool(returned),"callable result transfer is missing"))return {};*result=join(*result,*returned);}
        if(fixed&&bounds.at(id).unknownHost)unknownCall(value,args,Targets{false,{id}});
      }
      if(saved.top){unknownCall(value,args,saved);if(result)result->top=true;}return result;
    }
    for(auto key:{"expression","left","right","receiver","index","value","target"})if(!field(value,key).getAsNull())expression(s,state,field(value,key));
    for(const auto &child:items(field(value,"elements"))){expression(s,state,child);auto owner=types.find(type);if(owner!=types.end())erase(string(field(*owner->second,"elementType")),string(field(child,"type")));}
    const auto &rawArgs=items(field(value,"arguments"));if(!step(rawArgs.size()))return {};std::vector<std::optional<Targets>> args;args.reserve(rawArgs.size());
    for(const auto &arg:rawArgs)args.push_back(expression(s,state,arg));
    if(kind=="new"||kind=="superConstruct"){
      auto owner=types.find(kind=="new"?type:string(field(value,"callee")));
      if(owner!=types.end()){const auto &parameters=items(field(field(*owner->second,"construction"),"parameters"));
        for(size_t i=0;i<parameters.size()&&i<rawArgs.size();++i){if(!step())return {};erase(string(field(parameters[i],"type")),string(field(rawArgs[i],"type")),args[i]);}initialize(s,state,*owner->second,args);}
      while(owner!=types.end()&&field(field(*owner->second,"construction"),"functionId").getAsNull()){
        if(!step())return {};owner=types.find(string(field(*owner->second,"base")));}
      if(owner!=types.end()){auto *target=reach(string(field(field(*owner->second,"construction"),"functionId")));if(target){arguments(*target,args);
          if(fixed&&bounds.at(string(field(*target->fn,"id"))).unknownHost){unknownCall(value,args);if(kind=="superConstruct"){if(!need(s.fn,"super construction has no original owner"))return {};expose(string(field(*s.fn,"ownerType")));}}}}
    }
    return callable(type)?std::optional<Targets>(Targets{true,{}}):std::nullopt;
  }
  bool body(Summary &s,State &state,const Json &rows){
    bool live=true;for(const auto &row:items(rows)){
      if(!step()||!e.message.empty())return false;if(!live)break;const auto kind=string(field(row,"kind"));
      if(kind=="constDeclaration"||kind=="letDeclaration"||kind=="initialize"){
        auto value=expression(s,state,field(row,"initializer"));const auto id=string(field(row,"binding"));
        if(globalIds.count(id)){expose(string(field(field(row,"initializer"),"type")));exposeClosures(value);}else if(value){state[id]=copy(*value);if(capturedLocals.count(id))merge(capturedLocals.at(id),*value);}
        auto binding=bindingTypes.find(id);if(binding!=bindingTypes.end())erase(binding->second,string(field(field(row,"initializer"),"type")),value);
      }else if(kind=="expression"||kind=="throw"||kind=="return"){
        auto value=field(row,"value").getAsNull()?std::optional<Targets>{}:expression(s,state,field(row,"value"));
        if(kind=="throw"){expose(string(field(field(row,"value"),"type")));exposeClosures(value);}
        if(kind=="return"){erase(string(field(*s.fn,"returnType")),string(field(field(row,"value"),"type")),value);if(externalFunctions.count(string(field(*s.fn,"id"))))exposeClosures(value);}
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
  void scan(const Json &value,bool defaults=false){
    if(!step()||!e.message.empty())return;
    if(auto rows=value.getAsArray()){for(const auto &child:*rows){if(!step())return;scan(child,defaults);}return;}
    auto object=value.getAsObject();if(!object)return;const auto kind=string(field(value,"kind")),id=string(field(value,"type"));auto type=types.find(id);
    if(kind=="arrayLiteral"){
      if(type==types.end()||string(field(*type->second,"kind"))!="array"||!field(value,"elements").getAsArray())expose(id);
      else {arrays.birth(id,items(field(value,"elements")).size());if(defaults){if(defaultLiterals.size()==defaultLiterals.capacity()&&!step(defaultLiterals.size()+1))return;defaultLiterals.push_back(&value);}}
    }else if(kind=="as"){
      const auto from=string(field(field(value,"expression"),"type"));std::set<std::pair<std::string,std::string>> seen;
      if(verifiedView(from,id,field(value,"compatibilityRoots"),seen))arrays.link(from,id);else{expose(from);expose(id);}erase(id,from);
    }else if(kind=="call"&&string(field(value,"callee"))=="intrinsic:readSpan"){
      const auto &args=items(field(value,"arguments"));if(!args.empty())arrays.link(string(field(args[0],"type")),id);
    }else if(type!=types.end()&&(string(field(*type->second,"kind"))=="array"||string(field(*type->second,"kind"))=="readSpan")&&
      kind!="bindingReference"&&kind!="parentheses"&&kind!="nonNull"&&kind!="bindingAssignment"&&kind!="fieldAssignment"&&kind!="elementAssignment")expose(id);
    if(kind=="lengthAssignment")arrays.cancel(string(field(field(field(value,"target"),"receiver"),"type")));
    for(const auto &entry:*object){if(!step())return;auto key=entry.first.str();if(key!="range"&&key!="signature"&&key!="sourceSignature"&&key!="compatibilityRoots")scan(entry.second,defaults);}
  }
  void unknownArrays(const std::string &id,std::set<std::string> &seen){
    if(!step()||!seen.insert(id).second)return;auto type=types.find(id);if(type==types.end())return;const auto kind=string(field(*type->second,"kind"));
    if(kind=="array"||kind=="readSpan")expose(id);
    else if(kind=="union")for(const auto &member:items(field(*type->second,"members"))){if(!step())return;unknownArrays(string(member),seen);}
    else if(kind=="reference"||kind=="value"){
      for(const auto &member:items(field(*type->second,"fields"))){if(!step())return;unknownArrays(string(field(member,"type")),seen);}unknownArrays(string(field(*type->second,"base")),seen);}
  }
  bool run(bool withFixed){
    fixed=withFixed;summaries.clear();sites.clear();fieldValues.clear();fieldCaptures.clear();exposed.clear();exposedFields.clear();externalFunctions.clear();defaultLiterals.clear();arrays.reset();dirty=false;
    for(auto &[id,value]:capturedLocals){if(!step())return false;value=Targets{};}
    for(const auto &[id,fn]:functions){
      const auto &params=items(field(*fn,"parameters"));if(!step(params.size()*2+1))return false;Summary s;s.fn=fn;s.reached=true;s.parameters.resize(params.size());s.observations.resize(params.size());
      if(fixed){if(!step(params.size()))return false;for(const auto &value:bounds.at(id).parameters)if(!step(value.functions.size()))return false;s.parameters=bounds.at(id).parameters;}
      if(callable(string(field(*fn,"returnType"))))s.returned=Targets{};summaries.emplace(id,std::move(s));
    }
    for(const auto &root:items(field(field(p.hir,"closure"),"roots"))){
      if(!step())return false;if(string(field(root,"kind"))=="module-initialization")continue;auto *s=reach(string(field(root,"target")));if(!s)return false;
      externalFunctions.insert(string(field(root,"target")));const auto &params=items(field(*s->fn,"parameters"));for(size_t i=0;i<params.size();++i){if(!step())return false;if(callable(string(field(params[i],"type"))))observe(*s,i,Targets{true,{}});}
      expose(string(field(*s->fn,"returnType")));for(const auto &parameter:params){if(!step())return false;expose(string(field(parameter,"type")));}
    }
    for(const auto &module:items(field(p.hir,"modules")))for(const auto &exported:items(field(module,"exports")))for(const auto &global:items(field(p.hir,"globals"))){
      if(!step())return false;if(same(field(exported,"target"),field(global,"id")))expose(string(field(global,"type")));}
    for(const auto &[id,type]:types)for(const auto &member:items(field(*type,"fields"))){if(!step())return false;if(!field(member,"initializer").getAsNull())scan(field(member,"initializer"),true);}
    for(const auto &[id,fn]:functions){if(!step())return false;for(const auto &parameter:items(field(*fn,"parameters"))){if(!step())return false;std::set<std::string> seen;unknownArrays(string(field(parameter,"type")),seen);}scan(field(*fn,"body"));}
    for(const auto &global:items(field(p.hir,"globals"))){if(!step())return false;std::set<std::string> seen;unknownArrays(string(field(global,"type")),seen);}
    for(const auto &module:items(field(p.hir,"modules"))){if(!step())return false;scan(field(module,"initialization"));}
    bool missing;do{
    do{dirty=false;
    if(!defaultLiterals.empty()){State state;for(const auto &[id,type]:bindingTypes){if(!step())return false;if(callable(type))state.emplace(id,Targets{true,{}});}Summary storage;
      for(const auto *value:defaultLiterals){if(!step())return false;expression(storage,state,*value);}}
    for(const auto &module:items(field(p.hir,"modules"))){if(!step())return false;Json owner=Object{{"id",field(module,"initializer")}};Summary s;s.fn=&owner;State state;body(s,state,field(module,"initialization"));}
    for(auto &[id,s]:summaries)if(s.reached){
      if(!step())return false;State state;const auto &params=items(field(*s.fn,"parameters"));
      for(size_t i=0;i<params.size();++i){if(!step())return false;if(callable(string(field(params[i],"type"))))state.emplace(string(field(params[i],"id")),copy(s.parameters[i]));}
      body(s,state,field(*s.fn,"body"));if(!e.message.empty())return false;
    }}while(dirty);
    missing=false;for(const auto &[id,member]:fields)if(callable(string(field(*member,"type")))){if(!step())return false;auto &value=fieldValues[slot(id)];
      if(!value.top&&value.functions.empty()){merge(value,Targets{true,{}});missing=true;}}
    if(arrays.complete())missing=true;
    }while(missing&&e.message.empty());
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
bool targetFacts(Program &p,Error &e,std::map<std::string,size_t> *initialized){
  // Atomic reconstruction prevents a second verification on the same owned
  // Program from retaining site or transfer rows from its previous artifact.
  p.callableSites.clear();p.callableParameters.clear();p.callableReturns.clear();if(initialized)initialized->clear();TargetFlow flow{p,e};
  if(!flow.catalogue()||!flow.run(false)||!flow.run(true))return false;
  std::map<std::string,size_t> prefix;if(initialized&&!flow.arrays.initialized(prefix))return false;
  std::map<std::string,std::vector<Targets>> parameters;std::map<std::string,Targets> returns;
  for(const auto &[id,s]:flow.summaries){if(!flow.step(s.parameters.size()+1))return false;for(const auto &value:flow.bounds.at(id).parameters)if(!flow.step(value.functions.size()))return false;if(flow.bounds.at(id).returned&&!flow.step(flow.bounds.at(id).returned->functions.size()))return false;parameters.emplace(id,flow.bounds.at(id).parameters);if(flow.bounds.at(id).returned)returns.emplace(id,*flow.bounds.at(id).returned);}
  p.callableSites=std::move(flow.sites);p.callableParameters=std::move(parameters);p.callableReturns=std::move(returns);if(initialized)*initialized=std::move(prefix);return true;
}
}
// Existing Source/fixed-boundary verifier clients intentionally request only
// code reconstruction. Both query forms execute this one independent flow.
bool verifyCallableTargets(Program &p,Error &e){return targetFacts(p,e,nullptr);}
bool verifyCallableTargets(Program &p,Error &e,std::map<std::string,size_t> &initialized){return targetFacts(p,e,&initialized);}
} // namespace tsfg::commonProgram
