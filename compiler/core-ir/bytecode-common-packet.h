// SPDX-License-Identifier: MIT
#pragma once
#include "bytecode-program.h"

namespace tsfg::wire {
// Complete Common-only cold verification followed by the one canonical wire18
// measure/emit traversal. Failure clears output; success grants no Runtime admission.
bool encodeCommon(const Program &,bytecode::Bytes &,Error &);
}
