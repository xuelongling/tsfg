// SPDX-License-Identifier: MIT
#include "common-program-array-targets.h"
#include "common-program-source.h"
namespace tsfg::commonProgram {
bool ArrayTargets::step(size_t n){return p.charge(n)||reject(e,"core-ir-common-budget","independent Array storage target work exceeded");}
bool ArrayTargets::build(){
  for(const auto &[id,type]:types){if(!step(id.size()/64+1))return false;const auto kind=string(field(*type,"kind"));if(kind=="array"||kind=="readSpan")parents.emplace(id,id);}
  for(const auto &[id,type]:types)if(string(field(*type,"kind"))=="union")for(const auto &member:items(field(*type,"members"))){if(!step())return false;link(id,string(member));}
  return e.message.empty();
}
void ArrayTargets::reset(){minimum.clear();values.clear();captures.clear();unsafe.clear();exposed.clear();missing.clear();}
std::string ArrayTargets::root(const std::string &id){
  if(!step(id.size()/64+1))return {};auto current=id;
  for(;;){if(!step(current.size()/64+1))return {};auto found=parents.find(current);if(found==parents.end()){reject(e,"core-ir-common-callable","Array family type is not owned");return {};}
    if(found->second==current)return current;current=found->second;}
}
void ArrayTargets::members(const std::string &id,std::set<std::string> &seen,std::set<std::string> &out){
  if(!step(id.size()/64+1)||!seen.insert(id).second)return;
  if(parents.count(id)){const auto key=root(id);if(e.message.empty()&&step(key.size()/64+1))out.insert(key);return;}
  auto found=types.find(id);if(found!=types.end()&&string(field(*found->second,"kind"))=="union")for(const auto &member:items(field(*found->second,"members"))){if(!step())return;members(string(member),seen,out);}
}
std::set<std::string> ArrayTargets::families(const std::string &id){std::set<std::string> seen,out;members(id,seen,out);return out;}
void ArrayTargets::merge(Targets &into,const Targets &value){
  auto next=join(into,value);if(!e.message.empty()||!step(into.functions.size()+next.functions.size()+1))return;
  if(into.top!=next.top||into.functions!=next.functions){into=std::move(next);dirty=true;}
}
void ArrayTargets::link(const std::string &from,const std::string &to){
  const auto left=families(from),right=families(to);
  for(const auto &a:left)for(const auto &b:right){if(!step())return;const auto x=root(a),y=root(b);if(x==y)continue;
    const bool firstExposed=exposed.count(x),secondExposed=exposed.count(y);Targets pending;
    if(firstExposed&&!secondExposed&&captures.count(y))pending=join(pending,captures.at(y));
    if(secondExposed&&!firstExposed&&captures.count(x))pending=join(pending,captures.at(x));
    if(!step((x.size()+y.size())/64+2))return;parents[x]=y;
    auto first=minimum.find(x),second=minimum.find(y);if(first!=minimum.end())minimum[y]=second==minimum.end()?first->second:std::min(first->second,second->second);
    if(unsafe.count(x))unsafe.insert(y);if(missing.count(x))missing.insert(y);if(firstExposed||secondExposed)exposed.insert(y);
    auto value=values.find(x);if(value!=values.end())merge(values[y],value->second);
    auto captured=captures.find(x);if(captured!=captures.end())merge(captures[y],captured->second);dirty=true;
    if(e.message.empty()&&exposeWriter&&(pending.top||!pending.functions.empty()))exposeWriter(pending);
  }
}
void ArrayTargets::birth(const std::string &type,size_t count){for(const auto &id:families(type)){if(!step())return;auto old=minimum.find(id);minimum[id]=old==minimum.end()?count:std::min(count,old->second);}}
void ArrayTargets::cancel(const std::string &type){for(const auto &id:families(type)){if(!step())return;unsafe.insert(id);}}
void ArrayTargets::expose(const std::string &type){
  for(const auto &id:families(type)){if(!step())return;unsafe.insert(id);if(!exposed.insert(id).second)continue;dirty=true;
    auto found=captures.find(id);if(found!=captures.end()&&exposeWriter){auto value=join(Targets{},found->second);if(e.message.empty())exposeWriter(value);}}
}
bool ArrayTargets::mayCallable(const std::string &type,bool element){
  if(!step(type.size()/64+1))return false;std::vector<std::pair<std::string,bool>> pending{{type,element}};std::set<std::pair<std::string,bool>> seen;
  for(size_t at=0;at<pending.size();++at){if(!step(pending[at].first.size()/64+2))return false;if(!seen.insert(pending[at]).second)continue;
    const auto id=pending[at].first;const bool array=pending[at].second;auto found=types.find(id);if(found==types.end())continue;
    const auto kind=string(field(*found->second,"kind"));if(!array&&kind=="function")return true;
    const auto add=[&](const std::string &next,bool mode){if(!step(next.size()/64+1))return;if(pending.size()==pending.capacity()&&!step(pending.size()+1))return;pending.emplace_back(next,mode);};
    if(kind=="union")for(const auto &member:items(field(*found->second,"members")))add(string(member),array);
    else if(array&&(kind=="array"||kind=="readSpan"))add(string(field(*found->second,"elementType")),false);
    if(!e.message.empty())return false;
  }return false;
}
void ArrayTargets::write(const std::string &type,const std::optional<Targets> &value){
  const Targets top{true,{}};const bool callable=value.has_value()||mayCallable(type,true);
  for(const auto &id:families(type)){if(!step())return;merge(values[id],value?*value:top);
    if(callable){const auto &observed=value?*value:top;merge(captures[id],observed);if(e.message.empty()&&exposed.count(id)&&exposeWriter)exposeWriter(observed);}}
}
ArrayTargets::Targets ArrayTargets::read(const std::string &type){
  Targets result;const auto ids=families(type);if(ids.empty())return {true,{}};
  for(const auto &id:ids){if(!step())return {};auto value=values.find(id);if(value!=values.end())result=join(result,value->second);result.top|=exposed.count(id)||missing.count(id);}return result;
}
bool ArrayTargets::complete(){
  bool changed=false;for(const auto &[id,parent]:parents){if(!step())return false;const auto element=types.find(string(field(*types.at(id),"elementType")));
    if(element==types.end()||string(field(*element->second,"kind"))!="function")continue;
    const auto key=root(id);if(!e.message.empty())return false;auto &value=values[key];if(!value.top&&value.functions.empty()&&missing.insert(key).second){dirty=true;changed=true;}
  }return changed;
}
bool ArrayTargets::initialized(std::map<std::string,size_t> &out){
  std::map<std::string,size_t> result;
  for(const auto &[id,type]:types){if(!step())return false;if(string(field(*type,"kind"))!="array")continue;const auto key=root(id);auto bound=minimum.find(key);
    if(bound!=minimum.end()&&!unsafe.count(key)){if(!step(id.size()/64+1))return false;result.emplace(id,bound->second);}}
  if(!e.message.empty())return false;out=std::move(result);return true;
}
} // namespace tsfg::commonProgram
