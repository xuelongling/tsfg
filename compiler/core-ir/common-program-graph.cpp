// SPDX-License-Identifier: MIT
#include "common-program-actual.h"
#include "llvm/ADT/STLExtras.h"
#include <algorithm>
namespace tsfg::commonProgram {
namespace {
// These relations are rebuilt from typed SSA, not Source ranges or producer
// certificates. Dynamic binding state remains part of the actual CFG solver.
bool constructionProtocol(ActualCheck &c,const Function &fn,const std::vector<std::set<uint16_t>> &predecessors){
  struct Frame{std::string owner;uint16_t parent=noRegister;};
  struct Value{uint16_t allocated=noRegister,constructed=noRegister,bound=noRegister,binding=noRegister;};
  struct Token{uint16_t frame=noRegister,binding=noRegister;size_t position=0;};
  std::map<uint16_t,Frame> frames;std::map<uint16_t,Value> values;std::map<uint16_t,Token> tokens;
  uint16_t entryFrame=noRegister;
  auto source=c.sourceFunctions.find(fn.id);
  if(source!=c.sourceFunctions.end()&&string(field(*source->second,"kind"))=="construction-body"){
    const size_t hidden=!field(*source->second,"lexicalEnvironment").getAsNull();entryFrame=fn.blocks[0].parameters[hidden];
    frames.emplace(entryFrame,Frame{string(field(*source->second,"ownerType"))});
  }
  bool changed=true;
  while(changed){changed=false;
    for(size_t b=0;b<fn.blocks.size();++b)for(const auto &op:fn.blocks[b].operations){
      if(!c.step(op.operands.size()+1))return false;const auto &name=op.name;
      if(name=="receiver_create"&&!frames.count(op.result)){frames.emplace(op.result,Frame{string(field(op.properties,"owner"))});changed=true;}
      else if(name=="receiver_child"&&!frames.count(op.result)&&frames.count(op.operands[0])){frames.emplace(op.result,Frame{string(field(op.properties,"owner")),op.operands[0]});changed=true;}
      else if(name=="receiver_allocate"&&!values.count(op.result)&&frames.count(op.operands[0])){Value value;value.allocated=op.operands[0];values.emplace(op.result,value);changed=true;}
      else if((name=="carrier_cast"||name=="view")&&!values.count(op.result)&&op.operands.size()==1&&values.count(op.operands[0])){values.emplace(op.result,values.at(op.operands[0]));changed=true;}
      else if((name=="receiver_bind"||name=="receiver_get"||name=="receiver_result")&&frames.count(op.operands[0])){
        const auto frame=op.operands[0],normal=fn.blocks[op.successors[0]].parameters[0];if(values.count(normal))continue;
        Value value;
        if(name=="receiver_result")value.constructed=frame;
        else if(name=="receiver_get")value.bound=frame;
        else{
          const auto input=values.find(op.operands[1]);if(input==values.end())continue;
          const auto &owner=*c.types.at(frames.at(frame).owner);const auto base=string(field(owner,"base"));
          if(base.empty()){if(input->second.allocated!=frame)continue;}
          else{const auto child=frames.find(input->second.constructed);if(child==frames.end()||child->second.parent!=frame||child->second.owner!=base)continue;}
          value.bound=frame;value.binding=normal;
        }
        values.emplace(normal,value);changed=true;
      }else if(name=="invoke"){
        const auto callee=c.sourceFunctions.find(string(field(op.properties,"function_id")));
        if(callee==c.sourceFunctions.end()||string(field(*callee->second,"kind"))!="construction-body")continue;
        const size_t hidden=!field(*callee->second,"lexicalEnvironment").getAsNull();const auto frame=op.operands[hidden];
        const auto normal=fn.blocks[op.successors[0]].parameters[0];
        if(!c.need(predecessors[op.successors[0]]==std::set<uint16_t>{uint16_t(b)},"constructor call result has a foreign predecessor"))return false;
        if(!values.count(normal)&&frames.count(frame)&&frames.at(frame).owner==string(field(*callee->second,"ownerType"))){Value value;value.constructed=frame;values.emplace(normal,value);changed=true;}
      }else if(name=="initialize_begin"&&!tokens.count(op.result)){
        const auto input=values.find(op.operands[1]);
        if(frames.count(op.operands[0])&&input!=values.end()&&input->second.bound==op.operands[0]&&input->second.binding!=noRegister){tokens.emplace(op.result,Token{op.operands[0],input->second.binding,0});changed=true;}
      }else if(name=="initialize_field"&&!tokens.count(op.result)){
        const auto token=tokens.find(op.operands[0]);const auto receiver=values.find(op.operands[1]);if(token==tokens.end()||receiver==values.end())continue;
        const auto &fields=items(field(field(*c.types.at(frames.at(token->second.frame).owner),"construction"),"initializationFields"));
        if(!c.need(token->second.position<fields.size()&&string(fields[token->second.position])==string(field(op.properties,"field"))&&
          receiver->second.bound==token->second.frame&&receiver->second.binding==token->second.binding,"initializer cursor/receiver identity differs"))return false;
        auto next=token->second;++next.position;tokens.emplace(op.result,next);changed=true;
      }
    }
  }
  for(size_t b=0;b<fn.blocks.size();++b){
    for(auto reg:fn.blocks[b].parameters)if(!c.step()||!c.need(!llvm::StringRef(fn.carriers[reg]).starts_with("initialization:")&&
      (!llvm::StringRef(fn.carriers[reg]).starts_with("receiver:")||reg==entryFrame),"unproved construction control block parameter"))return false;
    for(const auto &op:fn.blocks[b].operations){
      if(!c.step(op.operands.size()+1))return false;const auto &name=op.name;
      for(auto reg:op.operands)if(llvm::StringRef(fn.carriers[reg]).starts_with("initialization:")){
        if(!c.need((name=="initialize_field"||name=="initialize_end")&&reg==op.operands[0]&&tokens.count(reg),"unproved initializer token use"))return false;
      }
      if(name=="receiver_create"||name=="receiver_child"){if(!c.need(frames.count(op.result),"unproved receiver/newTarget lineage"))return false;}
      else if(name=="receiver_allocate"){if(!c.need(values.count(op.result),"unproved base receiver allocation"))return false;}
      else if(name=="receiver_bind"||name=="receiver_get"||name=="receiver_result"){
        if(!c.need(values.count(fn.blocks[op.successors[0]].parameters[0]),"receiver binding/result is not a completed Construct relation"))return false;
      }else if(name=="initialize_begin"){
        if(!c.need(tokens.count(op.result),"initialization did not follow the successful receiver binding"))return false;
      }else if(name=="initialize_field"){if(!c.need(tokens.count(op.result),"unproved initializer cursor step"))return false;}
      else if(name=="initialize_end"){
        const auto token=tokens.find(op.operands[0]);const auto receiver=values.find(op.operands[1]);
        if(!c.need(token!=tokens.end()&&receiver!=values.end(),"unproved initializer completion"))return false;
        const auto &fields=items(field(field(*c.types.at(frames.at(token->second.frame).owner),"construction"),"initializationFields"));
        if(!c.need(token->second.position==fields.size()&&receiver->second.bound==token->second.frame&&receiver->second.binding==token->second.binding,"incomplete or changed initializer receiver"))return false;
      }else if(name=="func.return"&&entryFrame!=noRegister){
        if(!c.need(op.operands.size()==1&&values.count(op.operands[0])&&values.at(op.operands[0]).constructed==entryFrame,"constructor return bypassed receiver result selection"))return false;
      }
    }
  }
  // A right is pending-begin (noRegister) or the exact current token. Preserve
  // alternatives at joins: intersecting them would hide a skipped initializer.
  // These are control rights, not this-binding state or rollback snapshots.
  using Rights=std::map<uint16_t,uint16_t>;
  std::vector<std::set<Rights>> seen(fn.blocks.size());
  std::vector<std::pair<uint16_t,const Rights *>> pending;
  const auto enqueue=[&](uint16_t block,const Rights &rights){
    if(!c.step())return false;
    // Prepay the red-black tree's comparison path plus one ownership copy.
    // Lexicographic map comparison examines at most rights.size()+1 entries.
    size_t comparisons=2;for(auto count=seen[block].size();count;count>>=1)comparisons+=4;
    if(!c.step((rights.size()+1)*(comparisons+1)))return false;
    const auto inserted=seen[block].insert(rights);
    if(inserted.second)pending.emplace_back(block,&*inserted.first);return true;
  };
  if(!enqueue(0,{}))return false;
  for(size_t index=0;index<pending.size();++index){
    const auto block=pending[index].first;const auto &entry=*pending[index].second;
    if(!c.step(entry.size()+1))return false;auto rights=entry;
    for(const auto &op:fn.blocks[block].operations){
      if(!c.step(op.operands.size()+rights.size()+1))return false;const auto &name=op.name;
      if(name=="initialize_begin"){
        const auto &token=tokens.at(op.result);const auto right=rights.find(token.binding);
        if(!c.need(right!=rights.end()&&right->second==noRegister,"initializer begin has no pending binding right on this path"))return false;
        right->second=op.result;
      }else if(name=="initialize_field"||name=="initialize_end"){
        const auto &token=tokens.at(op.operands[0]);const auto right=rights.find(token.binding);
        if(!c.need(right!=rights.end()&&right->second==op.operands[0],"initializer consumed an absent, aborted or stale token on this path"))return false;
        if(name=="initialize_end")rights.erase(right);else right->second=op.result;
      }else if(name=="receiver_create"||name=="receiver_child"){
        for(const auto &[binding,token]:rights)if(!c.need(values.at(binding).bound!=op.result,"new receiver activation abandoned an unfinished initializer"))return false;
      }
      if(name=="receiver_bind"||name=="receiver_get"||name=="receiver_result"){
        const auto frame=op.operands[0];
        if(name=="receiver_result"||name=="receiver_bind")for(const auto &[binding,token]:rights)
          if(!c.need(values.at(binding).bound!=frame,"receiver completion or rebinding skipped an unfinished initializer"))return false;
        if(name=="receiver_bind")rights.emplace(fn.blocks[op.successors[0]].parameters[0],noRegister);
        if(!enqueue(op.successors[0],rights)||!enqueue(op.successors[1],{}))return false;
        break;
      }
      if(name=="invoke"||name=="invoke_method"||name=="invoke_indirect"){
        // A language exception aborts the enclosing initializer evaluation;
        // selected receivers and their already committed effects stay bound.
        if(!enqueue(op.successors[0],rights)||!enqueue(op.successors[1],{}))return false;
        break;
      }
      if(name=="func.return"){
        if(!c.need(rights.empty(),"normal return skipped an unfinished initializer"))return false;break;
      }
      if(name=="return_throw"||name=="unreachable")break;
      if(!op.successors.empty()){
        if(name=="route"&&string(field(op.properties,"completion"))=="throw")rights.clear();
        for(auto to:op.successors)if(!enqueue(to,rights))return false;break;
      }
    }
  }
  return true;
}
}
bool ActualCheck::catalogs(){
  for(const auto &t:items(field(p.hir,"types"))){if(!step())return false;types.emplace(string(field(t,"id")),&t);}
  for(auto name:{"bool","undefined","null"}){
    const auto id=digest(std::string("tsfg.type")+std::string(1,'\0')+name);
    if(!types.count(id)){auto row=builtins.emplace(id,Object{{"id",id},{"kind",llvm::StringRef(name)=="bool"?"scalar":name},{"name",name}});types.emplace(id,&row.first->second);}
  }
  for(const auto &f:items(field(p.hir,"functions"))){
    if(!step())return false;sourceFunctions.emplace(string(field(f,"id")),&f);
    for(auto key:{"parameters","bindings"})for(const auto &b:items(field(f,key))){if(!step())return false;bindings.emplace(string(field(b,"id")),&b);}
    if(!field(f,"receiverBinding").getAsNull()){
      const auto id=string(field(f,"receiverBinding"));auto row=builtins.emplace("binding:"+id,Object{{"id",id},{"type",field(f,"ownerType")},{"kind","receiver"},{"range",field(f,"nameRange")}});bindings.emplace(id,&row.first->second);
    }
  }
  for(const auto &m:items(field(p.hir,"modules"))){if(!step())return false;modules.emplace(string(field(m,"initializer")),&m);}
  for(const auto &g:items(field(p.hir,"globals"))){if(!step())return false;globals.emplace(string(field(g,"id")),&g);bindings.emplace(string(field(g,"sourceBinding")),&g);}
  for(const auto &t:items(field(p.hir,"types"))){
    for(const auto &f:items(field(t,"fields"))){if(!step())return false;fields.emplace(string(field(f,"id")),&f);bindings.emplace(string(field(f,"sourceBinding")),&f);}
    if(string(field(t,"kind"))=="array"){
      const auto id="element:"+string(field(t,"id"));auto row=builtins.emplace("binding:"+id,Object{{"id",id},{"type",field(t,"elementType")},{"kind","element"}});bindings.emplace(id,&row.first->second);
    }
  }
  for(const auto &environment:items(field(p.hir,"environments"))){
    const auto id=string(field(environment,"id"));if(!step()||!need(environments.emplace(id,&environment).second,"duplicate environment identity"))return false;
    for(const auto &slot:items(field(environment,"slots"))){const auto binding=string(field(slot,"binding"));
      if(!step()||!need(environmentSlots.emplace(binding,&slot).second&&slotLayouts.emplace(binding,id).second,"duplicate environment cell owner"))return false;}
  }
  for(const auto &row:items(field(p.representation,"domains"))){if(!step())return false;domains.emplace(string(field(row,"id")),&row);}
  for(const auto &row:items(field(p.representation,"bindings"))){if(!step())return false;physicalBindings.emplace(string(field(row,"id")),&row);}
  for(const auto &row:items(field(p.representation,"functions"))){if(!step())return false;physicalFunctions.emplace(string(field(row,"id")),&row);}
  for(const auto &f:p.functions)if(!step()||!need(functions.emplace(f.id,&f).second,"duplicate normalized function identity"))return false;
  if(!need(functions.size()==sourceFunctions.size()+modules.size(),"complete normalized function/module inventory differs"))return false;
  for(const auto &[id,type]:analysisTypes){if(!step())return false;types.emplace(id,&type);}
  for(const auto &[id,owner]:analysisOwners)if(!step()||!need(sourceFunctions.emplace(id,&owner).second,"internal owner collides with public Source"))return false;
  for(const auto &[id,binding]:analysisBindings)if(!step()||!need(bindings.emplace(id,&binding).second,"internal binding collides with Source storage"))return false;
  for(const auto &[id,row]:p.internalDeclarations){if(!step())return false;physicalFunctions.emplace(id,row);
    for(const auto &binding:items(field(*row,"bindings"))){if(!step())return false;physicalBindings.emplace(string(field(binding,"id")),&binding);}}
  for(const auto &fn:p.internalFunctions){if(!step()||!need(analysisOwners.count(fn.id)&&printedConstructors.emplace(fn.id,&fn).second&&functions.emplace(fn.id,&fn).second,"unowned/duplicate internal function"))return false;}
  return true;
}
bool ActualCheck::graph(){
  const auto boolId=digest(std::string("tsfg.type")+std::string(1,'\0')+"bool");
  const auto i32Id=digest(std::string("tsfg.type")+std::string(1,'\0')+"i32");
  const auto payload="payload:"+schema.str();
  for(const auto &[id,fn]:functions){
    if(analysisFunctions.count(id)&&!printedConstructors.count(id))continue;
    const bool init=modules.count(id);const auto *owner=init?modules.at(id):sourceFunctions.count(id)?sourceFunctions.at(id):nullptr;
    if(!step()||!need(owner&&physicalFunctions.count(id)&&!fn->blocks.empty()&&fn->blocks.size()<=256&&fn->carriers.size()<=4096,"normalized function identity/size differs"))return false;
    const auto &abi=*physicalFunctions.at(id);const auto expectedSignature=init?digest(std::string("tsfg.common-program.initializer-signature.v1")+std::string(1,'\0')+"void"):string(field(*owner,"signatureHash"));
    if(!need(fn->signature==expectedSignature&&fn->path==string(field(*owner,"sourcePath"))&&
      fn->role==(printedConstructors.count(id)?"implicit-construction-helper":init?"module-initializer":string(field(*owner,"kind")))&&fn->resultCarrier==string(field(abi,"result")),"normalized function stable header/ABI differs"))return false;
    if(!init&&!need(field(field(*owner,"range"),"start").getAsInteger()==fn->range.start&&field(field(*owner,"range"),"end").getAsInteger()==fn->range.end,"function anchor differs from Source"))return false;
    if(init){bool found=false;for(const auto &s:items(field(p.hir,"sources")))if(string(field(s,"path"))==fn->path){
      found=true;for(const auto &raw:items(field(field(field(p.hir,"snapshot"),"payload"),"files")))if(string(field(raw,"path"))==fn->path&&
        !need(fn->range.start==0&&field(raw,"utf16Length").getAsInteger()==fn->range.end,"initializer anchor differs from full Source"))return false;}
      if(!need(found,"initializer source missing"))return false;}
    for(const auto &carrier:fn->carriers){if(!step())return false;
      if(llvm::StringRef(carrier).starts_with("cell:")){
        if(!need(bindings.count(carrier.substr(5)),"unowned Cell carrier"))return false;
      }else if(!need(carrier!="void"&&p.layouts.count(carrier),"unowned/nonactual physical register carrier"))return false;
    }
    const auto n=fn->carriers.size();if(!step(2*n+fn->blocks.size()))return false;
    std::vector<int> definition(n,-1),position(n,-2);std::vector<std::set<uint16_t>> predecessors(fn->blocks.size());
    size_t instructions=0;
    for(size_t b=0;b<fn->blocks.size();++b){const auto &block=fn->blocks[b];
      if(!step(block.parameters.size()+1)||!need(!block.operations.empty()&&block.parameters.size()<=64,"empty/oversized normalized block"))return false;
      for(auto reg:block.parameters){if(!need(reg<n&&definition[reg]==-1,"duplicate/invalid block parameter"))return false;definition[reg]=b;position[reg]=-1;}
      for(size_t i=0;i<block.operations.size();++i){const auto &op=block.operations[i];
        if(!step(op.operands.size()+op.successors.size()+1)||!need(++instructions<=8192&&op.range.end>op.range.start,"instruction bound/original anchor differs"))return false;
        if(op.result!=noRegister){if(!need(op.result<n&&definition[op.result]==-1,"duplicate/invalid SSA result"))return false;definition[op.result]=b;position[op.result]=int(i);}
        for(auto successor:op.successors){if(!need(successor<fn->blocks.size()&&i+1==block.operations.size(),"invalid/nonterminal successor"))return false;predecessors[successor].insert(uint16_t(b));}
      }
    }
    if(!need(std::none_of(definition.begin(),definition.end(),[](int b){return b<0;}),"undeclared normalized register"))return false;
    if(!step(fn->blocks.size()))return false;std::vector<bool> reachable(fn->blocks.size());reachable[0]=true;bool changed=true;
    while(changed){changed=false;for(size_t b=0;b<fn->blocks.size();++b)if(reachable[b])for(auto to:fn->blocks[b].operations.back().successors){if(!step())return false;if(!reachable[to]){reachable[to]=true;changed=true;}}}
    if(!step(reachable.size()))return false;std::set<uint16_t> all;for(size_t b=0;b<reachable.size();++b)if(reachable[b])all.insert(uint16_t(b));
    if(!step(fn->blocks.size()*(all.size()+1)))return false;
    std::vector<std::set<uint16_t>> dominators(fn->blocks.size(),all);dominators[0]={0};changed=true;
    while(changed){changed=false;for(size_t b=1;b<fn->blocks.size();++b)if(reachable[b]){
      if(!step(all.size()+1))return false;std::set<uint16_t> result=all;
      for(auto from:predecessors[b])if(reachable[from]){
        if(!step(result.size()+dominators[from].size()))return false;std::set<uint16_t> next;
        std::set_intersection(result.begin(),result.end(),dominators[from].begin(),dominators[from].end(),std::inserter(next,next.end()));result=std::move(next);
      }result.insert(uint16_t(b));if(result!=dominators[b]){dominators[b]=std::move(result);changed=true;}
    }}
    const auto &entry=fn->blocks[0].parameters;const auto &parameters=items(field(abi,"parameters"));
    if(!need(entry.size()==parameters.size(),"entry ABI arity differs"))return false;
    for(size_t i=0;i<entry.size();++i)if(!need(fn->carriers[entry[i]]==string(parameters[i]),"entry ABI physical carrier differs"))return false;
    for(size_t b=0;b<fn->blocks.size();++b)for(size_t i=0;i<fn->blocks[b].operations.size();++i){const auto &op=fn->blocks[b].operations[i];
      for(auto reg:op.operands)if(!step()||!need(reg<n&&definition[reg]>=0&&
        (definition[reg]==int(b)?position[reg]<int(i):!reachable[b]||dominators[b].count(uint16_t(definition[reg]))),"operand lacks independent SSA dominance"))return false;
      for(auto reg:op.operands){const auto carrier=llvm::StringRef(fn->carriers[reg]);
        if(carrier.starts_with("receiver:")&&!need(op.name=="receiver_child"||op.name=="receiver_allocate"||op.name=="receiver_bind"||op.name=="receiver_get"||op.name=="receiver_result"||op.name=="initialize_begin"||op.name=="invoke"||op.name=="cf.br"||op.name=="cf.cond_br"||op.name=="route","constructor frame used as a language object"))return false;
        if(carrier.starts_with("initialization:")&&!need(op.name=="initialize_field"||op.name=="initialize_end"||op.name=="cf.br"||op.name=="cf.cond_br"||op.name=="route","initializer token escaped its control protocol"))return false;
      }
      const auto noResult=op.result==noRegister;
      if(!noResult){const auto carrier=llvm::StringRef(fn->carriers[op.result]);
        if(carrier.starts_with("receiver:")&&!need(op.name=="receiver_create"||op.name=="receiver_child","foreign operation forged a constructor frame"))return false;
        if(carrier.starts_with("initialization:")&&!need(op.name=="initialize_begin"||op.name=="initialize_field","foreign operation forged an initializer token"))return false;
      }
      if(llvm::StringRef(op.name).starts_with("receiver_")||llvm::StringRef(op.name).starts_with("initialize_")){
        const auto ownerId=string(field(op.properties,"owner"));
        if(!need(types.count(ownerId)&&!field(*types.at(ownerId),"construction").getAsNull(),"construction operation owner missing"))return false;
        const auto &ownerType=*types.at(ownerId);const auto frame="receiver:"+ownerId,phase="initialization:"+ownerId;
        const auto frameOperand=[&op,&frame,function=fn](size_t index){return op.operands.size()>index&&function->carriers[op.operands[index]]==frame;};
        const auto languageValue=[&op,function=fn](size_t index){if(op.operands.size()<=index)return false;const auto value=llvm::StringRef(function->carriers[op.operands[index]]);return !value.starts_with("receiver:")&&!value.starts_with("initialization:")&&!value.starts_with("cell:")&&!value.starts_with("env:");};
        if(op.name=="receiver_get"||op.name=="receiver_bind"||op.name=="receiver_result"){
          const size_t count=op.name=="receiver_bind"?2:1;const bool returned=op.name=="receiver_result";
          if(!need(noResult&&op.successors.size()==2&&frameOperand(0)&&
            (op.operands.size()==count||(returned&&op.operands.size()==2))&&(op.operands.size()==1||languageValue(1))&&op.successors[0]!=op.successors[1],"receiver normal/language operation shape differs"))return false;
          const auto &normal=fn->blocks[op.successors[0]].parameters,&language=fn->blocks[op.successors[1]].parameters;
          if(!need(normal.size()==1&&language.size()==1&&fn->carriers[language[0]]==payload&&
            !llvm::StringRef(fn->carriers[normal[0]]).starts_with("receiver:")&&!llvm::StringRef(fn->carriers[normal[0]]).starts_with("initialization:")&&
            predecessors[op.successors[0]]==std::set<uint16_t>{uint16_t(b)}&&predecessors[op.successors[1]]==std::set<uint16_t>{uint16_t(b)},"receiver continuation ABI/ownership differs"))return false;
        }else if(op.name=="receiver_create"){
          if(!need(!noResult&&op.operands.empty()&&op.successors.empty()&&fn->carriers[op.result]==frame&&op.view==frame&&
            string(field(op.properties,"new_target"))==ownerId&&same(field(op.properties,"construction"),field(field(ownerType,"construction"),"id")),"root receiver/newTarget identity differs"))return false;
        }else if(op.name=="receiver_child"){
          if(!need(!noResult&&op.operands.size()==1&&op.successors.empty()&&fn->carriers[op.result]==frame&&op.view==frame,"child receiver shape differs"))return false;
          const auto parent=llvm::StringRef(fn->carriers[op.operands[0]]);const auto parentId=parent.starts_with("receiver:")?parent.drop_front(9).str():std::string();
          if(!need(types.count(parentId)&&string(field(*types.at(parentId),"base"))==ownerId,"child receiver is not direct-base Construct"))return false;
        }else if(op.name=="receiver_allocate"){
          if(!need(!noResult&&op.operands.size()==1&&frameOperand(0)&&op.successors.empty()&&fn->carriers[op.result]==ownerId&&op.view==ownerId&&
            string(field(ownerType,"base")).empty(),"allocation requires the base receiver/newTarget frame"))return false;
        }else if(op.name=="initialize_begin"){
          if(!need(!noResult&&op.operands.size()==2&&frameOperand(0)&&languageValue(1)&&op.successors.empty()&&fn->carriers[op.result]==phase&&op.view==phase,"initializer begin receiver/token shape differs"))return false;
        }else if(op.name=="initialize_field"){
          const auto fieldId=string(field(op.properties,"field"));bool own=false;
          for(const auto &f:items(field(ownerType,"fields"))){if(!step())return false;own|=string(field(f,"id"))==fieldId;}
          if(!need(!noResult&&op.operands.size()==3&&fn->carriers[op.operands[0]]==phase&&languageValue(1)&&languageValue(2)&&op.successors.empty()&&
            fn->carriers[op.result]==phase&&op.view==phase&&own&&fields.count(fieldId),"initializer field/token owner differs"))return false;
          const auto storage=string(field(*fields.at(fieldId),"sourceBinding"));
          if(!need(physicalBindings.count(storage)&&fn->carriers[op.operands[2]]==string(field(*physicalBindings.at(storage),"carrier")),"initializer field storage capacity differs"))return false;
        }else if(op.name=="initialize_end"){
          if(!need(noResult&&op.operands.size()==2&&fn->carriers[op.operands[0]]==phase&&languageValue(1)&&op.successors.empty(),"initializer end token/receiver shape differs"))return false;
        }else return need(false,"unknown construction protocol operation");
        if(op.name!="receiver_get"&&op.name!="receiver_bind"&&op.name!="receiver_result"&&!need(i+1<fn->blocks[b].operations.size(),"construction operation omitted block completion"))return false;
      }else if(op.name=="func.return"){
        if(!need(noResult&&op.successors.empty()&&op.operands.size()==(fn->resultCarrier=="void"?0:1)&&
          (op.operands.empty()||fn->carriers[op.operands[0]]==fn->resultCarrier),"return ABI differs"))return false;
      }else if(op.name=="cf.br"||op.name=="route"){
        if(!need(noResult&&op.successors.size()==1,"branch successor count differs"))return false;
        const auto &to=fn->blocks[op.successors[0]].parameters;if(!need(to.size()==op.operands.size(),"branch argument count differs"))return false;
        for(size_t n=0;n<to.size();++n)if(!need(fn->carriers[to[n]]==fn->carriers[op.operands[n]],"branch carrier differs"))return false;
      }else if(op.name=="cf.cond_br"){
        if(!need(noResult&&op.successors.size()==2&&!op.operands.empty()&&fn->carriers[op.operands[0]]==boolId,"boolean conditional shape differs"))return false;
        size_t cursor=1;for(auto target:op.successors)for(auto reg:fn->blocks[target].parameters){
          if(!need(cursor<op.operands.size()&&fn->carriers[reg]==fn->carriers[op.operands[cursor++]],"conditional branch argument carrier differs"))return false;}
        if(!need(cursor==op.operands.size(),"conditional branch arguments differ"))return false;
      }else if(op.name=="numeric_use"){
        if(!need(noResult&&op.operands.size()==1&&op.successors.size()==1&&fn->blocks[op.successors[0]].parameters.size()==1&&
          fn->carriers[fn->blocks[op.successors[0]].parameters[0]]==i32Id,"numeric request-trap/normal shape differs"))return false;
      }else if(op.name=="host_call"){
        auto host=p.hosts.find(string(field(op.properties,"host_id")));
        if(!need(host!=p.hosts.end()&&!noResult&&op.successors.empty()&&op.operands.size()==host->second.parameters.size()&&
          op.view==host->second.returnType&&string(field(op.properties,"signature_hash"))==host->second.signature&&
          string(field(op.properties,"contract_hash"))==p.hostContractHash,"Host operation binding/signature/control differs"))return false;
      }else if(op.name=="invoke_indirect"){
        std::vector<std::string> args;std::string result;
        if(!need(noResult&&op.successors.size()==2,"indirect invocation control differs")||!indirectAbi(*fn,op,args,result)||!need(args.size()==op.operands.size(),"indirect invocation joined arity differs"))return false;
        for(size_t n=0;n<args.size();++n)if(!need(fn->carriers[op.operands[n]]==args[n],"indirect argument joined ABI differs"))return false;
        const auto &normal=fn->blocks[op.successors[0]].parameters,&language=fn->blocks[op.successors[1]].parameters;
        if(!need(normal.size()==(result=="void"?0:1)&&(normal.empty()||fn->carriers[normal[0]]==result)&&language.size()==1&&fn->carriers[language[0]]==payload,"indirect normal/language joined ABI differs"))return false;
      }else if(op.name=="invoke_method"){
        const auto valid=[&](){
        std::vector<std::string> args;std::string result;if(!need(noResult&&op.successors.size()==2,"method invocation control differs")||!methodAbi(*fn,op,args,result))return false;
        for(size_t n=0;n<args.size();++n)if(!need(fn->carriers[op.operands[n]]==args[n],"method invocation joined argument ABI differs"))return false;
        const auto &normal=fn->blocks[op.successors[0]].parameters,&language=fn->blocks[op.successors[1]].parameters;
        return need(normal.size()==(result=="void"?0:1)&&(normal.empty()||fn->carriers[normal[0]]==result)&&language.size()==1&&fn->carriers[language[0]]==payload,"method normal/language joined ABI differs");};
        if(!valid()){if(e.code!="core-ir-common-budget"){e.path=fn->path;e.range=op.range;}return false;}
      }else if(op.name=="invoke"){
        const auto target=string(field(op.properties,"function_id"));if(!need(noResult&&op.successors.size()==2&&functions.count(target)&&physicalFunctions.count(target),"direct invocation target differs"))return false;
        if(sourceFunctions.count(target)&&string(field(*sourceFunctions.at(target),"kind"))=="method"){
          e.path=fn->path;e.range=op.range;return need(false,"virtual method requires explicit dispatch");
        }
        const auto &called=*physicalFunctions.at(target);const auto &args=items(field(called,"parameters"));
        if(!need(args.size()==op.operands.size()&&functions.at(target)->signature==string(field(op.properties,"signature_hash")),"direct invocation signature/arity differs"))return false;
        for(size_t n=0;n<args.size();++n)if(!need(fn->carriers[op.operands[n]]==string(args[n]),"invocation ABI argument differs"))return false;
        const auto &normal=fn->blocks[op.successors[0]].parameters,&language=fn->blocks[op.successors[1]].parameters;const auto result=string(field(called,"result"));
        if(!need(normal.size()==(result=="void"?0:1)&&(normal.empty()||fn->carriers[normal[0]]==result)&&language.size()==1&&fn->carriers[language[0]]==payload,"invocation normal/language ABI projection differs"))return false;
      }else if(op.name=="return_throw"||op.name=="unreachable"){
        if(!need(noResult&&op.successors.empty()&&op.operands.size()==(op.name=="return_throw"?1:0)&&
          (op.operands.empty()||fn->carriers[op.operands[0]]==payload),"abrupt terminator shape differs"))return false;
      }else if(!need(op.successors.empty()&&i+1<fn->blocks[b].operations.size(),"missing/foreign block terminator"))return false;
    }
    if(!constructionProtocol(*this,*fn,predecessors))return false;
  }
  return true;
}
} // namespace tsfg::commonProgram
