<!-- SPDX-License-Identifier: MIT -->

# Ordinary module AOT and instance boundary

Implementation continuation of R03 issue18, based on a849d4c. This document
defines the production interface being implemented; it is not execution,
Resource, formal Native or Source admission evidence. The old Native0.4 loader
and descriptor protocol are independent and are not used by this interface.

## Complete program and execution plan

Owned Snapshot retains all checked source files and declarations. HIR retains
the exact normalized input scope, module external/script classification,
original functions, parameter initializers, globals, Host declarations, roots
and source associations, including the original import/export edges and their
specifier, resolved logical path and UTF16 span. A digest binds facts to input; it does not authenticate
a checker run. Persisted input, origins, binding visibility and source ranges
are checked independently before emission.

Cold verification covers every original top-level declaration, not only reached
functions. It rebuilds local, imported, namespace, re-exported, script and Host
visibility from the original source. Claimed edge targets must match the locked
official relative-file resolution over the complete inputScope file universe;
they are not accepted merely because a target exports a compatible signature.
The current official bootstrap fixes NoLib/NoEmit/Strict and TargetESNext
(`tsc/cmd/tsfg-frontend/owned_program.go:28`); its effective resolver is Bundler
(`tsc/internal/core/compileroptions.go:202–235`). File lookup precedes directory
index lookup, and TypeScript files precede declarations within each extension
attempt (`tsc/internal/module/resolver.go:1383–1450,1527–1550,1662`). Explicit
extension replacement and a trailing directory separator retain those official
rules. This finite source guard neither reads the host filesystem nor provides
an alternative TypeScript parser/checker or a new Source execution qualification.

All original functions and all module metadata remain in Core and wire. Dead
functions are checked and compiled, not removed to admit a supported subset.
Code retention does not authorize an embedding entry or run its initializer.
The execution plan is a separate, verified selection:

1. Start at every explicit root, preserving the normalized root order.
2. Retain its owner and static dependencies, and visit their initializers.
3. Follow direct calls and global references, including parameter defaults.
4. Repeat until no new function or module is discovered.
5. Initialize retained modules by dependency DFS, once per module; active
   cycles are visited once. Additional retained owners use UTF8 path order.

The complete tables contain unselected modules, functions, globals and Hosts.
Their presence neither initializes an unselected module nor grants a Host
capability. The required Host set is derived from selected functions and
initializers, including defaults. Public invocation selects a declared root,
not an arbitrary index in the retained function table. Initializer-only roots
request initialization without exposing a synthetic initializer as a source call.

Core and the independent Runtime reader recompute this plan from verified
tables, calls, global accesses and roots. Unknown/missing indexes, initializer
calls, incomplete schedules and excess schedule entries reject. The previous
Core/wire11 rule requiring every table module to initialize cannot represent
this distinction. Its replacement receives a new exact Core/wire identity;
the numeric opcode assignments40–42 and String34–39 remain unchanged.

## One ordinary expression semantics

The scalar verifier handles ordinary function bodies and parameter defaults
with a module context supplying the original source, visible binding map,
globals, Host declarations and initializer ownership. It retains the existing
presence lattice, dominance and loop/branch checks. Module/source validation
does not substitute a new parser or checker.

Local and parameter writes update SSA definitions. Global lvalues emit real
global loads/stores. Capture a compound assignment's old value before its RHS;
postfix returns that old value; short-circuit writes evaluate the RHS only on
the selected branch. A bare assignment does not read its target. All operands
are evaluated once in source order. Defaults run in parameter order only for
undefined, after actual arguments and before the function body; null is retained.

A writable global is not a writable import. The HIR keeps module classification
and original binding ownership: a write must name a writable declaration owned
by the current module, or a legal shared binding between nonexternal scripts.
Namespace/import aliases do not gain write permission from their target's
global writable bit. Default expressions participate in the same binding and
conversion-origin checks as the body.

## Ordinary ABI v4

The compiler emits executable code plus immutable tables. No descriptor loader,
bytecode interpreter or dynamically supplied program is part of the call path.
The embedding links one concrete compiled program. Its table identity is the
SHA256 of that program's exact canonical wire bytes under a versioned domain;
it includes function bodies, complete metadata and the execution plan. This is
a compiled-program identity, not a BuildIdentity or Resource certificate.

The C boundary uses fixed-width integers and Win64 C calling convention. Pointer
fields borrow valid embedding-owned storage for a synchronous call. Raw guest
requests cannot provide an instance, authority, callback or function pointer.
The production header and Zig extern declarations must agree in size, alignment
and offsets. Reserved fields are zero and unknown versions/sizes reject before
guest events or mutations. Existing scalar slots remain8bytes aligned4, with
their canonical bool/f32/64-bit representations and presence carriers.
`argument_count` is the physical slot count and `argument_types` describes
every physical slot, including each presence-state i32. The declaration-order
mapping remains at most64 logical parameters and128 physical slots. A public
call does not express omission by sending zero slots for a nonempty signature;
the Source guest-call lowering supplies canonical payload0/state1 for omission.

The concrete interface has these records:

```c
typedef struct TsfgAotFailureV4 {
  uint32_t kind;             /* 0 none, 1 trap, 2 abort, 3 request, 4 managed exception */
  uint32_t reason;           /* versioned machine reason, never free text */
  uint32_t function_index;   /* exact immutable function/Host table identity */
  uint32_t source_index;
  uint32_t start, end;       /* original UTF16 half-open range */
  uint32_t reserved[2];
} TsfgAotFailureV4;

typedef struct TsfgAotHost31V4 {
  uint32_t capability;       /* exactly31 */
  uint32_t reserved;
  uint8_t signature[32];
  uint8_t semantic_contract[32];
  void *counter;             /* real Runtime-owned Counter context */
} TsfgAotHost31V4;

typedef struct TsfgAotAuthorityV4 {
  uint32_t version, bytes;
  uint8_t signature[32];
  uint8_t semantic_contract[32];
  uint32_t (*host31)(void *counter, uint32_t argument);
  uint32_t (*admitted)(const void *counter);
} TsfgAotAuthorityV4;

typedef struct TsfgAotInstanceV4 {
  uint32_t version, bytes;
  uint8_t compiled_table_id[32];
  uint32_t status;           /* 0 uninitialized, 1 initializing, 2 ready, 3 failed */
  uint32_t active;           /* serial non-reentrant owner, not an atomic lock */
  uint32_t global_count, host_count;
  uint64_t *globals;         /* nominal raw bits, not serialized ABI slots */
  uint8_t *initialized;
  const TsfgAotHost31V4 *hosts;
  const TsfgAotAuthorityV4 *authority;
  TsfgAotFailureV4 memo;
} TsfgAotInstanceV4;

typedef struct TsfgAotRequestV4 {
  uint32_t version, bytes;
  void *event_state;
  int32_t (*event)(void *, uint32_t kind, uint32_t function,
                   uint32_t start, uint32_t end, uint64_t location);
  TsfgAotFailureV4 failure;
} TsfgAotRequestV4;

uint32_t tsfg_aot_instance_init_v4(TsfgAotInstanceV4 *instance);
uint32_t tsfg_aot_invoke_v4(TsfgAotInstanceV4 *instance,
  TsfgAotRequestV4 *request, uint32_t root_index,
  uint32_t argument_count, const uint8_t *argument_types,
  uint8_t result_type, const void *arguments, void *output);
```

`instance_init` checks the linked compiled identity and storage extents, clears
instance storage and installs the uninitialized state. It executes no guest
code. The caller supplies capacity from immutable compiled counts. Rebinding or
resetting a live instance is not an invocation operation. Distinct instances
borrow distinct mutable arrays and Counter contexts; immutable tables may be shared.

The authority record is constructed by the trusted embedding from its compiled
Host semantic constants and fixed real bridge, never decoded from request JSON.
Invocation compares required grants with that authority and the compiled Host
table: capability31, exact signature, exact semantic-contract claim, unique
binding, nonnull Counter. Unrequired or unknown grants reject. This preserves
the existing trust boundary; equality of arbitrary caller-supplied hashes does
not create authority. The Zig adapter obtains constants from the generated
host-semantic identity and uses the real Counter bridge/admission implementation.

The event callback remains the caller-owned budget/source-location seam; scalar
results and Host results have their own typed paths. A callback refusal records
a first request failure (an abort if no more precise record exists). Generated
code records conversion traps and managed TDZ ReferenceError before cleanup and
preserves their distinct failure kinds and the first failure.
Host31 returns through the typed bridge after the same depth, fuel, work,
deadline and storage admission as the existing Runtime boundary. No unknown
Host signature, callback/retention policy or request-controlled bridge is admitted.

## Lifecycle and failure ownership

All preflight checks, including root/signature/presence/Host authorization,
precede execution or exposure of memoized initialization failure. An active or
initializing instance rejects reentry. An already failed instance copies its
owned memo into the request without running guest code or charging guest events.

On the first valid invocation, generated production code changes uninitialized
to initializing and runs the verified initialization sequence serially. Synthetic
initializers have logical depth0 and no source-function entry fuel; their real
calls and Host boundaries keep ordinary charges. Global reads and noninitializing
writes check the initialized bit before access and report TDZ at their source
operation. Initialization stores publish an individual initialized bit only
after the value has been evaluated successfully.

A failure during initialization is copied into the instance memo and sets failed.
Partial internal storage is not available through a public root afterwards.
Earlier external Host effects are not rolled back. There is no automatic retry.
Successful initialization sets ready before the selected ordinary root runs.
An ordinary request failure retains ready state and preceding globals/Host
effects; it does not turn a ready instance into a permanently failed module.

Every invocation owns one request failure and output slot. It writes output only
after successful return and final failure check. Conversion failure records its
precise trap before the single event9/10 first-failure notification, preserving
the existing conversion event contract. After that notification, or after a
failure without a notification event, only required frame cleanup and failure
checking may occur: no later step, fuel, return-source, global access, Host call
or unrelated user callback. Mutable request state never aliases the
owned initialization memo. Releasing caller-owned storage requires no guest code.

## Implementation and validation boundaries

Compiler module/source checks, scalar lvalue checks and instance lowering are
separate cohesive modules, each below500lines. `aot-lowering` retains operation
selection and typed SSA; a module lowering helper owns immutable tables, storage,
public-root selection and lifecycle. The C ABI header is shared with a Zig
adapter implementing actual instance storage and Host admission; no empty Runtime
API is added. Complete wire plan validation stays independent in C++ and Zig.

The concrete authority additionally calls the real Counter `admitted` gate
before guest effects. The opaque Counter pointer cannot supply or override that
decision. A false certificate remains a rejection. `global_count` constrains
both raw-global and initialized-byte capacities; `host_count` is the required
grant set. The production header fixes Win64 sizes/offsets; Zig checks the same
layout. Failure entity indexes use bit31 for a Host table index and clear bit31
for a function table index.

The fixed Counter call bridge and the private synchronous Runtime entry have
separate source and object files. Both the normal and cold-input Runtime build
compile and link the latter explicitly; a Counter-only AOT embedding needs only
the former. Moving the original entry assembly preserves its full instruction
text. The source-binding lock identifies the changed Counter source independently
of any instruction, loaded-graph or Resource qualification; old artifacts retain
their original identities.

Use public owned HIR print/read/lower and canonical/wire interfaces for structural
RED/GREEN. Freeze small complete multi-source inputs before an independent author
derives values, global state, Host effects, ordering and first-failure anchors.
Actual numeric conversion algorithms reuse their independently checked3238cases
when their implementation/read set is unchanged; new ABI/plan behavior requires
its own fixed linked component checks. Any full package containing an unsupported
domain rejects as a whole; retaining its functions does not grant that domain's
execution qualification. Formal Source, VM, Native, Resource and RF obligations
remain separately open until their real approved paths have evidence.
