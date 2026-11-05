<!-- SPDX-License-Identifier: MIT -->

# ECP-0043: Exact GPU logical-binding compiler input

Status: accepted
Date: 2026-11-05
Decision Owner: user
Integration Owner: Root

The Owner explicitly accepted this precise supplement after reviewing the
implemented logical GPU binding consumer. This records the decision under
engineering charter sections 14.1–14.2; ECP-0002 delegation is unchanged.

Add only `compiler/common-program-gpu-bindings.mjs`, projectId `tsfg`, to the
855-member declaration. The canonical declaration grows from 56950 to 57021
bytes, exactly 71, with SHA256
`f5238110e9b3f8ae9d82ce8e6cd4d77d25cf2d1dad7bf939eb07600ed55d90fb`.
All 855 earlier members, SDK44, identity algorithms and payload formats remain.
Leaving the new compiler module outside the declared production inputs was the
alternative; the Owner selected the complete declaration.

The paired JS/C++ consumers and receiver-flow correction are implemented in
commit f552123. Validation: causal RED to 10 cross-consumer passes, four current
Q11 passes, 32 normalized borrow checks, full noEmit type checking, and zero
Spec/Standards findings. Nine unchanged old-schema captures fail before borrow
analysis and remain a maintenance debt.

Adoption changes the build identity naturally. Verify exact membership and a new
ordinary initial-false build before dev delivery; this does not qualify software
devices, Source/VM execution or RF. Rollback reverts the declaration and affected
compiler implementation coherently before rebuilding; retain original evidence.

No new upstream, tool, license boundary, numerical/failure policy, device/API
execution or compatibility promise is approved. Existing specific safety
refusals and equivalent purposes remain stopped. Main publication remains human.
