// SPDX-License-Identifier: MIT
// Pure owned lexical/CFG contracts, not Source packets or program execution.
#include "../../compiler/core-ir/environment-contracts.h"
#include <iostream>
using namespace tsfg::environmentContracts;
int main(){
  size_t checks=0;bool passed=true;const auto charge=[](size_t){return true;};
  const auto report=[&](const char *name,bool ok){++checks;passed&=ok;std::cout<<name<<" "<<(ok?"PASS":"FAIL")<<"\n";};
  Catalogue c; c.functions.emplace("factory",Function{"","","env","/src/model.ts",1,100,{}});
  c.functions.emplace("bump",Function{"factory","env","","/src/model.ts",30,70,{}});
  c.environments.emplace("env",Environment{"factory","",{{"n","i32","local",0,true}}});
  std::string error;report("nearest lexical layout",validate(c,charge,error));
  auto changed=c;changed.functions.at("bump").lexical.clear();error.clear();report("missing nearest layout",!validate(changed,charge,error));
  changed=c;changed.environments.at("env").parent="env";error.clear();report("wrong parent layout",!validate(changed,charge,error));
  changed=c;changed.functions.at("factory").parent="bump";error.clear();report("lexical cycle",!validate(changed,charge,error));
  changed=c;changed.environments.emplace("child",Environment{"bump","env",{{"n","i32","local",0,true}}});error.clear();report("cell unique owner",!validate(changed,charge,error));
  error.clear();report("lexical work budget",!validate(c,[](size_t){return false;},error));
  const Event init{EventKind::Initialize,"n"},load{EventKind::Observe,"n"};
  const auto run=[&](const char *name,const InitializationGraph &g,bool expected,const char *message=""){
    Failure failure;const bool ok=initialize(g,charge,failure);report(name,ok==expected&&(expected||failure.message==message));
  };
  InitializationGraph g{{"n"},{},{{{}, {init,load}}}};
  run("initialize before observation",g,true);
  g.blocks[0].events={load,init};run("observation before initialization",g,false,"cell is not definitely initialized");
  g.blocks[0].events={init,init};run("duplicate initialization",g,false,"cell may already be initialized");
  g.blocks={{{1,2},{}},{{3},{init}},{{3},{}},{{},{load}}};
  run("one branch initialization",g,false,"cell is not definitely initialized");
  g.blocks[2].events={init};run("both branches initialization",g,true);
  g.blocks={{{1},{}},{{1},{init,load}}};run("loop initialization",g,false,"cell may already be initialized");
  g.blocks={{{},{}},{{2},{load}},{{1},{}}};
  run("disconnected SCC cannot retain Must top",g,false,"initialization block is unreachable from entry");
  g.blocks={{{0},{init}}};run("entry cannot reset activation",g,false,"entry reentry or foreign initialization successor");
  g.slots.clear();g.incoming={"n"};g.blocks={{{},{load}}};run("ancestor initialized precondition",g,true);
  g.incoming.clear();run("unknown cell cannot be observed",g,false,"cell is outside lexical initialization preconditions");
  g.slots={"n"};g.blocks={{{},{init,load}}};Failure failure;size_t work=0;
  const bool accepted=initialize(g,[&](size_t n){work+=n;return true;},failure);
  size_t remaining=work;failure={};report("exact initialization budget",accepted&&initialize(g,[&](size_t n){if(n>remaining)return false;remaining-=n;return true;},failure)&&remaining==0);
  remaining=work-1;failure={};report("short initialization budget",!initialize(g,[&](size_t n){if(n>remaining)return false;remaining-=n;return true;},failure)&&failure.message=="environment initialization work exceeded");
  std::cout<<"owned environment contracts "<<checks<<" "<<(passed?"PASS":"FAIL")<<"\n";return passed?0:1;
}
