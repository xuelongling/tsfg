<!-- SPDX-License-Identifier: MIT -->

# Owned Query Core consumer

The private owned v5 Source package enters typed Core through
`readSystemQueryFacts` and `emitSystemQueryCore`. The complete original package
and request remain in the module. Original Source FunctionIds and BindingIds
are kept separately from lowered function, selection, component and FieldIds.
This route does not register a new formal Frontend or change Core/wire0.10.

Each original `for (const [p, v] of q)` becomes a `tsfg.query` selection, a
`tsfg.chunk` region and a `tsfg.parallel_for` row region. The chunk supplies a
typed chunk and row count; the row region supplies its index. Ordered
`tsfg.column` operations select the original tuple occurrences, with a view
type containing the component TypeId and Read/Write mode. A repeated component
keeps its separate occurrences and permissions. These operations describe the
architecture's column computation; this consumer does not schedule or execute
it.

Field expressions become typed `tsfg.field_load` and `tsfg.field_store` operations.
The existing native f32/f64 Core arithmetic operations implement `+`, `-`, `*` and
`/`. A compound assignment loads its actual target before evaluating the RHS,
then applies its original operation and stores. Source statement and operand order remain explicit SSA
dependencies. No component objects or boxed field values are constructed.

Reachable f32/f64-result helpers become real func.func definitions with native f32/f64 or component-view parameters and typed func.return operations. Direct calls become typed func.call SSA operations with semantic callable IDs and separate original Source helper identities. Call arguments evaluate left to right, and an enclosing compound assignment still reads its target before evaluating those arguments. The private Query Core version is 3; the Core/common wire contract remains unchanged.

The independent C++ consumer reconstructs identities from the retained Source
data, checks the complete original request and pinned declaration contexts,
replays lexical/import alias resolution and generic substitutions, and checks
each system, tuple, loop and expression against its original AST and UTF16
source tokens, including helper signatures, returns, arithmetic and resolved direct calls. It compares actual operations and operands in Source order.
Node-supplied identities, arithmetic names, permission attributes and source
anchors cannot substitute for that comparison. Field lookup selects the first
same-name declaration from the receiver's actual class and then its bases;
the flattened physical catalog does not decide language field visibility.

The producer emits `tsfg.query_stage = "logical"` without guessed physical
offsets. After verifying the entire module, C++ uses the existing component
DataLayout builder to attach stride/alignment to columns and
offset/stride/alignment/field_type to field operations. The complete computed
catalog is retained as `tsfg.query_layouts`, and the stage becomes `bound`.
Canonical parsing of a bound module repeats the independent Source and layout
checks. The component-layout26a envelope and its field order stay unchanged.

This bounded slice supports the complete current owned fixtures: declaration
only systems, cross-file and generic aliases, multiple component occurrences,
Read/Write views of a shared component, inherited shadowed fields, direct same-width f32/f64
field arithmetic, assignment and compound assignment. Ordinary system
parameters require a selected native scalar Core type and systems return void.
Component metadata uses fixed fields with scalar literal initializers and
implicit zero-argument construction. Explicit constructor/method metadata
requires further Source validation and remains a capability error. This route
does not execute initializers or constructors. Unsupported source
shapes remain capability errors. Input/output and Source reconstruction have
bounded bytes, depth and work.

The real static CLI accepts:

```text
tsfg-core-static --system-query --canonicalize < logical.mlir
tsfg-core-static --system-query --optimize < bound.mlir
```

Both commands verify the whole owned module. The selected optimization pass
preserves the verified computation and every Source anchor. Bytecode emission
and mixed Common/formal modules are outside this route.

`compileSystemQuery(packetBytes, context, {core, optimize})` in the compiler
pipeline uses the source-built consumer manifest and current Core input closure.
The driver form is `tsfgc --input facts.json --query-request request.json
--core <qualified-static-tool> --emit core`. It requires the original request,
uses the owning reader, and rejects frontend/VM/runtime request options. Static
Core generation and validation grant no Guest, VM, native execution or parallel
execution qualification.

Direct component-view helpers lower to actual `func.func` view parameters and
`func.call` operands, with distinct original Source and lowered identities.
A `tsfg.view_borrow` result may narrow a Write view to Read for that same
component and SSA backing. The original operand remains writable; the borrow
cannot upgrade a Read value or change its component. C++ independently checks
that operation against the original formal annotation and actual caller view,
then checks callee field loads/stores and their physical layouts. Helpers still
have one f32/f64 return expression; returning a view is outside this boundary.