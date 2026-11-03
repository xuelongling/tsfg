// SPDX-License-Identifier: MIT
#include "bytecode-common-cold.h"
#include <common-program-borrows.h>
#include <common-program-methods.h>
#include "llvm/Support/raw_ostream.h"
#include <cstdlib>

namespace tsfg::wire {
using namespace commonProgram;
namespace {
using Point=std::pair<size_t,size_t>;
struct InlineBaseRoot {
  commonProgram::Function function;
  std::map<std::pair<uint16_t,uint16_t>,std::string> sources;
  std::string canonical;
};

// Use the existing internal-metadata text units. Borrowed text is paid before
// comparison; owning text is paid before its copy, not by a later JSON walk.
bool inlineTextWork(ActualCheck &check,size_t bytes){return check.step(12*bytes+8);}
bool inlineTreeWork(ActualCheck &check,size_t count,size_t keyWork){
  size_t height=0;for(auto left=count;left;left>>=1){if(!check.step())return false;height+=2;}
  height=std::min(height,count);
  // Bound both predicate directions, node visits and insertion/rebalancing.
  return check.step(4+2*height+2*(height+1)*keyWork);
}
bool inlineObjectWork(ActualCheck &check,std::initializer_list<llvm::StringRef> keys){
  // Fixed-key JSON objects have no reserve API. Prepay their key bytes and the
  // complete pairwise probe/growth bound before the initializer list is built.
  if(!check.step(keys.size()*(keys.size()+1)))return false;
  for(auto key:keys)if(!inlineTextWork(check,key.size())||!check.step(keys.size()*(2*key.size()+1)))return false;
  return true;
}

// Borrow a closed, straight-line scalar initializer protocol from the already
// checked graph. Failure to close this subset leaves the original cold gate.
// No source expression, claimed return graph or capacity supplies behavior.
bool inlineBaseRoot(CommonCold &cold,ActualCheck &check,const Json &ctor,size_t f,uint16_t frame,Point allocation,InlineBaseRoot &out){
  const auto &fn=cold.model.functions[f];
  if(!inlineTreeWork(check,cold.model.registerViews.size(),2*fn.id.size()+1)||
    !inlineTreeWork(check,cold.model.operationSources.size(),2*fn.id.size()+1))return false;
  const auto &views=cold.model.registerViews.at(fn.id);const auto &sourcePaths=cold.model.operationSources.at(fn.id);
  const auto ownerText=field((*cold.tables.types)[uint32_t(*field(ctor,"owner").getAsInteger())],"id").getAsString().value_or("");
  if(!inlineTextWork(check,ownerText.size()))return false;const auto owner=ownerText.str();
  const auto &allocated=fn.blocks[allocation.first].operations[allocation.second];
  const auto &start=fn.blocks[allocation.first];
  if(allocation.second+2!=start.operations.size())return false;const auto &bind=start.operations.back();
  if(!inlineTextWork(check,allocated.name.size()+bind.name.size()+owner.size()))return false;
  if(allocated.name!="receiver_allocate"||allocated.operands.size()!=1||allocated.operands[0]!=frame||allocated.result==commonProgram::noRegister||
    bind.name!="receiver_bind"||bind.operands.size()!=2||bind.operands[0]!=frame||bind.operands[1]!=allocated.result||bind.successors.size()!=2||
    field(bind.properties,"owner").getAsString().value_or("")!=owner)return false;
  const auto bodyIndex=bind.successors[0];const auto &body=fn.blocks[bodyIndex];
  if(body.parameters.size()!=1||body.operations.empty())return false;
  if(!inlineTextWork(check,views[body.parameters[0]].size()+owner.size()))return false;
  if(views[body.parameters[0]]!=owner)return false;const auto payload=body.parameters[0];
  const auto &begin=body.operations.front(),&result=body.operations.back();
  if(!inlineTextWork(check,begin.name.size()+result.name.size()+2*owner.size()))return false;
  if(begin.name!="initialize_begin"||begin.operands.size()!=2||begin.operands[0]!=frame||begin.operands[1]!=payload||begin.result==commonProgram::noRegister||
    field(begin.properties,"owner").getAsString().value_or("")!=owner||result.name!="receiver_result"||result.operands.size()!=1||result.operands[0]!=frame||
    result.successors.size()!=2||field(result.properties,"owner").getAsString().value_or("")!=owner)return false;
  const auto &fields=items(field(ctor,"initializationFields"));size_t prefix=0;auto token=begin.result;bool ended=false;
  const auto pure=[](const std::string &name){return name=="constant"||name=="floating"||name=="boolean"||name=="undefined"||name=="null"||
    name=="value_copy"||name=="view"||name=="carrier_cast"||name=="assert"||name=="unary"||name=="binary"||name=="strict_equal";};
  for(size_t n=1;n+1<body.operations.size();++n){
    const auto &op=body.operations[n];if(!inlineTextWork(check,op.name.size()+owner.size()))return false;
    if(ended||!op.successors.empty())return false;
    if(op.name=="initialize_field"){
      if(prefix>=fields.size()||op.operands.size()!=3||op.operands[0]!=token||op.operands[1]!=payload||op.result==commonProgram::noRegister||
        field(op.properties,"owner").getAsString().value_or("")!=owner)return false;
      const auto member=uint32_t(*fields[prefix].getAsInteger());const auto &decl=(*cold.tables.fields)[member],&origin=field(decl,"origin");
      const auto memberId=field(decl,"id").getAsString().value_or("");
      const auto path=field((*cold.tables.sources)[uint32_t(*field(origin,"source").getAsInteger())],"path").getAsString().value_or("");
      if(!inlineTreeWork(check,sourcePaths.size(),7))return false;const auto &source=sourcePaths.at({uint16_t(bodyIndex),uint16_t(n)});
      if(!inlineTextWork(check,memberId.size()+field(op.properties,"field").getAsString().value_or("").size()+path.size()+source.size())||!check.step(4))return false;
      if(field(op.properties,"field").getAsString().value_or("")!=memberId||op.range.start!=field(origin,"start").getAsInteger()||
        op.range.end!=field(origin,"end").getAsInteger()||source!=path)return false;
      token=op.result;++prefix;
    }else if(op.name=="initialize_end"){
      if(op.operands.size()!=2||op.operands[0]!=token||op.operands[1]!=payload||op.result!=commonProgram::noRegister||prefix!=fields.size()||
        field(op.properties,"owner").getAsString().value_or("")!=owner)return false;ended=true;
    }else{
      if(!pure(op.name)||op.result==commonProgram::noRegister)return false;
      if(!inlineTreeWork(check,check.types.size(),2*op.view.size()+1))return false;const auto type=check.types.find(op.view);
      if(type==check.types.end())return false;const auto kind=field(*type->second,"kind").getAsString().value_or("");
      if(!inlineTextWork(check,kind.size()))return false;
      if(kind!="scalar"&&kind!="undefined"&&kind!="null")return false;
      for(auto input:op.operands){if(!inlineTextWork(check,views[input].size()))return false;const auto view=llvm::StringRef(views[input]);
        if(view.starts_with("receiver:")||view.starts_with("initialization:")||view.starts_with("payload:")||view.starts_with("cell:")||view.starts_with("env:"))return false;}
    }
  }
  if(!ended)return false;
  // Roles, rather than a fixed block count, close both protocol completions.
  // Shared throw-only sinks are allowed; any crossed role or loop is Pending.
  std::map<size_t,char> roles;std::vector<size_t> order;
  if(!check.step(bind.successors.size()+result.successors.size()+2))return false;order.reserve(bind.successors.size()+result.successors.size()+1);
  const auto role=[&](size_t block,char value){
    if(!inlineTreeWork(check,roles.size(),3))return false;const auto found=roles.find(block);
    if(found!=roles.end())return found->second=='L'&&value=='L';
    if(!inlineTreeWork(check,roles.size(),3)||!check.step(2))return false;roles.emplace(block,value);order.push_back(block);return true;
  };
  if(!role(allocation.first,'E')||!role(bodyIndex,'B')||!role(bind.successors[1],'L')||!role(result.successors[0],'R')||!role(result.successors[1],'L'))return false;
  const auto normal=result.successors[0];
  for(const auto &[b,kind]:roles){
    if(!check.step())return false;const auto &block=fn.blocks[b];
    if(kind=='L'&&!block.operations.empty()&&!inlineTextWork(check,block.operations[0].name.size()+block.operations[0].operands.size()))return false;
    if(kind=='L'&&(block.parameters.size()!=1||block.operations.size()!=1||block.operations[0].name!="return_throw"||
      block.operations[0].operands!=block.parameters||!block.operations[0].successors.empty()))return false;
    if(kind=='R'){if(block.parameters.size()!=1)return false;if(!inlineTextWork(check,views[block.parameters[0]].size()+owner.size()))return false;
      if(views[block.parameters[0]]!=owner)return false;}
  }
  std::set<Point> selected;std::set<uint16_t> local;
  if(!inlineTreeWork(check,local.size(),3))return false;local.insert(frame);
  for(const auto &[b,kind]:roles){
    if(!check.step())return false;const auto &block=fn.blocks[b];
    if(kind!='E')for(auto parameter:block.parameters){if(!inlineTreeWork(check,local.size(),3))return false;local.insert(parameter);}
    if(kind=='R')continue;
    for(size_t n=kind=='E'?allocation.second:0;n<block.operations.size();++n){
      if(!inlineTreeWork(check,selected.size(),7))return false;selected.emplace(b,n);
      if(block.operations[n].result!=commonProgram::noRegister){if(!inlineTreeWork(check,local.size(),3))return false;local.insert(block.operations[n].result);}
    }
  }
  // Every incoming operand is either the sole formal frame or an internal
  // definition. Every interior use stays inside; only normal payload escapes.
  const auto output=fn.blocks[normal].parameters[0];
  for(size_t b=0;b<fn.blocks.size();++b)for(size_t n=0;n<fn.blocks[b].operations.size();++n){
    const auto &op=fn.blocks[b].operations[n];if(!inlineTreeWork(check,selected.size(),7))return false;const bool inside=selected.count({b,n});
    for(auto operand:op.operands){if(!inlineTreeWork(check,local.size(),3))return false;
      if(inside?!local.count(operand):local.count(operand)&&operand!=output)return false;}
    // Entry and the output boundary deliberately cut the caller CFG. All
    // internal body/throw predecessors must instead belong to this region.
    for(auto target:op.successors){if(!inlineTreeWork(check,roles.size(),3))return false;const auto found=roles.find(target);
      if(found!=roles.end()&&found->second!='E'&&found->second!='R'&&!inside)return false;}
  }
  std::map<size_t,uint16_t> blocks;std::map<uint16_t,uint16_t> registers;
  for(auto b:order){if(!inlineTreeWork(check,blocks.size(),3))return false;blocks.emplace(b,uint16_t(blocks.size()));}
  if(!check.step(local.size()+order.size()+2))return false;out.function.carriers.reserve(local.size());out.function.blocks.reserve(order.size());
  const auto reg=[&](uint16_t old){
    if(!inlineTreeWork(check,registers.size(),3))return uint16_t(commonProgram::noRegister);const auto found=registers.find(old);if(found!=registers.end())return found->second;
    if(!inlineTreeWork(check,registers.size(),3)||!inlineTextWork(check,views[old].size())||!check.step())return uint16_t(commonProgram::noRegister);
    const auto value=uint16_t(out.function.carriers.size());registers.emplace(old,value);out.function.carriers.push_back(views[old]);return value;
  };
  reg(frame);
  for(auto b:order){if(!inlineTreeWork(check,roles.size(),3))return false;const auto kind=roles.at(b);if(kind!='E')for(auto parameter:fn.blocks[b].parameters)reg(parameter);
    if(kind!='R')for(size_t n=kind=='E'?allocation.second:0;n<fn.blocks[b].operations.size();++n)if(fn.blocks[b].operations[n].result!=commonProgram::noRegister)reg(fn.blocks[b].operations[n].result);}
  if(!check.e.message.empty())return false;
  for(auto b:order){
    if(!inlineTreeWork(check,roles.size(),3))return false;const auto kind=roles.at(b);commonProgram::Block block;
    const auto parameterCount=kind=='E'?size_t(1):fn.blocks[b].parameters.size();
    const auto operationCount=kind=='R'?size_t(1):fn.blocks[b].operations.size()-(kind=='E'?allocation.second:0);
    if(!check.step(parameterCount+operationCount+2))return false;block.parameters.reserve(parameterCount);block.operations.reserve(operationCount);
    if(kind=='E'){if(!inlineTreeWork(check,registers.size(),3)||!check.step())return false;block.parameters.push_back(registers.at(frame));}
    else for(auto parameter:fn.blocks[b].parameters){if(!inlineTreeWork(check,registers.size(),3)||!check.step())return false;block.parameters.push_back(registers.at(parameter));}
    if(kind=='R'){
      if(!inlineTreeWork(check,sourcePaths.size(),7))return false;const auto &source=sourcePaths.at({uint16_t(bodyIndex),uint16_t(body.operations.size()-1)});
      if(!inlineTextWork(check,11+source.size())||!inlineTreeWork(check,registers.size(),3)||!inlineTreeWork(check,out.sources.size(),7)||!check.step(5))return false;
      commonProgram::Operation returned;returned.name="func.return";returned.range=result.range;returned.operands={registers.at(output)};
      out.sources.emplace(std::pair{uint16_t(out.function.blocks.size()),uint16_t(0)},source);
      block.operations.push_back(std::move(returned));
    }else for(size_t n=kind=='E'?allocation.second:0;n<fn.blocks[b].operations.size();++n){
      const auto &original=fn.blocks[b].operations[n];
      if(!inlineTextWork(check,original.name.size()+original.view.size())||!check.step(original.operands.size()+original.successors.size()+8)||!check.analysisMetadataCost(original.properties))return false;
      auto op=original;for(auto &operand:op.operands){if(!inlineTreeWork(check,registers.size(),3))return false;operand=registers.at(operand);}
      for(auto &target:op.successors){if(!inlineTreeWork(check,blocks.size(),3))return false;target=blocks.at(target);}
      if(op.result!=commonProgram::noRegister){if(!inlineTreeWork(check,registers.size(),3))return false;op.result=registers.at(op.result);}
      if(!inlineTreeWork(check,sourcePaths.size(),7))return false;const auto &source=sourcePaths.at({uint16_t(b),uint16_t(n)});
      if(!inlineTextWork(check,source.size())||!inlineTreeWork(check,out.sources.size(),7)||!check.step(2))return false;
      out.sources.emplace(std::pair{uint16_t(out.function.blocks.size()),uint16_t(block.operations.size())},source);block.operations.push_back(std::move(op));
    }if(!check.step())return false;out.function.blocks.push_back(std::move(block));
  }
  Array encodedBlocks,encodedViews;
  if(!check.step(out.function.blocks.size()+out.function.carriers.size()+2))return false;encodedBlocks.reserve(out.function.blocks.size());encodedViews.reserve(out.function.carriers.size());
  for(const auto &view:out.function.carriers){if(!inlineTextWork(check,view.size())||!check.step())return false;encodedViews.push_back(view);}
  for(size_t b=0;b<out.function.blocks.size();++b){
    const auto &block=out.function.blocks[b];Array parameters,operations;
    if(!check.step(block.parameters.size()+block.operations.size()+2))return false;parameters.reserve(block.parameters.size());operations.reserve(block.operations.size());
    for(auto p:block.parameters){if(!check.step())return false;parameters.push_back(p);}
    for(size_t n=0;n<block.operations.size();++n){const auto &op=block.operations[n];
      if(!inlineTreeWork(check,out.sources.size(),7))return false;const auto &source=out.sources.at({uint16_t(b),uint16_t(n)});
      if(!inlineTextWork(check,op.name.size()+op.view.size()+source.size())||!check.analysisMetadataCost(op.properties)||
        !inlineObjectWork(check,{"name","view","properties","operands","successors","result","source"})||!inlineObjectWork(check,{"path","start","end"})||
        !check.step(2*(op.operands.size()+op.successors.size())+4))return false;Array operands,successors;
      operands.reserve(op.operands.size());successors.reserve(op.successors.size());
      for(auto r:op.operands)operands.push_back(r);for(auto to:op.successors)successors.push_back(to);
      operations.push_back(Object{{"name",op.name},{"view",op.view},{"properties",op.properties},{"operands",std::move(operands)},
        {"successors",std::move(successors)},{"result",op.result==commonProgram::noRegister?Json(nullptr):Json(op.result)},
        {"source",Object{{"path",source},{"start",op.range.start},{"end",op.range.end}}}});
    }if(!inlineObjectWork(check,{"parameters","operations"})||!check.step())return false;
    encodedBlocks.push_back(Object{{"parameters",std::move(parameters)},{"operations",std::move(operations)}});
  }
  if(!inlineObjectWork(check,{"views","blocks"}))return false;Json material=Object{{"views",std::move(encodedViews)},{"blocks",std::move(encodedBlocks)}};
  // This walk pays only the subsequent canonicalization, never prior copies.
  if(!check.analysisMetadataCost(material))return false;out.canonical=commonProgram::canonical(material);return true;
}

bool installInlineBaseRoots(CommonCold &cold,ActualCheck &check){
  struct Frame {size_t function;uint16_t reg;};struct Allocation {Point at;std::string owner;};
  std::map<std::string,const Json *> eligible;std::map<std::string,std::vector<Frame>> frames;
  std::map<std::pair<size_t,uint16_t>,Allocation> allocations;std::map<std::string,size_t> counts;std::set<std::string> ambiguous;
  for(const auto &ctor:*cold.tables.constructions){
    if(!check.step())return false;const auto kind=field(ctor,"kind").getAsString().value_or("");if(!inlineTextWork(check,kind.size()))return false;
    if(kind!="implicit-base"||!field(ctor,"function").getAsNull()||!items(field(ctor,"parameters")).empty())continue;
    const auto &type=(*cold.tables.types)[uint32_t(*field(ctor,"owner").getAsInteger())];if(!field(type,"base").getAsNull())continue;
    const auto owner=field(type,"id").getAsString().value_or("");
    if(!inlineTextWork(check,owner.size())||!inlineTreeWork(check,eligible.size(),2*owner.size()+1))return false;eligible.emplace(owner.str(),&ctor);
  }
  for(size_t f=0;f<cold.model.functions.size();++f)for(size_t b=0;b<cold.model.functions[f].blocks.size();++b){
    const auto &block=cold.model.functions[f].blocks[b];for(size_t n=0;n<block.operations.size();++n){
      const auto &op=block.operations[n];if(!inlineTextWork(check,op.name.size()))return false;
      if(op.name!="receiver_create"&&op.name!="receiver_child"&&op.name!="receiver_allocate")continue;
      const auto ownerText=field(op.properties,"owner").getAsString().value_or("");if(!inlineTextWork(check,ownerText.size()))return false;const auto owner=ownerText.str();
      if(!inlineTreeWork(check,eligible.size(),2*owner.size()+1))return false;if(!eligible.count(owner))continue;
      if(op.name=="receiver_allocate"){
        if(!inlineTreeWork(check,counts.size(),2*owner.size()+1))return false;auto count=counts.find(owner);
        if(count==counts.end()){
          if(!inlineTreeWork(check,counts.size(),2*owner.size()+1)||!inlineTextWork(check,owner.size()))return false;count=counts.emplace(owner,0).first;
        }if(!check.step())return false;++count->second;
        if(!inlineTreeWork(check,allocations.size(),7)||!inlineTextWork(check,owner.size()))return false;
        if(!allocations.emplace(std::pair{f,op.operands[0]},Allocation{{b,n},owner}).second){
          if(!inlineTreeWork(check,ambiguous.size(),2*owner.size()+1)||!inlineTextWork(check,owner.size()))return false;ambiguous.insert(owner);
        }
      }else{
        if(!inlineTreeWork(check,frames.size(),2*owner.size()+1))return false;auto found=frames.find(owner);
        if(found==frames.end()){
          if(!inlineTreeWork(check,frames.size(),2*owner.size()+1)||!inlineTextWork(check,owner.size()))return false;found=frames.emplace(owner,std::vector<Frame>{}).first;
        }auto &owned=found->second;
        if(owned.size()==owned.capacity()){
          const auto capacity=owned.empty()?size_t(1):2*owned.size();
          if(!check.step(capacity+2*owned.size()+1))return false;owned.reserve(capacity);
        }if(!check.step(2))return false;owned.push_back({f,op.result});
      }
    }
  }
  for(const auto &[owner,ctor]:eligible){
    if(!inlineTreeWork(check,check.implicitTargets.size(),2*owner.size()+1)||!inlineTreeWork(check,ambiguous.size(),2*owner.size()+1)||
      !inlineTreeWork(check,frames.size(),2*owner.size()+1)||!inlineTreeWork(check,counts.size(),2*owner.size()+1))return false;
    const auto foundFrames=frames.find(owner);const auto foundCount=counts.find(owner);
    if(check.implicitTargets.count(owner)||ambiguous.count(owner)||foundFrames==frames.end()||foundFrames->second.empty()||foundCount==counts.end()||foundFrames->second.size()!=foundCount->second)continue;
    InlineBaseRoot root;bool closed=true;bool first=true;
    for(const auto &frame:foundFrames->second){
      if(!inlineTreeWork(check,allocations.size(),7)||!inlineTextWork(check,2*owner.size()))return false;
      const auto allocation=allocations.find({frame.function,frame.reg});InlineBaseRoot next;
      if(allocation==allocations.end()||allocation->second.owner!=owner||!inlineBaseRoot(cold,check,*ctor,frame.function,frame.reg,allocation->second.at,next)){closed=false;break;}
      if(first){root=std::move(next);first=false;}else{
        if(!inlineTextWork(check,root.canonical.size()+next.canonical.size()))return false;
        if(root.canonical!=next.canonical){closed=false;break;}
      }
    }
    if(!check.e.message.empty())return false;if(!closed)continue;
    constexpr llvm::StringLiteral idPrefix="analysis-construction:",bindingPrefix="analysis-receiver:",rootName="$implicitConstruction",rootRole="construction-body";
    const auto constructionText=field(*ctor,"id").getAsString().value_or("");const auto idBytes=idPrefix.size()+constructionText.size();
    if(!inlineTextWork(check,constructionText.size()+idBytes)||!check.step(idBytes+1))return false;
    const auto construction=constructionText.str();std::string id;id.reserve(idBytes);id.append(idPrefix.data(),idPrefix.size());id+=construction;
    if(!inlineTreeWork(check,check.functions.size(),2*id.size()+1)||!inlineTreeWork(check,check.sourceFunctions.size(),2*id.size()+1)||
      !inlineTreeWork(check,cold.model.internalOwners.size(),2*id.size()+1))return false;
    if(check.functions.count(id)||check.sourceFunctions.count(id)||cold.model.internalOwners.count(id))continue;
    const auto &origin=field(*ctor,"origin");const auto sourceText=field((*cold.tables.sources)[uint32_t(*field(origin,"source").getAsInteger())],"path").getAsString().value_or("");
    if(!inlineTextWork(check,sourceText.size()+construction.size()+owner.size())||!inlineObjectWork(check,{"construction","parameters","returnType"}))return false;
    const auto source=sourceText.str();
    Json signature=Object{{"construction",construction},{"parameters",Array{}},{"returnType",owner}};
    if(!check.analysisMetadataCost(signature))return false;const auto encoded=commonProgram::canonical(signature);
    constexpr llvm::StringLiteral signatureDomain="tsfg.common-program.analysis-construction-signature.v1";
    const auto hashBytes=signatureDomain.size()+1+encoded.size();
    if(!inlineTextWork(check,hashBytes+71)||!check.step(hashBytes+1))return false;std::string hashInput;hashInput.reserve(hashBytes);
    hashInput.append(signatureDomain.data(),signatureDomain.size());hashInput+='\0';hashInput+=encoded;const auto hash=commonProgram::digest(hashInput);
    if(!inlineObjectWork(check,{"start","end"})||!check.step(4))return false;
    Json range=Object{{"start",field(origin,"start")},{"end",field(origin,"end")}};
    if(!inlineObjectWork(check,{"id","name","kind","analysisOnly","ownerType","receiverBinding","sourcePath","range","nameRange","returnType",
      "signatureHash","parameters","bindings","lexicalParent","lexicalEnvironment","activationEnvironment","captures"})||
      !inlineObjectWork(check,{"start","end"})||!inlineObjectWork(check,{"start","end"})||
      !inlineTextWork(check,2*id.size()+rootName.size()+rootRole.size()+2*owner.size()+bindingPrefix.size()+source.size()+hash.size())||!check.step(bindingPrefix.size()+id.size()+8))return false;
    std::string receiverBinding;receiverBinding.reserve(bindingPrefix.size()+id.size());receiverBinding.append(bindingPrefix.data(),bindingPrefix.size());receiverBinding+=id;
    Json metadata=Object{{"id",id},{"name","$implicitConstruction"},{"kind","construction-body"},{"analysisOnly",true},{"ownerType",owner},
      {"receiverBinding",std::move(receiverBinding)},{"sourcePath",source},{"range",range},{"nameRange",range},{"returnType",owner},
      {"signatureHash",hash},{"parameters",Array{}},{"bindings",Array{}},{"lexicalParent",nullptr},{"lexicalEnvironment",nullptr},
      {"activationEnvironment",nullptr},{"captures",Array{}}};
    // Prepay every installation copy and directory operation before publishing
    // any borrowed pointer. A failed prepayment leaves all directories intact.
    if(!inlineTextWork(check,7*id.size()+rootName.size()+rootRole.size()+source.size()+hash.size()+2*owner.size())||
      !inlineTreeWork(check,cold.model.internalOwners.size(),2*id.size()+1)||!inlineTreeWork(check,check.analysisFunctions.size(),2*id.size()+1)||
      !inlineTreeWork(check,check.sourceFunctions.size(),2*id.size()+1)||!inlineTreeWork(check,check.functions.size(),2*id.size()+1)||
      !inlineTreeWork(check,cold.model.internalTargets.size(),2*owner.size()+1)||!inlineTreeWork(check,cold.model.operationSources.size(),2*id.size()+1))return false;
    for(size_t n=0;n<root.function.carriers.size();++n){
      size_t digits=1;for(auto v=n;v>=10;v/=10){if(!check.step())return false;++digits;}
      const auto bytes=id.size()+1+digits;
      if(!inlineTreeWork(check,check.views.size()+n,2*bytes+1)||!inlineTextWork(check,bytes+digits+root.function.carriers[n].size())||!check.step(bytes+2))return false;
    }
    root.function.id=id;root.function.name="$implicitConstruction";root.function.path=source;root.function.role="construction-body";
    root.function.signature=hash;root.function.range={uint32_t(*field(origin,"start").getAsInteger()),uint32_t(*field(origin,"end").getAsInteger())};root.function.resultCarrier=owner;
    const auto storedOwner=cold.model.internalOwners.emplace(id,std::move(metadata));
    const auto storedFunction=check.analysisFunctions.emplace(id,std::move(root.function));
    check.sourceFunctions.emplace(id,&storedOwner.first->second);check.functions.emplace(id,&storedFunction.first->second);
    cold.model.internalTargets.emplace(owner,id);cold.model.operationSources.emplace(id,std::move(root.sources));
    const auto &views=storedFunction.first->second.carriers;
    for(size_t n=0;n<views.size();++n){
      const auto digits=std::to_string(n);std::string key;key.reserve(id.size()+1+digits.size());key=id;key+='/';key+=digits;
      check.views.emplace(std::move(key),views[n]);
    }
  }
  return check.e.message.empty();
}
}
bool CommonCold::actual(){
  model.remaining=tables.remaining;ActualCheck check{model,failure};
  const bool tracing=std::getenv("TSFG_COMMON_ACTUAL_TRACE")!=nullptr;
  const auto phase=[&](const char *name){if(tracing)llvm::errs()<<"[DEBUG-23j-common-actual] "<<name<<" remaining="<<model.remaining<<" contexts="<<check.contexts.size()<<'\n';};
  phase("begin");
  if(!check.catalogs()){tables.remaining=model.remaining;return reject(failure.message);}
  phase("catalogs");
  for(const auto &[id,views]:model.registerViews)for(size_t r=0;r<views.size();++r){
    if(!check.step()){tables.remaining=model.remaining;return reject(failure.message);}check.views.emplace(id+"/"+std::to_string(r),views[r]);
  }
  if(containsReceiverProtocol&&!installInlineBaseRoots(*this,check)){tables.remaining=model.remaining;return reject(failure.message);}
  check.initializedArrays=initializedArrays;
  // The Source verifier obtains this closure from owned statements. Here its
  // actual inputs are the independently checked typed graph and target flow.
  std::map<std::string,std::set<std::string>> calls;
  std::map<std::string,std::vector<const std::string *>> receiverCallers;
  const auto activationEdge=[&](const std::string &from,const std::string &to){
    if(!containsReceiverProtocol)return true;if(!check.step(to.size()/64+2))return false;
    receiverCallers[to].push_back(&from);return true;
  };
  std::map<std::string,std::string> owners;
  for(const auto &binding:*tables.bindings){if(!check.step()){tables.remaining=model.remaining;return reject(failure.message);}
    if(!field(binding,"scope").getAsNull())owners.emplace(string(field(binding,"id")),function(uint32_t(*field(binding,"owner").getAsInteger())));
  }
  for(const auto &[id,fn]:check.sourceFunctions)for(const auto &capture:items(field(*fn,"captures"))){
    if(!check.step()){tables.remaining=model.remaining;return reject(failure.message);}check.environmentNeeds[id].insert(string(field(capture,"binding")));
  }
  for(const auto &fn:model.functions)for(const auto &block:fn.blocks)for(const auto &op:block.operations){
    if(!check.step()){tables.remaining=model.remaining;return reject(failure.message);}
    if(op.name=="invoke"||op.name=="make_closure"){
      auto target=string(field(op.properties,"function_id"));
      if(op.name=="invoke"&&!activationEdge(fn.id,target)){tables.remaining=model.remaining;return reject(failure.message);}
      calls[fn.id].insert(std::move(target));
    }
    else if(op.name=="invoke_method"){
      std::vector<std::string> targets;if(!methodTargets(model,field(op.properties,"dispatch"),targets,failure)){tables.remaining=model.remaining;return reject(failure.message);}
      calls[fn.id].insert(targets.begin(),targets.end());
      if(containsReceiverProtocol)for(const auto &target:targets)if(!activationEdge(fn.id,target)){tables.remaining=model.remaining;return reject(failure.message);}
    }else if(op.name=="invoke_indirect"){
      const auto &targets=model.callableSites.at(fn.id+"/"+std::to_string(op.range.start)+":"+std::to_string(op.range.end));
      if(!check.step(targets.functions.size())){tables.remaining=model.remaining;return reject(failure.message);}calls[fn.id].insert(targets.functions.begin(),targets.functions.end());
      if(containsReceiverProtocol)for(const auto &target:targets.functions)if(!activationEdge(fn.id,target)){tables.remaining=model.remaining;return reject(failure.message);}
    }
  }
  bool changed=true;
  while(changed){changed=false;for(const auto &[id,targets]:calls)for(const auto &target:targets){
    if(!check.step()||!check.need(check.sourceFunctions.count(target),"Common lexical target has no Source function interface")){tables.remaining=model.remaining;return reject(failure.message);}
    for(const auto &binding:check.environmentNeeds[target]){
      if(!check.step()||!check.need(owners.count(binding),"Common lexical capture has no original binding owner")){tables.remaining=model.remaining;return reject(failure.message);}
      if(!check.sourceFunctions.count(id))continue;auto parent=string(field(*check.sourceFunctions.at(id),"lexicalParent"));
      while(!parent.empty()){
        if(!check.step()||!check.need(check.sourceFunctions.count(parent),"Common lexical capture ancestor is missing")){tables.remaining=model.remaining;return reject(failure.message);}
        if(parent==owners.at(binding)){changed|=check.environmentNeeds[id].insert(binding).second;break;}parent=string(field(*check.sourceFunctions.at(parent),"lexicalParent"));
      }
    }
  }}
  check.environmentNeedsReady=true;
  phase("environment-closure");
  for(const auto &[id,fn]:check.functions)if(!check.environmentGraph(*fn)){tables.remaining=model.remaining;return reject(failure.message);}
  phase("environment-graph");
  // These solvers consume normalized SSA/heap facts. Source-only run(),
  // source(), AST matching and owned-body effect derivation are not invoked.
  bool valid=check.callGraph();phase("callGraph");
  if(valid&&containsReceiverProtocol){
    for(const auto &abi:*tables.abis){
      if(!check.step(2)){valid=false;break;}const auto &parameters=items(field(abi,"parameters")),&incoming=items(field(abi,"argumentTypes"));
      for(size_t i=0;i<parameters.size();++i){
        if(!check.step(2)){valid=false;break;}const auto &binding=(*tables.bindings)[size_t(*parameters[i].getAsInteger())];
        if(incoming[i].getAsInteger()!=field(binding,"type").getAsInteger()){
          reject("Common receiver proof lacks independent cold FDI raw-entry metadata");valid=false;break;
        }
      }if(!valid)break;
    }
    // Root seeding needs an actual normalized target for every nominal and
    // ancestor. Cold directories cannot invent Source-derived private plans.
    for(const auto &[id,type]:check.types){
      if(!valid)break;if(!check.step()){valid=false;break;}const auto &ctor=field(*type,"construction");if(ctor.getAsNull())continue;
      if(field(ctor,"functionId").getAsNull()){
        const auto target=check.implicitTargets.find(id);
        if(target==check.implicitTargets.end()||!check.functions.count(target->second)){
          reject("Common receiver proof lacks a normalized implicit construction target");valid=false;break;
        }
      }
    }
    std::set<std::string> affected;std::vector<const std::string *> pending;
    for(const auto &[id,fn]:check.functions){
      if(!valid)break;bool creates=fn->role=="construction-body";
      for(size_t b=0;valid&&b<fn->blocks.size();++b)for(const auto &op:fn->blocks[b].operations){
        if(!check.step()){valid=false;break;}
        if(op.name!="receiver_create"&&op.name!="receiver_child"&&op.name!="receiver_allocate")continue;
        creates=true;if(!check.step(id.size()/64+2)){valid=false;break;}
        if(check.repeatingBlocks.count(id+"/"+std::to_string(b))){
          reject("Common repeated receiver creation/allocation needs a dynamic freshness proof");valid=false;break;
        }
      }
      if(creates&&valid){if(!check.step(id.size()/64+2)){valid=false;break;}const auto entry=affected.insert(id);pending.push_back(&*entry.first);}
    }
    for(size_t i=0;valid&&i<pending.size();++i){
      if(!check.step()){valid=false;break;}const auto &id=*pending[i];
      if(check.cyclicFunctions.count(id)){reject("Common recursive receiver activation needs a dynamic freshness proof");valid=false;break;}
      const auto parents=receiverCallers.find(id);if(parents==receiverCallers.end())continue;
      for(const auto *parent:parents->second){
        if(!check.step(parent->size()/64+2)){valid=false;break;}const auto entry=affected.insert(*parent);if(entry.second)pending.push_back(&*entry.first);
      }
    }
    for(const auto &[id,fn]:check.functions){
      if(!valid)break;if(!check.step()){valid=false;break;}if(!affected.count(id))continue;
      for(const auto &block:fn->blocks){if(!valid)break;for(const auto &op:block.operations){
        if(!check.step()){valid=false;break;}
        if(check.unresolvedCalls.count(&op)){reject("Common receiver activation lacks a complete fixed call target/permission boundary");valid=false;break;}
      }}
    }
  }
  if(valid){valid=check.solve(true);phase("solve-conditional");}
  if(valid){valid=check.representation();phase("representation");}
  if(valid){valid=check.effects();phase("effects");}
  if(valid){valid=check.solve(false);phase("solve-final");}
  if(valid&&containsReceiverProtocol){
    // Fixed body proof consumes solved storage/ABI before borrow reads it.
    tables.remaining=model.remaining;
    valid=effects();
    model.remaining=tables.remaining;
  }
  if(valid){valid=verifyCommonBorrows(check);phase("borrow");}
  tables.remaining=model.remaining;return valid||(failure.message.empty()?false:reject(failure.message));
}
} // namespace tsfg::wire
