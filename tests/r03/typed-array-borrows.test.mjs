// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildHir,verifyHir,printHir,readHir,analyzeArrayCalls,printArrayCalls,readArrayCalls} from '../../compiler/hir.mjs';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {staticPublication} from './typed-array-publication-fixtures.mjs';
import {createHash} from 'node:crypto';

// Actual Source publication, preserved unchanged: string|undefined is a valid T.
const bytes=await readFile(new URL('./testdata/typed-array-actual-v8/d70e95378e645d194db0875bfa9de4bbe1e774bde2ffa5a2872ce21d1ef89969-package.json',import.meta.url));
const facts=readTypedArrayFacts(bytes);
const selected={family:'tsfg.array-facts-context-candidate',version:2,
  factsBytes:bytes,expectedPackageId:facts.packageId};

test('ordinary v8 ReadSpan HIR requires the complete fixed publication before borrow admission',()=>{
  const result=buildHir(facts,selected);
  assert.equal(result.status,'error','typed projection must not bypass mandatory owner and borrow preparation');
  assert.equal(result.diagnostics[0].code,'r03-d-array-call-effects');
});

test('valid string|undefined borrowed reads retain the original owner and complete typed HIR',()=>{
  const publication=staticPublication(facts,{read:{parameters:{0:{read:true,write:false,structural:false}},
    local:{read:false,write:false,structural:false}}});
  const built=buildHir(facts,selected,publication);assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const hir=built.hir,plan=hir.readSpanPlan,state=plan.functions[0];
  assert.equal(hir.format.contractVersion,'0.16.0');assert.equal(plan.version,5);
  assert.equal(state.views.length,1);assert.equal(state.views[0].owner.kind,'parameter');
  assert.equal(state.views[0].owner.index,0);assert.equal(state.views[0].lastUseEvent,1);
  assert.deepEqual(state.events.map(row=>row.kind),['view-create-complete','view-read-complete']);
  assert.ok(hir.types.some(row=>row.kind==='union'&&row.members.length===2));
  assert.deepEqual(verifyHir(hir,selected,publication),hir);
  assert.deepEqual(readHir(Buffer.from(printHir(hir,selected,publication)),selected,publication),hir);
  const analysis=analyzeArrayCalls(hir,selected,publication);
  assert.equal(analysis.format.version,9);assert.equal(analysis.calls.length,0);
  assert.deepEqual(readArrayCalls(Buffer.from(printArrayCalls(analysis,hir,selected,publication)),hir,selected,publication),analysis);
  const bad=structuredClone(hir);bad.readSpanPlan.functions[0].views[0].lastUseEvent=0;
  assert.throws(()=>verifyHir(bad,selected,publication),{code:'r03-typed-array-hir-projection'});
  const oldReport=structuredClone(analysis);oldReport.format.version=8;
  assert.throws(()=>readArrayCalls(Buffer.from(JSON.stringify(oldReport)),hir,selected,publication),{code:'r03-d-array-call-effects-report'});
});

test('fixed publication identity, exact owner slots and Derived coverage reject independent tampering',()=>{
  const publication=staticPublication(facts,{read:{parameters:{0:{read:true,write:false,structural:false}},local:{read:false,write:false,structural:false}}});
  const cases={
    oldVersion:p=>{p.version=4;},wrongScope:p=>{p.scopeDigest='sha256:'+'0'.repeat(64);},
    missingOriginalSlot:p=>{p.contracts[0].upper.parameters=[];},
    scalarSlotSubstitution:p=>{p.contracts[0].upper.parameters[0].index=1;},
    missingReadMaximum:p=>{p.contracts[0].upper.parameters[0].read=false;},
  };
  const stable=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(stable).join(',')+']'
    :'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}';
  const hash=text=>'sha256:'+createHash('sha256').update(text).digest('hex');
  for(const [name,mutate]of Object.entries(cases)) {
    const input=structuredClone(publication);mutate(input);
    for(const row of input.contracts){const {digest,...body}=row;row.digest=hash('tsfg.array-published-contract.v5\0'+stable(body));}
    input.expectedDigest=hash('tsfg.array-publication.v5\0'+stable({scopeDigest:input.scopeDigest,contracts:input.contracts}));
    const result=buildHir(facts,selected,input);assert.equal(result.status,'error',name);
    assert.equal(result.hir,undefined,name+' cannot publish partial HIR');
    assert.ok(result.diagnostics[0].code.startsWith('r03-d-array-call-effects'),name);
  }
});
