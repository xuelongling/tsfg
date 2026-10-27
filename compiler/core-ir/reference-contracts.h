// SPDX-License-Identifier: MIT
#pragma once
#include <cstdint>
#include <functional>
#include <map>
#include <set>
#include <string>
#include <tuple>
#include <vector>
namespace tsfg::referenceContracts {
using Pair=std::pair<std::string,std::string>;
using OriginKey=std::tuple<std::string,uint32_t,uint32_t,std::string,std::string>;
using Charge=std::function<bool(size_t)>;
// Owned adapters supply only checked logical IDs. No JSON, MLIR, physical
// layout, allocation observation or producer permission enters this core.
struct Type {std::string kind,element,base;std::vector<std::string> members;};
using Types=std::map<std::string,Type>;
struct Policy {bool crossContainers=false,undefinedVoid=false,nominalInheritance=false;};
struct Member {
  std::string kind,name,type,result;std::vector<std::string> parameters;
};
using Members=std::map<std::string,Member>;
struct MethodClass {std::string base;std::vector<std::string> methods;};
struct Method {std::string owner,name,overrideTarget;};
struct MethodCatalogue {std::map<std::string,MethodClass> classes;std::map<std::string,Method> methods;};
using MethodMaps=std::map<Pair,std::map<std::string,std::string>>;
bool validateMethods(const MethodCatalogue &,const Charge &,std::string &);
bool selectMethod(const MethodCatalogue &,const MethodMaps &,const std::string &actual,const std::string &view,
  const std::string &member,std::string &selected,const Charge &,std::string &);
bool logical(const Types &,const std::string &,const std::string &,const std::set<Pair> &,
  std::set<Pair> &,const Charge &,std::string &,Policy={});
bool verifyMembers(const Types &,const Members &,const Members &,const std::vector<Pair> &,
  const std::set<Pair> &,const std::set<std::string> &,const Charge &,std::string &,Policy={});
bool closeDirectory(const std::map<OriginKey,std::set<Pair>> &,const Charge &,std::string &);
} // namespace tsfg::referenceContracts
