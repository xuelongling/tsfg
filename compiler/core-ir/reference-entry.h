// SPDX-License-Identifier: MIT
#pragma once
#include "reference-contracts.h"

namespace tsfg::referenceContracts {
using EntryCandidates=std::map<std::string,std::set<std::string>>;
using EntryChildren=std::function<bool(const std::string &,std::vector<std::string> &)>;
// Both adapters provide checked logical metadata and the exact selected roots.
// A dependency record contributes field projection, never a new entry root.
bool entryCandidates(const Types &,const std::string &,const std::set<Pair> &,
                     const EntryChildren &,EntryCandidates &,const Charge &,std::string &);
}
