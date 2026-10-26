// SPDX-License-Identifier: MIT
// Complete, genuine owned Source input at the production SourcePlan boundary.
// This does not read or manufacture a Core, representation, or success proof.
#include "common-program-plan.h"
#include "common-program-borrows.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/raw_ostream.h"
using namespace tsfg::commonProgram;
namespace {
bool read(const std::string &path,Json &out,Program &p,Error &e){
  auto bytes=llvm::MemoryBuffer::getFile(path);if(!bytes)return reject(e,"test-input","complete owned input unavailable");
  auto text=(*bytes)->getBuffer();if(text.ends_with("\n"))text=text.drop_back();return readJson(text,out,p,e);
}
void header(Program &p){
  p.inputIdentity=string(field(p.hir,"inputIdentity"));p.sourcePath=string(field(p.hir,"rootFile"));p.hirHash=digest(canonical(p.hir)+"\n");
  for(const auto &row:items(field(p.hir,"sources")))if(string(field(row,"path"))==p.sourcePath)p.sourceHash=string(field(row,"hash"));
  for(const auto &row:items(field(field(field(p.hir,"snapshot"),"payload"),"files")))if(string(field(row,"path"))==p.sourcePath)
    p.sourceLength=field(row,"utf16Length").getAsInteger().value_or(0);
}
bool numericContinuations(ActualCheck &check,Function &fn){
  // SourcePlan's logical scalar operation corresponds to these exact request
  // checks in the production matcher. Reuse its policy and the actual solver;
  // an undefined operand must trap rather than be coerced by this adapter.
  if(!check.step(fn.blocks.size()))return false;auto original=std::move(fn.blocks);fn.blocks.resize(original.size());
  for(size_t b=0;b<original.size();++b){
    fn.blocks[b].parameters=std::move(original[b].parameters);size_t current=b;
    for(auto &operation:original[b].operations){
      if(!check.step())return false;auto op=std::move(operation);
      if(sourceNumeric(fn,op))for(size_t i=0;i<op.operands.size();++i){
        if(!check.step()||!check.need(fn.blocks.size()<256&&fn.carriers.size()<4096,"Source request continuation limit exceeded"))return false;
        const auto target=uint16_t(fn.blocks.size()),reg=uint16_t(fn.carriers.size()),operand=op.operands[i];const auto type=fn.carriers[operand];
        Operation use;use.name="numeric_use";use.range=op.range;use.view=type;use.operands={operand};use.successors={target};
        use.properties=Object{{"operator",field(op.properties,"operator")},{"index",int64_t(i)},{"operand_view",type}};
        fn.blocks[current].operations.push_back(std::move(use));fn.carriers.push_back(type);fn.blocks.push_back({{reg},{}});current=target;op.operands[i]=reg;
      }
      fn.blocks[current].operations.push_back(std::move(op));
    }
  }return true;
}
bool sourceGraph(ActualCheck &check){
  auto &p=check.p;const auto &functions=items(field(p.hir,"functions")),&modules=items(field(p.hir,"modules"));
  if(!check.step(functions.size()+modules.size()))return false;p.functions.resize(functions.size()+modules.size());size_t index=0;
  for(const auto &fn:functions)p.functions[index++].id=string(field(fn,"id"));
  for(const auto &m:modules)p.functions[index++].id=string(field(m,"initializer"));
  if(!check.catalogs())return false;
  for(auto &fn:p.functions){
    if(!check.step())return false;const bool init=check.modules.count(fn.id);Json initializer=nullptr;const Json *owner;
    if(init){
      const auto &m=*check.modules.at(fn.id);uint32_t length=0;const auto path=string(field(m,"sourcePath"));
      for(const auto &raw:items(field(field(field(p.hir,"snapshot"),"payload"),"files"))){
        if(!check.step())return false;if(string(field(raw,"path"))==path)length=field(raw,"utf16Length").getAsInteger().value_or(0);
      }
      initializer=Object{{"id",fn.id},{"sourcePath",path},{"kind","module-initializer"},{"returnType","void"},{"parameters",Array{}},
        {"body",field(m,"initialization")},{"range",Object{{"start",0},{"end",length}}}};owner=&initializer;
    }else owner=check.sourceFunctions.at(fn.id);
    SourcePlan plan(check,*owner);if(!plan.run())return false;
    // The production matcher permits only empty, unreferenced logical blocks
    // to disappear. Compact those same blocks before the actual CFG consumer.
    std::map<uint16_t,uint16_t> blocks;
    for(size_t i=0;i<plan.function.blocks.size();++i){if(!check.step())return false;
      if(plan.function.blocks[i].operations.empty()){if(!check.need(plan.incoming[i]==0,"empty Source block has incoming flow"))return false;}
      else blocks.emplace(uint16_t(i),uint16_t(blocks.size()));
    }
    std::vector<Block> compact;if(!check.step(blocks.size()))return false;compact.reserve(blocks.size());
    for(const auto &[from,to]:blocks){
      auto &block=plan.function.blocks[from];for(auto &op:block.operations)for(auto &target:op.successors){
        if(!check.step()||!check.need(blocks.count(target),"Source successor has no complete block"))return false;target=blocks.at(target);
      }compact.push_back(std::move(block));
    }
    plan.function.blocks=std::move(compact);fn=std::move(plan.function);fn.role=string(field(*owner,"kind"));if(!numericContinuations(check,fn))return false;
    fn.signature=init?digest(std::string("tsfg.common-program.initializer-signature.v1")+std::string(1,'\0')+"void"):string(field(*owner,"signatureHash"));
    for(size_t reg=0;reg<fn.carriers.size();++reg){if(!check.step())return false;check.views.emplace(fn.id+"/"+std::to_string(reg),fn.carriers[reg]);}
    if(!check.environmentGraph(fn))return false;
  }
  return check.callGraph()&&check.solve(false);
}
bool run(const std::string &prefix,llvm::StringRef expected){
  Program p;Error e;bool passed=read(prefix+"-hir.json",p.hir,p,e)&&read(prefix+"-publication.json",p.publication,p,e)&&read(prefix+"-request.json",p.request,p,e);
  if(passed){header(p);passed=verifySource(p,e)&&verifyCallableTargets(p,e)&&verifyPublication(p,e);}
  if(!passed){llvm::errs()<<"complete Source/publication setup: "<<e.code<<": "<<e.message<<"\n";return false;}
  ActualCheck actual{p,e};std::map<std::string,Json> semanticSlots;
  // environmentGraph also checks each original cell's initialization flow.
  // This SourcePlan adapter supplies its declared logical slot types, not a
  // producer physical table. Physical carrier/layout qualification is absent.
  for(const auto &environment:items(field(p.hir,"environments")))for(const auto &slot:items(field(environment,"slots"))){
    if(!actual.step())return false;const auto binding=string(field(slot,"binding"));
    semanticSlots.emplace(binding,Object{{"carrier",field(slot,"type")}});actual.physicalBindings.emplace(binding,&semanticSlots.at(binding));
  }
  if(!sourceGraph(actual)){llvm::errs()<<"complete production SourcePlan/actual: "<<e.code<<": "<<e.message<<"\n";return false;}
  const bool accepted=verifyCommonBorrows(actual);bool correct=expected=="accept"?accepted:!accepted&&e.code=="core-ir-common-borrow"&&
    e.path==p.sourcePath&&e.range.end>e.range.start&&(expected=="reject"||llvm::StringRef(e.message).contains(expected=="conflict"?"active ReadSpan":"unproved"));
  llvm::outs()<<prefix<<": "<<(correct?"PASS":"FAIL")<<" complete-functions="<<p.functions.size()<<" contexts="<<actual.contexts.size()<<"\n";
  if(!accepted)llvm::outs()<<e.code<<": "<<e.message<<" ("<<e.path<<":"<<e.range.start<<":"<<e.range.end<<")\n";
  return correct;
}
}
int main(int argc,char **argv){
  if(argc<3||argc%2==0)return 2;bool ok=true;
  for(int i=1;i<argc;i+=2)ok=run(argv[i+1],argv[i])&&ok;return ok?0:1;
}
