<!-- SPDX-License-Identifier: MIT -->

# Static GPU buffer ABI

`createCommonGpuBindingPlan` consumes the complete owned Common Program, its
original fixed publication and the existing two-to-32 kernel request. It first
runs the existing whole-Program Core and borrow consumer. Ordinary functions,
initializers, Source identity, fixed effects, call-chain diagnostics and borrowing
remain checked even when the GPU request selects only one kernel from the group.

The independent unpublished request version 2 has these exact fields:

```json
{"family":"tsfg.gpu-logical-binding-request","version":2,"target":"vulkan","kernels":["<FunctionId>"],"bindings":[{"kind":"global","id":"<GlobalId>","kernel":null,"set":0,"binding":0,"access":"read-write"},{"kind":"parameter","id":"<ParameterBindingId>","kernel":"<FunctionId>","set":0,"binding":1,"access":"read"},{"kind":"return","id":"<FunctionId>","kernel":"<FunctionId>","set":0,"binding":2,"access":"write"}]}
```

`kernels` is a nonempty ordered unique subset of the original verified group.
Each binding is a global (`kernel: null`), a parameter (`kernel` is its selected
FunctionId and `id` is the original owned parameter binding identity), or a
return (`kernel` and `id` are both the selected original FunctionId). A returned
value is not assigned a fabricated GlobalId.
The descriptor set and binding are uint32 logical names. The table contains at
most 4096 rows, ordered uniquely by set then binding; a resource appears once.
These bounds describe compiler data and do not claim device limits.

Version 2 supports i32 scalar globals and i32 value parameters, with i32 or void
returns and no receiver. Every selected parameter requires a read binding.
Every global in the selected fixed read/write upper requires exactly one binding
with the same combined access. Missing, extra, foreign, duplicate or incorrectly
permissioned resources are rejected. Other types or mutable parameter effects
produce an explicit capability error; their implementation remains part of the
parent GPU task. A narrower current body never replaces its supplied upper.

Every selected i32-returning function requires exactly one explicit write-only
return binding. A void-returning function has no output resource and rejects
such a binding. Return resources participate in the same slot and resource
uniqueness, access, identity and complete-coverage checks as all other resources.
Their Source anchor is the selected function declaration.

The version 2 plan has scope `static-buffer-abi` and this exact layout shared by
all its scalar bindings:

```json
{"profile":"vulkan-storage-buffer-std430-scalar-i32-v1","memberOffset":0,"memberBytes":4,"memberAlignment":4,"blockBytes":4}
```

Each descriptor names a separate storage-buffer block containing one i32 member.
Its member occupies the payload interval [0, 4), with member alignment 4. These
are block-relative member and payload dimensions. They are not a host buffer's
descriptor-base offset, `minStorageBufferOffsetAlignment`, device allocation size
or allocation alignment. An actual descriptor must cover the required block;
device limits, backing storage and allocation are still checked by its owning
consumer. No byte order is selected by this layout contract.

A return binding describes one result cell for one Source function call. It
does not choose dispatch cardinality, lane indexing, reduction, concurrent-write
permission or the contents visible after a failed invocation.

The version 2 plan retains the original input, HIR, scope and publication
identities, complete group targets, selected kernel and resource Source anchors,
and SHA-256 digests of the canonical kernel proof, borrow proof and request.
Each digest covers canonical JSON plus one LF. `verifyCommonGpuBindingPlan`,
`printCommonGpuBindingPlan` and `readCommonGpuBindingPlan` recompute this data;
an asserted plan cannot supply authority. GPU lowering must consume this checked
ABI plan and its matching Common, borrow and request digests for descriptor,
member and result addressing, rather
than independently inventing layout. This remains a compiler artifact; no
shader or device consumer has been qualified by producing it.

The independent C++ command is `--common-program --gpu-binding-plan`. Standard
input is canonical JSON plus one LF with exact fields `family`, `version`,
`core`, `request`, `plan`. Family is `tsfg.gpu-logical-binding-input`, version is
2, `core` is complete existing Common Core text and `request` is the request
above. `plan: null` produces the plan; a non-null plan must equal the independently
reconstructed result. The command verifies complete Source/Core, actual values,
borrowing and the original kernel proof before producing canonical plan JSON.

Request, plan and input envelope v1 are rejected directly. This unpublished,
same-product development format is atomically replaced, with no compatibility
reader. Existing Common/Graph/wire identities and input membership are unchanged.

This interface emits no shader or SPIR-V. It does not infer GPU ABI from CPU
DataLayout, adopt Vulkan tools, invoke an API/device or define numeric, dispatch,
synchronization, failure or recovery behavior. Software-device execution and
the rest of task 39 remain unverified.
