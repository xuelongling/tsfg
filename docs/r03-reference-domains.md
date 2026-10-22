<!-- SPDX-License-Identifier: MIT -->
# Reference views and actual storage

Source reference arrays have a static element view and an independent actual
value domain. A writable `Base[]` alias of `Derived[]` may store a new Base.
Reading through the original alias preserves that Base cell's complete actual
TypeId/runtimeKey. A subsequent static Derived-to-Base conversion uses the
Source-selected M12 projection; it does not require the actual Base to become a
Derived object. Assignment, argument and returned carriers keep this separation.

`typed-reference-domains.mjs` selects storage plans from verified owned HIR.
Reference/absence arrays select `actual-reference-v1`; numeric and value types
retain their canonical representations. The bounded development `TSREFD01`
reader embeds the existing canonical layout/member-view module and checks each
array's original element TypeId against that catalogue. It consumes the plan in
the same ManagedHeap array, root, write-barrier and moving-collector operations.
It is neither executable bytecode nor a published formal wire format.

The internal storage TypeId is SHA256 of `tsfg.storage.reference-domain.v1`.
Its zero-byte value plane and one reference slot use three explicit tags:
0 = actual reference cell, 1 = null, 2 = undefined. `cell_domain` accepts only a
reference-kind heap cell; scalar objects and inline value cells cannot enter it.
This internal physical identity is separate from every Source semantic TypeId.
The existing exact `.cell:TypeId` representation still validates fixed physical
layouts; no class identity test is globally weakened or bits reinterpreted.

Array aliases retain one heap identity. Element reads root the actual cell.
Value retention across a scope/return explicitly retains that same cell handle;
static assignment and assertion never retag the payload. Presence removal can
therefore leave an actual undefined value under a narrower static reference
view. No new cast trap is introduced. Dense overwrite, append, shortening,
active reference clearing and allocation failure use the existing heap's
transactional commit and collector.

Source writes select the static target field through the validated M12 module.
The target field must be writable. An actual class field's readonly bit is not
deep freezing of a legal writable structural alias. The physical low-level
initialization API remains distinct; Source viewed writes preserve the actual
field representation and update its bytes, active edges and initialization bit
in one commit. Native undefined field-definition observations remain a separate
full language-lowering obligation, not a fabricated scalar zero value.

Component checks consume actual Source packets and the resulting production
storage/view plans. They do not execute the Source program. Formal Core and
wire adoption, full ABI, method execution, all value-domain adaptation, and VM
execution remain open under the existing execution restrictions. Full M25 is
not limited to this reference-domain checkpoint.
