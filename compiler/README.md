<!-- SPDX-License-Identifier: MIT -->

# Compiler responsibility area

This directory owns tsfg compiler product source, including the language
frontend and lowering pipeline introduced by later roadmap stages. R00 defines
the boundary but intentionally ships no compiler implementation here.

Compiler-to-runtime or compiler-to-tooling interfaces must be represented by
versioned contracts rather than by reaching into another responsibility area's
internals.
