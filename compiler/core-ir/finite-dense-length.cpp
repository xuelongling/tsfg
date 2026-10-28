// SPDX-License-Identifier: MIT
#include "finite-dense-length.h"

namespace tsfg::finite {
DenseLength::DenseLength(size_t &work,std::function<bool()> cancel)
    :remaining(work),cancelled(std::move(cancel)),flow(work,PayloadFlow::AtomDomain::MemoryVersion){}
bool DenseLength::reject(const std::string &message){if(failure.empty())failure=message;solved=false;return false;}
bool DenseLength::charge(){
  if(!failure.empty())return false;if(cancelled&&cancelled())return reject("dense length proof cancelled");
  if(!remaining)return reject("dense length proof work limit");--remaining;return true;
}
bool DenseLength::building(){return charge()&&(!sealed||reject("dense length equations are sealed"));}
bool DenseLength::outcome(bool result){return result||reject(flow.error());}
std::string DenseLength::atom(const Term &term){
  if(!charge())return {};
  if(term.number&&!term.symbol.empty()){reject("ambiguous dense length term");return {};}
  if(!term.number&&term.symbol.empty())return {};
  const auto id=term.number?"#length/"+std::to_string(*term.number):"#length-value/"+term.symbol;
  terms.emplace(id,term);return id;
}
DenseLength::Id DenseLength::node(){
  if(!building())return none;const auto id=flow.node();if(id==none){reject(flow.error());return none;}
  ++count;if(!outcome(flow.requireEvidence(id)))return none;return id;
}
bool DenseLength::seed(Id target,const Term &term){
  if(!building())return false;const auto id=atom(term);if(!failure.empty())return false;
  return id.empty()?outcome(flow.unknown(target)):outcome(flow.seed(target,id));
}
bool DenseLength::unknown(Id target){return building()&&outcome(flow.unknown(target));}
bool DenseLength::pass(Id from,Id to){return building()&&outcome(flow.connect({from,to}));}
bool DenseLength::store(Id before,Id after,std::optional<uint32_t> index){
  if(!building())return false;if(before>=count||after>=count)return reject("dense store node identity");
  stores.push_back({before,after,index});
  // An append can only introduce one of these finitely many literal lengths.
  if(index&&*index<UINT32_MAX)atom({uint32_t(*index+1),{}});
  return failure.empty();
}
bool DenseLength::solve(){
  if(!building())return false;sealed=true;
  const auto pending=flow.node();if(pending==none||!outcome(flow.unknown(pending)))return false;
  for(const auto &store:stores){
    if(!charge())return false;
    if(!store.index){if(!outcome(flow.unknown(store.after)))return false;continue;}
    // Pending always propagates, even when no concrete successful predecessor
    // can be selected. A source-free loop is not an observed empty Array.
    if(!outcome(flow.connect({store.before,store.after,none,{}, {},true,true})))return false;
    for(const auto &[id,term]:terms){
      if(!charge())return false;
      if(!term.number){if(!outcome(flow.connect({pending,store.after,store.before,id})))return false;continue;}
      if(*store.index>*term.number)continue; // gap: no normal-success length
      if(*store.index==*term.number&&*term.number==UINT32_MAX)continue;
      const auto length=*store.index==*term.number?uint32_t(*term.number+1):*term.number;
      const auto source=flow.node();if(source==none||!outcome(flow.seed(source,"#length/"+std::to_string(length)))||
          !outcome(flow.connect({source,store.after,store.before,id})))return false;
    }
  }
  if(!charge()||!outcome(flow.solve()))return false;solved=true;return true;
}
bool DenseLength::unchanged(Id before,const Term &requested){
  if(!solved||!charge())return false;
  if(requested.number&&!requested.symbol.empty())return reject("ambiguous dense comparison term");
  if(!requested.number&&requested.symbol.empty())return false;
  const auto id=requested.number?"#length/"+std::to_string(*requested.number):"#length-value/"+requested.symbol;
  const auto *value=evidence(before);
  if(!value||value->pending||value->alternatives.empty())return false;
  for(const auto &candidate:value->alternatives){if(!charge())return false;if(candidate!=id)return false;}
  return true;
}
const PayloadEvidence *DenseLength::evidence(Id id)const{return solved&&failure.empty()?flow.evidence(id):nullptr;}
} // namespace tsfg::finite
