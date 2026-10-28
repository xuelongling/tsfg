// SPDX-License-Identifier: MIT
// Target-flow models only: no Source or execution qualification is claimed.
#include "common-program-source.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/raw_ostream.h"
using namespace tsfg::commonProgram;
int main(int argc,char **argv){
  if(argc!=2)return 2;auto bytes=llvm::MemoryBuffer::getFile(argv[1]);if(!bytes)return 2;
  Program decoded;Error read;auto text=(*bytes)->getBuffer();if(text.ends_with("\n"))text=text.drop_back();
  Json models=nullptr;if(!readJson(text,models,decoded,read)){llvm::errs()<<read.message<<"\n";return 2;}
  bool ok=true;size_t count=0;
  for(const auto &model:items(models)){
    Program p;p.hir=field(model,"hir");p.publication=field(model,"publication");Error error;
    bool accepted=verifyCallableTargets(p,error);const auto name=string(field(model,"name"));
    const auto found=p.callableSites.find("root/10:20");bool matched=accepted&&found!=p.callableSites.end();
    // Independent expectations are chosen here, not copied from producer rows.
    const bool top=name=="unknown-writer"||name=="external"||name=="host"||name=="permission-host"||name=="permission-constructor"||name=="array"||name=="unknown-assertion"||name=="scalar-assertion"||name=="unproved-alias"||name=="unproved-view"||name.rfind("erased-",0)==0;
    if(matched){std::set<std::string> expected={"left","right"};if(name=="initializer")expected={"left"};
      if(name=="fixed-upper")expected.insert("unrelated");matched=found->second.top==top&&(top||found->second.functions==expected);}
    llvm::outs()<<name<<": "<<(matched?"PASS":"FAIL")<<"\n";if(!matched)llvm::errs()<<error.code<<": "<<error.message<<"\n";
    ok&=matched;++count;
  }
  Program limited;limited.hir=field(items(models)[0],"hir");limited.publication=field(items(models)[0],"publication");limited.remaining=10;Error budget;
  const bool bounded=!verifyCallableTargets(limited,budget)&&budget.code=="core-ir-common-budget";llvm::outs()<<"budget: "<<(bounded?"PASS":"FAIL")<<"\n";
  llvm::outs()<<"models: "<<count<<"\n";return ok&&bounded&&count==21?0:1;
}
