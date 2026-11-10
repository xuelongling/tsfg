// SPDX-License-Identifier: MIT
#pragma once
#include "common-program.h"
namespace tsfg::commonProgram {
// Called only after the existing full Source/Core verification has succeeded.
bool componentLayouts(Program &,Json &,Error &);
// Internal semantic catalog after its owning Source family independently
// verifies declarations. Uses exactly the same DataLayout builder as26a.
bool componentLayoutCatalog(Program &,Json &,Error &);
// Internal fixed-value roots selected from a complete verified Common Program.
// This shares the physical builder with component storage, without granting a
// public call ABI or adding unrelated declarations to the component catalog.
bool fixedValueLayoutCatalog(Program &,const std::vector<std::string> &,Json &,Error &);
}
