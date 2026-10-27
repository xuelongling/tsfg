// SPDX-License-Identifier: MIT
#pragma once
#include "common-program.h"
namespace tsfg::commonProgram {
// Called only after the existing full Source/Core verification has succeeded.
bool componentLayouts(Program &,Json &,Error &);
}
