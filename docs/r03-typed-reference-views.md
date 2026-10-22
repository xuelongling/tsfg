<!-- SPDX-License-Identifier: MIT -->
# Actual cell member views

`typed-reference-views.mjs` consumes the complete verified generic HIR and its
Source-selected M12 member/dependency closure. A view maps target FieldIds to
actual declaring FieldIds and target FunctionIds to actual callable FunctionIds.
It supplies no byte offsets. Inherited fields retain their declaring identity;
an actual descendant follows explicit base and override edges. Names, equal
layouts and runtime keys never manufacture a member edge. Repeated selected
proofs for the same actual/target pair must agree. Derivation has a cumulative
100000 work bound, 4096 views/methods and 256 members per view.

The development `TSGVIEW1` format contains the selected package identity, a
length-delimited unchanged `TSGLAY01` module, a sorted method catalogue and sorted
actual/target views. IDs and signature hashes are complete 32-byte values.
Method records contain FunctionId, declaring TypeId, actual signatureHash and
an optional explicit override target. View field/method pairs are sorted by
target ID. The bounded Zig reader reconstructs canonical layouts independently,
rejects missing/duplicate fields, incomplete target field/method maps, invalid
owners, hidden overridden methods, malformed identities and trailing bytes.
This development format is not formal wire, Source admission or executable code.

`managed-reference-view.zig` consumes those plans against the actual ManagedHeap
cell. It compares the complete actual TypeId/runtimeKey/layout, resolves a member
ID and then uses the existing typed-field API and graph barrier. The target
layout never reads the actual object. The returned value owns a clone of the
actual field layout and its original tag, bytes and rooted references. A field
whose static view has wider presence retains its original concrete value domain.
Buffer/layout destruction and managed root lifetime remain separate. View reads
and callable receiver retention use the existing scopes and moving collector.

Component writes accept an actual-domain value and use the existing field
barrier, initialization and readonly checks. This low-level Interface does not
define a new source assignment policy, cast trap or Array invariance rule.
Converting source values for legal mutable aliases and preserving actual domains
through the formal ABI remains the lowerer's responsibility.

A callable view returns the actual FunctionId/signature, complete actual object
identity and a rooted handle to the same receiver. It does not execute a method
body or adapt arguments/results. Selected recursive member proofs and method
variance remain verified at the cold boundary; method execution and formal
argument/result view adaptation are still open.

The independent component path uses four existing actual public Source packets:
Left's second field at offset4 viewed as a one-field class at offset0; nested
nullable X/Y references; a method with concrete i32 return viewed through a union
return; and an inline value viewed through presence widening. Node writes the
logical binary, Zig reconstructs layouts, then the real heap performs field
access/mutation, Array alias retention, value copying and moving GC. Allocation
failure checks exercise decoder and read cleanup. No substitute evaluator,
private bytecode loader, VM, CoreCLI, Native or Source executable participates.

Full M25 remains open: actual-domain propagation through language returns,
aliases, storage and ABI, formal Core/verifier/printing/wire/VM, callable execution,
language trap identities/anchors, borrow checks and the independent language
oracle. Existing component evidence does not grant those execution credits.
