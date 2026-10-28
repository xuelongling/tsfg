// SPDX-License-Identifier: MIT
// This exercises the production definition-resource algorithm, without MLIR,
// Source evaluation, a substitute interpreter or a producer domain ledger.
#include "../../compiler/core-ir/finite-entry-arrays.h"
#include <cstdio>
using namespace tsfg::finite;
using Types=std::map<std::string,EntryArrayType>;
using Set=std::set<std::string>;
#define CHECK(value) do {if(!(value)){std::fprintf(stderr,"line %d: %s\n",__LINE__,#value);return false;}}while(false)
Types catalogue() {
  return {{"i32",{"scalar"}},{"f64",{"scalar"}},{"U",{"undefined"}},{"N",{"null"}},
    {"iU",{"union",{},{},{"i32","U"}}},{"fU",{"union",{},{},{"f64","U"}}},
    {"AI",{"array","i32"}},{"AIU",{"array","iU"}},{"AFU",{"array","fU"}},
    {"AU",{"array","U"}},{"RI",{"readSpan","i32"}},{"AAI",{"array","AI"}},
    {"Base",{"reference"}},{"Derived",{"reference",{},"Base"}},{"Foreign",{"reference"}},
    {"ForeignChild",{"reference",{},"Foreign"}},
    {"AB",{"array","Base"}},{"AF",{"array","Foreign"}},{"V",{"value"}}};
}
std::string owner(const std::string &seed,const std::string &type) { return seed+"/entry-owner/"+type; }
bool completeDefinitionBounds() {
  auto types=catalogue();EntryArrayBounds out;size_t work=100000;
  CHECK(deriveEntryArrayBounds(types,{{"export/binding/x","AIU"},{"internal/binding/y","AI"}},out,work));
  const auto x=owner("export/binding/x","AIU"),y=owner("internal/binding/y","AI");
  // No initializer/instance was supplied. Every legal definition element is
  // still present, including actual undefined and writes through another view.
  CHECK(out.resources.at(x).elementTypes==Set({"i32","U"}));
  CHECK(out.resources.at(y).elementTypes==Set({"i32","U"}));
  CHECK(out.resources.at(x).aliases==Set({y}));CHECK(out.resources.at(y).aliases==Set({x}));
  CHECK(out.owners.at("export/binding/x")==Set({x}));return true;
}
bool nestedAndNominalClosure() {
  auto types=catalogue();
  types.at("Base").relations={{"field/owned-field-id","V"},{"method/owned-method-id/return","RI"}};
  types.at("V").relations={{"field/nested-handle-id","AAI"},{"field/recursive-reference-id","Base"}};
  EntryArrayBounds out;size_t work=100000;
  CHECK(deriveEntryArrayBounds(types,{{"entry/binding/box","Base"},{"entry/binding/nested","AAI"}},out,work));
  CHECK(out.owners.count("entry/binding/box")==0);
  const auto outer=owner("entry/binding/nested","AAI"),inner=owner(outer+"/elements","AI");
  CHECK(out.owners.at("entry/binding/nested")==Set({outer}));
  CHECK(out.resources.at(outer).elementTypes==Set({"AI"}));
  CHECK(out.resources.at(outer).elementOwners.count(inner));
  CHECK(out.resources.at(inner).elementTypes==Set({"i32"}));
  size_t boxResources=0;bool span=false,value=false;
  for(const auto &[id,row]:out.resources)if(id.find("entry/binding/box/")==0) {
    boxResources++;span|=row.semanticType=="RI";value|=row.semanticType=="AAI";
  }
  CHECK(boxResources==3);CHECK(span&&value);CHECK(out.resources.size()==5);return true;
}
bool selectedStructuralAndNominalElements() {
  auto types=catalogue();EntryArrayBounds out;size_t work=100000;
  EntryArraySeed base{"published/binding/base","AB",{{"Base",{"Foreign"}}}};
  CHECK(deriveEntryArrayBounds(types,{base},out,work));
  CHECK(out.resources.at(owner(base.id,"AB")).elementTypes==Set({"Base","Derived","Foreign","ForeignChild"}));
  work=100000;
  CHECK(deriveEntryArrayBounds(types,{base,{"other/binding/foreign","AF"}},out,work));
  const auto a=owner(base.id,"AB"),b=owner("other/binding/foreign","AF");
  CHECK(out.resources.at(a).elementTypes==Set({"Base","Derived","Foreign","ForeignChild"}));
  CHECK(out.resources.at(b).elementTypes==Set({"Base","Derived","Foreign","ForeignChild"}));
  CHECK(out.resources.at(a).aliases==Set({b}));
  // Removing the authorized M12 root cannot be replaced by an instance seed.
  work=100000;base.references.clear();CHECK(deriveEntryArrayBounds(types,{base,{"other/binding/foreign","AF"}},out,work));
  CHECK(out.resources.at(a).elementTypes==Set({"Base","Derived"}));CHECK(out.resources.at(a).aliases.empty());
  return true;
}
bool numericAbsenceDoesNotAuthorizeSharing() {
  auto types=catalogue();EntryArrayBounds out;size_t work=100000;
  CHECK(deriveEntryArrayBounds(types,{{"i","AIU"},{"f","AFU"}},out,work));
  CHECK(out.resources.at(owner("i","AIU")).aliases.empty());
  CHECK(out.resources.at(owner("f","AFU")).elementTypes==Set({"f64","U"}));
  return true;
}
bool absenceBridgeRemainsPending() {
  auto types=catalogue();EntryArrayBounds out;size_t work=100000;
  CHECK(!deriveEntryArrayBounds(types,{{"i","AIU"},{"f","AFU"},{"u","AU"}},out,work));
  CHECK(out.resources.empty()&&out.owners.empty());
  CHECK(out.error.find("pending native compatibility")!=std::string::npos);
  CHECK(out.error.find(owner("u","AU"))!=std::string::npos);return true;
}
bool receiverScopeAndUnprovedReturns() {
  auto types=catalogue();types["Receiver"]={"reference",{},{},{},{{"field/owned-array","AB"}}};
  types["UnrelatedReceiver"]={"reference",{},{},{},{{"field/unrelated-array","AFU"}}};
  EntryArraySeed receiver{"method/binding/this","Receiver",
    {{"Receiver",{"UnrelatedReceiver"}},{"Base",{"Foreign"}}},true,true};
  EntryArrayBounds out;size_t work=100000;
  CHECK(deriveEntryArrayBounds(types,{receiver},out,work));
  CHECK(out.owners.count(receiver.id)==0);CHECK(out.resources.size()==1);
  CHECK(out.resources.begin()->second.semanticType=="AB");
  CHECK(out.resources.begin()->second.elementTypes==Set({"Base","Derived","Foreign","ForeignChild"}));
  CHECK(out.resources.begin()->second.aliasesComplete);
  work=100000;
  CHECK(deriveEntryArrayBounds(types,{{"return","AB",{},false,false},{"entry","AF"},{"numeric","AI"}},out,work));
  CHECK(!out.resources.at(owner("return","AB")).aliasesComplete);
  CHECK(!out.resources.at(owner("entry","AF")).aliasesComplete);
  CHECK(out.resources.at(owner("numeric","AI")).aliasesComplete);
  CHECK(out.resources.at(owner("return","AB")).aliases.empty());
  work=100000;
  CHECK(deriveEntryArrayBounds(types,{{"u","AU"},{"i","AIU"}},out,work));
  CHECK(!out.resources.at(owner("u","AU")).aliasesComplete);
  CHECK(!out.resources.at(owner("i","AIU")).aliasesComplete);return true;
}
bool resourceCyclesTerminate() {
  auto types=catalogue();types["Cycle"]={"reference",{},{},{},{{"field/cycle-array","AC"}}};
  types["AC"]={"array","Cycle"};EntryArrayBounds out;size_t work=100000;
  CHECK(deriveEntryArrayBounds(types,{{"cycle","AC"}},out,work));
  CHECK(out.resources.size()==1);CHECK(out.resources.at(owner("cycle","AC")).elementOwners.empty());
  CHECK(out.resources.at(owner("cycle","AC")).elementTypes==Set({"Cycle"}));return true;
}
bool missingBudgetAndCancellationPublishNothing() {
  auto types=catalogue();EntryArrayBounds out;size_t work=100000;
  types["Broken"]={"array","missing"};
  CHECK(!deriveEntryArrayBounds(types,{{"x","AI"}},out,work));CHECK(out.resources.empty());
  CHECK(out.error.find("missing element type")!=std::string::npos);
  types.erase("Broken");work=1;CHECK(!deriveEntryArrayBounds(types,{{"x","AI"}},out,work));
  CHECK(out.resources.empty()&&out.error.find("work limit")!=std::string::npos);
  work=100000;size_t calls=0;
  CHECK(!deriveEntryArrayBounds(types,{{"x","AAI"}},out,work,[&](){return ++calls==10;}));
  CHECK(out.resources.empty()&&out.error.find("cancelled")!=std::string::npos);
  work=100000;CHECK(!deriveEntryArrayBounds(types,{{"x","AI"},{"x","AFU"}},out,work));
  CHECK(out.resources.empty()&&out.error.find("declaration seed")!=std::string::npos);return true;
}
bool directOwnerRolesExcludeNonArrays() {
  auto types=catalogue();types["S"]={"string"};types["Plain"]={"reference"};
  types["Box"]={"reference",{},{},{},{{"field/owned-array","AI"}}};
  types["ArrayOrScalar"]={"union",{},{},{"AI","i32","U"}};
  EntryArrayBounds out;size_t work=100000;
  CHECK(deriveEntryArrayBounds(types,{{"number","i32"},{"string","S"},{"class","Plain"},
    {"box","Box"},{"mixed","ArrayOrScalar"},{"array","AI"},{"span","RI"}},out,work));
  CHECK(out.owners.count("number")==0);CHECK(out.owners.count("string")==0);
  CHECK(out.owners.count("class")==0);CHECK(out.owners.count("box")==0);
  CHECK(out.owners.size()==3);
  CHECK(out.owners.at("mixed")==Set({owner("mixed","AI")}));
  CHECK(out.owners.at("array")==Set({owner("array","AI")}));
  CHECK(out.owners.at("span")==Set({owner("span","RI")}));
  bool nested=false;for(const auto &[id,bound]:out.resources)if(id.find("box/payload/")==0) {
    nested=true;CHECK(bound.semanticType=="AI");CHECK(bound.elementTypes==Set({"i32"}));
  }
  CHECK(nested);return true;
}
bool budgetAndCancellationKeepTheirFirstCause() {
  struct Boundary {const char *name;Types types;std::vector<EntryArraySeed> seeds;size_t budget;};
  const std::vector<Boundary> boundaries={
    {"union member",{{"a",{"scalar"}},{"z",{"union",{},{},{"a"}}}}, {},2},
    {"owned relation",{{"a",{"scalar"}},{"z",{"value",{},{},{},{{"field/f","a"}}}}}, {},2},
    {"M12 target",{{"a",{"reference"}},{"b",{"reference"}}},{{"entry","a",{{"a",{"b"}}}}},5},
    {"M12 source",{{"a",{"reference"}},{"b",{"reference"}}},{{"entry","a",{{"a",{"b"}}}}},6}};
  for(const auto &boundary:boundaries) {
    EntryArrayBounds out;size_t work=boundary.budget;
    CHECK(!deriveEntryArrayBounds(boundary.types,boundary.seeds,out,work));
    if(out.error!="entry array proof work limit")std::fprintf(stderr,"%s: %s\n",boundary.name,out.error.c_str());
    CHECK(out.error=="entry array proof work limit");CHECK(out.resources.empty()&&out.owners.empty());
    work=100000;size_t calls=0;
    CHECK(!deriveEntryArrayBounds(boundary.types,boundary.seeds,out,work,[&](){return ++calls==boundary.budget+1;}));
    CHECK(out.error=="entry array proof cancelled");CHECK(out.resources.empty()&&out.owners.empty());
  }
  return true;
}
int main() {
  struct Case {const char *name;bool (*run)();};
  const Case cases[]={{"complete definition bounds",completeDefinitionBounds},{"nested/value/reference/method closure",nestedAndNominalClosure},
    {"selected structural/nominal elements",selectedStructuralAndNominalElements},{"native absence separation",numericAbsenceDoesNotAuthorizeSharing},
    {"absence bridge pending",absenceBridgeRemainsPending},{"recursive resources terminate",resourceCyclesTerminate},
    {"receiver root scope and incomplete published returns",receiverScopeAndUnprovedReturns},
    {"missing/budget/cancel transactional failure",missingBudgetAndCancellationPublishNothing},
    {"only direct Array/ReadSpan roots publish owner roles",directOwnerRolesExcludeNonArrays},
    {"budget/cancel first cause survives every validation boundary",budgetAndCancellationKeepTheirFirstCause}};
  unsigned failed=0;
  for(const auto &test:cases) {
    if(!test.run()){++failed;std::fprintf(stderr,"FAIL %s\n",test.name);}
    else std::printf("PASS %s\n",test.name);
  }
  return failed?1:0;
}
