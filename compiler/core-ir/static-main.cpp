// SPDX-License-Identifier: MIT
#include "core-command.h"
// Same complete language, verifier and wire producer; native code generation is
// a separate compiler responsibility and is absent from this tool's link graph.
int main(int argc, char **argv) { return tsfg::runCoreCommand(argc, argv, nullptr); }
