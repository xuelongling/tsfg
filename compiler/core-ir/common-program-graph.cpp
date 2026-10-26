// SPDX-License-Identifier: MIT
#include "common-program-actual.h"
#include "llvm/ADT/STLExtras.h"
#include <algorithm>
namespace tsfg::commonProgram {
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
  for(const auto &row:items(field(p.representation,"domains"))){if(!step())return false;domains.emplace(string(field(row,"id")),&row);}
  for(const auto &row:items(field(p.representation,"bindings"))){if(!step())return false;physicalBindings.emplace(string(field(row,"id")),&row);}
  for(const auto &row:items(field(p.representation,"functions"))){if(!step())return false;physicalFunctions.emplace(string(field(row,"id")),&row);}
  for(const auto &f:p.functions)if(!step()||!need(functions.emplace(f.id,&f).second,"duplicate normalized function identity"))return false;
  return need(functions.size()==sourceFunctions.size()+modules.size(),"complete normalized function/module inventory differs");
}
bool ActualCheck::graph(){
  const auto boolId=digest(std::string("tsfg.type")+std::string(1,'\0')+"bool");
  const auto i32Id=digest(std::string("tsfg.type")+std::string(1,'\0')+"i32");
  const auto payload="payload:"+schema.str();
  for(const auto &[id,fn]:functions){
    const bool init=modules.count(id);const auto *owner=init?modules.at(id):sourceFunctions.count(id)?sourceFunctions.at(id):nullptr;
    if(!step()||!need(owner&&physicalFunctions.count(id)&&!fn->blocks.empty()&&fn->blocks.size()<=256&&fn->carriers.size()<=4096,"normalized function identity/size differs"))return false;
    const auto &abi=*physicalFunctions.at(id);const auto expectedSignature=init?digest(std::string("tsfg.common-program.initializer-signature.v1")+std::string(1,'\0')+"void"):string(field(*owner,"signatureHash"));
    if(!need(fn->signature==expectedSignature&&fn->path==string(field(*owner,"sourcePath"))&&
      fn->role==(init?"module-initializer":string(field(*owner,"kind")))&&fn->resultCarrier==string(field(abi,"result")),"normalized function stable header/ABI differs"))return false;
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
      const auto noResult=op.result==noRegister;
      if(op.name=="func.return"){
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
  }
  return true;
}
} // namespace tsfg::commonProgram
