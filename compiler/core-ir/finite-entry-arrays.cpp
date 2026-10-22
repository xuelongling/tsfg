// SPDX-License-Identifier: MIT
#include "finite-entry-arrays.h"
#include <algorithm>
#include <iterator>
#include <tuple>
#include <utility>

namespace tsfg::finite {
namespace {
using Types=std::map<std::string,EntryArrayType>;
using Set=std::set<std::string>;
struct Derivation {
  const Types &types;
  const std::vector<EntryArraySeed> &seeds;
  EntryArrayBounds result;
  size_t &remaining;
  const std::function<bool()> &cancelled;
  std::map<std::string,Set> descendants;
  std::map<std::tuple<size_t,std::string,bool>,Set> requiredMemo;
  std::map<std::string,size_t> resourceSeeds;
  bool reject(const std::string &reason) { result.error=reason;return false; }
  bool charge(size_t count=1) {
    if(cancelled&&cancelled())return reject("entry array proof cancelled");
    if(count>remaining)return reject("entry array proof work limit");
    remaining-=count;return true;
  }
  bool container(const std::string &id) const {
    const auto &kind=types.at(id).kind;return kind=="array"||kind=="readSpan";
  }
  bool catalogue() {
    if(types.empty()||types.size()>4096||seeds.size()>4096)return reject("entry array catalogue/seed count");
    static const Set kinds={"scalar","null","undefined","void","string","union","array","readSpan","reference","value"};
    for(const auto &[id,row]:types) {
      if(!charge())return false;
      if(id.empty()||id.size()>4096||!kinds.count(row.kind))return reject("entry array unknown semantic type");
      if(container(id)&&!types.count(row.elementType))return reject("entry array missing element type");
      if(row.kind=="union"&&(row.members.empty()||row.members.size()>256))return reject("entry array union members");
      for(const auto &member:row.members) {
        if(!charge())return false;
        if(!types.count(member))return reject("entry array missing union member");
      }
      for(const auto &[role,type]:row.relations) {
        if(!charge())return false;
        if(role.empty()||!types.count(type))return reject("entry array missing owned resource relation");
      }
      if(!row.base.empty()&&(!types.count(row.base)||types.at(row.base).kind!=row.kind))
        return reject("entry array invalid nominal base");
    }
    // Finite nominal descendants are authority only for actual nominal
    // inheritance. Structural candidates arrive through the verified seeds.
    for(const auto &[id,row]:types)if(row.kind=="reference") {
      Set seen;
      for(auto current=id;!current.empty();current=types.at(current).base) {
        if(!charge())return false;
        if(!seen.insert(current).second)return reject("entry array nominal lineage cycle");
        descendants[current].insert(id);
      }
    }
    Set ids;
    for(const auto &seed:seeds) {
      if(!charge())return false;
      if(seed.id.empty()||seed.id.size()>4096||!ids.insert(seed.id).second||!types.count(seed.type))
        return reject("entry array duplicate/missing declaration seed");
      for(const auto &[target,sources]:seed.references) {
        if(!charge())return false;
        if(!types.count(target)||types.at(target).kind!="reference")return reject("entry array M12 target");
        for(const auto &source:sources) {
          if(!charge())return false;
          if(!types.count(source)||types.at(source).kind!="reference")return reject("entry array M12 source");
        }
      }
    }
    return true;
  }
  bool required(size_t seed,const std::string &root,Set &out,bool nominalOnly=false) {
    const auto key=std::make_tuple(seed,root,nominalOnly);const auto found=requiredMemo.find(key);
    if(found!=requiredMemo.end()){out=found->second;return true;}
    std::vector<std::string> work{root};Set seen;
    while(!work.empty()) {
      if(!charge())return false;
      const auto id=work.back();work.pop_back();if(!seen.insert(id).second)continue;
      const auto &type=types.at(id);
      if(type.kind=="union") {work.insert(work.end(),type.members.begin(),type.members.end());continue;}
      out.insert(id);
      if(type.kind=="reference") {
        for(const auto &actual:descendants[id]){if(!charge())return false;out.insert(actual);}
        const auto authority=seeds[seed].references.find(id);
        if(!nominalOnly&&authority!=seeds[seed].references.end())for(const auto &actual:authority->second) {
          if(!charge())return false;out.insert(actual);
          for(const auto &child:descendants[actual]){if(!charge())return false;out.insert(child);}
        }
      }
      if(out.size()>256)return reject("entry array element variant limit");
    }
    if(out.empty())return reject("entry array unresolved semantic bound");
    requiredMemo.emplace(key,out);return true;
  }
  bool resources(size_t seed) {
    struct Task { std::string type,path,parent;bool direct; };
    const auto &root=seeds[seed];std::vector<Task> work{{root.type,root.id,{},true}},payload;
    std::map<std::string,std::string> interned;Set nominals;
    while(!work.empty()||!payload.empty()) {
      if(work.empty())work.swap(payload);
      if(!charge())return false;auto task=std::move(work.back());work.pop_back();Set alternatives;
      if(!required(seed,task.type,alternatives,task.direct&&root.nominalReceiver))return false;
      for(const auto &id:alternatives) {
        if(!charge())return false;const auto &type=types.at(id);
        if(container(id)) {
          if(!charge((task.path.size()+id.size())/64+1))return false;
          const auto proposed=task.path+"/entry-owner/"+id;
          auto [position,inserted]=interned.emplace(id,proposed);const auto owner=position->second;
          if(task.direct)result.owners[root.id].insert(owner);
          if(!task.parent.empty())result.resources.at(task.parent).elementOwners.insert(owner);
          if(!inserted)continue;
          if(result.resources.size()>=4096)return reject("entry array resource count");
          EntryArrayBound bound;bound.semanticType=id;
          if(!required(seed,type.elementType,bound.elementTypes))return false;
          std::vector<std::string> declared{type.elementType};Set seen;
          while(!declared.empty()) {
            if(!charge())return false;const auto target=declared.back();declared.pop_back();if(!seen.insert(target).second)continue;
            const auto &relation=types.at(target);
            if(relation.kind=="union")declared.insert(declared.end(),relation.members.begin(),relation.members.end());
            else if(relation.kind=="reference"&&(!root.completeAuthority||!root.references.count(target)))bound.aliasesComplete=false;
          }
          if(!result.resources.emplace(owner,std::move(bound)).second)return reject("entry array resource role collision");
          resourceSeeds.emplace(owner,seed);
          work.push_back({type.elementType,owner+"/elements",owner,false});
        } else if((type.kind=="reference"||type.kind=="value")&&nominals.insert(id).second) {
          // A copied value can retain container handles; nominal methods and
          // fields expose further resources without making the nominal value
          // itself an Array owner. Intern by owned TypeId to terminate cycles.
          for(auto relation=type.relations.rbegin();relation!=type.relations.rend();++relation)
            payload.push_back({relation->second,root.id+"/payload/"+id+"/"+relation->first,{},false});
        }
      }
    }
    return true;
  }
  bool shareable(const std::string &left,const std::string &right,bool &out) {
    using Pair=std::pair<std::string,std::string>;
    const auto a=resourceSeeds.at(left),b=resourceSeeds.at(right);
    std::vector<Pair> work{{types.at(result.resources.at(left).semanticType).elementType,
      types.at(result.resources.at(right).semanticType).elementType}};std::set<Pair> seen;
    while(!work.empty()) {
      if(!charge())return false;const auto pair=work.back();work.pop_back();if(!seen.insert(pair).second)continue;
      Set x,y;if(!required(a,pair.first,x)||!required(b,pair.second,y))return false;
      const auto present=[&](const Set &all) {Set selected;for(const auto &id:all)
        if(types.at(id).kind!="undefined"&&types.at(id).kind!="null")selected.insert(id);return selected;};
      const auto xp=present(x),yp=present(y);
      const auto &xs=xp.empty()&&yp.empty()?x:xp,&ys=xp.empty()&&yp.empty()?y:yp;
      for(const auto &id:xs)if(ys.count(id)){out=true;return true;}
      for(const auto &i:xp)for(const auto &j:yp) {
        if(!charge())return false;
        if(container(i)&&container(j))work.emplace_back(types.at(i).elementType,types.at(j).elementType);
      }
    }
    out=false;return true;
  }
  bool aliases() {
    for(auto a=result.resources.begin();a!=result.resources.end();++a)for(auto b=std::next(a);b!=result.resources.end();++b) {
      if(!charge())return false;bool shared=false;if(!shareable(a->first,b->first,shared))return false;
      if(shared){a->second.aliases.insert(b->first);b->second.aliases.insert(a->first);}
    }
    // An absence-only resource may be source-compatible with two distinct
    // numeric views. Absence cannot prove their shared native storage. Report
    // that concrete boundary as pending instead of certifying non-aliasing or
    // silently using it to combine incompatible native representations.
    for(auto &[bridge,bound]:result.resources) {
      Set absence;
      bool onlyAbsence=true;
      for(const auto &id:bound.elementTypes) {
        if(!charge())return false;const auto &kind=types.at(id).kind;
        if(kind=="undefined"||kind=="null")absence.insert(id);else onlyAbsence=false;
      }
      if(!onlyAbsence||absence.empty())continue;
      std::vector<std::string> candidates;
      for(const auto &[id,other]:result.resources) {
        if(!charge())return false;if(id==bridge)continue;
        bool common=false,present=false;
        for(const auto &type:other.elementTypes) {
          if(!charge())return false;common|=absence.count(type)!=0;
          present|=types.at(type).kind!="undefined"&&types.at(type).kind!="null";
        }
        if(common&&present)candidates.push_back(id);
      }
      if(!candidates.empty()) {
        bound.aliasesComplete=false;
        for(const auto &candidate:candidates)result.resources.at(candidate).aliasesComplete=false;
      }
      for(size_t a=0;a<candidates.size();++a)for(size_t b=a+1;b<candidates.size();++b) {
        if(!charge())return false;
        if(!result.resources.at(candidates[a]).aliases.count(candidates[b]))
          return reject("entry array pending native compatibility through absence resource: "+bridge+" -> "+candidates[a]+" / "+candidates[b]);
      }
    }
    bool changed=true;
    while(changed) {
      changed=false;
    // A reference-bearing return or an unconnected definition may lack a
    // declaration-role authority. It cannot certify separation from another
    // reference shape merely because their currently known leaves differ.
    for(auto a=result.resources.begin();a!=result.resources.end();++a)for(auto b=std::next(a);b!=result.resources.end();++b) {
      if(!charge())return false;
      if(a->second.aliasesComplete&&b->second.aliasesComplete)continue;
      using Pair=std::pair<std::string,std::string>;std::set<Pair> seen;
      std::vector<Pair> work{{types.at(a->second.semanticType).elementType,types.at(b->second.semanticType).elementType}};
      bool uncertain=false;
      while(!work.empty()&&!uncertain) {
        if(!charge())return false;const auto pair=work.back();work.pop_back();if(!seen.insert(pair).second)continue;
        Set x,y;if(!required(resourceSeeds.at(a->first),pair.first,x)||!required(resourceSeeds.at(b->first),pair.second,y))return false;
        for(const auto &i:x)for(const auto &j:y) {
          if(!charge())return false;
          if(types.at(i).kind=="reference"&&types.at(j).kind=="reference")uncertain=true;
          if(container(i)&&container(j))work.emplace_back(types.at(i).elementType,types.at(j).elementType);
        }
      }
      if(uncertain) {
        changed|=a->second.aliasesComplete||b->second.aliasesComplete;
        a->second.aliasesComplete=false;b->second.aliasesComplete=false;
      }
    }
      for(auto &[id,bound]:result.resources)for(const auto &alias:bound.aliases) {
        if(!charge())return false;const auto &other=result.resources.at(alias);
        if(bound.aliasesComplete&&!other.aliasesComplete){bound.aliasesComplete=false;changed=true;}
        for(const auto &type:other.elementTypes){if(!charge())return false;changed|=bound.elementTypes.insert(type).second;}
        for(const auto &owner:other.elementOwners){if(!charge())return false;changed|=bound.elementOwners.insert(owner).second;}
        if(bound.elementTypes.size()>256)return reject("entry array aliased element variant limit");
      }
      for(auto &[id,bound]:result.resources)for(const auto &owner:bound.elementOwners) {
        if(!charge())return false;
        if(bound.aliasesComplete&&!result.resources.at(owner).aliasesComplete){bound.aliasesComplete=false;changed=true;}
      }
    }
    return true;
  }
  bool run() {
    if(!catalogue())return false;
    for(size_t seed=0;seed<seeds.size();++seed)if(!resources(seed))return false;
    return aliases();
  }
};
}
bool deriveEntryArrayBounds(const Types &types,const std::vector<EntryArraySeed> &seeds,
    EntryArrayBounds &out,size_t &remaining,const std::function<bool()> &cancelled) {
  Derivation proof{types,seeds,{},remaining,cancelled};
  if(!proof.run()){out={};out.error=proof.result.error;return false;}
  out=std::move(proof.result);return true;
}
} // namespace tsfg::finite
