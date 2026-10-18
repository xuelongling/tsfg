<!-- SPDX-License-Identifier: MIT -->

# 0022: Explicit selected nullable HIR4 in the existing Core text consumer

Status: accepted bounded private Interface extension by Root under the existing
reasonable-scope R03 authorization after independent Spec and Standards review.
Implementation checks and actual results are recorded separately in the workspace20n
acceptance summary; adoption grants no native/VM execution or formal acceptance.

## Scope and data flow

The missing consumer edge is complete selected nullable HIR4 to existing nullable Core
text. Keep one existing Module and Interface: emitNullableCore(hir, context = undefined).
A supplied context is forwarded unchanged to verifyNullableHir(hir, context) before any
module/function text or lowering state is constructed. The verifier owns the exact safe
four-field S5 selection, complete H6 cold reconstruction, declaration identities, original
Source owners/ranges, finite guard proof and owned immutable input. The emitter consumes
only that complete verified result, without filtering functions, inferring a selector or
trusting caller-supplied flow/proof fields. It returns one whole synchronous string.

The input is H6 sha256:9892edc555999b98f964ae409e10d6ba576e8a819b2c4ed68783f626f2665eed
and its unchanged S5/S4 capture. Core retains version0.9.0 and the existing private marker
family tsfg.core-nullable-candidate, version1, profile i32-null-undefined-internal-v1,
schema sha256:8f99963869ac2fed97db0ce90171d89593e4a3de667288eace4fc141c7cbc4bd.
Type, complete signature and function identities retain their existing Core preimages.
No descriptor/version/registry/BIS member, global HIR/String dispatch or C++ change occurs.

## Exact lowering

Map the H6 private scalar bool candidate ID to i1 using its existing Core type preimage
{kind:scalar,name:bool}. Preserve the existing global bool ID mapping used internally by
the unchanged nullableCoalesce path; do not replace that global identity or widen HIR.

The existing emitValueLeaf policy adds exactly two verified leaf cases:
- nullableTagTest: emit its declared-nullable operand exactly once through api.emit;
  emit tsfg_nullable.tag_test with that operand and its original declared type, H6 bool
  result type and the exact numeric tag1(undefined) or2(null) as tag = N : i32.
- nullableGet: emit its declared-nullable operand exactly once through api.emit; emit
  tsfg_nullable.get with that full original nullable type and scalar i32 result, with
  no extra proof, flow, retype, constant or other attribute.

Use api.operation for both leaves. Do not introduce another SSA builder, register/block
allocator, branch handler or generic flow solver. Existing shared if/block/return handling
keeps all original statements and emits the true early-return path and false continuation.
Its existing typed joins and binding definitions carry the original nullable mask; the
existing Core CFG/tag proof can establish present only after all declared absence exits.
The four exact routes remain mask1:[undefined], mask2:[null], mask3:[null,undefined] and
mask3:[undefined,null]. Never fold the guards, convert them into ?? or retag a declaration.

Both new operations use their complete H6 expression.range as tsfg_source.start/end.
The existing cf.cond_br uses condition.range; its continuation cf.br uses if.range.
Function metadata/fuel1 retain fn.range, func.return retains return.range, and existing
call/wrap/coalesce anchors stay unchanged. Original tagRange is fully checked as part of
the entire H6 input, not published as an unsupported extra Core attribute. Preserve all
functions in source order, parameter order/types, scalar entry role/ABI, complete direct
callee identities/signatures and each existing explicit scalar-to-nullable wrap. Existing
SSA value/block naming, join order, formatting, quotation and one entry fuel1 per function
stay authoritative; no new loop fuel or semantic execution claim is introduced.

## Validation, limits and failure

Complete input validation is exactly H6, including safe graph inspection with zero caller
traps/getters, context before untrusted HIR access, fixed domain counts before canonical
work, all global declaration identities before local owners, full nested S5 reconstruction,
8MiB escaped JCS/depth128/200000 tokens/1MiB strings, alias expansion and deep ownership.
Do not substitute a schema sniff, cached verification or accepted function hash for this.

Keep the existing incremental emitter limits:8MiB reserved UTF8 text,64 parameters per
function,1000000 registers and4096 blocks per function, and1000000 total visited work
steps. These text-emission resource ceilings do not independently certify Core parser,
CFG, payload or runtime acceptance. The selected four finite golden modules must also
retain the existing Core descriptor's structural/type/tag requirements. Existing ordinary
SSA labels are assembled outside the incremental line callback. For selected4 only, add
a final exact Buffer.byteLength of the whole returned string against8MiB, so the check
includes every module/function header, SSA line, block label, delimiter and final LF;
keep the existing incremental guards and default3 budget behavior unchanged. Any failed
input check, limit or lowering aborts the call;
no partial module is returned or published. Forward verifier errors unchanged, retaining
H6 fixed messages/phase/original permitted primary; keep existing emitter limit/errors.
No callback, filesystem/process operation, asynchronous state or new dependency is added.

## Compatibility, alternatives and rollback

An omitted or undefined context keeps the complete old3 named consumer, output bytes and
errors, including rejection of HIR4. Existing old coalesce/global bool behavior remains.
Proposal0021's statement that the Core emitter rejects HIR4 describes its then-current
consumer and continues to apply to this default path. Only this newly explicit selected4
call adds the private text consumer; no implicit version upgrade or compatibility shim.

Discarding guards, coercing the nullable operand to scalar or ignoring the context would
lose the proof/capture boundary and is rejected. Another Module, Core schema/C++ change or
general flow solver would duplicate capabilities already present in tag_test/get and SSA.
The selected extension keeps domain leaf policy local to the existing nullable emitter.
It adds no package/download, trust root or license change. Repository MIT and existing
SDK/tool provenance obligations remain. Roll back this emitter extension and proposal
adoption together; HIR4 remains usable at its separate named HIR seam and is again rejected
by the default3-only Core consumer. Existing Core text identities/format are not rewritten.

## Evidence and stopping points

An independent author freezes four whole Core strings and all Source/identity/SSA/fuel
preimages from the complete frozen HIRs before final lowering implementation; expected
text must not come from this emitter. Actual fixed-BASE context refusal is mechanical RED.
Root then releases natural context-only wiring, preserves that real intermediate source
and records the actual remaining typed-output failure before releasing the two leaf cases.
Only reached failures receive that credit; no planned refusal, injected throw/stub/mock,
rehashed fixture or manufactured output mismatch is accepted. The same whole oracle must
then pass, including cold object repetition, fresh default3 control, selected context and
malformed HIR/graph/budget boundaries, affected named Node checks and complete typecheck.
Reuse applicable HIR28/TYPE539 and existing SSA proofs. Independent final Spec/Standards
reviews precede authorized local commit and serial integration; actual evidence lives in
the single workspace20n acceptance summary, separate from this normative proposal.

All historical cyber STOPs remain. No old nullable/coalesce/??/F3 or other stopped group
is replayed or repackaged. No CoreCLI/C/MC/native/generated VM/Source execution, formal
Source012/279333 adoption, Runtime/RF/AC/GC/ABI closure, push or publication is authorized.
Runtime215 ordinary initial-false work and human24c/21e remain independent of this slice.
