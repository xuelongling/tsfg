# Complete Common Program candidate Node pipeline

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

Source facts use the private v2 family and `contracts/common-program-source-v2.schema.json`; owned HIR uses its separate private v2 descriptor. Static Core carries the existing `tsfg.core-program-development` v3 marker and exact private 0.12 header. The C++ consumer selects it with `tsfg-core-ir --common-program --canonicalize` (or `--optimize`). This static format has no wire or execution qualification.

The dev formal Frontend/HIR/bytecode 0.10 registry, Source lock and admission remain unchanged. Candidate metadata never derives its private header from that registry. Shared MLIR string escaping has its own module so the budgeted printer does not import the scalar emitter and its formal registry.

Run the pure Node regressions with:

```text
node --test tests/r03/common-program-callable-parameters.test.mjs tests/r03/common-program-dev-seams.test.mjs
```

The four complete callable fixtures are original official Source packages. Their cold contexts must reach byte-identical static Core for readonly, shared reassignment, ancestor forwarding and shadow-local cases. Separate normalized regressions check fixed callable upper bounds. The existing tsconfig includes all new compiler modules and these tests.
