<!-- SPDX-License-Identifier: MIT -->

# ECP-0018: selected string facts in the existing typed HIR

Status: accepted by Root on2026-10-18 under the full-R03 reasonable-autonomy instruction.

The previous scalar-only HIR has no consumer for the complete owned string-facts
package. Add an explicit factsBytes/expectedPackageId context to the existing HIR
interfaces and independently convert the complete selected package to typed
String constants and returns. The caller binds the actual selected packageId;
self-consistent cold data does not acquire official Source admission.

String is nominal managedReference/string with immutable numeric UTF16 codeUnits.
Retain empty, NUL, isolated/reversed surrogate and normalization-distinct values,
all owners and Source ranges. No runtime handle, ABI tag14, Source expression
expansion, parser, new private HIR family or alternate execution path is introduced.

Adopt exact HIR0.10.0/schema7d242a9f29da88f1b0cd08bab906912b6bb45e51c4b859755676bac2c2e1fcac.
Old0.9 identities are rejected; the full prior commit is the rollback unit.
The existing schema explicitly retains Core exchange0.9 through
x-coreExchangeVersion. Ordinary/generic/reference emitters share that metadata
from their existing SSA module, preserving the current bytecode schema and wire9.
String Core lowering remains explicit unsupported after full HIR validation.
FrontendSnapshot0.8 and formal012 admission, Source locks, Runtime, SDK and ABI
remain unchanged. All historical cyber STOPs remain; no native/String VM credit
is granted by this adoption.

Only compiler/string-hir.mjs and compiler/string-hir-model.mjs are new production
responsibilities. Root adopts these exact BIS memberships under the reasonable-autonomy scope:
Product207 to209 and M13208 to210. Each complete declaration adds114 bytes;
removing the two entries restores every previous byte, including ordering.
All prior inputs, managed heap, SDKv2 and canonical payload spelling remain.

Root froze the implementation contract and independently reconstructed its H10
and complete manual HIR example after two-axis review. The fixed BASE public
string capability RED and all review/budget failures are retained. The final
61-file suite passes1388 tests; selected pure module checks pass8 tests. TYPE
passes517 files with0 diagnostics after one test-only JSDoc annotation. Final
independent Spec and Standards implementation reviews report0 findings. Four
complete old Core outputs are byte-identical to the fixed BASE. Precise adoption
delta review remains required before local commit. Each integration target
receives its own related checks before its integration commit.
