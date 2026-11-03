# Complete Common Program candidate Node pipeline

Kernel capability rejections retain their existing code, rule and primary
anchor, and add a readonly `error.callChain`. Its version-1 result identifies
the root, a prohibited facet/capture/Host resource, real Source call edges, and
an origin. Operation origins name a validated Source operation; function origins
identify signature, capture or derived function properties. A `fixed-upper`
origin carries the unchanged contract digest and does not assert that the
current body performs that operation. Unknown provenance stays unknown.

The chain search is bounded and deterministic over existing direct, method,
constructor and finite indirect calls. Source ranges use UTF-16 offsets.
Ambient Host calls are operation endpoints rather than invented owned
functions. The real compiler CLI and independent C++ static verifier append
`; callChain=` followed by canonical JSON to their existing stderr diagnostic.
The C++ primary anchor remains its original diagnostic anchor, which can name a
different genuine Host occurrence when more than one path exists. Diagnostic
provenance does not narrow fixed Published bounds or grant kernel permission.

The static borrow-proof output uses the same complete HIR, fixed publication and
kernel request. `createCommonBorrowProof(hir, publication, request)` exports a
version-1 `tsfg.common-borrow-proof-candidate`; `readCommonBorrowProof(bytes, hir,
publication, request)` reconstructs it from those inputs and returns immutable,
typed data only after exact canonical comparison. Source/function identities,
physical Core operation positions, descriptor and owner origins, uses,
structural effects, and normal/language call completions remain distinct.
Control edges project the verified graph between borrow, call and completion
points; unrelated scalar adapters do not create additional borrow authority.

`compileCommonBorrowProof(hir, publication, request, {core})` requires the current
verified static consumer manifest. It canonicalizes the actual Core, obtains
the independently reconstructed C++ proof through `--common-program
--borrow-proof`, and passes that output through the owning Node reader. The
corresponding `tsfgc` mode is `--emit borrow-proof` with `--input`,
`--publication`, `--kernel-request`, and `--core`. No publication is refreshed or
narrowed by either interface. A later view use across an owner resize still
rejects before a successful proof can be published. This output grants no
execution, scheduling or Runtime qualification.

The candidate entry points consume one complete Source package, own its HIR, verify fixed Published bounds and emit static Core. They preserve ordinary functions, initializers, globals, nominal types and original capture bindings even when a kernel selects only part of the Program.

```js
import {readCommonProgramFacts} from '../compiler/common-program-facts.mjs';
import {buildCommonProgramHir} from '../compiler/common-program-hir.mjs';
import {createCommonProgramPublication,analyzeCommonProgram} from '../compiler/common-program-analysis.mjs';
import {emitCommonProgramCore} from '../compiler/common-program-core.mjs';
const facts=readCommonProgramFacts(bytes);
const hir=buildCommonProgramHir(facts,{
  family:'tsfg.common-program-context-candidate',version:2,
  factsBytes:bytes,expectedPackageId:facts.packageId
});
const publication=createCommonProgramPublication(hir); // Explicit first publication.
const report=analyzeCommonProgram(hir,publication);
const request={targets:hir.closure.requiredRoots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()};
const core=emitCommonProgramCore(hir,publication,request);
```

Later consumers retain the supplied publication: they verify it against the current complete Program rather than regenerate a narrower permission. Incoming scalar and function parameters keep their original parameter BindingId, lexical owner and shared environment cell. Callable signature compatibility supplies no closed target set or lifetime proof.

The current private publication is version 4 (`common-program-fixed-v4`). Its
complete owned scope binds the declaration, type, module, global, import/export,
Env and construction directories together with fixed storage tables. The ordered
group binds every function's signature, full upper, callable bounds and return
Graph5, including explicit null rows. Every function has an ordinary Function/Env
protocol row and a construction role or null, even when its return graph is
unavailable. Implicit constructors remain owned construction roles, rather than
invented public function rows. Declaration identity excludes replaceable bodies
and initialization source identities; each current body is checked independently
against its fixed row.

A null return graph means unavailable authority. It does not mean an empty graph
or grant a return, capture or storage proof. A supplied graph must cover the
independently derived body, including its normal and language completions.
Concrete Code values and observed branches cannot narrow other permitted targets'
full uppers. A primitive scalar exception requires independent complete Source
views, full fixed-target closure and actual effects covered by the fixed upper;
it cannot hide a failed nonnull fixed graph in that closure.

Construction return graphs project the admitted normalized CFG, including its
receiver and initializer protocol. They do not interpret Source constructor
syntax again or grant initialization rights from a range or site name. Hidden
receiver frame references stay separate from data, Code and Env references.
Constructor call data arguments exclude logical receiver0: logical parameter i
for i >= 1 reads argument i - 1, while full receiver0 permissions apply to actual
data bound by that constructor throughout normal and language completion. An
unrelated nested construction does not inherit the caller receiver0 role.

Frame state retains the owned construction, original newTarget and bound or
unbound receiver. Actual Object, undefined and other primitive categories are
independent of Source views and owner provenance. Object replacement preserves
its actual identity and layout; assertions do not change the category. A
receiver protocol ReferenceError or TypeError is an Object with a data identity
even without a Source TypeId. Source and call exception payloads retain their
own categories. Request termination supplies no language completion. A missing
constructor graph remains null and grants no return or storage proof. Frame
creation with cyclic control dependencies and CFG global payload stores remain
Open until their lifetime and data transfer are represented.

Upper capture permissions are transitive stable SlotKeys. They need not belong
to the incoming lexical Env. Payload transfer must locate the actual owning Env
in the same fixed call context; a name or directory entry does not supply it.
Initialization joins distinguish an absent Env from an existing undefined slot,
and require every present arm to define the slot. Missing or unproved payload
relations remain open. Distinct Source views, sites or names do not grant noalias;
a current actual allocation tag can exclude aliasing only when its invariant is
independently established.

The current storage subset is nominal scalar tuples. The complete owned
catalogue and selected-witness/entry closure establish completeness; observed
fields do not. Actual field carriers, complete tuple offsets and conditional
constructor/newTarget results must match the fixed table before copy/address
callbacks become available. Metadata admission alone grants neither callback.
Structural aliases, inheritance, explicit/replacement construction and foreign
storage stay outside this subset. Future storage-v2 plans are not its authority.

The fixed table still enumerates every field and constructor/newTarget role.
An unknown row has `unknown:true` and an empty actualTypes array: unresolved TOP,
not an empty permission. Completeness and copy/address eligibility are checked
per owning type; an unsupported body does not remove an independent closed
tuple. Consumers cannot upgrade fixed TOP using narrower current observations,
and actual data outside a known fixed bound is rejected. Reference identity can
remain known while that reference body has no physical field route.

Node metadata admission and publication identity retain their existing 100,000
work allowance. Source, graph and body-effect analysis share the existing
cumulative private Core5 physical allowance of 4,000,000, both at first publication and when
consuming a supplied publication. An inline, context or phase does not start a
fresh budget. Per-operation fees remain charged.
Old or mixed publication/graph formats and mismatched private Core identities
are rejected rather than upgraded in a reader.


Source facts use the private v2 or v3 family with the matching Source descriptor;
owned HIR uses its separate matching v2 or v3 descriptor. The v3 Source and HIR
formats retain ordered constructor parameter initialization and actual omitted
arguments. Existing v2 packets retain their original identities. Static Core
carries the `tsfg.core-program-development` v5 marker and exact private
0.12 header. The C++ consumer selects it with `tsfg-core-ir --common-program --canonicalize` (or `--optimize`). This static format has no wire or execution qualification.

The formal Frontend/HIR/bytecode registries, Source lock and admission remain unchanged by this private candidate. Candidate metadata never derives its private header from that registry. Shared MLIR string escaping has its own module so the budgeted printer does not import the scalar emitter and its formal registry.

Run the pure Node regressions with:

```text
node --test tests/r03/common-program-callable-parameters.test.mjs tests/r03/common-program-dev-seams.test.mjs tests/r03/common-program-hosts.test.mjs
```

The four complete callable fixtures were regenerated by the official Source producer with the required empty hostImports array. Their remaining full payloads match the original frozen payload digests. Cold contexts still preserve readonly, shared reassignment, ancestor forwarding and shadow-local behavior. Separate normalized regressions check fixed callable upper bounds. The existing tsconfig includes all new compiler modules and these tests.

## Counter Host static analysis

The private Source v2 descriptor now requires input and payload `hostImports` arrays. The exact new schema hash is required; an old packet cannot be relabelled. An ambient import retains its original declaration, Symbol, selected signature and UTF16 call anchors. It is not an owned Source function, body or callable target.

For a Program containing the reviewed Counter31 import, pass the actual Runtime build's paired metadata as the third argument:

```js
const hir=buildCommonProgramHir(facts,sourceContext,{
  contract:actualHostSemanticContract,
  identity:{buildIdentity:actualBuildIdentity,buildInputSet:actualBuildInputSet}
});
const publication=createCommonProgramPublication(hir);
const core=emitCommonProgramCore(hir,publication,{targets:[]});
```

The Host boundary checks the existing VM/AOT debug target, source profile, implementation source hashes, complete BuildIdentity/BuildInputSet and canonical semantic contract. The Source structural signature remains distinct from the capability ABI signature. The complete context is embedded in private HIR/Core so the C++ consumer independently repeats the owning boundary check. No static issuer role or caller safety flag is accepted.

Counter always reads and writes both `runtime.counter.storage` and `runtime.counter.events`, including an argument of zero. These fixed resource bounds propagate through complete direct, recursive and finite-indirect function uppers. They are separate from GlobalId and managed-owner effects. The scalar-only verified Host operation produces an abstract i32 result; static analysis never calls the bridge.

An empty target array requests no kernel permission. It still validates the complete Program, Host context, fixed Published bounds, SSA, actual values and borrowing; its proof has empty accesses and pairs. Nonempty requests retain the original two-to-32 declared-kernel rule. Counter resource access makes a requested kernel ineligible, even when current data or a narrower body would appear harmless.

The initial genuine Counter Program has direct Host calls and an ordinary cross-module application call. Its separately produced complete extension adds genuine cross-module and finite-indirect kernel roots while retaining every original declaration and body. Node and C++ reject those requests from the propagated Host resources. The same complete extension independently accepts the pure left/right kernel pair; widening only the fixed right upper then rejects that otherwise valid pair. Normalized argument-zero and recursive controls test additional effect equations separately from complete Source evidence.

The C++ entry regressions require an explicitly supplied production binary and output directory:

```text
TSFG_COMMON_CORE_EXE=/absolute/path/tsfg-core-ir.exe
TSFG_COMMON_CPP_OUTPUT=/absolute/path/test-output
node --test --test-concurrency=1 tests/r03/common-program-host-core.test.mjs
```

These are static parser, verifier, canonicalizer and optimizer checks. Static Core, paired metadata and these controls grant no Host, wire, native, VM or AOT execution qualification.
