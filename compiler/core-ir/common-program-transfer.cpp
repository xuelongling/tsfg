// SPDX-License-Identifier: MIT
#include "common-program-actual.h"
#include <cstdlib>
#include <cerrno>
namespace tsfg::commonProgram {
namespace {
bool summarizedSlot(ActualCheck &check,const std::string &slot){
  // Object paths are independently allocated identities. Globals and Cells do
  // not use these member suffixes and retain their normal strong assignment.
  if(!check.step((slot.size()/64+1)*6))return false;
  for(llvm::StringRef marker:{"/field/","/element/","/slot/","/length","/owner","/start","/parent"}){
    const auto at=slot.rfind(marker.str());if(at==std::string::npos)continue;
    if((marker=="/length"||marker=="/owner"||marker=="/start"||marker=="/parent")&&at+marker.size()!=slot.size())continue;
    const auto object=check.objects.find(slot.substr(0,at));
    if(object!=check.objects.end())return object->second.weak;
  }return false;
}
}
bool ActualCheck::instruction(ActualContext &context,const Operation &op,size_t block,ActualState &state,bool conditional,bool &changed,
    const std::function<bool(uint16_t,const ActualState &,const std::vector<ActualValue> &)> &edge,bool &continues){
  if(!step(op.operands.size()+1))return false;const auto &fn=*context.function;const auto &name=op.name;const auto &props=op.properties;
  std::vector<ActualValue> args;for(auto reg:op.operands){auto found=state.values.find(reg);args.push_back(found==state.values.end()?ActualValue{}:copy(found->second));}
  ActualValue value;const auto typeId=[&](llvm::StringRef name){return digest(std::string("tsfg.type")+std::string(1,'\0')+name.str());};
  const auto literal=[&](const std::string &id,uint8_t truth=0){ActualValue v;v.tags.insert(id);v.truth=truth;return v;};
  const auto put=[&](const std::string &slot,const ActualValue &v,bool strong=true){
    auto old=state.heap.find(slot);if(strong||old==state.heap.end())state.heap.insert_or_assign(slot,copy(v));else merge(old->second,v);return e.message.empty();
  };
  const auto observe=[&](const std::string &id,const ActualValue &v){if(conditional)merge(storageCapacity[id],v);};
  const auto seed=[&](std::map<std::string,ActualValue> &seeds,const std::string &id,const ActualValue &v){
    if(!conditional)return;ActualValue tags;tags.tags=v.tags;tags.unknown=v.unknown;tags.truth=v.truth;
    changed=merge(seeds[id],tags)||changed;
  };
  const bool weak=repeatingFunctions.count(fn.id)||repeatingBlocks.count(fn.id+"/"+std::to_string(block));
  if(name=="env_alloc"){
    const auto layout=string(field(props,"layout")),ref=context.id+"/environment/"+std::to_string(op.result);
    if(!need(environments.count(layout),"actual activation layout missing"))return false;
    value=literal("env:"+layout);value.objects.insert(ref);objects[ref]={"env:"+layout,weak};
    if(!args.empty()&&!put(ref+"/parent",args[0],!weak))return false;
  }else if(name=="env_parent"){
    for(const auto &ref:args[0].objects){
      if(!step()||!need(objects.count(ref),"actual environment parent owner missing"))return false;
      auto stored=state.heap.find(ref+"/parent");if(!need(stored!=state.heap.end(),"actual environment parent is uninitialized"))return false;
      merge(value,stored->second);
    }
  }else if(name=="env_init"||name=="env_load"||name=="env_store"){
    const auto layout=string(field(props,"layout")),key=string(field(props,"key"));
    for(const auto &ref:args[0].objects){
      if(!step()||!need(objects.count(ref)&&objects.at(ref).type=="env:"+layout,"actual environment cell owner differs"))return false;
      const auto slot=ref+"/slot/"+key;auto stored=state.heap.find(slot);
      if(name=="env_load"){
        if(!need(stored!=state.heap.end(),"actual environment cell is uninitialized"))return false;merge(value,stored->second);
      }else if(!put(slot,args[1],!objects.at(ref).weak&&args[0].objects.size()==1))return false;
    }
    if(name!="env_load")observe(string(field(props,"binding")),args[1]);
  }else if(name=="make_closure"){
    value=literal(op.view);const auto code=string(field(props,"function_id")),layout=string(field(props,"environment_layout"));
    if(layout.empty())value.callables.emplace(code,"");
    else for(const auto &ref:args[0].objects){
      if(!step()||!need(objects.count(ref)&&objects.at(ref).type=="env:"+layout,"actual closure activation differs"))return false;
      value.callables.emplace(code,ref);
    }
  }else if(name=="constant"){
    value=literal(op.view);const auto decimal=string(field(props,"decimal"));char *end=nullptr;errno=0;const auto number=std::strtoll(decimal.c_str(),&end,10);
    if(!errno&&end==decimal.c_str()+decimal.size())value.number=number;
  }else if(name=="floating"||name=="undefined"||name=="null"||name=="string")value=literal(op.view);
  else if(name=="boolean")value=literal(typeId("bool"),field(props,"value").getAsBoolean()==true?2:1);
  else if(name=="cell"||name=="catch_bind"){
    const auto id=context.id+"/cell/"+std::to_string(op.result);value.cells.insert(id);put(id,name=="cell"?ActualValue{}:args[0]);
    if(name=="catch_bind")observe(string(field(props,"binding")),args[0]);
  }else if(name=="load"){
    for(const auto &cell:args[0].cells){if(!step())return false;auto stored=state.heap.find(cell);if(stored!=state.heap.end())merge(value,stored->second);}
  }else if(name=="store"){
    for(const auto &cell:args[0].cells)if(!step()||!put(cell,args[1]))return false;observe(string(field(props,"binding")),args[1]);
  }else if(name=="global_load"){
    const auto found=state.heap.find("global:"+string(field(props,"global")));if(found!=state.heap.end())value=copy(found->second);
  }else if(name=="global_store"){
    const auto id=string(field(props,"global")),raw=string(field(*globals.at(id),"sourceBinding"));put("global:"+id,args[0]);observe(raw,args[0]);seed(globalSeeds,raw,args[0]);
  }else if(name=="assert"||name=="view"||name=="carrier_cast"||name=="pack")value=copy(args[0]);
  else if(name=="value_copy")value=valueCopy(args[0],state,fn.id+"/copy/"+std::to_string(op.result)+"/root",weak);
  else if(name=="construct_value"||name=="allocate_reference"||name=="array_create"){
    value=literal(op.view);const auto ref=fn.id+"/object/"+std::to_string(op.result);value.objects.insert(ref);objects[ref]={op.view,weak};
    if(name=="array_create"){
      for(size_t i=0;i<args.size();++i){put(ref+"/element/"+std::to_string(i),args[i],!weak);seed(elementSeeds,"element:"+op.view,args[i]);}
      auto length=literal(typeId("u32"));length.number=args.size();put(ref+"/length",length,!weak);
    }
  }else if(name=="field_load"||name=="field_store"){
    const auto fieldId=string(field(props,"field"));
    for(const auto &ref:args[0].objects){
      if(!step()||!need(objects.count(ref),"field receiver object missing"))return false;const auto &object=objects.at(ref);bool owned=false;
      for(const auto *f:allFields(object.type)){if(!step())return false;if(string(field(*f,"id"))==fieldId){owned=true;break;}}
      auto selected=fieldId;
      if(!owned){
        const auto view=views.find(fn.id+"/"+std::to_string(op.operands[0]));
        auto projection=view==views.end()?p.referenceFields.end():p.referenceFields.find({object.type,view->second});
        if(projection!=p.referenceFields.end()){auto member=projection->second.find(fieldId);if(member!=projection->second.end()){selected=member->second;owned=true;}}
      }
      if(!need(owned&&fields.count(selected),"actual field lacks an independently verified nominal member mapping")){e.path=fn.path;e.range=op.range;return false;}
      const auto slot=ref+"/field/"+selected;auto stored=state.heap.find(slot);
      if(name=="field_load"){if(stored!=state.heap.end())merge(value,stored->second);}
      else{put(slot,args[1],!object.weak&&args[0].objects.size()==1);const auto raw=string(field(*fields.at(selected),"sourceBinding"));observe(raw,args[1]);seed(fieldSeeds,raw,args[1]);}
    }if(args[0].unknown)value.unknown=true;
  }else if(name=="readspan"){
    value=literal(op.view);const auto ref=fn.id+"/span/"+std::to_string(op.result);value.objects.insert(ref);objects[ref]={op.view,weak};
    put(ref+"/owner",args[0],!weak);put(ref+"/start",args[1],!weak);put(ref+"/length",args[2],!weak);
  }else if(name=="array_length"||name=="readspan_length")value=literal(op.view);
  else if(name=="array_read"||name=="array_store"||name=="array_resize"){
    ActualValue owners;
    for(const auto &ref:args[0].objects){
      if(!step()||!need(objects.count(ref),"array owner object missing"))return false;
      if(string(field(*types.at(objects.at(ref).type),"kind"))=="readSpan"){
        auto stored=state.heap.find(ref+"/owner");if(stored!=state.heap.end())merge(owners,stored->second);
      }else owners.objects.insert(ref);
    }
    for(const auto &ref:owners.objects){
      if(!step()||!need(objects.count(ref),"array backing object missing"))return false;const auto &object=objects.at(ref);const auto index=args[1].number;
      if(name=="array_resize"){put(ref+"/length",args[1],!object.weak);continue;}
      if(name=="array_store"){
        put(ref+"/element/"+(index?std::to_string(*index):"*"),args[2],!object.weak&&owners.objects.size()==1&&index.has_value());seed(elementSeeds,"element:"+object.type,args[2]);continue;
      }
      for(const auto &[slot,stored]:state.heap){if(!step())return false;if(llvm::StringRef(slot).starts_with(ref+"/element/"))merge(value,stored);}
      value.tags.insert(typeId("undefined"));
    }if(args[0].unknown)value.unknown=true;
  }else if(name=="strict_equal"){
    value=literal(typeId("bool"),3);if(!args[0].unknown&&!args[1].unknown){
      bool disjoint=true;for(const auto &tag:args[0].tags){if(!step())return false;if(args[1].tags.count(tag))disjoint=false;}
      bool sameAbsence=args[0].tags.size()==1&&args[1].tags==args[0].tags;
      if(sameAbsence){const auto kind=string(field(*types.at(*args[0].tags.begin()),"kind"));sameAbsence=kind=="undefined"||kind=="null";}
      if(disjoint||sameAbsence)value.truth=(sameAbsence==(string(field(props,"operator"))=="==="))?2:1;
    }
  }else if(name=="numeric_use"){
    const auto i32=typeId("i32"),undefined=typeId("undefined");
    if(!need(!args[0].unknown,"unknown actual numeric consumption is unsupported"))return false;
    for(const auto &tag:args[0].tags)if(!step()||!need(tag==i32||tag==undefined,"unsupported actual numeric consumption"))return false;
    if(!conditional&&args[0].tags.count(undefined))context.requestTrap=true;
    if(conditional||args[0].tags.count(i32)){
      auto selected=literal(i32);if(args[0].tags.size()==1)selected.number=args[0].number;if(!edge(op.successors[0],state,{selected}))return false;
    }continues=false;
  }else if(name=="binary"||name=="unary"){
    bool reaches=true;for(size_t i=0;i<args.size();++i){
      const auto view=views.at(fn.id+"/"+std::to_string(op.operands[i]));
      if(!need(!args[i].unknown,"unknown actual scalar consumption is unsupported"))return false;
      for(const auto &tag:args[i].tags)if(!step()||!need(tag==view,"actual scalar tag differs from its original consuming view"))return false;
      reaches&=!args[i].tags.empty();
    }
    if(conditional||reaches)value=literal(op.view,op.view==typeId("bool")?3:0);if(!conditional&&!reaches)continues=false;
  }else if(name=="invoke"||name=="invoke_method"||name=="invoke_indirect"){
    const auto complete=[&](uint16_t target,const ActualValue &v,const ActualHeap &heap){
      auto after=copyState(state);if(!e.message.empty()||!step(heap.size()))return false;
      for(const auto &[slot,value]:heap){
        const bool summarized=summarizedSlot(*this,slot);if(!e.message.empty())return false;
        auto old=after.heap.find(slot);
        // A callee summary may describe another runtime instance at the same
        // allocation/copy site. Keep aliases already owned by the caller.
        if(summarized&&old!=after.heap.end())merge(old->second,value);else after.heap.insert_or_assign(slot,copy(value));
        if(!e.message.empty())return false;
      }
      return edge(target,after,fn.blocks[target].parameters.empty()?std::vector<ActualValue>{}:std::vector<ActualValue>{copy(v)});
    };

    const auto invoke=[&](const std::string &target,std::vector<ActualValue> actual){
      const auto &source=*sourceFunctions.at(target);std::string activation;
      if(!field(source,"activationEnvironment").getAsNull()||!field(source,"lexicalEnvironment").getAsNull())
        // Recursive SCCs need a finite activation summary even with unchanged
        // arguments and heap. Multiple incoming/loop calls alone do not merge
        // activation identities; actual pair environments remain in the key.
        activation=cyclicFunctions.count(target)?"recursive/"+target:
          context.id+"/call/"+std::to_string(block)+"/"+std::to_string(op.range.start)+":"+std::to_string(op.range.end);
      auto *call=this->context(target,actual,state.heap,false,changed,activation);if(!call)return false;
      if(call->normal&&!complete(op.successors[0],call->returned,call->normalHeap))return false;
      if(call->language&&!complete(op.successors[1],call->thrown,call->languageHeap))return false;return true;
    };
    if(name=="invoke"){if(!invoke(string(field(props,"function_id")),std::move(args)))return false;}
    else if(name=="invoke_indirect"){
      const auto site=fn.id+"/"+std::to_string(op.range.start)+":"+std::to_string(op.range.end);
      if(!need(!args.empty()&&p.callableSites.count(site),"indirect actual site has no fixed authority"))return false;
      const auto &upper=p.callableSites.at(site);
      if(!need((!args[0].unknown&&!args[0].callableTop)||upper.top,"actual unknown callee exceeds finite target upper"))return false;
      for(const auto &tag:args[0].tags)if(!step()||!need(types.count(tag)&&string(field(*types.at(tag),"kind"))=="function","actual indirect operand is not callable"))return false;
      if(upper.top){
        ActualValue unknown;unknown.unknown=true;if(!complete(op.successors[0],unknown,{})||!complete(op.successors[1],unknown,{}))return false;
      }
      for(const auto &[code,environment]:args[0].callables){
        if(!step()||!need(sourceFunctions.count(code)&&(upper.top||upper.functions.count(code)),"indirect pair target exceeds fixed authority"))return false;
        if(!need(same(field(*sourceFunctions.at(code),"signatureHash"),field(props,"signature_hash")),"actual indirect code signature differs"))return false;
        const auto &source=*sourceFunctions.at(code);const auto layout=string(field(source,"lexicalEnvironment"));std::vector<ActualValue> selected;
        if(!layout.empty()){
          if(!need(!environment.empty()&&objects.count(environment)&&objects.at(environment).type=="env:"+layout,"indirect pair carries a foreign/missing activation"))return false;
          ActualValue env;env.tags.insert("env:"+layout);env.objects.insert(environment);selected.push_back(std::move(env));
        }else if(!need(environment.empty(),"environment-free code acquired an activation"))return false;
        for(size_t i=1;i<args.size();++i){if(!step())return false;selected.push_back(copy(args[i]));}
        if(!invoke(code,std::move(selected)))return false;
      }
    }else{
      if(!need(!args.empty()&&!args[0].unknown,"method receiver has no finite actual nominal type")){e.path=fn.path;e.range=op.range;return false;}
      for(const auto &tag:args[0].tags){
        const Json *arm=nullptr;for(const auto &row:items(field(props,"dispatch"))){if(!step())return false;if(string(field(row,"receiver_type"))==tag){arm=&row;break;}}
        if(!need(arm,"actual method receiver has no independently verified dispatch arm")){e.path=fn.path;e.range=op.range;return false;}
        const auto target=string(field(*arm,"target"));if(!need(functions.count(target),"actual method implementation missing"))return false;
        const auto count=functions.at(target)->blocks[0].parameters.size();if(!need(count>0&&count<=args.size(),"method target requires missing actual arguments"))return false;
        if(!step(count))return false;std::vector<ActualValue> selected;for(size_t i=0;i<count;++i)selected.push_back(copy(args[i]));
        selected[0].tags={tag};selected[0].objects.clear();selected[0].cells.clear();
        for(const auto &ref:args[0].objects){if(!step(ref.size()/64+1)||!need(objects.count(ref),"method receiver object missing"))return false;if(objects.at(ref).type==tag)selected[0].objects.insert(ref);}
        if(!need(!selected[0].objects.empty(),"method receiver tag has no matching actual object"))return false;
        if(!invoke(target,std::move(selected)))return false;
      }
    }continues=false;
  }else if(name=="cf.br"||name=="route"){
    if(!edge(op.successors[0],state,args))return false;continues=false;
  }else if(name=="cf.cond_br"){
    if(!need(!args[0].unknown,"condition requires a proved boolean actual value"))return false;
    for(const auto &tag:args[0].tags)if(!step()||!need(tag==typeId("bool"),"condition actual tag is not boolean"))return false;
    const auto truth=args[0].truth?args[0].truth:3;
    if((truth&2)&&!edge(op.successors[0],state,{}))return false;if((truth&1)&&!edge(op.successors[1],state,{}))return false;continues=false;
  }else if(name=="func.return"||name=="return_throw"){
    const bool normal=name=="func.return";auto &completed=normal?context.normal:context.language;auto &returned=normal?context.returned:context.thrown;auto &heap=normal?context.normalHeap:context.languageHeap;
    if(!completed){completed=true;changed=true;}if(!args.empty())changed=merge(returned,args[0])||changed;
    std::vector<ActualValue> roots;for(const auto &arg:context.arguments)roots.push_back(copy(arg));if(!args.empty())roots.push_back(copy(args[0]));
    const auto live=reachable(roots,state.heap);changed=mergeHeap(heap,live)||changed;continues=false;
  }else if(name=="unreachable")continues=false;
  else if(!need(name=="fuel"||name=="enter_handler"||name=="finally_enter","unmodelled normalized actual operation"))return false;
  if(op.result!=noRegister){state.values.insert_or_assign(op.result,copy(value));if(conditional)merge(registerCapacity[fn.id+"/"+std::to_string(op.result)],value);}
  return e.message.empty();
}
} // namespace tsfg::commonProgram
