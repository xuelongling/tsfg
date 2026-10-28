// SPDX-License-Identifier: MIT
// Independent actual catch-closure control and repaired negatives; imports Product when run.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';
const schema='sha256:5221b50822965c633418462b28a9b58bfbc41b01e0fa4b6d31c50ab83805424d';
const pin={
  "directory": "08",
  "request": "584a1c04fa3686f223a2cf3c38c83b3e3ba91ac8ab6c4ea49c67f6139f05145b",
  "response": "ec8f399ef5ea0208b41003886c6aa308de07c7e9d611917e5150748a880184a8",
  "origin": "97a5939eb78f38694bb662cbf0c898dd91c4c3600159957a87d0edf4222f0d3e",
  "expected": "ec8f399ef5ea0208b41003886c6aa308de07c7e9d611917e5150748a880184a8",
  "source": "/* 😀 */ export function entry(value: i32): bool { try { throw value; } catch (caught) { function inner(): bool { try { throw caught; } catch (nested) { return typeof nested === \"boolean\"; } } return inner(); } }"
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

/** @param {any} facts */
function context(facts) {
  const root=facts.functions[0],child=facts.functions[1];
  const outer=root.body[0].exception,inner=child.body[0].exception;
  return {facts,root,child,outer,inner,declaration:outer.catchClause.block.body[0],
    call:outer.catchClause.block.body[1].expression,read:inner.tryBlock.body[0].expression,
    test:inner.catchClause.block.body[0].expression,definitions:new Map(facts.symbols.map(symbol=>[symbol.id,symbol]))};
}
/** @param {any} x @param {string} id @param {(value:any)=>void} change */
function coherentSymbol(x,id,change) {walk(x.facts,value=>{if(value.id===id)change(value);});}
/** @param {any} x */
function swapCatchIds(x) {
  walk(x.facts,value=>{for(const key of ['id','symbol'])if(typeof value[key]==='string')value[key]=value[key]==='s4'?'s5':value[key]==='s5'?'s4':value[key];});
  [x.facts.symbols[3],x.facts.symbols[4]]=[x.facts.symbols[4],x.facts.symbols[3]];
}
/** @type {[string,(value:any)=>void][]} */
const mutations=[
 ['childParentForeign',x=>{x.child.lexicalParent='s404';}],
 ['childParentSelf',x=>{x.child.lexicalParent=x.child.symbol;}],
 ['childParentOmitted',x=>{delete x.child.lexicalParent;}],
 ['rootParentInvented',x=>{x.root.lexicalParent=x.child.symbol;}],
 ['childOwnerRegistryAndEmbeddedForeign',x=>{coherentSymbol(x,x.child.symbol,value=>{value.lexicalOwner='s404';});}],
 ['childOwnerRegistryAndEmbeddedSelf',x=>{coherentSymbol(x,x.child.symbol,value=>{value.lexicalOwner=x.child.symbol;});}],
 ['rootOwnerInvented',x=>{coherentSymbol(x,x.root.symbol,value=>{value.lexicalOwner=x.root.symbol;});}],
 ['outerCatchOwnerCoherentlyChild',x=>{coherentSymbol(x,x.outer.catchClause.binding.id,value=>{value.lexicalOwner=x.child.symbol;});}],
 ['innerCatchOwnerCoherentlyRoot',x=>{coherentSymbol(x,x.inner.catchClause.binding.id,value=>{value.lexicalOwner=x.root.symbol;});}],
 ['parameterOwnerCoherentlyChild',x=>{coherentSymbol(x,x.root.parameters[0].id,value=>{value.lexicalOwner=x.child.symbol;});}],
 ['outerCatchOwnerCoherentlyMissing',x=>{coherentSymbol(x,x.outer.catchClause.binding.id,value=>{delete value.lexicalOwner;});}],
 ['catchRegistryOrderCoherentlyReversed',swapCatchIds],
 ['childNameCoherentlyForeign',x=>{coherentSymbol(x,x.child.symbol,value=>{value.name='other';});x.child.name='other';}],
 ['catchNameCoherentlyForeign',x=>{coherentSymbol(x,x.outer.catchClause.binding.id,value=>{value.name='outside';});}],
 ['outerCatchTypeCoherentlyBool',x=>{coherentSymbol(x,x.outer.catchClause.binding.id,value=>{value.type='bool';});}],
 ['outerCatchWritableCoherentlyFalse',x=>{coherentSymbol(x,x.outer.catchClause.binding.id,value=>{value.writable=false;});}],
 ['childCapturesOmitted',x=>{delete x.child.captures;}],
 ['childCapturesEmpty',x=>{x.child.captures=[];}],
 ['childCaptureReadFalse',x=>{x.child.captures[0].read=false;}],
 ['childCaptureWriteTrue',x=>{x.child.captures[0].write=true;}],
 ['childCaptureWrongOriginalBinding',x=>{x.child.captures[0].symbol=x.inner.catchClause.binding.id;}],
 ['childCaptureDuplicate',x=>{x.child.captures.push(clone(x.child.captures[0]));}],
 ['childCaptureExtraParameter',x=>{x.child.captures.push({symbol:x.root.parameters[0].id,read:true,write:false});}],
 ['childCaptureHasForeignKey',x=>{x.child.captures[0].lexicalOwner=x.root.symbol;}],
 ['rootClaimsChildRead',x=>{x.root.captures=clone(x.child.captures);}],
 ['outerReadPretendsNarrowedBool',x=>{x.read.type='bool';}],
 ['outerReadTargetsNotYetInnerCatch',x=>{x.read.symbol=x.inner.catchClause.binding.id;}],
 ['innerReadTargetsOuterCatch',x=>{x.test.operand.symbol=x.outer.catchClause.binding.id;}],
 ['childTableOmitted',x=>{x.facts.functions.pop();}],
 ['childTableDuplicated',x=>{x.facts.functions.push(clone(x.child));}],
 ['functionPreorderReversed',x=>{x.facts.functions.reverse();}],
 ['childBodyOmitted',x=>{x.child.body=[];}],
 ['childBodyBorrowedFromParent',x=>{x.child.body=clone(x.root.body);}],
 ['childTryReadOmitted',x=>{x.inner.tryBlock.body=[];}],
 ['declarationOmitted',x=>{x.outer.catchClause.block.body.shift();}],
 ['declarationDuplicated',x=>{x.outer.catchClause.block.body.unshift(clone(x.declaration));}],
 ['declarationHasInlineBody',x=>{x.declaration.body=clone(x.child.body);}],
 ['declarationClaimsRootHeader',x=>{x.declaration.symbol=clone(x.definitions.get(x.root.symbol));}],
 ['declarationHeaderDiffersFromRegistry',x=>{x.declaration.symbol.name='other';}],
 ['declarationRangeDiffersFromTable',x=>{x.declaration.range.start++;}],
 ['childTableAndDeclarationRangeCoherentlyTrimmed',x=>{x.declaration.range.start++;x.child.range.start++;}],
 ['childTableRangeSplitsAstral',x=>{x.child.range.start=4;}],
 ['directCallTargetsRoot',x=>{x.call.target=x.root.symbol;}],
 ['directCallTargetsCatchLocal',x=>{x.call.target=x.outer.catchClause.binding.id;}],
 ['directCallTargetsForeignFunction',x=>{x.call.target='s404';}],
 ['directCallSignatureOmitted',x=>{delete x.call.signature;}],
 ['directCallSignatureWrongResult',x=>{x.call.signature.returnType='i32';}],
 ['directCallSignatureInventsParameter',x=>{x.call.signature.parameters=['i32'];}],
 ['directCallSignatureInventsKey',x=>{x.call.signature.target=x.child.symbol;}],
 ['directCallArgumentsOmitted',x=>{delete x.call.arguments;}],
 ['directCallInventsArgument',x=>{x.call.arguments=[clone(x.read)];}],
 ['directCallWrongResultType',x=>{x.call.type='i32';}],
 ['directCallHasIndirectCallee',x=>{x.call.callee=clone(x.read);}],
 ['directCallRawAnchorTrimmed',x=>{x.call.range.start++;}],
 ['wholeTypeTestUsesRawStart',x=>{x.test.range.start=x.test.typeTest.typeofRange.start;}],
 ['wholeTypeTestEndTruncated',x=>{x.test.range.end--;}],
 ['typeofRawAnchorTrimmed',x=>{x.test.typeTest.typeofRange.start++;}],
 ['typeofRawAnchorAddsTrivia',x=>{x.test.typeTest.typeofRange.start--;}],
 ['typeofRawEndTruncated',x=>{x.test.typeTest.typeofRange.end--;}],
 ['tagRawAnchorTrimmed',x=>{x.test.typeTest.tagRange.start++;}],
 ['tagRawEndTruncated',x=>{x.test.typeTest.tagRange.end--;}],
 ['operandRawAnchorTrimmed',x=>{x.test.operand.range.start++;}],
 ['operandInventsBooleanProof',x=>{x.test.operand.type='bool';}],
 ['typeofAnchorHasForeignKey',x=>{x.test.typeTest.typeofRange.positionUnit='utf16';}],
];

async function captured() {
  const base=new URL('../fixtures/r03/m21-exception/corpus/08/',import.meta.url);
  const buffers=await Promise.all(['request.json','response.json','origin.json','expected-private.json'].map(name=>readFile(new URL(name,base))));
  assert.deepEqual(buffers.map(hash),['request','response','origin','expected'].map(key=>'sha256:'+pin[key]));
  assert.ok(buffers[1].equals(buffers[3]),'actual08 must equal pre-existing independent complete expected-private');
  const [q,p,o,expectedPacket]=buffers.map(bytes=>JSON.parse(bytes.toString('utf8')));
  const source=q.input.files.find(file=>file.path===q.input.rootFile).content;
  assert.equal(source,pin.source);assert.equal(source.codePointAt(3),0x1f600);
  const x=context(expectedPacket.payload.facts);
  assert.deepEqual([x.test.range,x.test.typeTest.typeofRange,x.test.operand.range,x.test.typeTest.tagRange],
    [{start:160,end:187},{start:159,end:173},{start:166,end:173},{start:177,end:187}]);
  assert.equal(source.slice(160,187),'typeof nested === "boolean"');assert.equal(source.slice(159,173),' typeof nested');
  const frames={requestBytes:buffers[0],responseBytes:buffers[1],origin:o};identities(frames);
  return {q,p,o,buffers,frames,expectedPacket};
}

test('independent catch-closure ownership, captures, calls and exact UTF16 anchors',async t=>{
  const baseline=await captured();
  await t.test('actual08 complete expected, deep-owned and cold control',async()=>{
    const requestBytes=Buffer.from(baseline.frames.requestBytes),responseBytes=Buffer.from(baseline.frames.responseBytes),origin=clone(baseline.o);
    const before=[hash(requestBytes),hash(responseBytes),jcs(origin)],expected=expectedSnapshot(baseline);
    const result=await importCapturedFrontendResponse(requestBytes,responseBytes,origin);
    assert.equal(result.status,'ok');assert.deepEqual(result.snapshot,expected);frozen(result.snapshot);
    validateFrontendSnapshot(result.snapshot);validateFrontendSnapshot(JSON.parse(JSON.stringify(result.snapshot)));
    assert.deepEqual([hash(requestBytes),hash(responseBytes),jcs(origin)],before);
    requestBytes.fill(0);responseBytes.fill(0);origin.producerBaseOid='0'.repeat(40);
    assert.deepEqual(result.snapshot,expected);validateFrontendSnapshot(JSON.parse(JSON.stringify(result.snapshot)));
  });
  for(const [name,mutate] of mutations)await t.test(name,async()=>{
    const q=clone(baseline.q),p=clone(baseline.p);mutate(context(p.payload.facts));
    const frames=seal(q,p,baseline.o);identities(frames);
    assert.deepEqual(q,baseline.q,'entire actual source, DTS, profile, roots and target stay fixed');
    assert.deepEqual(p.payload.exports,baseline.p.payload.exports,'complete exports stay fixed');
    assert.deepEqual(p.payload.files,baseline.p.payload.files);assert.equal(p.payload.inputIdentity,baseline.p.payload.inputIdentity);
    const before=[hash(frames.requestBytes),hash(frames.responseBytes),jcs(frames.origin)];
    const result=await importCapturedFrontendResponse(frames.requestBytes,frames.responseBytes,frames.origin);
    assert.equal(result.status,'error','repaired closure corruption must reject: '+name);
    const code=result.diagnostics?.[0]?.code;assert.match(code,/^r03-exception-/);assert.notEqual(code,'r03-exception-identity');
    assert.ok(!Object.hasOwn(result,'snapshot'));assert.deepEqual([hash(frames.requestBytes),hash(frames.responseBytes),jcs(frames.origin)],before);
    t.diagnostic(JSON.stringify({mutation:name,code,completeOuterDomainsValid:true,sourceUnchanged:true}));
  });
  assert.equal(mutations.length,64);
  assert.deepEqual(baseline.buffers.map(hash),['request','response','origin','expected'].map(key=>'sha256:'+pin[key]));
});
