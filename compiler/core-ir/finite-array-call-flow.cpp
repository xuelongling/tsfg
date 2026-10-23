// SPDX-License-Identifier: MIT
#include "finite-array-call-flow.h"

namespace tsfg::finite {
bool ArrayCallFlow::reject(const std::string &message) {
  if(failure.empty())failure=message;return false;
}
bool ArrayCallFlow::spend() {
  if(!failure.empty())return false;
  if(!remaining)return reject("Array call flow work limit");--remaining;return true;
}
bool ArrayCallFlow::building() {return spend()&&(!solved||reject("Array call flow is sealed after solving"));}
bool ArrayCallFlow::valid(Id function)const {return function<functions.size();}
bool ArrayCallFlow::owned(Id value,Id function)const {return value<owners.size()&&owners[value]==function;}
ArrayCallFlow::Id ArrayCallFlow::function(Bound bound) {
  if(!building())return none;
  for(const auto &[slot,flags]:bound.parameters)if(!spend()||slot>7||flags>7) {
    reject("Array call flow published parameter grammar");return none;
  }
  if(bound.local>7||(bound.returnOrigin&&(!bound.returnsView||!bound.parameters.count(*bound.returnOrigin)))) {
    reject("Array call flow published return/local grammar");return none;
  }
  const auto id=functions.size();functions.push_back({std::move(bound),{},none,false,{}});
  if(functions[id].bound.returnsView) {const auto summary=value(id);if(summary==none)return none;functions[id].summary=summary;}
  return id;
}
ArrayCallFlow::Id ArrayCallFlow::value(Id function) {
  if(!building())return none;if(!valid(function)) {reject("Array call flow value function");return none;}
  const auto id=origins.node();if(id==none){reject(origins.error());return none;}
  owners.push_back(function);if(!origins.requireEvidence(id)){reject(origins.error());return none;}return id;
}
bool ArrayCallFlow::parameter(Id value,size_t slot) {
  if(!building())return false;
  if(value>=owners.size()||!functions[owners[value]].bound.parameters.count(slot))return reject("Array call flow formal slot");
  const auto atom="#parameter/"+std::to_string(slot);auto &roots=functions[owners[value]].roots;
  const auto [entry,added]=roots.emplace(atom,value);
  if(!added&&entry->second!=value)return reject("Array call flow duplicate formal root");
  return origins.seed(value,atom)||reject(origins.error());
}
bool ArrayCallFlow::local(Id value) {
  if(!building())return false;
  if(value>=owners.size())return reject("Array call flow local origin");
  const auto atom="#local/"+std::to_string(value);functions[owners[value]].roots.emplace(atom,value);
  return origins.seed(value,atom)||reject(origins.error());
}
bool ArrayCallFlow::unknown(Id value) {
  if(!building())return false;
  return (value<owners.size()&&origins.unknown(value))||reject("Array call flow unknown origin: "+origins.error());
}
bool ArrayCallFlow::copy(Id from,Id to) {
  if(!building())return false;
  if(from>=owners.size()||to>=owners.size()||owners[from]!=owners[to])return reject("Array call flow cross-definition alias");
  return origins.connect({from,to})||reject(origins.error());
}
bool ArrayCallFlow::effect(Id function,Id value,unsigned flags) {
  if(!building())return false;
  if(!valid(function)||!owned(value,function)||flags>7)return reject("Array call flow effect origin");
  if(flags)effects.push_back({function,value,flags});return true;
}
bool ArrayCallFlow::call(Id caller,Id callee,const std::vector<Id> &arguments,Id result) {
  if(!building())return false;
  if(!valid(caller)||!valid(callee)||(result!=none&&!owned(result,caller)))return reject("Array call flow selected definition");
  functions[callee].callers.insert(caller);const auto &bound=functions[callee].bound;
  for(const auto &[slot,flags]:bound.parameters) {
    if(!spend())return false;
    if(slot>=arguments.size()||!effect(caller,arguments[slot],flags))return reject("Array call flow actual original slot");
  }
  if(bound.local) {
    const auto origin=value(caller);if(origin==none||!local(origin)||!effect(caller,origin,bound.local))return false;
  }
  if(result!=none) {
    if(bound.returnsView&&bound.returnOrigin) {
      const auto slot=*bound.returnOrigin;
      if(slot>=arguments.size()||!owned(arguments[slot],caller))return reject("Array call flow result original slot");
      // A fixed return origin is an obligation. Only actual productive return
      // equations can activate the substitution, including recursive SCCs.
      if(!origins.connect({arguments[slot],result,functions[callee].summary,"#parameter/"+std::to_string(slot)})||
          !origins.connect({functions[callee].summary,result,none,{},{},true,true}))return reject(origins.error());
    }else if(!unknown(result))return false;
  }
  return true;
}
bool ArrayCallFlow::returned(Id function,Id value) {
  if(!building())return false;
  if(!valid(function)||!owned(value,function))return reject("Array call flow normal return");
  if(!functions[function].bound.returnsView)return true;
  return copy(value,functions[function].summary);
}
bool ArrayCallFlow::coverage(const Effect &effect) {
  if(!spend())return false;const auto *value=origins.evidence(effect.value);
  if(!value)return reject("Array call flow unsolved origin");
  auto &function=functions[effect.function];
  if(value->pending||value->alternatives.empty())function.pending=true;
  for(const auto &origin:value->alternatives) {
    if(!spend())return false;unsigned allowed=function.bound.local;
    if(origin.rfind("#local/",0)!=0) {
      bool found=false;
      for(const auto &[slot,flags]:function.bound.parameters) {
        if(!spend())return false;
        if(origin=="#parameter/"+std::to_string(slot)){allowed=flags;found=true;break;}
      }
      if(!found)return reject("Array call flow unowned relative origin");
    }
    if((allowed&effect.flags)!=effect.flags)return reject("Array call Effective exceeds fixed Published upper");
  }
  return true;
}
bool ArrayCallFlow::solve() {
  if(!building())return false;
  if(!origins.solve())return reject(origins.error());
  for(const auto &effect:effects)if(!coverage(effect))return false;
  for(auto &fn:functions) {
    if(!spend())return false;if(!fn.bound.returnsView)continue;
    const auto *result=origins.evidence(fn.summary);if(!result)return reject("Array call flow unsolved normal return");
    if(result->pending||result->alternatives.empty())fn.pending=true;
    for(const auto &origin:result->alternatives) {
      if(!spend())return false;
      if(!fn.bound.returnOrigin||origin!="#parameter/"+std::to_string(*fn.bound.returnOrigin))
        return reject("Array call fixed returnOrigin differs from actual SSA return");
    }
  }
  // A recursive empty origin equation is pending, never a productive identity.
  // A target's unproved contract taints callers even if its fixed upper is empty.
  std::vector<Id> work;for(Id id=0;id<functions.size();++id) {if(!spend())return false;if(functions[id].pending)work.push_back(id);}
  for(size_t at=0;at<work.size();++at)for(const auto caller:functions[work[at]].callers) {
    if(!spend())return false;if(!functions[caller].pending){functions[caller].pending=true;work.push_back(caller);}
  }
  solved=true;return true;
}
bool ArrayCallFlow::proved(Id function)const {return solved&&failure.empty()&&valid(function)&&!functions[function].pending;}
bool ArrayCallFlow::projection(Id value,std::set<Id> &roots,bool &pending) {
  if(!spend())return false;
  if(!solved||value>=owners.size())return reject("Array call flow projection requires a solved owned value");
  const auto fn=owners[value];const auto *evidence=origins.evidence(value);
  if(!evidence)return reject(origins.error());
  std::set<Id> result;const bool unresolved=!proved(fn)||evidence->pending||evidence->alternatives.empty();
  if(!unresolved)for(const auto &atom:evidence->alternatives) {
    if(!spend())return false;const auto found=functions[fn].roots.find(atom);
    if(found==functions[fn].roots.end())return reject("Array call flow projection leaves actual relative roots");
    result.insert(found->second);
  }
  roots=std::move(result);pending=unresolved;return true;
}
} // namespace tsfg::finite
