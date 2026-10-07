<!-- SPDX-License-Identifier: MIT -->

# Explicit numeric conversions

The current registered frontend/HIR/Core0.9 and bytecode wire9/capability20 execute checked, wrapping and equal-width raw scalar conversions through the formal C++ compiler and Zig Runtime. See [the exact exchange contract](../contracts/bytecode.md) and `contracts/conversion-entries.json` for entry identities and nominal pairs. Runtime computes checked rounding/ranges with exact integer significands and powers of two, without host float intermediates, unsafe float casts or runtime LLVM/libm.

Tests preserve the independently frozen 2508 mathematical expectations and 36 nonfinite expectations byte for byte. The corpus records remain expectation-only; current execution belongs to fresh command evidence. Both actual optimizer modes are required. The optimizer currently validates and canonically prints while preserving operations. Tests also cover declaration/brand/scope forgery, ordinary same-name calls, invalid nominal pairs/arity/type arguments, unused-path traps, first failure, source anchors, scalar Fuel/depth, cold/incremental equivalence and canonical HIR/bytecode roundtrips. Formal build identity, complete source/tool closure and full regression evidence are maintained under workspace ticket09/09a; this document does not manufacture execution credit.
