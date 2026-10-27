// SPDX-License-Identifier: MIT
#pragma once
#include "common-program.h"
namespace tsfg::commonProgram {
// Called only after the existing full Source/Core verification has succeeded.
bool componentLayouts(Program &,Json &,Error &);
// Internal semantic catalog after its owning Source family independently
// verifies declarations. Uses exactly the same DataLayout builder as26a.
bool componentLayoutCatalog(Program &,Json &,Error &);
}
