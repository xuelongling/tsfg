// SPDX-License-Identifier: MIT
// Independent published-role/definition seed obligations. These are necessary
// bounds, not permission to admit a producer's entire upper-bound ledger.
#include "finite-module.h"
#include <algorithm>
#include <tuple>

namespace tsfg::finite {
namespace {
using Pair=std::pair<std::string,std::string>;
using Origin=std::tuple<std::string,uint32_t,uint32_t>;
struct Entries {
  ModuleProof &proof;
  std::set<std::string> exported;
  std::map<Pair,const Object *> entries;
  std::map<Origin,std::set<Pair>> witnesses;
  std::map<std::string,std::set<std::string>> ancestors;
  bool origin(const Object *value, Origin &out) {
    uint32_t start=0,end=0;
    if(!value || value->size()!=3 || !unsignedInteger(*value,"start",start) || !unsignedInteger(*value,"end",end) || start>end)
      return proof.reject("entry authority original declaration range");
    const auto path=string(*value,"source");
    if(!proof.sourceLengths.count(path) || end>proof.sourceLengths.at(path)) return proof.reject("entry authority original source");
    out={path,start,end}; return true;
  }
  bool exports() {
    const auto *rows=proof.sourceExports.getAsArray(); if(!rows || rows->empty() || rows->size()>4096) return proof.reject("owned source export catalogue");
    std::set<std::string> names;
    for(const auto &value:*rows) {
      if(!proof.charge()) return false; const auto *row=value.getAsObject();
      const auto name=row?string(*row,"name"):std::string(),id=row?string(*row,"functionId"):std::string();
      if(!row || row->size()!=2 || name.empty() || name.size()>4096 || !names.insert(name).second || !proof.callable.count(id) ||
          string(*proof.callable.at(id),"role")!="function" || !string(*proof.callable.at(id),"ownerType").empty())
        return proof.reject("source export identity/role/name");
      exported.insert(id);
    }
    return true;
  }
  bool descendant(const std::string &actual, const std::string &target, bool &result) {
    if(!proof.charge())return false;
    if(ancestors.count(actual)){result=ancestors.at(actual).count(target);return true;}
    std::set<std::string> seen;
    for(auto id=actual;!id.empty();id=string(*proof.catalog.at(id),"base")) {
      if(!proof.charge() || !proof.catalog.count(id) || !seen.insert(id).second) return proof.reject("definition receiver lineage");
    }
    result=seen.count(target);ancestors.emplace(actual,std::move(seen));
    return true;
  }
  // A nominal payload is a leaf itself. Inherited members are traversed, but a
  // base declaration is not an extra payload leaf of a Derived parameter.
  bool leaves(const std::string &root, std::set<std::string> &references) {
    std::vector<std::string> work{root}; std::set<std::string> seen;
    while(!work.empty()) {
      const auto id=work.back();work.pop_back(); if(!proof.charge() || !proof.catalog.count(id)) return false;
      if(!seen.insert(id).second)continue; const auto *row=proof.catalog.at(id);const auto kind=string(*row,"kind");
      if(kind=="union") {for(const auto &value:*row->getArray("members")){if(!proof.charge())return false;work.push_back(value.getAsString()->str());}}
      else if(kind=="array" || kind=="readSpan")work.push_back(string(*row,"elementType"));
      else if(kind=="reference" || kind=="value") {
        if(kind=="reference")references.insert(id); std::set<std::string> seen_ancestors;std::vector<std::string> lineage;
        for(auto owner=id;!owner.empty();owner=string(*proof.catalog.at(owner),"base")) {
          if(!proof.charge() || !seen_ancestors.insert(owner).second) return proof.reject("entry payload member lineage");
          lineage.push_back(owner);
        }
        // Recompute effective signature reachability independently; an
        // overridden ancestor header is not an extra public payload relation.
        std::reverse(lineage.begin(),lineage.end());std::set<std::string> methods;
        for(const auto &owner:lineage) {
          const auto *nominal=proof.catalog.at(owner);
          for(const auto &field:*nominal->getArray("fields")){if(!proof.charge())return false;work.push_back(string(*field.getAsObject(),"type"));}
          for(const auto &method:*nominal->getArray("methods")) {
            if(!proof.charge() || !proof.callable.count(method.getAsString()->str()))return false;
            const auto method_id=method.getAsString()->str();methods.erase(string(*proof.callable.at(method_id),"overrideTarget"));methods.insert(method_id);
          }
        }
        for(const auto &method:methods) {
          const auto *fn=proof.callable.at(method);work.push_back(string(*fn,"returnType"));const auto &parameters=*fn->getArray("parameters");
          for(size_t i=1;i<parameters.size();++i){if(!proof.charge())return false;work.push_back(string(*parameters[i].getAsObject(),"type"));}
        }
      }
    }
    return true;
  }
  bool authorities() {
    for(const auto &value:*proof.witnesses.getAsArray()) {
      if(!proof.charge())return false; const auto &row=*value.getAsObject()->getObject("compatibility");Origin at;
      if(!origin(row.getObject("origin"),at))return false;
      witnesses[at].insert({string(row,"sourceType"),string(row,"targetType")});
    }
    const auto *rows=proof.entryRoots.getAsArray();if(!rows || rows->size()>4096)return proof.reject("entry authority catalogue");
    Pair previous;
    for(const auto &value:*rows) {
      if(!proof.charge())return false;const auto *row=value.getAsObject();
      const Pair key{row?string(*row,"functionId"):std::string(),row?string(*row,"parameterBinding"):std::string()};
      if(!row || row->size()!=5 || !exported.count(key.first) || (!previous.first.empty() && key<=previous) || !entries.emplace(key,row).second)
        return proof.reject("entry record function/binding/order/role");
      previous=key;const auto &fn=*proof.callable.at(key.first);const Object *parameter=nullptr;
      for(const auto &item:*fn.getArray("parameters")){if(!proof.charge())return false;const auto *p=item.getAsObject();if(string(*p,"id")==key.second)parameter=p;}
      if(!parameter || string(*parameter,"type")!=string(*row,"viewType"))return proof.reject("entry parameter static declared type join");
      Origin actual,expected;
      if(!origin(row->getObject("origin"),actual)||!origin(parameter->getObject("origin"),expected))return false;
      if(actual!=expected)return proof.reject("expression/member proof cannot replace parameter-declaration authority");
      const auto *roots=row->getArray("roots");if(!roots || roots->size()>4096)return proof.reject("entry root pair count");
      std::set<std::string> targets;if(!leaves(string(*row,"viewType"),targets))return false;
      Pair prior;
      for(const auto &item:*roots) {
        if(!proof.charge())return false;const auto *root=item.getAsObject();
        const Pair pair{root?string(*root,"sourceType"):std::string(),root?string(*root,"targetType"):std::string()};
        if(!root || root->size()!=2 || (!prior.first.empty() && pair<=prior) || !targets.count(pair.second) ||
            !proof.catalog.count(pair.first) || string(*proof.catalog.at(pair.first),"kind")!="reference" || pair.first==pair.second ||
            !witnesses[actual].count(pair)) return proof.reject("entry root lacks exact same-declaration selected M12 reference authority");
        prior=pair;
      }
    }
    size_t count=0;
    for(const auto &id:exported)for(const auto &item:*proof.callable.at(id)->getArray("parameters")) {
      if(!proof.charge())return false;count++;
      if(!entries.count({id,string(*item.getAsObject(),"id")}))return proof.reject("missing exported parameter authority, including native empty roots");
    }
    return count==entries.size() || proof.reject("extra exported parameter authority");
  }
  bool required(const std::string &root, const Object *entry, bool receiver, std::set<std::string> &result) {
    std::vector<std::string> work{root};std::set<std::string> seen;
    while(!work.empty()) {
      const auto id=work.back();work.pop_back();if(!proof.charge() || !proof.catalog.count(id))return false;
      if(!seen.insert(id).second)continue;const auto *row=proof.catalog.at(id);const auto kind=string(*row,"kind");
      if(kind=="union") {for(const auto &member:*row->getArray("members")){if(!proof.charge())return false;work.push_back(member.getAsString()->str());}continue;}
      result.insert(id);
      if(kind!="reference")continue;
      for(const auto &[candidate,type]:proof.catalog)if(string(*type,"kind")=="reference") {
        bool derived=false;if(!descendant(candidate,id,derived))return false;if(derived)result.insert(candidate);
      }
      if(receiver)continue;
      const auto insert=[&](const Object &authority)->bool {
        for(const auto &value:*authority.getArray("roots")) {
          if(!proof.charge())return false;const auto &pair=*value.getAsObject();
          if(string(pair,"targetType")==id)result.insert(string(pair,"sourceType"));
        }
        return true;
      };
      if(entry){if(!insert(*entry))return false;}
      else for(const auto &[key,authority]:entries)if(!insert(*authority))return false;
    }
    return true;
  }
  bool definitions() {
    std::map<Pair,const Object *> seeds;
    const auto *rows=proof.plan.getAsObject()->getArray("definitionSeeds");if(!rows)return proof.reject("whole definition seed catalogue");
    for(const auto &value:*rows) {
      if(!proof.charge())return false;const auto *row=value.getAsObject();
      const Pair key{row?string(*row,"functionId"):std::string(),row?string(*row,"binding"):std::string()};
      if(!row || row->size()!=4 || !proof.callable.count(key.first) || exported.count(key.first) || !seeds.emplace(key,row).second)
        return proof.reject("duplicate/unknown/published definition seed");
    }
    size_t seed_count=0;
    for(const auto &[id,fn]:proof.callable) {
      const auto &parameters=*fn->getArray("parameters"),&bounds=*proof.abi.at(id)->getArray("parameters");
      for(size_t index=0;index<parameters.size();++index) {
        if(!proof.charge())return false;const auto &parameter=*parameters[index].getAsObject();const Pair key{id,string(parameter,"id")};
        const auto view=string(parameter,"type");const bool receiver=index==0 && !string(*fn,"ownerType").empty();
        const Object *entry=exported.count(id)?entries.at(key):nullptr;
        if(!entry) {
          seed_count++;const auto found=seeds.find(key);
          if(found==seeds.end() || string(*found->second,"viewType")!=view || string(*found->second,"authority")!=
              (receiver?"owned-receiver-definition-bound":"owned-parameter-definition-bound"))return proof.reject("missing or wrong-role universal definition seed");
        }
        std::set<std::string> expected;if(!required(view,entry,receiver,expected))return false;
        const auto &actual=proof.domains.at(bounds[index].getAsString()->str()).alternatives;
        if(!std::includes(actual.begin(),actual.end(),expected.begin(),expected.end()))
          return proof.reject("definition ABI drops a declared/selected published payload or actual receiver descendant");
      }
    }
    return seeds.size()==seed_count || proof.reject("unused definition seed binding");
  }
  bool published() {
    const auto *rows=proof.plan.getAsObject()->getArray("published");if(!rows)return proof.reject("fixed published call contracts");
    std::map<std::string,std::string> seen;
    for(const auto &value:*rows) {
      if(!proof.charge())return false;const auto *row=value.getAsObject();const auto id=row?string(*row,"functionId"):std::string();
      if(!row || row->size()!=7 || !exported.count(id))return proof.reject("published contract refers to another callable role");
      const auto &fn=*proof.callable.at(id),&abi=*proof.abi.at(id);
      Object expected{{"functionId",id},{"sourceSignature",string(fn,"signatureHash")},
        {"closureIdentity",proof.module->getAttrOfType<mlir::StringAttr>("tsfg_core.input_identity").getValue().str()},
        {"parameterBounds",llvm::json::Array(*abi.getArray("parameters"))},{"resultBound",*abi.get("result")},{"abi",string(abi,"id")}};
      std::string encoded;if(!canonical(std::move(expected),encoded))return false;
      const auto identity=hash(std::string("tsfg.published-call.v1")+'\0'+encoded);
      Object given=*row;given.erase("id");std::string actual;
      if(!canonical(std::move(given),actual)||actual!=encoded||string(*row,"id")!=identity)return proof.reject("published ABI changes its fixed closure/signature/domain identity");
      if(seen.count(id)&&seen.at(id)!=identity)return proof.reject("export aliases disagree about one published ABI");
      seen[id]=identity;
    }
    return seen.size()==exported.size() || proof.reject("published function contract omitted");
  }
  bool run(){return exports()&&authorities()&&definitions()&&published();}
};
}
bool verifyDefinitionBounds(ModuleProof &proof) { return Entries{proof}.run(); }
} // namespace tsfg::finite
