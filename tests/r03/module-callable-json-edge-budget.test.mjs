// SPDX-License-Identifier: MIT
// Extra-key mechanical probes preserve the complete private fixture. An exact
// graph cap here grants no legal-program maximum or semantic execution credit.
import assert from 'node:assert/strict';
import test from 'node:test';
import {validateFrontendSnapshot} from '../../compiler/frontend.mjs';
import {verifyHir} from '../../compiler/hir.mjs';
import {sample,clone,canonical,base,assertError} from './module-callable-fixtures.mjs';
const fixture=sample('first-rr');
const messages={input:'invalid module callable candidate',reconstruct:'module callable HIR differs from complete reconstruction',limit:'module callable candidate budget exceeded'};
const rejects=(action,kind)=>assert.throws(action,error=>assertError(error,base(kind,messages[kind])));
// Container depth starts at the complete root object=1. Primitive leaves do
// not add object depth, matching the frozen descriptor-safe graph definition.
function depth(value,level=1){if(!value||typeof value!=='object')return 0;return Math.max(level,...Object.values(value).map(child=>depth(child,level+1)));}
function tokens(value){if(!value||typeof value!=='object')return 1;return Array.isArray(value)?2+value.reduce((sum,child)=>sum+tokens(child),0):2+Object.values(value).reduce((sum,child)=>sum+1+tokens(child),0);}
function independentOtherLimits(value){assert.ok(Buffer.byteLength(canonical(value))<8388608);assert.ok(tokens(value)<200000);}
test('complete HIR and snapshot extra string has exact1MiB decoded boundary',()=>{
 for(const extra of [0,1]){const hir=clone(fixture.hir),snapshot=clone(fixture.snapshot),text='x'.repeat(1048576+extra);assert.equal(Buffer.byteLength(text),1048576+extra);hir.extra=text;snapshot.extra=text;
  independentOtherLimits(hir);independentOtherLimits(snapshot);assert.ok(depth(hir)<128);assert.ok(depth(snapshot)<128);
  rejects(()=>verifyHir(hir),extra?'limit':'reconstruct');rejects(()=>validateFrontendSnapshot(snapshot),extra?'limit':'input');
 }
});
test('complete HIR and snapshot extra child graph has exact depth128 boundary',()=>{
 for(const extra of [0,1]){const hir=clone(fixture.hir),snapshot=clone(fixture.snapshot);let child=null;for(let i=0;i<127+extra;i++)child={child};hir.extra=child;snapshot.extra=clone(child);
  assert.equal(depth(hir),128+extra);assert.equal(depth(snapshot),128+extra);independentOtherLimits(hir);independentOtherLimits(snapshot);
  rejects(()=>verifyHir(hir),extra?'limit':'reconstruct');rejects(()=>validateFrontendSnapshot(snapshot),extra?'limit':'input');
 }
});
