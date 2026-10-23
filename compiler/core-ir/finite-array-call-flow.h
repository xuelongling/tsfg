// SPDX-License-Identifier: MIT
#pragma once
#include "finite-payload-flow.h"
#include <map>
#include <optional>

namespace tsfg::finite {
// Definition-relative SSA origin equations and Effective <= Published. This
// engine never infers a smaller call upper from a narrower implementation.
class ArrayCallFlow {
public:
  using Id=PayloadFlow::Id;
  static constexpr Id none=PayloadFlow::none;
  enum Flag:unsigned {Read=1,Write=2,Structural=4};
  struct Bound {
    std::map<size_t,unsigned> parameters;
    unsigned local=0;
    bool returnsView=false;
    std::optional<size_t> returnOrigin;
  };
  explicit ArrayCallFlow(size_t &budget):remaining(budget),origins(budget,PayloadFlow::AtomDomain::IdentityOrigin){}
  Id function(Bound bound);
  Id value(Id function);
  bool parameter(Id value,size_t slot);
  bool local(Id value);
  bool unknown(Id value);
  bool copy(Id from,Id to);
  bool effect(Id function,Id value,unsigned flags);
  bool call(Id caller,Id callee,const std::vector<Id> &arguments,Id result=none);
  bool returned(Id function,Id value);
  bool solve();
  bool proved(Id function)const;
  const std::string &error()const {return failure;}
private:
  struct Function {Bound bound;std::set<Id> callers;Id summary=none;bool pending=false;};
  struct Effect {Id function,value;unsigned flags;};
  size_t &remaining;
  PayloadFlow origins;
  std::vector<Function> functions;
  std::vector<Id> owners;
  std::vector<Effect> effects;
  std::string failure;
  bool solved=false;
  bool spend();
  bool building();
  bool reject(const std::string &message);
  bool valid(Id function)const;
  bool owned(Id value,Id function)const;
  bool coverage(const Effect &effect);
};
} // namespace tsfg::finite
