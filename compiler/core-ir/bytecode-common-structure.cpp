// SPDX-License-Identifier: MIT
#include "bytecode-common-cold.h"
#include "bytecode-common-numeric.h"
#include "common-program-plan.h"
#include <algorithm>
#include <deque>

namespace tsfg::wire {
using namespace commonProgram;
namespace {
bool fuel(CommonCold &cold,size_t index){
  const auto &fn=cold.tables.program.functions[index];size_t entries=0;
  std::vector<bool> charged(fn.blocks.size());std::vector<std::vector<uint16_t>> edges(fn.blocks.size());
  for(size_t b=0;b<fn.blocks.size();++b){
    const auto &block=fn.blocks[b];
    for(size_t i=0;i<block.instructions.size();++i){
      if(!cold.charge())return false;const auto &op=block.instructions[i];if(op.opcode!=26)continue;
      Payload data(op.payload);const auto event=data.integer(1);
      if(op.sourceIndex!=fn.source)return cold.reject("Common fuel Source differs from its function");
      if(event==1){
        ++entries;if(b||fn.role==2||op.source.start!=fn.declaration.start||op.source.end!=fn.declaration.end)return cold.reject("Common entry fuel identity");
        for(size_t n=0;n<i;++n)if(!cold.charge()||block.instructions[n].opcode!=65)return cold.reject("Common entry fuel has a non-activation prefix");
      }else if(event==2){if(!b||i)return cold.reject("Common condition fuel is not the first loop-header event");charged[b]=true;}
      else return cold.reject("Common fuel event kind");
    }
    edges[b]=cold.model.functions[index].blocks[b].operations.back().successors;
  }
  if(entries!=(fn.role==2?0:1))return cold.reject("Common unique entry fuel coverage");
  std::vector<size_t> incoming(fn.blocks.size());size_t remaining=0;std::deque<size_t> pending;
  for(size_t b=0;b<edges.size();++b)if(!charged[b]){++remaining;for(auto next:edges[b])if(!charged[next]){if(!cold.charge())return false;++incoming[next];}}
  for(size_t b=0;b<edges.size();++b)if(!charged[b]&&!incoming[b])pending.push_back(b);
  size_t visited=0;while(!pending.empty()){
    if(!cold.charge())return false;const auto b=pending.front();pending.pop_front();++visited;
    for(auto next:edges[b])if(!charged[next]&&!--incoming[next])pending.push_back(next);
  }
  return visited==remaining||cold.reject("Common CFG cycle bypasses condition fuel");
}
// This boundary owns the untrusted logical witness. It grants only exact
// correspondence to the already validated physical graph, never Source authority.
bool readSourcePlan(ActualCheck &check,const Json &value,const commonProgram::Function &actual,
  const Array &sources,commonProgram::Function &expected,std::map<std::pair<size_t,size_t>,std::string> &paths,
  std::vector<size_t> &incoming){
  const auto *plan=value.getAsObject();
  if(!check.step(3)||!check.need(shape(plan,{"carriers","blocks"})&&plan->getArray("carriers")&&
      plan->getArray("blocks"),"Common sourcePlan exact arrays"))return false;
  const auto &carriers=*plan->getArray("carriers"),&blocks=*plan->getArray("blocks");
  if(!check.need(carriers.size()<=4096&&!blocks.empty()&&blocks.size()<=256,"Common sourcePlan register/block bound")||
      !check.step(3*carriers.size()+blocks.size()+2+(actual.id.size()+actual.path.size())/32))return false;
  expected.id=actual.id;expected.path=actual.path;expected.carriers.reserve(carriers.size());expected.blocks.resize(blocks.size());
  incoming.assign(blocks.size(),0);std::vector<int> definitions(carriers.size(),-1);std::vector<bool> used(carriers.size());
  const auto text=[&](const Json &row,std::string &out,bool empty=false){const auto raw=row.getAsString();
    if(!check.step(2+(raw?raw->size()/32:0))||!check.need(raw&&textValue(&row,4096,empty),"Common sourcePlan text bound/UTF8"))return false;
    out=raw->str();return true;
  };
  for(const auto &row:carriers){std::string view;if(!text(row,view))return false;expected.carriers.push_back(std::move(view));}
  size_t operations=0;
  for(size_t b=0;b<blocks.size();++b){const auto *row=blocks[b].getAsObject();
    if(!check.step(3)||!check.need(shape(row,{"parameters","operations"})&&row->getArray("parameters")&&row->getArray("operations"),"Common sourcePlan block shape"))return false;
    const auto &parameters=*row->getArray("parameters"),&ops=*row->getArray("operations");auto &block=expected.blocks[b];
    if(!check.need(parameters.size()<=4096&&ops.size()<=8192-operations,"Common sourcePlan block count")||
        !check.step(2*parameters.size()+ops.size()+2))return false;
    block.parameters.reserve(parameters.size());block.operations.reserve(ops.size());operations+=ops.size();
    for(const auto &parameter:parameters){uint64_t reg;
      if(!check.need(unsignedValue(&parameter,4095,reg)&&reg<carriers.size()&&definitions[reg]==-1,"Common sourcePlan duplicate/invalid block parameter"))return false;
      definitions[reg]=int(b);block.parameters.push_back(uint16_t(reg));
    }
    for(size_t n=0;n<ops.size();++n){const auto *raw=ops[n].getAsObject();
      if(!check.step(12)||!check.need(shape(raw,{"name","view","properties","result","operands","successors","source"})&&
          raw->getObject("properties")&&raw->getArray("operands")&&raw->getArray("successors")&&raw->getObject("source"),"Common sourcePlan operation shape"))return false;
      Operation op;if(!text(*raw->get("name"),op.name)||!text(*raw->get("view"),op.view,true))return false;
      const auto &operands=*raw->getArray("operands"),&successors=*raw->getArray("successors");
      if(!check.need(operands.size()<=4096&&successors.size()<=256,"Common sourcePlan operand/successor bound")||
          !check.step(2*(operands.size()+successors.size())+1))return false;
      op.operands.reserve(operands.size());op.successors.reserve(successors.size());
      if(!raw->get("result")->getAsNull()){uint64_t reg;
        if(!check.need(unsignedValue(raw->get("result"),4095,reg)&&reg<carriers.size()&&definitions[reg]==-1,"Common sourcePlan duplicate/invalid result"))return false;
        definitions[reg]=int(b);op.result=uint16_t(reg);
      }
      for(const auto &operand:operands){uint64_t reg;if(!check.need(unsignedValue(&operand,4095,reg)&&reg<carriers.size(),"Common sourcePlan operand reference"))return false;
        used[reg]=true;op.operands.push_back(uint16_t(reg));}
      for(const auto &successor:successors){uint64_t next;
        if(!check.need(unsignedValue(&successor,255,next)&&next<blocks.size()&&n+1==ops.size(),"Common sourcePlan nonterminal/invalid CFG edge"))return false;
        ++incoming[next];op.successors.push_back(uint16_t(next));
      }
      if(!check.need((op.name!="invoke"&&op.name!="invoke_method"&&op.name!="invoke_indirect")||op.successors.size()==2,"Common sourcePlan invoke completions"))return false;
      const auto *source=raw->getObject("source");uint64_t start,end;std::string path;
      if(!check.need(shape(source,{"path","start","end"}),"Common sourcePlan Source shape")||!text(*source->get("path"),path)||
          !check.need(unsignedField(source,"start",UINT32_MAX,start)&&unsignedField(source,"end",UINT32_MAX,end)&&start<=end,"Common sourcePlan Source range"))return false;
      bool owned=false;for(const auto &entry:sources){const auto &original=*entry.getAsObject()->getString("path");
        if(!check.step(1+(original.size()+path.size())/64))return false;
        if(original==path){owned=end<=uint64_t(*entry.getAsObject()->getInteger("length"));break;}}
      if(!check.need(owned,"Common sourcePlan original Source path/range"))return false;
      op.range={uint32_t(start),uint32_t(end)};
      size_t comparisons=1;for(auto count=paths.size();count;count>>=1){if(!check.step())return false;comparisons+=2;}
      if(!check.step(2*comparisons+path.size()/64+1)||!returnOriginMetadataCost(check.p,*raw->get("properties"),check.e))return false;
      paths.emplace(std::pair<size_t,size_t>{b,n},std::move(path));op.properties=*raw->get("properties");block.operations.push_back(std::move(op));
    }
  }
  if(!check.need(!expected.blocks[0].operations.empty()&&std::none_of(definitions.begin(),definitions.end(),[](int owner){return owner<0;}),"Common sourcePlan entry/complete SSA definitions"))return false;
  for(size_t b=0;b<expected.blocks.size();++b){if(!check.step())return false;const auto &block=expected.blocks[b];if(!block.operations.empty())continue;
    if(!check.need(b!=0&&incoming[b]==0,"Common reserved Source block has an incoming edge")||!check.step(block.parameters.size()))return false;
    for(auto reg:block.parameters)if(!check.need(!used[reg],"Common reserved Source block parameter was consumed"))return false;
  }
  // The full matcher below carries dominance and opcode/terminal obligations
  // from the independently checked actual graph through only its old adapters.
  return true;
}
}
bool CommonCold::graphStructure(){
  Array domains,bindings,functions;
  for(size_t i=0;i<tables.types->size();++i){
    if(!charge())return false;if(!tables.typeLayouts[i])continue;const auto &layout=*tables.typeLayouts[i];
    model.layouts.emplace(type(uint32_t(i)),Layout{layout.bytes,layout.alignment,layout.roots,layout.offsets});
  }
  for(size_t i=0;i<tables.domains->size();++i){
    if(!charge())return false;const auto &row=(*tables.domains)[i];Array actualTypes;
    for(const auto &t:items(field(row,"actualTypes"))){if(!charge())return false;actualTypes.push_back(type(uint32_t(*t.getAsInteger())));}
    domains.push_back(Object{{"id",field(row,"id")},{"actualTypes",std::move(actualTypes)},{"representation",field(row,"representation")},
      {"alignment",field(row,"alignment")},{"tagBytes",field(row,"tagBytes")},{"byteSize",field(row,"byteSize")},{"referenceCount",field(row,"referenceCount")}});
    if(!tables.domainLayouts[i])return reject("Common independently derived actual-domain layout is absent");const auto &layout=*tables.domainLayouts[i];
    model.layouts.emplace(string(field(row,"id")),Layout{layout.bytes,layout.alignment,layout.roots,layout.offsets});
  }
  for(const auto &row:*tables.environments){if(!charge())return false;model.layouts.emplace("env:"+string(field(row,"id")),Layout{8,8,1,{}});}
  for(const auto &row:*tables.constructions){
    if(!charge(2))return false;const auto owner=type(uint32_t(*field(row,"owner").getAsInteger()));
    if(!charge(2+(9+owner.size())/64+(15+owner.size())/64))return false;
    model.layouts.emplace("receiver:"+owner,Layout{32,8,1,{}});model.layouts.emplace("initialization:"+owner,Layout{16,8,1,{}});
  }
  model.layouts.emplace("payload:"+commonProgram::schema.str(),Layout{16,8,1,{}});
  for(const auto &row:*tables.bindings){
    if(!charge())return false;bindings.push_back(Object{{"id",field(row,"id")},{"carrier",carrier(field(row,"carrier"))}});
    if(!field(row,"scope").getAsNull())for(const auto &part:items(field((*tables.scopes)[uint32_t(*field(row,"scope").getAsInteger())],"path"))){
      if(!charge())return false;model.bindingScopes[string(field(row,"id"))].push_back(string(part));
    }
  }
  for(size_t i=0;i<tables.abis->size();++i){
    if(!charge())return false;const auto &abi=(*tables.abis)[i];Array parameters;
    for(const auto &parameter:items(field(abi,"physicalParameters"))){if(!charge())return false;parameters.push_back(carrier(parameter));}
    functions.push_back(Object{{"id",function(uint32_t(i))},{"parameters",std::move(parameters)},{"result",carrier(field(abi,"resultCarrier"))}});
  }
  model.representation=Object{{"domains",std::move(domains)},{"bindings",std::move(bindings)},{"functions",std::move(functions)}};
  for(auto &fn:*model.hir.getAsObject()->getArray("functions"))for(auto key:{"parameters","bindings"})for(auto &binding:*fn.getAsObject()->getArray(key))
    (*binding.getAsObject())["lexicalOwner"]=field(fn,"id");
  model.remaining=tables.remaining;ActualCheck check{model,failure};
  for(size_t f=0;f<tables.program.functions.size();++f){
    const auto &fn=tables.program.functions[f];auto &views=model.registerViews[function(uint32_t(f))];
    for(size_t r=0;r<fn.registers.size();++r){
      if(!check.step())break;const auto id=fn.registers[r].view==UINT16_MAX?model.functions[f].carriers[r]:type(fn.registers[r].view);
      containsReceiverProtocol|=fn.registers[r].kind==5||fn.registers[r].kind==6;
      views.push_back(id);check.views.emplace(function(uint32_t(f))+"/"+std::to_string(r),id);
    }
  }
  const bool valid=failure.message.empty()&&check.catalogs()&&check.graph();tables.remaining=model.remaining;
  if(!valid)return failure.message.empty()?false:reject(failure.message);
  for(size_t i=0;i<tables.program.functions.size();++i)if(!fuel(*this,i)||!verifyCommonNumeric(*this,i))return false;
  // All original actual graph/fuel/numeric checks succeeded. Resume the same
  // live meter and ActualCheck; the witness cannot overwrite its static views.
  model.remaining=tables.remaining;
  for(size_t i=0;i<model.functions.size();++i){const auto &actual=model.functions[i];commonProgram::Function expected;
    std::map<std::pair<size_t,size_t>,std::string> paths;std::vector<size_t> incoming;
    if(!readSourcePlan(check,field((*tables.abis)[i],"sourcePlan"),actual,*tables.sources,expected,paths,incoming)||
        !matchSourceCorrespondence(check,expected,paths,incoming,actual)){
      tables.remaining=model.remaining;return failure.message.empty()?false:reject(failure.message);
    }
    size_t comparisons=1;for(auto count=model.functions.size();count;count>>=1){if(!check.step()){tables.remaining=model.remaining;return reject(failure.message);}comparisons+=2;}
    if(!check.step(3*comparisons*(actual.id.size()/64+1))){tables.remaining=model.remaining;return reject(failure.message);}
    const auto registers=model.sourceRegisters.find(actual.id);const auto views=model.registerViews.find(actual.id);
    const auto sources=model.operationSources.find(actual.id);
    if(!check.need(registers!=model.sourceRegisters.end()&&views!=model.registerViews.end()&&sources!=model.operationSources.end()&&
        registers->second.size()==actual.carriers.size()&&views->second.size()==actual.carriers.size(),"Common sourcePlan complete original view join")){
      tables.remaining=model.remaining;return reject(failure.message);
    }
    for(size_t raw=0;raw<actual.carriers.size();++raw){const auto semantic=registers->second[raw];
      if(!check.step(2+views->second[raw].size()/32)||!check.need(semantic<expected.carriers.size()&&expected.carriers[semantic]==views->second[raw],"Common sourcePlan raw/semantic original static view differs")){
        tables.remaining=model.remaining;return reject(failure.message);
      }
    }
    const auto &wire=tables.program.functions[i];size_t operationCount=0;
    for(size_t b=0;b<wire.blocks.size();++b)for(size_t n=0;n<wire.blocks[b].instructions.size();++n){const auto &op=wire.blocks[b].instructions[n];
      const auto &path=*(*tables.sources)[op.sourceIndex].getAsObject()->getString("path");++operationCount;
      size_t lookups=1;for(auto count=sources->second.size();count;count>>=1){if(!check.step()){tables.remaining=model.remaining;return reject(failure.message);}lookups+=2;}
      if(!check.step(2*lookups+path.size()/32+1)){tables.remaining=model.remaining;return reject(failure.message);}
      const auto mapped=sources->second.find({uint16_t(b),uint16_t(n)});
      if(!check.need(mapped!=sources->second.end()&&llvm::StringRef(mapped->second)==path,"Common sourcePlan differs from original wire SourceIndex path")){
        tables.remaining=model.remaining;return reject(failure.message);
      }
    }
    if(!check.need(sources->second.size()==operationCount,"Common sourcePlan complete operation path join")){tables.remaining=model.remaining;return reject(failure.message);}
  }
  tables.remaining=model.remaining;
  return true;
}
} // namespace tsfg::wire
