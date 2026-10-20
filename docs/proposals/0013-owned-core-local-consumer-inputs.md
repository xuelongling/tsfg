# ECP-0013: owned Core2 local-initialization consumer inputs

Status: adopted by Root within the Owner-authorized reasonable internal scope (2026-10-17).

The independent C++ consumer now accepts the existing private Core2 metadata and verifies local initialization against actual typed SSA/CFG. It retains the public verifyCandidate/analyzeRoots APIs. The formal Core0.9/wire9 contract, SDKv2, identity algorithm, payload format and all existing members remain unchanged.

The previously reviewed twelve-member Core consumer split from ECP-0011 is retained. Merge with the accepted 19i producer yields Product176/M13177. This change adds exactly three internal files:

- compiler/core-ir/closure-init-flow.cpp
- compiler/core-ir/closure-initialization.cpp
- compiler/core-ir/closure-initialization.h

Product176 becomes179; the corresponding future M13177 becomes180, retaining managed-heap and all prior members. The declaration contains only each path/projectId, with no digest or payload-format change.

The files separate bounded Need fixed-point analysis from per-function Must/May CFG flow and their private interface. Both init order and duplicate-path initialization are checked after structural verification. This is a mechanical dependency declaration for the authorized implementation, not a new Owner vote.

Validation is source/object-only until the separate human native validation ticket is completed. Object compilation cannot supply native RED, consumer execution, physical GC/ABI, Source/VM or formal Runtime/RF credit. Existing refused actions remain stopped; the ce6 human tree and plan remain frozen.
