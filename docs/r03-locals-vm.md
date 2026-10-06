<!-- SPDX-License-Identifier: MIT -->

# Linear scalar locals through the formal Runtime

M04 extends the scalar source chain with initialized `const`/`let`, local reads
and simple assignment. One checked zero-parameter i32/bool function may contain
linear declarations, assignments and returns. For example:

```ts
export function answer(): i32 {
  let seed: i32 = 40;
  const copy: i32 = seed;
  seed = seed + 1;
  return copy + seed;
}
```

The typed request result is `{ "type": "i32", "value": "81" }`: `copy` retains
40 and `seed` becomes 41. Comma declarations, inherited comments/ASI, escaped
identifier spellings and the `boolean` alias retain official frontend checking.
`bool` remains the canonical type identity.

The official checked Snapshot provides owned declarations, symbols, scalar
types and expression facts. Independent immutable HIR copies their required
source and identities, assigns declaration-order binding IDs and verifies the
complete source-anchored linear body. `lowerHir` selects each binding's current
SSA definition, emits every initializer/assignment RHS once in statement order
and visits operands from left to right. Reads reuse the selected scalar value.
The adapter emits the shared typed Core text; the source-built C++ MLIR middle
end owns Core operations, verifies typed SSA definition/use and source/target
identities, canonically reads/prints Core and lowers that same verified Core to
R04 register instructions. The Zig Runtime loads and executes R04 requests.
These are the actual current interfaces under the authoritative architecture
and accepted R03 Q4 division between independent HIR and C++/MLIR Core.

HIR and R04 use exact development contract 0.3.0, R04 wire version 3 and the
linear-locals capability bit 4. Existing scalar opcodes represent the SSA;
local initialization anchors may precede the return and must remain inside the
function, ending no later than the reached return. Mixed old formats/schema
identities and invalid typed definition/use are rejected before execution.
See [HIR](../contracts/hir.md), [R04](../contracts/bytecode.md) and the existing
[source/build commands](r03-constant-vm.md).

Unused initializers and overwritten assignment RHS expressions still execute.
The first divide/remainder/shift failure ends its request with the existing
R01 Rule/Trap and original UTF-16 operation span. Later operations are not
executed; the host can submit another request to the same Runtime. The Runtime
frees the request frame without rollback or user catch/finally. Only statements
through the first return are emitted; subsequent source remains officially
checked and owned. Request instruction limits remain physical limits;
Semantic Fuel is a separate later responsibility.

Owned uninitialized reads reject as `r03-hir-uninitialized` and verified forward
reads as `r03-hir-dominance`, both phase `hir`, Rule `r01-evaluation`, with the
read's verified source range. Foreign bindings and forged facts receive generic
invalid-input rejection. Adjacent `++`/`--` tokens cannot be reinterpreted as
scalar signs, while whitespace/comments may separate legal signs. Update,
compound-assignment and assignment-expression semantics belong to M10.

The official Snapshot 0.5.0 source producer currently rejects declarations
without initializers as `r02b-d-unsupported`/`capability`. R01 W1 explicitly
requires initialized locals; delayed initialization remains pending for later
ordinary-expression/full-R03 coverage. Owned negative-input checks do not
establish frontend initialization analysis or execute that source. Parameters,
calls, branches and general CFG remain later slices. Q3–Q13 obligations,
including active-Span structural restrictions, checked reads and dense array
updates, retain their accepted definitions and require their own implementation.

`locals-vm.test.mjs` exercises the official-source/HIR seam, owned invalid inputs,
canonical read/write and source transformations. Its formal consumer cases use
independently authored literal scalar results, SSA observations and source
spans, plus actual Core/R04 rejection and full/incremental equivalence. Current
execution evidence belongs to the ticket's frozen acceptance ledger; historical
M03 native artifacts do not establish M04 build or Runtime acceptance.
