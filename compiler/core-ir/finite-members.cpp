// SPDX-License-Identifier: MIT
#include "finite-module.h"
#include "finite-domain.h"
#include "finite-constructor-writes.h"
#include "reference-contracts.h"
#include "dialect.h"
#include <algorithm>
#include <tuple>

namespace tsfg::finite {
namespace {
using Pair = std::pair<std::string,std::string>;
struct Members { std::map<std::string,const Object *> fields, methods; };
struct MemberProof {
  ModuleProof &proof;
  std::map<std::string,Members> cache;
  std::map<Pair,Json> views;
  std::map<std::string,const Object *> declarations;
  std::map<std::string,std::string> fieldOwners;
  std::set<Pair> relations;
  referenceContracts::Types logicalTypes;
  std::map<std::string,std::set<mlir::Operation *>> constructorStores;
  std::vector<std::string> lineage(std::string type) {
    std::vector<std::string> result; std::set<std::string> seen;
    while (!type.empty()) {
      if (!proof.charge() || !proof.catalog.count(type) || !seen.insert(type).second) return {};
      result.push_back(type); type = string(*proof.catalog.at(type),"base");
    }
    std::reverse(result.begin(),result.end());
    return result;
  }
  bool members(const std::string &id) {
    if (cache.count(id)) return true;
    const auto path = lineage(id); if (path.empty()) return proof.reject("member inheritance cycle/type"); Members result;
    for (const auto &type : path) {
      const auto &row = *proof.catalog.at(type); const auto *fields = row.getArray("fields"), *methods = row.getArray("methods");
      // The owned catalogue omits methods when the declaration has none.
      if (!fields || (row.get("methods") && !methods)) return proof.reject("nominal member catalogue");
      for (const auto &field : *fields) { if (!proof.charge()) return false; const auto *f = field.getAsObject();
        if (!f || !result.fields.emplace(string(*f,"id"),f).second) return proof.reject("duplicate physical field identity"); }
      if (methods) for (const auto &method : *methods) {
        if (!proof.charge() || !method.getAsString() || !proof.callable.count(method.getAsString()->str())) return proof.reject("missing owned method callable");
        const auto *fn = proof.callable.at(method.getAsString()->str());
        if (string(*fn,"ownerType") != type || string(*fn,"role") != "function") return proof.reject("method owner/role");
        const auto overridden = string(*fn,"overrideTarget");
        if (!overridden.empty() && !result.methods.erase(overridden)) return proof.reject("override target is not an inherited effective method");
        result.methods.emplace(string(*fn,"id"),fn);
      }
    }
    cache.emplace(id,std::move(result)); return true;
  }
  std::string implementation(const std::string &actual, const std::string &member) {
    if (!members(actual)) return {};
    std::string selected;
    for (const auto &[id,fn] : cache.at(actual).methods) {
      const Object *current = fn; std::set<std::string> visited;
      while (current) {
        if (!proof.charge() || !visited.insert(string(*current,"id")).second) return {};
        if (string(*current,"id") == member) { if (!selected.empty()) return {}; selected=id; break; }
        const auto next = proof.callable.find(string(*current,"overrideTarget")); current = next == proof.callable.end() ? nullptr : next->second;
      }
    }
    return selected;
  }
  bool logicalCatalogue() {
    if(!logicalTypes.empty())return true;
    for(const auto &[id,row]:proof.catalog) {
      if(!proof.charge())return false;referenceContracts::Type type;
      type.kind=string(*row,"kind");type.element=string(*row,"elementType");type.base=string(*row,"base");
      if(const auto *members=row->getArray("members"))for(const auto &m:*members){if(!proof.charge()||!m.getAsString())return false;type.members.push_back(m.getAsString()->str());}
      logicalTypes.emplace(id,std::move(type));
    }return true;
  }
  bool logical(const std::string &from,const std::string &to,const std::set<Pair> &available,std::set<Pair> &used,bool allowNominal=false) {
    if(!logicalCatalogue())return false;std::string error;
    const bool result=referenceContracts::logical(logicalTypes,from,to,available,used,
      [&](size_t n){return proof.charge(n);},error,{false,false,allowNominal});
    if(!error.empty())return proof.reject(error);return result;
  }
  referenceContracts::Members memberModel(const Members &members) {
    referenceContracts::Members result;
    for(const auto &[id,f]:members.fields){if(!proof.charge(f->getString("name").value_or("").size()/8+1))return {};result.emplace(id,referenceContracts::Member{"field",string(*f,"name"),string(*f,"type")});}
    for(const auto &[id,f]:members.methods){
      if(!proof.charge(f->getString("name").value_or("").size()/8+1))return {};referenceContracts::Member method;method.kind="method";method.name=string(*f,"name");method.result=string(*f,"returnType");
      const auto &parameters=*f->getArray("parameters");
      for(size_t i=1;i<parameters.size();++i){if(!proof.charge())return {};method.parameters.push_back(string(*parameters[i].getAsObject(),"type"));}
      result.emplace(id,std::move(method));
    }return result;
  }
  bool declarationTypes() {
    bool presence=false;for(const auto &[id,row]:proof.catalog)if(const auto *fields=row->getArray("fields"))for(const auto &value:*fields) {
      if(!proof.charge())return false;const auto *field=value.getAsObject();if(!field)return proof.reject("field declaration");
      declarations.emplace(string(*field,"id"),field);fieldOwners.emplace(string(*field,"id"),id);presence|=field->get("propertyPresence")!=nullptr;
    }
    if(!presence)return true;
    const auto leaves=[&](const std::string &id,std::set<std::string> &out) {
      std::vector<std::string> todo{id};std::set<std::string> seen;
      while(!todo.empty()){if(!proof.charge())return false;const auto current=todo.back();todo.pop_back();
        if(!seen.insert(current).second)continue;if(!proof.catalog.count(current))return proof.reject("unknown declared field type");
        const auto &type=*proof.catalog.at(current);if(string(type,"kind")=="union")for(const auto &member:*type.getArray("members")){
          if(!proof.charge()||!member.getAsString())return false;todo.push_back(member.getAsString()->str());}
        else out.insert(current);}
      return true;
    };
    for(const auto &[id,field]:declarations) {
      const auto *p=field->getObject("propertyPresence");std::set<std::string> read,declared;
      if(!p||p->size()!=3||!p->getBoolean("optional")||!leaves(string(*field,"type"),read)||!leaves(string(*p,"declaredType"),declared))
        return proof.reject("optional declaration/read relation");
      if(*p->getBoolean("optional"))declared.insert(hash(std::string("tsfg.type\0undefined",19)));
      if(read!=declared)return proof.reject("optional read type is not declared type plus native undefined");
      const auto *question=p->get("questionTokenRange");
      if(!question)return proof.reject("missing question-token anchor");
      if(!*p->getBoolean("optional")){if(!question->getAsNull())return proof.reject("required field has optional token");continue;}
      const auto *q=question->getAsObject(),*origin=field->getObject("origin");uint32_t start=0,end=0,begin=0,finish=0;
      if(!q||q->size()!=2||!origin||!unsignedInteger(*q,"start",start)||!unsignedInteger(*q,"end",end)||end!=start+1||
          !unsignedInteger(*origin,"start",begin)||!unsignedInteger(*origin,"end",finish)||start<begin||end>finish)return proof.reject("optional token lies outside original field");
      bool found=false;
      for(const auto &source:*proof.sources.getAsArray())if(string(*source.getAsObject(),"path")==string(*origin,"source")) {
        const auto text=source.getAsObject()->getString("content");size_t at=0;uint32_t offset=0,point=0;
        while(text&&at<text->size()&&offset<=start){if(!proof.charge()||!arrays::ownerproof::jsondetail::nextUtf8(*text,at,point))return false;
          if(offset==start)found=point=='?';offset+=point>65535?2:1;}
      }
      if(!found)return proof.reject("optional token differs from original source");
    }
    return true;
  }
  std::string namedField(const std::string &actual,const std::string &name) {
    const auto path=lineage(actual);for(auto owner=path.rbegin();owner!=path.rend();++owner)
      for(const auto &value:*proof.catalog.at(*owner)->getArray("fields")) {
        if(!proof.charge())return {};const auto &field=*value.getAsObject();if(string(field,"name")==name)return string(field,"id");}
    return {};
  }
  bool relation(const Object &compatibility, const std::set<Pair> &dependencies,const llvm::json::Array *missing) {
    const auto source=string(compatibility,"sourceType"),target=string(compatibility,"targetType");
    if (!members(source) || !members(target) || compatibility.getBoolean("assignable") != true) return proof.reject("member proof pair/assignability");
    const auto *pairs=compatibility.getArray("members"); if (!pairs || pairs->size()>512) return proof.reject("member proof count");
    if(!logicalCatalogue())return false;std::vector<Pair> mapping;std::set<std::string> targets;std::string previous;
    for(const auto &value:*pairs){if(!proof.charge())return false;const auto *pair=value.getAsObject();
      if(!pair||pair->size()!=2)return proof.reject("member proof fields");mapping.emplace_back(string(*pair,"source"),string(*pair,"target"));}
    previous.clear();if(missing)for(const auto &value:*missing) {
      if(!proof.charge()||!value.getAsString())return proof.reject("missing optional member identity");const auto id=value.getAsString()->str();
      if((!previous.empty()&&id<=previous)||!targets.insert(id).second||!cache.at(target).fields.count(id))return proof.reject("missing member coverage/order");previous=id;
      const auto &field=*cache.at(target).fields.at(id);const auto *p=field.getObject("propertyPresence");
      if(!p||p->getBoolean("optional")!=true||!namedField(source,string(field,"name")).empty())return proof.reject("missing member is not independently absent optional");
    }
    auto sourceModel=memberModel(cache.at(source)),targetModel=memberModel(cache.at(target));if(proof.failed)return false;
    std::string error;const bool result=referenceContracts::verifyMembers(logicalTypes,sourceModel,targetModel,mapping,dependencies,targets,
      [&](size_t n){return proof.charge(n);},error);
    return result?true:proof.failed?false:proof.reject(error);
  }
  bool project(const Object &compatibility,const llvm::json::Array *missing) {
    const auto source=string(compatibility,"sourceType"),target=string(compatibility,"targetType");
    for (const auto &[actual,row] : proof.catalog) if (string(*row,"kind")=="reference") {
      const auto path=lineage(actual); if (!proof.remaining) return false;
      if (std::find(path.begin(),path.end(),source)==path.end()) continue;
      if (!members(actual)) return false;
      std::map<std::string,std::string> fields,methods;std::set<std::string> absent;bool unresolved=false;
      for (const auto &value : *compatibility.getArray("members")) {
        if (!proof.charge()) return false;const auto &pair=*value.getAsObject();const auto a=string(pair,"source"),b=string(pair,"target");
        if (cache.at(source).fields.count(a)) {if (!cache.at(actual).fields.count(a)) return proof.reject("actual field disappeared");fields[b]=a;}
        else {const auto selected=implementation(actual,a);if (selected.empty()) return proof.reject("missing actual callable implementation");methods[b]=selected;}
      }
      if(missing)for(const auto &value:*missing) {
        if(!proof.charge())return false;const auto id=value.getAsString()->str();const auto &targetField=*cache.at(target).fields.at(id);
        const auto selected=namedField(actual,string(targetField,"name"));
        if(selected.empty())absent.insert(id);
        else {std::set<Pair> used;if(!logical(string(*cache.at(actual).fields.at(selected),"type"),string(targetField,"type"),relations,used,true))unresolved=true;
          else fields[id]=selected;}
      }
      if(unresolved)continue;
      const auto pairs=[](const std::map<std::string,std::string> &values){llvm::json::Array result;
        for(const auto &[target,source]:values)result.emplace_back(Object{{"source",source},{"target",target}});return result;};
      std::map<std::string,Json> fieldRows;for(const auto &[target,source]:fields)fieldRows.emplace(target,Object{{"source",source},{"target",target}});
      for(const auto &target:absent)fieldRows.emplace(target,Object{{"target",target},{"missing",true}});
      llvm::json::Array projected;for(auto &[target,row]:fieldRows)projected.push_back(std::move(row));
      Json result=Object{{"actualType",actual},{"targetType",target},{"fields",std::move(projected)},{"methods",pairs(methods)}};
      const auto prior=views.find({actual,target}); std::string a,b;
      if (prior!=views.end() && (!canonical(prior->second,a)||!canonical(result,b)||a!=b)) return proof.reject("ambiguous same actual/static member map");
      views.insert_or_assign({actual,target},std::move(result));
      if (views.size()>4096) return proof.reject("member view count");
    }
    return true;
  }
  std::string selectedMember(const std::string &actual, const std::string &view, const std::string &member, bool method) {
    if (!members(actual)) return {};
    if (method) { const auto direct=implementation(actual,member); if (!direct.empty()) return direct; }
    else if (cache.at(actual).fields.count(member)) return member;
    const auto found=views.find({actual,view}); if(found==views.end())return {};
    const auto *pairs=found->second.getAsObject()->getArray(method?"methods":"fields");
    for(const auto &value:*pairs) {if(!proof.charge())return {};const auto &pair=*value.getAsObject();if(string(pair,"target")==member)return string(pair,"source");}
    return {};
  }
  bool missingMember(const std::string &actual,const std::string &view,const std::string &member) {
    const auto found=views.find({actual,view});if(found==views.end())return false;
    for(const auto &value:*found->second.getAsObject()->getArray("fields")) {
      if(!proof.charge())return false;const auto &pair=*value.getAsObject();
      if(string(pair,"target")==member)return pair.getBoolean("missing")==true;
    }return false;
  }
  std::string sourceView(mlir::Value value) {
    if(!proof.charge())return {};
    if(auto *definition=value.getDefiningOp()) {
      if(const auto view=definition->getAttrOfType<mlir::StringAttr>("view_type")) {
        if(proof.catalog.count(view.getValue().str()))return view.getValue().str();return {};
      }
      if(llvm::isa<mlir::func::CallOp>(definition)) {
        const auto id=definition->getAttrOfType<mlir::StringAttr>("tsfg_core.function_id");
        const auto found=id?proof.callable.find(id.getValue().str()):proof.callable.end();
        if(found!=proof.callable.end())return string(*found->second,"returnType");
      }
    }
    if(const auto argument=llvm::dyn_cast<mlir::BlockArgument>(value)) {
      auto fn=llvm::dyn_cast<mlir::func::FuncOp>(argument.getOwner()->getParentOp());
      if(fn&&argument.getOwner()==&fn.getBody().front()) {
        const auto id=fn->getAttrOfType<mlir::StringAttr>("tsfg_core.function_id");
        const auto found=id?proof.callable.find(id.getValue().str()):proof.callable.end();
        if(found!=proof.callable.end()) {
          const auto *parameters=found->second->getArray("parameters");
          if(parameters&&argument.getArgNumber()<parameters->size())return string(*(*parameters)[argument.getArgNumber()].getAsObject(),"type");
        }
      }
    }
    const auto *domain=valueDomain(proof,value.getType());
    if(domain&&!domain->native.empty())return hash(std::string("tsfg.type\0",10)+domain->native);
    return {};
  }
  bool constructorStore(mlir::Operation *op,const std::string &view,const std::string &member) {
    auto fn=op->getParentOfType<mlir::func::FuncOp>();
    const auto identity=fn?fn->getAttrOfType<mlir::StringAttr>("tsfg_core.function_id"):mlir::StringAttr();
    const auto found=identity?proof.callable.find(identity.getValue().str()):proof.callable.end();
    if(found==proof.callable.end())return proof.reject("readonly write has no owned construction frame");
    const auto &frame=*found->second;const auto owner=string(frame,"ownerType");
    if(string(frame,"role")!="construction-body"||owner!=view||!proof.catalog.count(owner)||
        string(*proof.catalog.at(owner),"constructor")!=found->first||fn.getNumArguments()==0||op->getOperand(0)!=fn.getArgument(0))
      return proof.reject("readonly write requires its explicit constructor and current receiver");
    const auto *fields=proof.catalog.at(owner)->getArray("fields");bool own=false;
    if(!fields)return proof.reject("constructor own field directory");
    for(const auto &value:*fields){if(!proof.charge())return false;own|=string(*value.getAsObject(),"id")==member;}
    if(!own)return proof.reject("constructor cannot assign an inherited readonly declaration");
    constructorStores[found->first].insert(op);return true;
  }
  bool constructorPhases() {
    for(const auto &[id,stores]:constructorStores) {
      if(!proof.charge())return false;auto fn=proof.functions.at(id);const auto &frame=*proof.callable.at(id);
      const auto owner=string(frame,"ownerType"),construction=string(frame,"construction");
      const auto &nominal=*proof.catalog.at(owner);const auto *definition=nominal.getObject("construction");
      const auto *fields=nominal.getArray("fields"),*parameters=definition?definition->getArray("parameters"):nullptr;
      const auto *initialization=definition?definition->getArray("initialization"):nullptr;
      if(!fields||!parameters||!initialization||initialization->size()!=fields->size())return proof.reject("constructor initialization catalogue");
      // Independently rebuild the required commit identities from the owned
      // catalogue. A shortened producer phase cannot authorize an early write.
      std::vector<std::pair<std::string,bool>> events;std::set<std::string> own,initialized;
      for(const auto &value:*fields){if(!proof.charge())return false;own.insert(string(*value.getAsObject(),"id"));}
      for(const auto &parameter:*parameters)for(const auto &value:*fields) {
        if(!proof.charge())return false;const auto *p=parameter.getAsObject();const auto &field=*value.getAsObject();
        if(!p||string(*p,"symbol").empty())return proof.reject("constructor phase parameter identity");
        if(string(field,"parameterBinding")==string(*p,"symbol"))events.emplace_back(string(field,"id"),true);
      }
      for(const auto &value:*initialization) {
        if(!proof.charge())return false;const auto *step=value.getAsObject();const auto member=step?string(*step,"field"):std::string();
        const auto kind=step?string(*step,"kind"):std::string();
        if(!own.count(member)||!initialized.insert(member).second||
            (kind!="fieldDefine"&&kind!="fieldInitialize"&&kind!="parameterFieldInitialize"))return proof.reject("constructor phase own-member coverage");
        events.emplace_back(member,kind=="fieldDefine");
      }
      const auto binding=string(*(*frame.getArray("parameters"))[0].getAsObject(),"id");
      const auto base=string(nominal,"base");
      ConstructorWrites control(owner,binding,base,events.size(),proof.remaining);
      for(const auto &value:*fields)if(!control.field(string(*value.getAsObject(),"id"),owner))return proof.reject(control.error());
      std::map<mlir::Block *,ConstructorWrites::Id> blocks;
      for(auto &block:fn.getBody()) {
        if(!proof.charge())return false;const auto key=control.block();
        if(key==ConstructorWrites::none)return proof.reject(control.error());blocks.emplace(&block,key);
      }
      if(!control.entry(blocks.at(&fn.getBody().front())))return proof.reject(control.error());
      for(auto &block:fn.getBody()) {
        const auto key=blocks.at(&block);
        for(auto &op:block) {
          if(!proof.charge())return false;const auto name=op.getName().getStringRef();
          if(name=="tsfg_core.domain.super") {
            const auto selected=op.getAttrOfType<mlir::StringAttr>("construction");
            const auto *parent=proof.catalog.count(base)?proof.catalog.at(base)->getObject("construction"):nullptr;
            if(!parent||!selected||selected.getValue()!=string(*parent,"id")||op.getOperand(0)!=fn.getArgument(0))
              return proof.reject("readonly constructor phase has no same-receiver direct super");
            if(!control.baseComplete(key,base))return proof.reject(control.error());
          }
          if(name=="tsfg_core.domain.initialize_fields"||name=="tsfg_core.domain.field_define"||name=="tsfg_core.domain.field_initialize") {
            const auto selected=op.getAttrOfType<mlir::StringAttr>("construction");
            if(!selected||selected.getValue()!=construction||op.getOperand(0)!=fn.getArgument(0))return proof.reject("constructor write phase belongs to another frame");
            if(name=="tsfg_core.domain.initialize_fields") {if(!control.activate(key))return proof.reject(control.error());}
            else {
              const auto ordinal=op.getAttrOfType<mlir::IntegerAttr>("ordinal");const auto member=op.getAttrOfType<mlir::StringAttr>("member");
              if(!ordinal||ordinal.getInt()<0||uint64_t(ordinal.getInt())>=events.size()||!member||
                  events[ordinal.getInt()]!=std::make_pair(member.getValue().str(),name=="tsfg_core.domain.field_define"))
                return proof.reject("constructor write phase differs from owned field sequence");
              if(!control.commit(key,size_t(ordinal.getInt())))return proof.reject(control.error());
            }
          }
          if(stores.count(&op)&&!control.write(key,op.getAttrOfType<mlir::StringAttr>("member").getValue().str(),binding))
            return proof.reject(control.error());
        }
        for(auto *successor:block.getTerminator()->getSuccessors()) {
          if(!proof.charge())return false;
          if(!control.edge(key,blocks.at(successor)))return proof.reject(control.error());
        }
      }
      if(!control.solve())return proof.reject(control.error());
    }
    return true;
  }
  bool accesses() {
    bool valid=true;
    proof.module.walk([&](mlir::Operation *op){
      if(!valid)return;
      const auto name=op->getName().getStringRef();const bool method=name=="tsfg_core.domain.method_call";
      if(!method&&name!="tsfg_core.domain.field_read"&&name!="tsfg_core.domain.field_store"&&name!="tsfg_core.domain.member_present")return;
      if(!proof.charge()){valid=false;return;}
      const auto text=[&](llvm::StringRef key){const auto a=op->getAttrOfType<mlir::StringAttr>(key);return a?a.getValue().str():std::string();};
      const auto view=text("receiver_view"),member=text("member");
      if(!members(view)||(method?!cache.at(view).methods.count(member):!cache.at(view).fields.count(member))) {
        valid=proof.reject("static access member is absent from its owned receiver view");return;}
      // Source readonly is checked on the selected static member. The actual
      // cell's declaration does not deep-freeze another legal writable view.
      if(name=="tsfg_core.domain.field_store"&&cache.at(view).fields.at(member)->getBoolean("readonly")!=false) {
        if(!constructorStore(op,view,member)){valid=false;return;}}
      const auto *receiver=valueDomain(proof,op->getOperand(0).getType());
      if(!receiver||receiver->alternatives.empty()){valid=proof.reject("access has no finite actual receiver domain");return;}
      llvm::json::Array expected;bool zero=false,valued=false;std::map<std::string,std::string> authority;
      for(const auto &actual:receiver->alternatives) {
        const auto selected=selectedMember(actual,view,member,method);
        if(selected.empty()){
          if(!method&&name!="tsfg_core.domain.field_store"&&missingMember(actual,view,member)) {
            authority.emplace(actual,"");expected.emplace_back(Object{{"actualType",actual},{"missing",true},{"fieldType",hash(std::string("tsfg.type\0undefined",19))}});continue;
          }
          valid=proof.reject("actual receiver has no selected member implementation");return;}
        if(!method)authority.emplace(actual,selected);
        if(name=="tsfg_core.domain.field_store") {
          const auto &field=*cache.at(view).fields.at(member);const auto *p=field.getObject("propertyPresence");
          const auto declared=p?string(*p,"declaredType"):string(field,"type"),from=sourceView(op->getOperand(1));
          if(from.empty()){valid=proof.reject("unproved static Source assignment permission");return;}
          std::set<Pair> used;
          if(!logical(from,declared,relations,used)) {
            const auto path=lineage(from);
            if(proof.failed||std::find(path.begin(),path.end(),declared)==path.end()){valid=proof.reject("explicit field store violates declared assignment type");return;}
          }
        }
        if(method) {
          const auto &fn=*proof.callable.at(selected),&abi=*proof.abi.at(selected);
          const auto &parameters=*abi.getArray("parameters");const auto *result=abi.get("result");
          if(parameters.size()>op->getNumOperands()||parameters.empty()||
             !proof.domains.count(parameters[0].getAsString()->str())) {valid=proof.reject("method dispatch ABI arity");return;}
          const auto &bound=proof.domains.at(parameters[0].getAsString()->str());
          if(std::find(bound.alternatives.begin(),bound.alternatives.end(),actual)==bound.alternatives.end()) {
            valid=proof.reject("dispatch arm cannot preserve its selected actual receiver");return;}
          for(size_t i=1;i<parameters.size();++i) {
            if(!proof.charge()){valid=false;return;}const auto *input=valueDomain(proof,op->getOperand(i).getType());
            const auto &target=proof.domains.at(parameters[i].getAsString()->str());
            if(!input||!std::includes(target.alternatives.begin(),target.alternatives.end(),input->alternatives.begin(),input->alternatives.end())) {
              valid=proof.reject("method argument would lose a payload alternative");return;}
          }
          if(result->kind()==Json::Null)zero=true;
          else {valued=true;const auto *output=op->getNumResults()==1?valueDomain(proof,op->getResult(0).getType()):nullptr;
            const auto &target=proof.domains.at(result->getAsString()->str());
            if(!output||!std::includes(output->alternatives.begin(),output->alternatives.end(),target.alternatives.begin(),target.alternatives.end())) {
              valid=proof.reject("method result would discard an actual return alternative");return;}}
          expected.emplace_back(Object{{"actualType",actual},{"functionId",selected},{"signatureHash",string(fn,"signatureHash")},{"abi",string(abi,"id")}});
        } else expected.emplace_back(Object{{"actualType",actual},{"fieldId",selected},{"fieldType",string(*cache.at(actual).fields.at(selected),"type")}});
      }
      if(method&&(zero&&valued||(zero?op->getNumResults()!=0:op->getNumResults()!=1))) {valid=proof.reject("method dispatch void/value ABI disagreement");return;}
      Json given=nullptr;std::string encoded;
      if(!arrays::ownerproof::parseCanonical(text(method?"dispatch":"field_dispatch")+"\n",given)||!canonical(std::move(expected),encoded)||encoded!=text(method?"dispatch":"field_dispatch"))
        valid=proof.reject("access dispatch differs from exact actual/member authority");
      if(valid&&!method)proof.memberFields.emplace(op,std::move(authority));
    });
    return valid&&constructorPhases();
  }
};
}
bool verifyMemberContracts(ModuleProof &proof) {
  MemberProof members{proof}; const auto *rows=proof.witnesses.getAsArray();if (!rows || rows->size()>100000) return proof.reject("member witness directory");
  if(!members.declarationTypes())return false;
  using Key=std::tuple<std::string,uint32_t,uint32_t,std::string,std::string>;
  std::map<Key,std::set<Pair>> directory;std::optional<Key> previous;
  for(const auto &value:*rows) {
    const auto *row=value.getAsObject();const auto *c=row?row->getObject("compatibility"):nullptr;
    const auto *origin=c?c->getObject("origin"):nullptr;const auto *deps=row?row->getArray("dependencies"):nullptr;uint32_t start=0,end=0;
    if(!proof.charge()||!row||row->size()!=(row->get("missingOptionalProperties")?3u:2u)||!c||!origin||!deps||!unsignedInteger(*origin,"start",start)||!unsignedInteger(*origin,"end",end)||
       !proof.sourceLengths.count(string(*origin,"source"))||start>end||end>proof.sourceLengths.at(string(*origin,"source"))) return proof.reject("member proof original anchor");
    const Key key{string(*origin,"source"),start,end,string(*c,"sourceType"),string(*c,"targetType")};
    if(previous && *previous>=key)return proof.reject("member proof directory order");previous=key;
    std::set<Pair> selected;std::optional<Pair> prior;
    for(const auto &d:*deps){const auto *dep=d.getAsObject();if(!dep||dep->size()!=2||!proof.charge())return proof.reject("member dependency fields");
      const Pair p{string(*dep,"sourceType"),string(*dep,"targetType")};if(prior && *prior>=p)return proof.reject("member dependency order");prior=p;selected.insert(p);}
    if(row->get("missingOptionalProperties")&&!row->getArray("missingOptionalProperties"))return proof.reject("missing member list shape");
    if(!members.relation(*c,selected,row->getArray("missingOptionalProperties")))return false;
    members.relations.emplace(string(*c,"sourceType"),string(*c,"targetType"));directory.emplace(key,std::move(selected));
  }
  std::string closureError;
  if(!referenceContracts::closeDirectory(directory,[&](size_t n){return proof.charge(n);},closureError))
    return proof.failed?false:proof.reject(closureError);
  for(const auto &value:*rows)if(!members.project(*value.getAsObject()->getObject("compatibility"),value.getAsObject()->getArray("missingOptionalProperties")))return false;
  llvm::json::Array methods,views;
  for(const auto &[id,fn]:proof.callable) {
    const auto owner=string(*fn,"ownerType");if(owner.empty()||string(*proof.catalog.at(owner),"kind")!="reference"||string(*fn,"role")!="function")continue;
    methods.emplace_back(Object{{"id",id},{"ownerType",owner},{"signatureHash",string(*fn,"signatureHash")},{"overrideTarget",*fn->get("overrideTarget")}});
  }
  for(const auto &[key,value]:members.views)views.push_back(value);
  const auto input=proof.module->getAttrOfType<mlir::StringAttr>("tsfg_core.input_identity");
  Object expected{{"family","tsfg.typed-reference-view-development"},{"version",1},{"inputIdentity",input.getValue().str()},{"methods",std::move(methods)},{"views",std::move(views)}};
  llvm::json::Array declarations;
  for(const auto &[id,field]:members.declarations)if(const auto *p=field->getObject("propertyPresence")) {
    const auto owner=members.fieldOwners.at(id);if(!proof.charge())return false;
    declarations.emplace_back(Object{{"id",id},{"ownerType",owner},{"name",string(*field,"name")},{"type",string(*field,"type")},
      {"declaredType",string(*p,"declaredType")},{"optional",*p->getBoolean("optional")}});
  }
  if(!declarations.empty()||(members.declarations.empty()&&proof.views.getAsObject()&&proof.views.getAsObject()->getInteger("version")==2)) {
    expected["version"]=2;expected["declarations"]=std::move(declarations);
  }
  std::string a,b;
  if(!canonical(Json(std::move(expected)),a)||!canonical(proof.views,b)||a!=b)return proof.reject("member view table is not the selected M12 physical projection");
  return members.accesses();
}
} // namespace tsfg::finite
