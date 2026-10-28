// SPDX-License-Identifier: MIT
#pragma once
#include "finite-payload-flow.h"
#include <functional>
#include <map>
#include <optional>

namespace tsfg::finite {
// Exact normal-continuation lengths, never capacity or initialized-cell facts.
// The IR adapter supplies actual predecessor edges and successful mutations.
// All equations use the existing MemoryVersion engine and shared work meter.
class DenseLength {
public:
  using Id=PayloadFlow::Id;
  static constexpr Id none=PayloadFlow::none;
  struct Term {std::optional<uint32_t> number;std::string symbol;};
  explicit DenseLength(size_t &work,std::function<bool()> cancelled={});
  Id node();
  bool seed(Id target,const Term &term);
  bool unknown(Id target);
  bool pass(Id from,Id to);
  bool store(Id before,Id after,std::optional<uint32_t> index);
  bool solve();
  bool unchanged(Id before,const Term &requested);
  const PayloadEvidence *evidence(Id id)const;
  const std::string &error()const{return failure.empty()?flow.error():failure;}
private:
  struct Store {Id before,after;std::optional<uint32_t> index;};
  size_t &remaining;
  std::function<bool()> cancelled;
  PayloadFlow flow;
  size_t count=0;
  bool sealed=false,solved=false;
  std::vector<Store> stores;
  std::map<std::string,Term> terms;
  std::string failure;
  bool charge();
  bool reject(const std::string &message);
  bool building();
  bool outcome(bool result);
  std::string atom(const Term &term);
};
} // namespace tsfg::finite
