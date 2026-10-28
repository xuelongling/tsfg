# Query metadata and borrowed batch binding

`jobs.query_tmeta.Document.load` owns the development Query `.tmeta` data section. Its expected payload hash, input identity and package identity come from the independent producer cold reader. An envelope cannot supply its own expected identity. Checksums fix data identity; they provide neither executable authority nor a Store borrow.

The reader checks the canonical versioned envelope, complete payload hashes, target, component layout, ordered entries and standard function argument types. The complete original Source request/facts, checked batch and effects report remain in the owned document. Source/Core semantics are checked at the producer cold boundary; the Runtime does not implement another Source checker.

Query component layouts retain the existing layout envelope. Their `hirDigest` binds the complete `{components,target,types}` catalog and newline. This has a separate owning load entry from the existing Common HIR expected-identity path, whose contract is unchanged. A Store copies the validated layout payload identity along with its component directory.

`Document.bind(allocator, store, batch, entry_index, scalars)` checks the actual Store owner, layout identity, live session, row count, complete unique column selection, strides, alignment, access and buffer lengths. It creates an owned plan of row-count, column, stride and f32 scalar arguments. Repeated tuple occurrences select the same original column; a read occurrence returns a const slice even when a write occurrence shares that backing. Component data is never copied.

The plan owns its metadata and scalar values, so the document can be released after binding. The Store must outlive the plan and its Query/Batch, as required by the existing Store owner contract. Releasing either Query or Batch invalidates the complete session; subsequent plan access uses the existing token check and fails. Tokens do not recover when another session is opened within that Store lifetime. Calling a plan after destroying its Store violates the owner lifetime contract.

Plans contain no executable address. They do not access FunctionCell, a loader, State, Guest or a scheduler, and do not claim CPU execution or entry publication. The entry symbol and logical function/signature identities remain in the explicit development candidate domain.
