// SPDX-License-Identifier: MIT
#include "common-program-relations.h"
#include <algorithm>
#include <optional>
namespace tsfg::commonProgram {
namespace {
Json origin(const std::string &path,const Json &range){return Object{{"source",path},{"start",field(range,"start")},{"end",field(range,"end")}};}
referenceContracts::OriginKey key(const Json &o,const std::string &a,const std::string &b){return {string(field(o,"source")),
  uint32_t(field(o,"start").getAsInteger().value_or(0)),uint32_t(field(o,"end").getAsInteger().value_or(0)),a,b};}
bool container(const std::string &k){return k=="array"||k=="readSpan";}
}
bool SourceRelations::fail(const Json &o,llvm::StringRef message){
  m.error.path=string(field(o,"source"));m.error.range={uint32_t(field(o,"start").getAsInteger().value_or(0)),uint32_t(field(o,"end").getAsInteger().value_or(0))};
  return m.need(false,message);
}
bool SourceRelations::members(const std::string &id){
  if(memberCache.count(id))return true;std::vector<const Json *> chain;std::set<std::string> seen;auto current=id;
  while(!current.empty()){
    if(!m.spend()||!m.need(m.types.count(current)&&seen.insert(current).second,"M12 member inheritance cycle/unowned type"))return false;
    const auto *t=m.types.at(current);chain.push_back(t);current=string(field(*t,"base"));
  }
  referenceContracts::Members out;
  for(auto it=chain.rbegin();it!=chain.rend();++it){
    for(const auto &f:items(field(**it,"fields"))){const auto name=field(f,"name").getAsString();if(!m.spend(name?name->size()/8+1:1)||!m.need(out.emplace(string(field(f,"id")),referenceContracts::Member{
      "field",string(field(f,"name")),string(field(f,"type"))}).second,"duplicate M12 field identity"))return false;}
    for(const auto &method:items(field(**it,"methods"))){
      const auto fid=string(method);if(!m.spend()||!m.need(m.functions.count(fid),"M12 method function missing"))return false;const auto &fn=*m.functions.at(fid);
      if(!m.need(string(field(fn,"ownerType"))==string(field(**it,"id")),"M12 method owner differs"))return false;
      const auto overridden=string(field(fn,"overrideTarget"));if(!overridden.empty()&&!m.need(out.erase(overridden)==1,"M12 override is not an effective inherited method"))return false;
      const auto name=field(fn,"name").getAsString();if(!m.spend(name?name->size()/8+1:1))return false;
      referenceContracts::Member row;row.kind="method";row.name=string(field(fn,"name"));row.result=string(field(fn,"returnType"));
      for(const auto &p:items(field(fn,"parameters"))){if(!m.spend())return false;row.parameters.push_back(string(field(p,"declaredType")));}
      if(!m.need(out.emplace(fid,std::move(row)).second,"duplicate M12 method identity"))return false;
    }
  }memberCache.emplace(id,std::move(out));return true;
}
bool SourceRelations::read(){
  for(const auto &[id,t]:m.types){
    if(!m.spend())return false;referenceContracts::Type row;row.kind=string(field(*t,"kind"));row.element=string(field(*t,"elementType"));row.base=string(field(*t,"base"));
    for(const auto &v:items(field(*t,"members"))){if(!m.spend())return false;row.members.push_back(string(v));}types.emplace(id,std::move(row));
  }
  std::optional<Key> previous;
  for(const auto &record:items(field(m.payload,"compatibilityWitnesses"))){
    const auto &c=field(record,"compatibility"),&o=field(c,"origin");const auto a=string(field(c,"sourceType")),b=string(field(c,"targetType"));
    const auto k=key(o,a,b);const auto path=string(field(o,"source"));const auto start=field(o,"start").getAsInteger(),end=field(o,"end").getAsInteger();
    if(!m.spend()||!m.need(m.sources.count(path)&&start&&end&&*start>=0&&*end>*start&&*end<=field(*m.sources.at(path),"utf16Length").getAsInteger().value_or(0)&&
      types.count(a)&&types.count(b)&&types.at(a).kind=="reference"&&types.at(b).kind=="reference"&&a!=b&&(!previous||*previous<k),"M12 directory type/origin/order differs"))return false;
    previous=k;records.emplace(k,&record);std::set<Pair> deps;std::optional<Pair> prior;
    for(const auto &d:items(field(record,"dependencies"))){Pair p{string(field(d,"sourceType")),string(field(d,"targetType"))};
      if(!m.spend()||!m.need(types.count(p.first)&&types.count(p.second)&&types.at(p.first).kind=="reference"&&types.at(p.second).kind=="reference"&&
        p.first!=p.second&&(!prior||*prior<p),"M12 dependency type/order differs"))return false;prior=p;deps.insert(p);}
    dependencies.emplace(k,std::move(deps));
  }
  std::string error;return referenceContracts::closeDirectory(dependencies,[&](size_t n){return m.spend(n);},error)||m.need(false,error);
}
bool SourceRelations::logical(const std::string &a,const std::string &b,const std::set<Pair> &available,std::set<Pair> &used){
  std::string error;const bool ok=referenceContracts::logical(types,a,b,available,used,[&](size_t n){return m.spend(n);},error,{true,true,false});
  if(!error.empty())return m.need(false,error);return ok;
}
bool SourceRelations::verify(const Key &root){
  std::vector<Key> pending{root};
  while(!pending.empty()){
    if(!m.spend())return false;auto k=std::move(pending.back());pending.pop_back();reached.insert(k);if(verified.count(k))continue;
    if(!m.need(records.count(k),"M12 selected same-origin record missing"))return false;
    const auto &c=field(*records.at(k),"compatibility"),&o=field(c,"origin");const auto a=std::get<3>(k),b=std::get<4>(k);
    if(!m.need(field(c,"assignable").getAsBoolean()==true,"M12 official edge is not successful")||!members(a)||!members(b))return false;
    std::vector<Pair> mapping;for(const auto &p:items(field(c,"members"))){if(!m.spend())return false;mapping.emplace_back(string(field(p,"source")),string(field(p,"target")));}
    std::string error;
    if(!referenceContracts::verifyMembers(types,memberCache.at(a),memberCache.at(b),mapping,dependencies.at(k),{},[&](size_t n){return m.spend(n);},error,{true,true,false}))return fail(o,error);
    verified.insert(k);for(const auto &[x,y]:dependencies.at(k)){if(!m.spend())return false;pending.push_back({std::get<0>(k),std::get<1>(k),std::get<2>(k),x,y});}
  }return true;
}
bool SourceRelations::select(const Json &rows,const Json &o,std::set<Pair> &selected){
  std::optional<Pair> previous;
  for(const auto &p:items(rows)){
    Pair pair{string(field(p,"sourceType")),string(field(p,"targetType"))};
    if(!m.spend()||!m.need((!previous||*previous<pair)&&records.count(key(o,pair.first,pair.second)),"M12 root order or exact occurrence differs"))return fail(o,"M12 root has no ordered same-origin record");
    previous=pair;selected.insert(pair);
  }return true;
}
bool SourceRelations::expression(const Json &v,const std::string &expected,const std::string &path){
  const auto o=origin(path,field(v,"range"));const auto *roots=v.getAsObject()->get("compatibilityRoots");std::set<Pair> selected,used;
  if(roots&&(!m.need(!items(*roots).empty(),"M12 expression root list is empty")||!select(*roots,o,selected)))return false;
  if(string(field(v,"kind"))=="as"){
    if(!assertion(string(field(field(v,"expression"),"flowType")),string(field(v,"flowType")),selected,used))return fail(o,"assertion changes unsupported numeric or nominal view");
  }else if(!selected.empty()&&expected.empty())return fail(o,"M12 roots have no contextual slot");
  if(!expected.empty()&&!logical(string(field(v,"flowType")),expected,selected,used))return fail(o,"expression does not satisfy contextual logical slot");
  if(!m.need(used==selected,"M12 expression contains unselected roots"))return fail(o,"M12 expression roots were not exactly consumed");
  for(const auto &[a,b]:used)if(!verify(key(o,a,b)))return false;return true;
}
bool SourceRelations::payloadReferences(const std::string &root,std::set<std::string> &out){
  std::vector<std::string> todo{root};std::set<std::string> seen;
  while(!todo.empty()){
    auto id=std::move(todo.back());todo.pop_back();if(!m.spend()||!m.need(types.count(id),"entry role type missing"))return false;if(!seen.insert(id).second)continue;
    const auto &t=types.at(id);if(t.kind=="reference")out.insert(id);
    if(t.kind=="union")for(const auto &v:t.members){if(!m.spend())return false;todo.push_back(v);}
    if(container(t.kind))todo.push_back(t.element);
    if(t.kind=="reference"||t.kind=="value"){
      if(!members(id))return false;for(const auto &[memberId,member]:memberCache.at(id)){
        if(!m.spend())return false;if(member.kind=="field")todo.push_back(member.type);
        else{todo.push_back(member.result);for(const auto &p:member.parameters){if(!m.spend())return false;todo.push_back(p);}}
      }
    }
  }return true;
}
bool SourceRelations::entry(const Json &entry){
  const auto &o=field(entry,"origin");std::set<Pair> selected;std::set<std::string> targets;
  if(!payloadReferences(string(field(entry,"viewType")),targets)||!select(field(entry,"roots"),o,selected))return false;
  const auto binding=string(field(entry,"parameterBinding"));entryTypes.try_emplace(binding);entryRecords.try_emplace(binding);
  // Base edges are declaration authority; structural candidates still need
  // this parameter's exact occurrence-specific witness.
  for(const auto &target:targets)for(const auto &[actual,type]:types){
    if(!m.spend())return false;if(type.kind!="reference")continue;auto current=actual;std::set<std::string> seen;
    while(!current.empty()){if(!m.spend()||!m.need(types.count(current)&&seen.insert(current).second,"entry base graph differs"))return false;
      if(current==target){entryTypes[binding][target].insert(actual);break;}current=types.at(current).base;}
  }
  for(const auto &[a,b]:selected){
    if(!m.spend()||!m.need(a!=b&&types.count(a)&&types.at(a).kind=="reference"&&targets.count(b),"entry candidate is outside original payload role")||!verify(key(o,a,b)))return false;
    entryTypes[binding][b].insert(a);
    std::vector<Key> todo{key(o,a,b)};auto &closure=entryRecords[binding];
    while(!todo.empty()){if(!m.spend())return false;auto current=std::move(todo.back());todo.pop_back();if(!closure.insert(current).second)continue;
      for(const auto &[x,y]:dependencies.at(current)){if(!m.spend())return false;todo.push_back({std::get<0>(current),std::get<1>(current),std::get<2>(current),x,y});}}
  }return true;
}
bool SourceRelations::forward(const Json &t){
  const auto &c=field(t,"construction"),&f=field(c,"implicitForward"),&o=field(c,"origin");const auto base=string(field(t,"base"));
  if(!m.need(m.types.count(base),"implicit forwarding base missing"))return false;const auto &bc=field(*m.types.at(base),"construction");
  const auto &parameters=items(field(c,"parameters")),&inherited=items(field(bc,"parameters")),&mapping=items(field(f,"parameters"));
  if(!m.need(string(field(f,"target"))==string(field(bc,"id"))&&same(field(f,"origin"),o)&&same(field(f,"baseSignature"),Object{
    {"parameters",field(bc,"parameters")},{"return",base}})&&parameters.size()==inherited.size()&&mapping.size()==parameters.size(),"implicit forwarding target/signature/arity differs"))return false;
  for(size_t i=0;i<parameters.size();++i){
    if(!m.spend())return false;const auto &p=parameters[i],&b=inherited[i],&edge=mapping[i],&proof=field(edge,"compatibility");const auto type=string(field(p,"type"));
    if(!m.need(string(field(p,"symbol"))==string(field(c,"id"))+".p"+std::to_string(i)&&same(field(p,"type"),field(b,"type"))&&same(field(p,"inheritedFrom"),field(b,"symbol"))&&
      same(field(p,"origin"),field(b,"origin"))&&same(field(edge,"source"),field(p,"symbol"))&&same(field(edge,"target"),field(b,"symbol"))&&
      field(proof,"assignable").getAsBoolean()==true&&string(field(proof,"sourceType"))==type&&string(field(proof,"targetType"))==type&&same(field(proof,"origin"),o),"implicit forwarding parameter/origin/identity differs"))return false;
    std::set<std::string> ids;
    if(types.at(type).kind=="reference"||types.at(type).kind=="value"){
      if(!members(type))return false;for(const auto &[id,member]:memberCache.at(type)){if(!m.spend())return false;ids.insert(id);}
    }else if(container(types.at(type).kind))ids.insert(string(field(field(m.payload,types.at(type).kind=="array"?"arrayLength":"readSpanLength"),"id")));
    Array expected;for(const auto &id:ids){if(!m.spend())return false;expected.push_back(Object{{"source",id},{"target",id}});}
    if(!m.need(same(Json(std::move(expected)),field(proof,"members")),"implicit forwarding member mapping differs"))return false;
  }return true;
}
bool SourceRelations::finish(){
  if(!m.need(reached.size()==records.size(),"M12 directory contains unreachable occurrence records"))return false;
  decltype(m.p.referenceFields) fields;decltype(m.p.entryCandidates) entries;
  const auto project=[&](const Key &k,Program::ReferenceFields &fields){
    const auto &c=field(*records.at(k),"compatibility");const auto source=std::get<3>(k),target=std::get<4>(k);
    for(const auto &[actual,type]:m.types){
      if(!m.spend())return false;if(string(field(*type,"kind"))!="reference")continue;auto current=actual;std::set<std::string> seen;bool descends=false;
      while(!current.empty()){
        if(!m.spend()||!m.need(m.types.count(current)&&seen.insert(current).second,"M12 projection inheritance differs"))return false;
        if(current==source){descends=true;break;}current=string(field(*m.types.at(current),"base"));
      }
      if(!descends)continue;auto &projection=fields[{m.typeIds.at(actual),m.typeIds.at(target)}];
      for(const auto &p:items(field(c,"members"))){
        if(!m.spend())return false;const auto a=string(field(p,"source")),b=string(field(p,"target"));
        if(m.fieldIds.count(a)){
          if(!m.need(m.fieldIds.count(b),"M12 semantic field map kind differs"))return false;const auto from=m.fieldIds.at(a),to=m.fieldIds.at(b);
          auto old=projection.find(to);if(!m.need(old==projection.end()||old->second==from,"ambiguous actual/static M12 field map"))return false;projection[to]=from;
        }
      }
    }return true;
  };
  for(const auto &k:verified)if(!project(k,fields))return false;
  for(const auto &[binding,views]:entryTypes){entries.try_emplace(binding);for(const auto &[view,candidates]:views)for(const auto &candidate:candidates){
    if(!m.spend())return false;entries[binding].candidates[m.typeIds.at(view)].insert(m.typeIds.at(candidate));
  }}
  for(const auto &[binding,closure]:entryRecords)for(const auto &k:closure)if(!project(k,entries[binding].fields))return false;
  m.p.referenceFields=std::move(fields);m.p.entryCandidates=std::move(entries);return true;
}
bool SourceRelations::assertion(const std::string &from,const std::string &to,const std::set<Pair> &available,std::set<Pair> &used){
  if(!m.types.count(from)||!m.types.count(to))return false;
  if(string(field(*m.types.at(from),"kind"))=="unknown"||string(field(*m.types.at(to),"kind"))=="unknown")return true;
  const auto container=[](const std::string &k){return k=="array"||k=="readSpan";};
  using Numerics=std::map<unsigned,std::set<std::string>>;
  const auto numerics=[&](const std::string &root,Numerics &out){
    std::vector<std::pair<std::string,unsigned>> pending{{root,0}};std::set<std::pair<std::string,unsigned>> seen;
    while(!pending.empty()){
      auto [id,depth]=std::move(pending.back());pending.pop_back();if(!m.spend()||!m.need(depth<=128&&m.types.count(id),"assertion numeric graph differs"))return false;
      if(!seen.emplace(id,depth).second)continue;const auto &t=*m.types.at(id);const auto k=string(field(t,"kind"));
      if(k=="scalar"&&id!="bool")out[depth].insert(id);
      else if(k=="union")for(const auto &member:items(field(t,"members"))){if(!m.spend())return false;pending.emplace_back(string(member),depth);}
      else if(container(k))pending.emplace_back(string(field(t,"elementType")),depth+1);
    }return true;
  };
  Numerics sourceNumeric,targetNumeric;if(!numerics(from,sourceNumeric)||!numerics(to,targetNumeric))return false;
  for(const auto &[depth,kinds]:sourceNumeric)if(targetNumeric.count(depth)){
    bool overlap=false;for(const auto &id:kinds){if(!m.spend())return false;overlap|=targetNumeric.at(depth).count(id);}
    if(!overlap)return false;
  }
  const auto payload=[&](const Json &t){std::vector<std::string> result;
    if(string(field(t,"kind"))!="union")result.push_back(string(field(t,"id")));
    else for(const auto &member:items(field(t,"members"))){if(!m.spend())return result;if(string(member)!="undefined"&&string(member)!="null")result.push_back(string(member));}return result;};
  std::function<bool(const std::string &,const std::string &,unsigned)> view;
  view=[&](const std::string &a,const std::string &b,unsigned depth){
    if(!m.spend()||!m.need(depth<=128&&m.types.count(a)&&m.types.count(b),"assertion view graph differs"))return false;
    if(a==b)return true;const auto &s=*m.types.at(a),&t=*m.types.at(b);const auto sk=string(field(s,"kind")),tk=string(field(t,"kind"));
    if(tk=="undefined"||tk=="null"||tk=="void")return true;
    if(sk=="union"||tk=="union"){
      const auto sp=payload(s),tp=payload(t);if(!m.error.message.empty())return false;
      if(!m.spend((sp.size()+1)*(tp.size()+1)))return false;
      const auto subset=[](const auto &x,const auto &y){return std::all_of(x.begin(),x.end(),[&](const auto &id){return std::find(y.begin(),y.end(),id)!=y.end();});};
      if(subset(sp,tp)||subset(tp,sp))return true;
      if(sk=="union"){for(const auto &id:sp)if(!view(id,b,depth+1))return false;return true;}
      if(tp.size()==1)return view(a,tp[0],depth+1);
      if(sk=="value"||sk=="reference")return logical(a,b,available,used);
    }
    if(container(sk)&&container(tk))return view(string(field(s,"elementType")),string(field(t,"elementType")),depth+1);
    if(sk=="reference"&&tk=="reference"){if(!available.count({a,b}))return false;used.emplace(a,b);return true;}
    return sk!="value"&&tk!="value";
  };return view(from,to,0);
}
} // namespace tsfg::commonProgram
