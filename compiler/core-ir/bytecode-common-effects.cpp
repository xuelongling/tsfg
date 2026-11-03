// SPDX-License-Identifier: MIT
#include "bytecode-common-cold.h"
#include "common-program-methods.h"
#include <deque>

namespace tsfg::wire {
namespace {
using namespace commonProgram;using Owners=std::set<std::string>;
struct EffectState {std::vector<Owners> values;std::map<std::string,Owners> cells;};
struct EffectCatalog {
  std::map<std::string,const Json *> types,slots,logical;
  std::map<std::string,std::string> bindingOwners;
  std::map<std::string,bool> managed;
};
struct GraphEffects {
  CommonCold &cold;EffectCatalog &catalog;const commonProgram::Function &fn;const Json *logical;Effects out;
  std::set<std::string> active;std::set<std::string> hosts;
  bool step(size_t n=1){return cold.charge(n);}
  bool reference(const std::string &id){
    if(!catalog.types.count(id))return false;if(catalog.managed.count(id))return catalog.managed.at(id);
    if(!step()||!active.insert(id).second){cold.reject("Common effect inline type cycle/work");return false;}
    const auto &row=*catalog.types.at(id);const auto kind=string(field(row,"kind"));bool result=kind=="reference"||kind=="array"||kind=="readSpan"||kind=="string"||kind=="unknown";
    if(kind=="union")for(const auto &member:items(field(row,"members"))){if(!step())return false;result|=reference(string(member));}
    if(kind=="value")for(const auto &fieldRow:items(field(row,"fields"))){if(!step())return false;result|=reference(string(field(fieldRow,"type")));}
    active.erase(id);return catalog.managed[id]=result;
  }
  Owners copy(const Owners &value){if(!step(value.size()+1))return {};return value;}
  bool merge(Owners &a,const Owners &b){if(!step(b.size()+1))return false;const auto size=a.size();a.insert(b.begin(),b.end());return a.size()!=size;}
  void mark(const Owners &owners,unsigned access){
    for(const auto &owner:owners){if(!step())return;const llvm::StringRef ref(owner);
      if(ref.starts_with("g:")){(access?out.writes:out.reads).insert(owner.substr(2));}
      else if(ref.starts_with("c:")){auto &value=out.captures[owner.substr(2)];if(!access)value.read=true;else if(access==1)value.write=true;else value.structural=true;}
      else if(ref.starts_with("p:")){unsigned index;if(ref.drop_front(2).getAsInteger(10,index)||index>=out.parameters.size()){cold.reject("Common effect parameter owner index");return;}
        auto &value=out.parameters[index];if(!access)value.read=true;else if(access==1)value.write=true;else value.structural=true;}
    }
  }
  bool consume(const std::string &id,const std::vector<Owners> &arguments){
    if(!step())return false;const auto found=cold.model.fixedEffects.find(id);if(found==cold.model.fixedEffects.end())return cold.reject("Common fixed graph callee has no original contract");
    const auto &upper=found->second;out.calls.insert(id);
    if(!step(upper.reads.size()+upper.writes.size()+upper.hostReads.size()+upper.hostWrites.size()+upper.parameters.size()+upper.captures.size()))return false;
    out.reads.insert(upper.reads.begin(),upper.reads.end());out.writes.insert(upper.writes.begin(),upper.writes.end());
    out.hostReads.insert(upper.hostReads.begin(),upper.hostReads.end());out.hostWrites.insert(upper.hostWrites.begin(),upper.hostWrites.end());
    out.allocation|=upper.allocation;out.managedReference|=upper.managedReference;out.ehControl|=upper.ehControl;
    out.await|=upper.await;out.lock|=upper.lock;out.escape|=upper.escape;out.unknownHost|=upper.unknownHost;
    for(const auto &[slot,value]:upper.captures){auto &given=out.captures[slot];given.read|=value.read;given.write|=value.write;given.structural|=value.structural;}
    if(upper.parameters.size()!=arguments.size())return cold.reject("Common fixed graph argument-owner arity");
    for(size_t i=0;i<arguments.size();++i){if(upper.parameters[i].read)mark(arguments[i],0);if(upper.parameters[i].write)mark(arguments[i],1);if(upper.parameters[i].structural)mark(arguments[i],2);}
    return cold.tables.error.message.empty();
  }
  std::string view(uint16_t reg)const{return cold.model.registerViews.at(fn.id)[reg];}
  bool run(){
    // Dependency identity covers every actual Host instruction; its effect
    // permission below follows language completion reachability separately.
    for(const auto &block:fn.blocks)for(const auto &op:block.operations){if(!step())return false;if(op.name=="host_call")hosts.insert(string(field(op.properties,"host_id")));}
    EffectState initial;initial.values.resize(fn.carriers.size());size_t offset=0;
    if(logical){
      if(!field(*logical,"activationEnvironment").getAsNull())out.allocation=out.managedReference=true;
      if(!field(*logical,"lexicalEnvironment").getAsNull()){out.managedReference=true;++offset;}
      std::vector<std::pair<std::string,std::string>> parameters;
      if(!field(*logical,"ownerType").getAsNull())parameters.emplace_back(string(field(*logical,"receiverBinding")),string(field(*logical,"ownerType")));
      for(const auto &p:items(field(*logical,"parameters")))parameters.emplace_back(string(field(p,"id")),string(field(p,"type")));
      out.parameters.resize(parameters.size());
      for(size_t i=0;i<parameters.size();++i){if(!step())return false;if(reference(parameters[i].second)){
        const Owners owner{"p:"+std::to_string(i)};initial.cells[parameters[i].first]=copy(owner);initial.values[fn.blocks[0].parameters[offset+i]]=copy(owner);out.managedReference=true;
      }}
      out.managedReference|=reference(string(field(*logical,"returnType")));
    }
    std::map<uint16_t,EffectState> entries;entries.emplace(0,std::move(initial));std::deque<uint16_t> pending{0};std::set<uint16_t> queued{0};
    const auto edge=[&](uint16_t target,const EffectState &state,const std::vector<Owners> &arguments){
      size_t cost=state.values.size()+state.cells.size()+arguments.size()+1;for(const auto &v:state.values)cost+=v.size();for(const auto &[id,v]:state.cells)cost+=v.size();
      if(!step(cost))return false;auto incoming=state;const auto &parameters=fn.blocks[target].parameters;
      if(parameters.size()!=arguments.size())return cold.reject("Common effect graph edge arity");
      for(size_t i=0;i<arguments.size();++i)incoming.values[parameters[i]]=arguments[i];
      auto old=entries.find(target);bool changed=old==entries.end();if(changed)entries.emplace(target,std::move(incoming));else{
        for(size_t i=0;i<incoming.values.size();++i)changed|=merge(old->second.values[i],incoming.values[i]);
        for(const auto &[id,value]:incoming.cells)changed|=merge(old->second.cells[id],value);
      }if(changed&&queued.insert(target).second)pending.push_back(target);return cold.tables.error.message.empty();
    };
    while(!pending.empty()){
      if(!step())return false;const auto block=pending.front();pending.pop_front();queued.erase(block);const auto &saved=entries.at(block);
      size_t cost=saved.values.size()+saved.cells.size()+1;for(const auto &v:saved.values)cost+=v.size();for(const auto &[id,v]:saved.cells)cost+=v.size();
      if(!step(cost))return false;auto state=saved;
      for(const auto &op:fn.blocks[block].operations){
        if(!step(op.operands.size()+1))return false;Owners result;const auto argument=[&](size_t i)->const Owners &{return state.values[op.operands[i]];};const auto name=op.name;
        if(op.result!=commonProgram::noRegister)out.managedReference|=reference(view(op.result));
        if(name=="load"||name=="env_load"){
          const auto id=string(field(op.properties,"binding"));if(name=="env_load"&&catalog.bindingOwners.at(id)!=fn.id){
            const auto key=string(field(*catalog.slots.at(id),"key"));out.captures[key].read=true;if(reference(op.view))result.insert("c:"+key);
          }else result=copy(state.cells[id]);
        }else if(name=="store"||name=="env_init"||name=="env_store"){
          const auto id=string(field(op.properties,"binding"));const bool initialize=name=="env_init"||field(op.properties,"initialize").getAsBoolean()==true;
          if(name=="env_store"&&catalog.bindingOwners.at(id)!=fn.id){const auto key=string(field(*catalog.slots.at(id),"key"));out.captures[key].write=true;mark(Owners{"c:"+key},1);}
          else if(!initialize)mark(state.cells[id],1);state.cells[id]=copy(argument(1));
        }else if(name=="global_load"){const auto id=string(field(op.properties,"global"));out.reads.insert(id);result.insert("g:"+id);}
        else if(name=="global_store"){const auto id=string(field(op.properties,"global"));out.writes.insert(id);}
        else if(name=="field_load"||name=="array_read"||name=="array_length"||name=="readspan_length"){
          result=copy(argument(0));mark(result,0);
        }else if(name=="field_store"){
          if(field(op.properties,"initialize").getAsBoolean()!=true)mark(argument(0),1);
        }else if(name=="array_store"||name=="array_resize"){mark(argument(0),1);mark(argument(0),2);}
        else if(name=="view"||name=="carrier_cast"||name=="value_copy"||name=="assert"||name=="pack"||name=="readspan")result=copy(argument(0));
        else if(name=="array_create"||name=="allocate_reference"||name=="construct_value"){
          if(name!="construct_value")out.allocation=out.managedReference=true;result.insert("local:"+fn.id+"/"+std::to_string(block)+"/"+std::to_string(&op-fn.blocks[block].operations.data()));
        }else if(name=="env_alloc"){out.allocation=out.managedReference=true;}
        else if(name=="string"||name=="binary"&&reference(op.view)&&catalog.types.count(op.view)&&string(field(*catalog.types.at(op.view),"kind"))=="string"){
          // A literal is an immutable constant; concatenation allocates.
          if(name=="binary")out.allocation=out.managedReference=true;
        }else if(name=="host_call"){
          out.hostReads.insert(cold.model.hostResources.begin(),cold.model.hostResources.end());out.hostWrites.insert(cold.model.hostResources.begin(),cold.model.hostResources.end());
        }else if(name=="enter_handler"||name=="finally_enter")out.ehControl=true;
        if(name=="pack")out.ehControl=true;
        if(op.result!=commonProgram::noRegister)state.values[op.result]=std::move(result);
        if(name=="invoke"||name=="invoke_method"||name=="invoke_indirect"){
          std::vector<std::string> targets;bool top=false;size_t hidden=0;
          if(name=="invoke")targets.push_back(string(field(op.properties,"function_id")));
          else if(name=="invoke_method"){
            cold.model.remaining=cold.tables.remaining;
            const bool valid=methodTargets(cold.model,field(op.properties,"dispatch"),targets,cold.failure);
            cold.tables.remaining=cold.model.remaining;
            if(!valid)return cold.reject(cold.failure.message);
          }
          else{const auto &site=cold.model.callableSites.at(fn.id+"/"+std::to_string(op.range.start)+":"+std::to_string(op.range.end));targets.assign(site.functions.begin(),site.functions.end());top=site.top;hidden=1;}
          bool throwing=top;Owners returned;
          for(const auto &target:targets){
            if(!step())return false;const auto &upper=cold.model.fixedEffects.at(target);size_t offset=hidden;
            if(name=="invoke"){const auto source=catalog.logical.find(target);if(source!=catalog.logical.end())offset=!field(*source->second,"lexicalEnvironment").getAsNull();}
            std::vector<Owners> arguments;for(size_t i=offset;i<op.operands.size();++i)arguments.push_back(copy(argument(i)));
            if(!consume(target,arguments))return false;throwing|=upper.mayThrow;returned.insert("unknown:"+target);
          }
          if(top){out.unknownHost=true;returned.insert("unknown:indirect");}
          std::vector<Owners> normal;if(!fn.blocks[op.successors[0]].parameters.empty())normal.push_back(returned);
          if(!edge(op.successors[0],state,normal)||throwing&&!edge(op.successors[1],state,{Owners{"unknown:exception"}}))return false;
        }else if(name=="cf.br"||name=="route"){
          std::vector<Owners> arguments;for(auto operand:op.operands)arguments.push_back(copy(state.values[operand]));if(!edge(op.successors[0],state,arguments))return false;
        }else if(name=="cf.cond_br"){
          const auto count=fn.blocks[op.successors[0]].parameters.size();std::vector<Owners> yes,no;
          for(size_t i=1;i<op.operands.size();++i)(i<=count?yes:no).push_back(copy(argument(i)));
          if(!edge(op.successors[0],state,yes)||!edge(op.successors[1],state,no))return false;
        }else if(name=="numeric_use"){if(!edge(op.successors[0],state,{Owners{}}))return false;}
        else if(name=="return_throw")out.mayThrow=true;
        else if(name=="func.return"&&!op.operands.empty()&&logical&&reference(string(field(*logical,"returnType"))))out.escape=true;
        if(!cold.tables.error.message.empty())return false;
      }
    }return true;
  }
};
bool contained(CommonCold &cold,const Effects &given,const Effects &actual){
  const auto subset=[&](const auto &a,const auto &b){for(const auto &v:a)if(!cold.charge()||!b.count(v))return false;return true;};
  const auto access=[](const Access &a,const Access &b){return (!a.read||b.read)&&(!a.write||b.write)&&(!a.structural||b.structural);};
  if(!subset(actual.reads,given.reads)||!subset(actual.writes,given.writes)||!subset(actual.hostReads,given.hostReads)||!subset(actual.hostWrites,given.hostWrites)||
    actual.parameters.size()!=given.parameters.size()||(actual.allocation&&!given.allocation)||(actual.managedReference&&!given.managedReference)||
    (actual.ehControl&&!given.ehControl)||(actual.mayThrow&&!given.mayThrow)||(actual.await&&!given.await)||(actual.lock&&!given.lock)||(actual.escape&&!given.escape)||(actual.unknownHost&&!given.unknownHost))return cold.reject("Common normalized graph exceeds original fixed upper");
  for(size_t i=0;i<actual.parameters.size();++i)if(!cold.charge()||!access(actual.parameters[i],given.parameters[i]))return cold.reject("Common normalized parameter effects exceed original fixed upper");
  for(const auto &[slot,value]:actual.captures){if(!cold.charge())return false;const auto upper=given.captures.find(slot);if(upper==given.captures.end()||!access(value,upper->second))return cold.reject("Common normalized capture effects exceed original fixed upper");}
  return true;
}
}
bool CommonCold::effects(){
  // Ordinary programs retain their existing transfer and budget path.
  const auto text=[&](llvm::StringRef value){return !containsReceiverProtocol||charge(value.size()/8+1);};
  const auto lookup=[&](size_t count,llvm::StringRef key){
    size_t depth=1;for(auto n=count;n;n>>=1){if(!charge())return false;depth+=2;}return charge(depth*(key.size()/8+1));
  };
  // These verified immutable directories and pure type classifications are
  // shared by all graph walks; function-local owner/CFG states remain private.
  EffectCatalog catalog;
  for(const auto &row:items(field(model.hir,"types"))){if(!charge()||!text(field(row,"id").getAsString().value())||containsReceiverProtocol&&!lookup(catalog.types.size(),field(row,"id").getAsString().value()))return false;catalog.types.emplace(string(field(row,"id")),&row);}
  for(const auto &env:items(field(model.hir,"environments")))for(const auto &slot:items(field(env,"slots"))){if(!charge()||!text(field(slot,"binding").getAsString().value())||containsReceiverProtocol&&!lookup(catalog.slots.size(),field(slot,"binding").getAsString().value()))return false;catalog.slots.emplace(string(field(slot,"binding")),&slot);}
  for(const auto &binding:*tables.bindings){if(!charge())return false;if(!field(binding,"scope").getAsNull()){
    if(containsReceiverProtocol){const auto id=field(binding,"id").getAsString().value();const auto &owner=model.functions[size_t(*field(binding,"owner").getAsInteger())].id;
      if(!text(id)||!text(owner)||!lookup(catalog.bindingOwners.size(),id))return false;catalog.bindingOwners.emplace(id.str(),owner);
    }else catalog.bindingOwners.emplace(string(field(binding,"id")),function(uint32_t(*field(binding,"owner").getAsInteger())));
  }}
  for(const auto &fn:items(field(model.hir,"functions"))){if(!charge()||!text(field(fn,"id").getAsString().value())||containsReceiverProtocol&&!lookup(catalog.logical.size(),field(fn,"id").getAsString().value()))return false;catalog.logical.emplace(string(field(fn,"id")),&fn);}
  if(containsReceiverProtocol){
    for(const auto &fn:model.functions){
      if(!charge()||!lookup(catalog.logical.size(),fn.id))return false;
      if(fn.role!="module-initializer"){
        if(!catalog.logical.count(fn.id))return reject("Common receiver effects lack a complete owned declared function interface");
      }else{
        // There is no declared Source-function row for module initialization.
        // Keep its ordinary transfer; never manufacture a row for this API.
        for(const auto &carrier:fn.carriers){if(!charge()||!text(carrier))return false;const auto kind=llvm::StringRef(carrier);
          if(kind.starts_with("receiver:")||kind.starts_with("initialization:"))return reject("Common module receiver effects lack an owned normalized projection interface");}
        for(const auto &block:fn.blocks)for(const auto &op:block.operations){if(!charge()||!text(op.name))return false;const auto name=llvm::StringRef(op.name);
          if(name.starts_with("receiver_")||name.starts_with("initialize_"))return reject("Common module receiver operations lack an owned normalized projection interface");}
      }
    }
  }
  const auto &dependencies=items(field(field(tables.program.table(Table::Authority),"fixedPublication"),"dependencies"));
  // This is per-invocation completion state, not an authority/cache directory.
  if(containsReceiverProtocol&&!charge(model.functions.size()+1))return false;
  std::vector<ProjectedReturnEffects> projections(containsReceiverProtocol?model.functions.size():0,ProjectedReturnEffects::Open);
  for(size_t i=0;i<model.functions.size();++i){
    const auto &fn=model.functions[i];if(containsReceiverProtocol&&!lookup(catalog.logical.size(),fn.id))return false;
    GraphEffects graph{*this,catalog,fn,catalog.logical.count(fn.id)?catalog.logical.at(fn.id):nullptr};
    if(containsReceiverProtocol&&graph.logical){
      // interfaces() joined this logical declaration to the fixed scope. Admit
      // only its independently joined, same-type normalized raw entry here.
      if(!charge(18)||!lookup(model.registerViews.size(),fn.id))return false;
      const auto &abi=(*tables.abis)[i],&logical=*graph.logical;
      const auto &parameters=items(field(logical,"parameters")),&refs=items(field(abi,"parameters")),&rawTypes=items(field(abi,"argumentTypes"));
      const auto &physical=items(field(items(field(model.representation,"functions"))[i],"parameters"));
      const auto &entry=fn.blocks[0].parameters;const auto views=model.registerViews.find(fn.id);
      if(!text(fn.signature)||!text(field(abi,"signature").getAsString().value())||!text(field(logical,"signatureHash").getAsString().value()))return false;
      if(field(abi,"function").getAsInteger()!=int64_t(i)||field(abi,"signature").getAsString()!=fn.signature||field(logical,"signatureHash").getAsString()!=fn.signature||
          parameters.size()!=refs.size()||refs.size()!=rawTypes.size()||entry.size()!=physical.size()||views==model.registerViews.end()||views->second.size()!=fn.carriers.size())
        return reject("Common receiver normalized formal entry inventory differs");
      size_t argument=0;
      const auto entryIs=[&](llvm::StringRef prefix,llvm::StringRef type){
        if(!charge(6)||!text(prefix)||!text(type))return false;
        if(argument>=entry.size())return reject("Common receiver normalized formal entry ordinal is missing");
        const auto reg=entry[argument];const auto expected=physical[argument].getAsString().value();
        if(reg>=fn.carriers.size())return reject("Common receiver normalized formal entry register differs");
        const llvm::StringRef view=views->second[reg],actual=fn.carriers[reg];
        if(!text(view)||!text(actual)||!text(expected))return false;
        if(actual!=expected||!view.starts_with(prefix)||view.drop_front(prefix.size())!=type)
          return reject("Common receiver normalized formal entry view/carrier differs");
        ++argument;return true;
      };
      const auto &lexical=field(abi,"lexicalEnvironment");
      if(!charge(3))return false;
      if(!lexical.getAsNull()){
        const auto id=field((*tables.environments)[size_t(*lexical.getAsInteger())],"id").getAsString().value();
        if(!text(id)||!text(field(logical,"lexicalEnvironment").getAsString().value()))return false;
        if(field(logical,"lexicalEnvironment").getAsString()!=id)return reject("Common receiver normalized Env entry differs");
        if(!entryIs("env:",id))return false;
      }else if(!field(logical,"lexicalEnvironment").getAsNull())return reject("Common receiver normalized Env entry is missing");
      const bool constructor=fn.role=="construction-body";const auto &receiver=field(abi,"receiver");
      if(!charge(4))return false;
      if(!receiver.getAsNull()){
        if(!charge(12))return false;const auto &binding=(*tables.bindings)[size_t(*receiver.getAsInteger())];
        const auto id=field(binding,"id").getAsString().value(),owner=field(logical,"ownerType").getAsString().value();
        const auto type=field((*tables.types)[size_t(*field(binding,"type").getAsInteger())],"id").getAsString().value();
        if(!text(id)||!text(owner)||!text(type)||!text(field(logical,"receiverBinding").getAsString().value()))return false;
        if(field(binding,"role").getAsString()!="receiver"||field(binding,"owner").getAsInteger()!=int64_t(i)||
            field(logical,"receiverBinding").getAsString()!=id||type!=owner)return reject("Common receiver normalized receiver Binding differs");
        if(constructor){
          if(field(abi,"receiverFrame").getAsInteger()!=int64_t(argument)||field(abi,"construction").getAsNull())return reject("Common receiver normalized Frame entry differs");
          if(!entryIs("receiver:",owner))return false;
        }else{
          if(!field(abi,"receiverFrame").getAsNull()||!field(abi,"construction").getAsNull())return reject("Common receiver normalized receiver is not a Frame");
          if(!entryIs("",owner))return false;
        }
      }else if(!field(logical,"ownerType").getAsNull()||!field(logical,"receiverBinding").getAsNull()||constructor||!field(abi,"receiverFrame").getAsNull()||!field(abi,"construction").getAsNull())
        return reject("Common receiver normalized receiver entry is missing");
      for(size_t n=0;n<parameters.size();++n){
        if(!charge(20))return false;const auto &parameter=parameters[n],&binding=(*tables.bindings)[size_t(*refs[n].getAsInteger())];
        const auto id=field(binding,"id").getAsString().value(),formal=field(parameter,"type").getAsString().value();
        const auto declared=field((*tables.types)[size_t(*field(binding,"type").getAsInteger())],"id").getAsString().value();
        const auto raw=field((*tables.types)[size_t(*rawTypes[n].getAsInteger())],"id").getAsString().value();
        const auto &range=field(parameter,"range"),&origin=field(binding,"origin");
        if(!text(id)||!text(formal)||!text(declared)||!text(raw)||!text(field(parameter,"id").getAsString().value())||!text(field(parameter,"sourceBinding").getAsString().value()))return false;
        if(field(binding,"role").getAsString()!="param"||field(binding,"owner").getAsInteger()!=int64_t(i)||field(parameter,"id").getAsString()!=id||field(parameter,"sourceBinding").getAsString()!=id||
            formal!=declared||raw!=formal||field(parameter,"writable").getAsBoolean()!=field(binding,"writable").getAsBoolean()||field(origin,"source").getAsInteger()!=int64_t(tables.program.functions[i].source)||
            field(range,"start").getAsInteger()!=field(origin,"start").getAsInteger()||field(range,"end").getAsInteger()!=field(origin,"end").getAsInteger())
          return reject("Common receiver effects lack independent cold FDI provenance for ordinary parameters");
        if(!entryIs("",formal))return false;
      }
      if(!charge())return false;
      if(argument!=entry.size())return reject("Common receiver normalized formal entry has extra arguments");
      std::set<std::string> checkedViews;
      const auto available=[&](llvm::StringRef view){
        if(!charge())return false;std::vector<llvm::StringRef> pending{view};
        while(!pending.empty()){
          if(!charge())return false;const auto current=pending.back();pending.pop_back();
          if(!lookup(catalog.types.size(),current)||!text(current))return false;const auto type=catalog.types.find(current.str());
          if(type==catalog.types.end())continue;
          if(!lookup(checkedViews.size(),current)||!text(current)||!charge())return false;if(!checkedViews.insert(current.str()).second)continue;
          const auto &row=*type->second;const auto kind=field(row,"kind").getAsString().value();if(!text(kind))return false;
          if(kind=="value")return reject("Common normalized receiver effects lack independently complete cold Value capabilities");
          const auto child=[&](const Json &id){if(!charge())return false;pending.push_back(id.getAsString().value());return true;};
          if(!field(row,"base").getAsNull()&&!child(field(row,"base")))return false;
          if((kind=="array"||kind=="readSpan")&&!child(field(row,"elementType")))return false;
          if(kind=="union")for(const auto &id:items(field(row,"members")))if(!child(id))return false;
          if(kind=="function"){
            for(const auto &id:items(field(row,"parameters")))if(!child(id))return false;
            if(!child(field(row,"returnType")))return false;
          }
          if(kind=="reference")for(const auto &member:items(field(row,"fields")))if(!child(field(member,"type")))return false;
        }
        return true;
      };
      if(!available(field(*graph.logical,"returnType").getAsString().value()))return false;
      if(!field(*graph.logical,"ownerType").getAsNull()&&!available(field(*graph.logical,"ownerType").getAsString().value()))return false;
      for(const auto &view:views->second)if(!charge()||!available(view))return false;
      for(const auto &capture:items(field(*graph.logical,"captures"))){
        if(!charge())return false;const auto binding=field(capture,"binding").getAsString().value();
        if(!lookup(catalog.slots.size(),binding)||!text(binding))return false;const auto slot=catalog.slots.find(binding.str());
        if(slot==catalog.slots.end())return reject("Common normalized receiver capture lacks an owned slot view");
        if(!available(field(*slot->second,"type").getAsString().value()))return false;
      }
      Json raw=nullptr;const std::vector<ReturnOriginAccessWitness> witnesses;
      model.remaining=tables.remaining;auto projection=ProjectedReturnEffects::Invalid;
      if(projectNormalizedReturnOriginBody(model,*graph.logical,fn,raw,graph.out,failure))
        projection=deriveProjectedEffects(model,*graph.logical,raw,graph.out,failure,nullptr,witnesses);
      tables.remaining=model.remaining;
      if(projection==ProjectedReturnEffects::Invalid)return reject(failure.message);
      if(!charge(2))return false;
      if(projection==ProjectedReturnEffects::Open)return reject("Common normalized receiver effect projection remains unavailable or Pending");
      if(projection==ProjectedReturnEffects::EffectsComplete){
        // graphStructure/check.graph already checked every actual return arity
        // and every normal/language edge. Its null carrier is the string void.
        if(!charge(5)||!text(fn.resultCarrier)||!text(fn.role))return false;
        const bool physicalVoid=field(abi,"result").getAsNull()&&field(abi,"resultCarrier").getAsNull()&&
          fn.resultCarrier=="void"&&fn.role!="construction-body";
        if(!physicalVoid)return reject("Common normalized effects require a complete return certificate");
      }
      if(projection==ProjectedReturnEffects::ReturnCertificateComplete){
        if(!lookup(model.returnOriginVerified.size(),fn.id)||!lookup(model.returnOriginPending.size(),fn.id))return false;
        if(!fixedReturnOriginAvailable(model,fn.id))return reject("Common normalized receiver effect projection remains unavailable or Pending");
      }
      projections[i]=projection;
    }else if(!graph.run())return false;
    if(containsReceiverProtocol){
      if(!lookup(model.effects.size(),fn.id))return false;const auto physical=model.effects.find(fn.id);
      if(physical!=model.effects.end()){graph.out.managedReference|=physical->second.managedReference;graph.out.escape|=physical->second.escape;}
    }
    if(catalog.logical.count(fn.id)&&!contained(*this,model.fixedEffects.at(fn.id),graph.out))return false;
    const auto &row=dependencies[i];std::set<std::string> calls,hosts;
    for(const auto &callee:items(field(row,"callees"))){if(!charge()||!text(field(callee,"functionId").getAsString().value())||containsReceiverProtocol&&!lookup(calls.size(),field(callee,"functionId").getAsString().value()))return false;calls.insert(string(field(callee,"functionId")));}
    for(const auto &host:items(field(row,"hosts"))){if(!charge()||!text(field(host,"hostId").getAsString().value())||containsReceiverProtocol&&!lookup(hosts.size(),field(host,"hostId").getAsString().value()))return false;hosts.insert(string(field(host,"hostId")));}
    if(containsReceiverProtocol)for(const auto *set:{&calls,&graph.out.calls,&hosts,&graph.hosts})for(const auto &id:*set)if(!charge()||!text(id))return false;
    if(calls!=graph.out.calls||hosts!=graph.hosts)return reject("Common effective fixed graph dependency closure differs from original digest joins");
    if(containsReceiverProtocol){if(!text(fn.id)||!lookup(model.effects.size(),fn.id))return false;model.effects.insert_or_assign(fn.id,std::move(graph.out));}
    else model.effects.emplace(fn.id,std::move(graph.out));
  }
  if(containsReceiverProtocol){
    model.remaining=tables.remaining;const bool valid=finishReturnOriginProofs(model,failure);tables.remaining=model.remaining;
    if(!valid)return reject(failure.message);
    for(const auto &[id,fn]:catalog.logical){
      if(!lookup(tables.functionIds.size(),id)||!charge(2))return false;
      const auto projection=projections[tables.functionIds.at(id)];
      if(projection==ProjectedReturnEffects::ReturnCertificateComplete){
        if(!lookup(model.returnOriginVerified.size(),id)||!lookup(model.returnOriginPending.size(),id))return false;
        if(!fixedReturnOriginAvailable(model,id))return reject("Common normalized receiver fixed dependency closure remains Pending");
      }else if(projection!=ProjectedReturnEffects::EffectsComplete)return reject("Common normalized effects dependency remains incomplete");
    }
  }
  return true;
}
} // namespace tsfg::wire
