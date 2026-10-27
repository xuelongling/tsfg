// SPDX-License-Identifier: MIT
#pragma once
#include "common-program-source.h"
#include "reference-contracts.h"
namespace tsfg::commonProgram {
// Rebuild from independently owned declarations and M12 outputs. The supplied
// Core dispatch table is never an input to target selection.
bool methodDispatch(Program &,const std::string &view,const std::string &member,Json &,Error &);
bool methodTargets(Program &,const Json &,std::vector<std::string> &,Error &);
}
