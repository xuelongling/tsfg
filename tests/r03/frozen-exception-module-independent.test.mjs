// SPDX-License-Identifier: MIT
// Independent actual module control and repaired negatives; imports Product when run.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';
const schema='sha256:5221b50822965c633418462b28a9b58bfbc41b01e0fa4b6d31c50ab83805424d';
const pin={
  "directory": "09",
  "request": "a7bca733fa641a4a81c2796e7f18cf07f9b1f38f20e098b76f694b5a975a8d91",
  "response": "b0182cf425db65f5afb6f8f0e5300b38a7230c478f38d4a912f8864d7d335035",
  "expected": "b0182cf425db65f5afb6f8f0e5300b38a7230c478f38d4a912f8864d7d335035",
  "origin": "de2a946f1957288763fbaf640a63de18d92025fe91c5fbdea6c24d17d13343b2",
  "sources": [
    {
      "path": "/src/app.ts",
      "content": "import { probe } from \"./worker\"; export function entry(value: i32): bool { return probe(value); }"
    },
    {
      "path": "/src/worker.ts",
      "content": "/* 😀 */ export function probe(value: i32): bool { try { throw value; } catch (caught: unknown) { if (typeof caught === \"boolean\") { return caught; } throw caught; } finally { const copied: i32 = value; } } try { throw true; } catch (initCaught: unknown) { if (typeof initCaught === \"boolean\") { throw initCaught; } throw initCaught; } finally {}"
    }
  ]
};
const hash=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
/** @param {any} value @returns {string} */
function jcs(value) {
  if(value===null||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='string'){assert.ok(value.isWellFormed());return JSON.stringify(value);}
  if(typeof value==='number'){assert.ok(Number.isFinite(value));return JSON.stringify(value);}
  if(Array.isArray(value))return '['+value.map(jcs).join(',')+']';
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+jcs(value[key])).join(',')+'}';
}
/** @param {any} q @param {any} p @param {any} o */
function seal(q,p,o) {
  for(const file of q.input.files)if(Object.hasOwn(file,'sha256'))file.sha256=hash(file.content);
  const files=q.input.files.map(file=>({path:file.path,content:file.content})).sort((a,b)=>Buffer.from(a.path).compare(Buffer.from(b.path)));
  p.payload.inputIdentity=hash(jcs({...q.input,files}));
  p.payload.files=files.map(file=>({path:file.path,digest:hash(file.content),byteLength:Buffer.byteLength(file.content),length:file.content.length,positionUnit:'utf16'}));
  const requestBytes=Buffer.from(jcs(q));
  p.requestId=hash('tsfg.exception-facts.request.v1\0'+requestBytes);
  p.packageId=hash('tsfg.exception-facts.package.v1\0'+schema+'\0'+jcs(p.payload));
  const responseBytes=Buffer.from(jcs(p));
  return {requestBytes,responseBytes,origin:{...clone(o),requestSha256:hash(requestBytes),responseSha256:hash(responseBytes)}};
}
/** @param {any} frames */
function identities(frames) {
  const q=JSON.parse(frames.requestBytes.toString('utf8')),p=JSON.parse(frames.responseBytes.toString('utf8'));
  assert.equal(jcs(q),frames.requestBytes.toString('utf8'));assert.equal(jcs(p),frames.responseBytes.toString('utf8'));
  assert.equal(q.schemaHash,schema);assert.equal(p.schemaHash,schema);
  assert.equal(frames.origin.requestSha256,hash(frames.requestBytes));assert.equal(frames.origin.responseSha256,hash(frames.responseBytes));
  assert.equal(p.requestId,hash('tsfg.exception-facts.request.v1\0'+frames.requestBytes));
  assert.equal(p.packageId,hash('tsfg.exception-facts.package.v1\0'+schema+'\0'+jcs(p.payload)));
  const files=q.input.files.map(file=>({path:file.path,content:file.content})).sort((a,b)=>Buffer.from(a.path).compare(Buffer.from(b.path)));
  assert.equal(p.payload.inputIdentity,hash(jcs({...q.input,files})));
  assert.deepEqual(p.payload.files,files.map(file=>({path:file.path,digest:hash(file.content),byteLength:Buffer.byteLength(file.content),length:file.content.length,positionUnit:'utf16'})));
  for(const file of q.input.files)if(Object.hasOwn(file,'sha256'))assert.equal(file.sha256,hash(file.content));
}
/** @param {any} value @param {(value:any)=>void} visit */
function walk(value,visit){if(!value||typeof value!=='object')return;visit(value);for(const child of Object.values(value))walk(child,visit);}
/** @param {any} value */
function frozen(value){if(!value||typeof value!=='object')return;assert.ok(Object.isFrozen(value));for(const child of Object.values(value))frozen(child);}
/** @param {any} baseline */
function expectedSnapshot(baseline) {
  const {q,o,expectedPacket,buffers}=baseline,payload=expectedPacket.payload;
  const files=q.input.files.map(file=>({path:file.path,content:file.content})).sort((a,b)=>Buffer.from(a.path).compare(Buffer.from(b.path)));
  return {format:{family:'tsfg.frontend-exception-candidate',version:1,schemaHash:schema},
    snapshotId:hash('tsfg.frontend-exception-candidate.snapshot.v1\0'+schema+'\0'+jcs({inputIdentity:payload.inputIdentity,sourceOrigin:o})),
    sourceOrigin:clone(o),inputIdentity:payload.inputIdentity,identityInput:{...clone(q.input),files},
    sources:files.filter(file=>!file.path.endsWith('.d.ts')).map(file=>({...file,hash:hash(file.content),length:file.content.length,positionUnit:'utf16'})),
    target:clone(q.input.target??null),facts:clone(payload.facts),exports:clone(payload.exports),
    capture:{request:buffers[0].toString('utf8'),response:buffers[1].toString('utf8')}};
}

/** @param {any} q @param {any} p */
function context(q,p) {
  const facts=p.payload.facts,entry=facts.functions[0],worker=facts.functions[1];
  const app=facts.modules[0],module=facts.modules[1],edge=app.imports[0],call=entry.body[0].expression;
  const region=worker.body[0].exception,initialization=module.initialization[0],init=initialization.exception;
  return {q,p,facts,entry,worker,app,module,edge,call,region,initialization,init,
    entryParameter:entry.parameters[0],workerParameter:worker.parameters[0],
    read:region.tryBlock.body[0].expression,guard:region.catchClause.block.body[0].condition,
    narrowed:region.catchClause.block.body[0].thenBody[0].body[0].expression,
    copied:region.finallyBlock.body[0],initGuard:init.catchClause.block.body[0].condition,
    initThrow:init.catchClause.block.body[1].expression};
}
/** @param {any} x @param {string} id @param {(value:any)=>void} change */
function coherentSymbol(x,id,change){walk(x.facts,value=>{if(value.id===id)change(value);});}
/** @typedef {{name:string,mutate:(value:any)=>void,inputEdit?:boolean,exportsEdit?:boolean}} Corruption */
/** @type {Corruption[]} */
const mutations=[
 {name:'moduleOmitted',mutate:x=>{x.facts.modules.pop();}},
 {name:'moduleDuplicated',mutate:x=>{x.facts.modules.push(clone(x.module));}},
 {name:'moduleOrderReversed',mutate:x=>{x.facts.modules.reverse();}},
 {name:'moduleSourceForeign',mutate:x=>{x.module.sourcePath='/src/foreign.ts';}},
 {name:'moduleSourceOmitted',mutate:x=>{delete x.module.sourcePath;}},
 {name:'moduleExternalFalse',mutate:x=>{x.module.external=false;}},
 {name:'moduleHasUnknownKey',mutate:x=>{x.module.body=[];}},
 {name:'moduleGlobalsInvented',mutate:x=>{x.module.globals=[clone(x.region.catchClause.binding)];}},
 {name:'entryFunctionSourceOmitted',mutate:x=>{delete x.entry.sourcePath;}},
 {name:'entryFunctionAndDefinitionCoherentlyForeignSource',mutate:x=>{x.entry.sourcePath=x.worker.sourcePath;coherentSymbol(x,x.entry.symbol,value=>{value.sourcePath=x.worker.sourcePath;});}},
 {name:'workerFunctionSourceUnconsumed',mutate:x=>{x.worker.sourcePath='/src/foreign.ts';}},
 {name:'entryParameterSourceCoherentlyForeign',mutate:x=>{coherentSymbol(x,x.entryParameter.id,value=>{value.sourcePath=x.worker.sourcePath;});}},
 {name:'catchSourceCoherentlyForeign',mutate:x=>{coherentSymbol(x,x.region.catchClause.binding.id,value=>{value.sourcePath=x.entry.sourcePath;});}},
 {name:'copiedSourceCoherentlyForeign',mutate:x=>{coherentSymbol(x,x.copied.symbol.id,value=>{value.sourcePath=x.entry.sourcePath;});}},
 {name:'initCatchSourceCoherentlyUnconsumed',mutate:x=>{coherentSymbol(x,x.init.catchClause.binding.id,value=>{value.sourcePath='/src/foreign.ts';});}},
 {name:'entryParameterDefinitionSourceOmitted',mutate:x=>{delete x.facts.symbols.find(value=>value.id===x.entryParameter.id).sourcePath;}},
 {name:'entryParameterEmbeddedSourceOmitted',mutate:x=>{delete x.entryParameter.sourcePath;}},
 {name:'sameNameValueReferenceCrossesSourceBinding',mutate:x=>{x.call.arguments[0].symbol=x.workerParameter.id;}},
 {name:'workerValueReferenceCrossesSourceBinding',mutate:x=>{x.read.symbol=x.entryParameter.id;}},
 {name:'referenceRawNameOmitted',mutate:x=>{delete x.call.arguments[0].name;}},
 {name:'referenceRawNameForeign',mutate:x=>{x.call.arguments[0].name='other';}},
 {name:'guardReferenceRawNameOmitted',mutate:x=>{delete x.guard.operand.name;}},
 {name:'narrowedReferenceRawNameForeign',mutate:x=>{x.narrowed.name='initCaught';}},
 {name:'initializerReferenceRawNameOmitted',mutate:x=>{delete x.copied.initializer.name;}},
 {name:'initReferenceRawNameForeign',mutate:x=>{x.initThrow.name='caught';}},
 {name:'importsOmitted',mutate:x=>{x.app.imports=[];}},
 {name:'importDuplicated',mutate:x=>{x.app.imports.push(clone(x.edge));}},
 {name:'importSourceUnconsumed',mutate:x=>{x.edge.sourcePath='/src/foreign.ts';}},
 {name:'importSourceSelf',mutate:x=>{x.edge.sourcePath=x.entry.sourcePath;}},
 {name:'importSpecifierMismatchSource',mutate:x=>{x.edge.specifier='./app';}},
 {name:'importBindingNameForeign',mutate:x=>{x.edge.bindings[0].name='other';}},
 {name:'importBindingTargetForeign',mutate:x=>{x.edge.bindings[0].target='s404';}},
 {name:'importAndCallTargetCoherentlyWrongSource',mutate:x=>{x.edge.bindings[0].target=x.entry.symbol;x.call.target=x.entry.symbol;}},
 {name:'importAndCallTargetCoherentlyLocal',mutate:x=>{x.edge.sourcePath=x.entry.sourcePath;x.edge.bindings[0].target=x.entry.symbol;x.call.target=x.entry.symbol;}},
 {name:'importBindingOmitted',mutate:x=>{x.edge.bindings=[];}},
 {name:'importBindingDuplicated',mutate:x=>{x.edge.bindings.push(clone(x.edge.bindings[0]));}},
 {name:'importBindingUsesRawInsteadOfTrimmedAnchor',mutate:x=>{x.edge.bindings[0].range.start--;}},
 {name:'importRawAnchorTrimmed',mutate:x=>{x.edge.range.start++;}},
 {name:'importHasForeignKey',mutate:x=>{x.edge.target=x.worker.symbol;}},
 {name:'moduleExportOmitted',mutate:x=>{x.module.exports=[];}},
 {name:'moduleExportDuplicated',mutate:x=>{x.module.exports.push(clone(x.module.exports[0]));}},
 {name:'moduleExportForeignTarget',mutate:x=>{x.module.exports[0].target=x.entry.symbol;}},
 {name:'moduleExportWrongRange',mutate:x=>{x.module.exports[0].range.start++;}},
 {name:'bothExportViewsCoherentlyOmitWorker',exportsEdit:true,mutate:x=>{x.module.exports=[];x.p.payload.exports[1].bindings=[];}},
 {name:'officialExportsOmitConsumedSource',exportsEdit:true,mutate:x=>{x.p.payload.exports.pop();}},
 {name:'officialExportsWrongDefinitionSourceAnchor',exportsEdit:true,mutate:x=>{x.p.payload.exports[1].bindings[0].definition=clone(x.p.payload.exports[0].bindings[0].definition);}},
 {name:'officialExportsWrongSourcePath',exportsEdit:true,mutate:x=>{x.p.payload.exports[1].sourcePath=x.entry.sourcePath;}},
 {name:'moduleAndOfficialExportNameCoherentlyForeign',exportsEdit:true,mutate:x=>{x.module.exports[0].name='other';x.p.payload.exports[1].bindings[0].name='other';}},
 {name:'initializationOmitted',mutate:x=>{x.module.initialization=[];}},
 {name:'initializationDuplicated',mutate:x=>{x.module.initialization.push(clone(x.initialization));}},
 {name:'initializationMovedToAnotherSource',mutate:x=>{x.app.initialization.push(x.module.initialization.pop());}},
 {name:'initializationTryBodyOmitted',mutate:x=>{x.init.tryBlock.body=[];}},
 {name:'initializationCatchOmitted',mutate:x=>{delete x.init.catchClause;}},
 {name:'initializationFinallyOmitted',mutate:x=>{delete x.init.finallyBlock;}},
 {name:'functionFinallyOmitted',mutate:x=>{delete x.region.finallyBlock;}},
 {name:'functionFinallyLocalOmitted',mutate:x=>{x.region.finallyBlock.body=[];}},
 {name:'initializationBorrowsFunctionCatchIdentity',mutate:x=>{x.init.catchClause.binding=clone(x.region.catchClause.binding);}},
 {name:'initializationAnnotationBorrowsOtherCatchAnchor',mutate:x=>{x.init.catchClause.annotationRange=clone(x.region.catchClause.annotationRange);}},
 {name:'annotatedCatchAnnotationOmitted',mutate:x=>{delete x.region.catchClause.annotationRange;}},
 {name:'annotatedCatchDeclarationTruncatedToName',mutate:x=>{x.region.catchClause.declarationRange=clone(x.region.catchClause.binding.range);}},
 {name:'calleeTargetForeign',mutate:x=>{x.call.target='s404';}},
 {name:'calleeTargetsCaller',mutate:x=>{x.call.target=x.entry.symbol;}},
 {name:'calleeRawNameOmitted',mutate:x=>{delete x.call.name;}},
 {name:'calleeRawNameForeign',mutate:x=>{x.call.name=x.entry.name;}},
 {name:'calleeSignatureOmitted',mutate:x=>{delete x.call.signature;}},
 {name:'calleeSignaturePresenceOmitted',mutate:x=>{delete x.call.signature.presence;}},
 {name:'calleePresenceUsesCallerAnchor',mutate:x=>{x.call.signature.presence=[clone(x.entryParameter.presence)];}},
 {name:'calleePresenceAllCopiesCoherentlyUseCallerAnchor',mutate:x=>{const presence=clone(x.entryParameter.presence);coherentSymbol(x,x.workerParameter.id,value=>{value.presence=clone(presence);});x.call.signature.presence=[clone(presence)];}},
 {name:'calleePresenceHasForeignSourcePathKey',mutate:x=>{x.call.signature.presence[0].sourcePath=x.worker.sourcePath;}},
 {name:'calleePresenceAllCopiesCoherentlyHaveForeignKey',mutate:x=>{coherentSymbol(x,x.workerParameter.id,value=>{value.presence.sourcePath=x.worker.sourcePath;});x.call.signature.presence[0].sourcePath=x.worker.sourcePath;}},
 {name:'calleePresenceAnnotationOnlyUsesCallerAnchor',mutate:x=>{x.call.signature.presence[0].annotation=clone(x.entryParameter.presence.annotation);}},
 {name:'calleePresenceFlagsInventOptional',mutate:x=>{x.call.signature.presence[0].optional=true;}},
 {name:'calleeSignatureInventsUnknownKey',mutate:x=>{x.call.signature.sourcePath=x.worker.sourcePath;}},
 {name:'calleeArgumentsOmitted',mutate:x=>{delete x.call.arguments;}},
 {name:'calleeArgumentsMissingRequiredValue',mutate:x=>{x.call.arguments=[];}},
 {name:'calleeArgumentUsesCalleeDeclarationRange',mutate:x=>{x.call.arguments[0].range=clone(x.workerParameter.range);}},
 {name:'calleeArgumentsDuplicated',mutate:x=>{x.call.arguments.push(clone(x.call.arguments[0]));}},
 {name:'calleeRawAnchorTrimmed',mutate:x=>{x.call.range.start++;}},
 {name:'factsInputsOmitDts',mutate:x=>{x.facts.inputs=x.facts.inputs.filter(path=>!path.endsWith('.d.ts'));}},
 {name:'functionRegistryPreorderReversed',mutate:x=>{x.facts.functions.reverse();}},
 {name:'rootDoesNotNameActualBinding',inputEdit:true,mutate:x=>{x.q.input.compilationClosure.roots[0].name='absent';}},
 {name:'rootNameGuessedFromAnotherSource',inputEdit:true,mutate:x=>{x.q.input.compilationClosure.roots[0].name=x.worker.name;}},
 {name:'rootSourceDoesNotOwnEntry',inputEdit:true,mutate:x=>{x.q.input.compilationClosure.roots[0].sourcePath=x.worker.sourcePath;}},
 {name:'requiredRootAbsentFromEmbeddingRoots',inputEdit:true,mutate:x=>{x.q.input.compilationClosure.requiredRoots=[{kind:'application',sourcePath:x.worker.sourcePath,name:x.worker.name}];}},
 {name:'requiredAndEmbeddingRootCoherentlyMissingBinding',inputEdit:true,mutate:x=>{const root={kind:'application',sourcePath:x.worker.sourcePath,name:'absent'};x.q.input.compilationClosure.roots.push(clone(root));x.q.input.compilationClosure.requiredRoots=[root];}},
 {name:'moduleInitializationRootUnconsumedSource',inputEdit:true,mutate:x=>{x.q.input.compilationClosure.roots.push({kind:'module-initialization',sourcePath:'/src/foreign.ts',name:'$moduleInit'});}},
 {name:'moduleInitializationRootWrongName',inputEdit:true,mutate:x=>{x.q.input.compilationClosure.roots.push({kind:'module-initialization',sourcePath:x.worker.sourcePath,name:'entry'});}},
 {name:'rootTupleHasUnknownKey',inputEdit:true,mutate:x=>{x.q.input.compilationClosure.roots[0].target=x.entry.symbol;}},
 {name:'duplicateEmbeddingRoot',inputEdit:true,mutate:x=>{x.q.input.compilationClosure.roots.push(clone(x.q.input.compilationClosure.roots[0]));}},
];

async function captured() {
  const base=new URL('../fixtures/r03/m21-exception/corpus/09/',import.meta.url);
  const buffers=await Promise.all(['request.json','response.json','origin.json','expected-private.json'].map(name=>readFile(new URL(name,base))));
  assert.deepEqual(buffers.map(hash),['request','response','origin','expected'].map(key=>'sha256:'+pin[key]));
  assert.ok(buffers[1].equals(buffers[3]),'actual09 must equal pre-existing independent full expected-private');
  const [q,p,o,expectedPacket]=buffers.map(bytes=>JSON.parse(bytes.toString('utf8')));
  const sources=q.input.files.filter(file=>!file.path.endsWith('.d.ts')).map(file=>({path:file.path,content:file.content}));
  assert.deepEqual(sources,pin.sources);const x=context(q,expectedPacket);
  assert.notDeepEqual(x.entryParameter.presence,x.workerParameter.presence,'callee and caller anchors intentionally differ');
  assert.deepEqual(x.call.signature.presence,[x.workerParameter.presence],'signature belongs to actual callee source');
  assert.equal(x.call.arguments[0].symbol,x.entryParameter.id);assert.equal(x.call.target,x.worker.symbol);
  const frames={requestBytes:buffers[0],responseBytes:buffers[1],origin:o};identities(frames);
  return {q,p,o,buffers,frames,expectedPacket};
}

test('independent module source ownership, imports, roots, initialization and callee anchors',async t=>{
  const baseline=await captured();
  await t.test('actual09 complete expected, owned and cold control',async()=>{
    const requestBytes=Buffer.from(baseline.frames.requestBytes),responseBytes=Buffer.from(baseline.frames.responseBytes),origin=clone(baseline.o);
    const before=[hash(requestBytes),hash(responseBytes),jcs(origin)],expected=expectedSnapshot(baseline);
    const result=await importCapturedFrontendResponse(requestBytes,responseBytes,origin);
    assert.equal(result.status,'ok');assert.deepEqual(result.snapshot,expected);frozen(result.snapshot);
    validateFrontendSnapshot(result.snapshot);validateFrontendSnapshot(JSON.parse(JSON.stringify(result.snapshot)));
    assert.deepEqual([hash(requestBytes),hash(responseBytes),jcs(origin)],before);
    requestBytes.fill(0);responseBytes.fill(0);origin.producerBaseOid='0'.repeat(40);
    assert.deepEqual(result.snapshot,expected);validateFrontendSnapshot(JSON.parse(JSON.stringify(result.snapshot)));
  });
  for(const mutation of mutations)await t.test(mutation.name,async()=>{
    const q=clone(baseline.q),p=clone(baseline.p);mutation.mutate(context(q,p));
    const frames=seal(q,p,baseline.o);identities(frames);
    assert.deepEqual(q.input.files,baseline.q.input.files,'every original Source and DTS byte stays unchanged');
    assert.deepEqual(p.payload.files,baseline.p.payload.files);
    if(mutation.inputEdit)assert.deepEqual({...q.input,compilationClosure:baseline.q.input.compilationClosure},baseline.q.input);
    else {assert.deepEqual(q,baseline.q);assert.equal(p.payload.inputIdentity,baseline.p.payload.inputIdentity);}
    if(!mutation.exportsEdit)assert.deepEqual(p.payload.exports,baseline.p.payload.exports);
    const before=[hash(frames.requestBytes),hash(frames.responseBytes),jcs(frames.origin)];
    const result=await importCapturedFrontendResponse(frames.requestBytes,frames.responseBytes,frames.origin);
    assert.equal(result.status,'error','repaired module corruption must reject: '+mutation.name);
    const code=result.diagnostics?.[0]?.code;assert.match(code,/^r03-exception-/);assert.notEqual(code,'r03-exception-identity');
    assert.ok(!Object.hasOwn(result,'snapshot'));assert.deepEqual([hash(frames.requestBytes),hash(frames.responseBytes),jcs(frames.origin)],before);
    t.diagnostic(JSON.stringify({mutation:mutation.name,code,outerDomainsValid:true,sourceUnchanged:true}));
  });
  assert.equal(mutations.length,89);
  assert.deepEqual(baseline.buffers.map(hash),['request','response','origin','expected'].map(key=>'sha256:'+pin[key]));
});
