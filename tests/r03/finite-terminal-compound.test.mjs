// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,buildInitialArrayPublication,lowerFormalHir} from '../../compiler/hir.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
import {accepted,invokeCore} from './generic-core-package-capture.mjs';

test('a terminal compound old read blocks the RHS sink write and the target writeback',async t=>{
  const bytes=await readFile(new URL('./testdata/typed-array-terminal-compound/old-value-terminal-package.json',import.meta.url));
  assert.equal(sha256(bytes),'sha256:6a33970814041f757694f14cb3750e8553593de9cf4f77bef2aefa75c150aaca');
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const publication=buildInitialArrayPublication(context),built=buildHir(facts,context,publication);
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const {hir}=built,compound=hir.functions.find(fn=>fn.name==='compound'),mark=hir.functions.find(fn=>fn.name==='mark');
  assert.ok(compound&&mark);
  const target=compound.id+'/body/2/expression',old=target+'/old-value',elements=compound.id+'/body/0/initializer/elements';
  const sink=mark.id+'/binding/'+mark.parameters[0].id;
  const bottom=sha256('tsfg.actual-domain.v1\0[]'),scalar=sha256('tsfg.actual-domain.v1\0'+canonical([compound.returnType.id]));
  const source=facts.payload.files.find(row=>row.path===compound.sourcePath).content;
  const proofs=buildFiniteCoreDomains(hir,context,{publicationContext:publication});
  for(const plan of [proofs.reached,proofs.definition]){
    assert.equal(plan.arrayReaching.reads.length,1);
    const [read]=plan.arrayReaching.reads;
    assert.deepEqual([read.node,read.index,read.status,read.versions,read.sources],[old,'c:0','missing',[],[]]);
    assert.equal(source.slice(read.origin.start,read.origin.end),'a[at]');
    const normal=[old,target,target+'/value',elements,compound.id+'/return'];
    if(plan===proofs.reached)normal.push(sink);
    for(const id of normal){
      const row=plan.nodes.find(node=>node.id===id);assert.ok(row);
      assert.deepEqual([row.domainId,row.arrayOwners,row.pending],[bottom,[],[]],id);
    }
    assert.equal(plan.carrierNodes.find(row=>row.id===old).domainId,scalar);
    assert.equal(plan.carrierNodes.find(row=>row.id===elements).domainId,bottom);
    const writes=plan.arrayReaching.writes;
    assert.deepEqual(writes.map(row=>row.id).sort(),[mark.id+'/body/0/expression/array-version',target+'/array-version'].sort());
    const rhsWrite=writes.find(row=>row.id.startsWith(mark.id));
    assert.equal(source.slice(rhsWrite.origin.start,rhsWrite.origin.end),'sink[0] = 7.0');
  }

  /** @param {string} text */
  const checkBody=text=>{
    const symbol='f'+compound.id.slice(7),lines=text.split(/\r?\n/);
    const start=lines.findIndex(line=>line.includes('func.func @'+symbol+'(')||line.includes('func.func @"'+symbol+'"(')
      ||line.startsWith('  "func.func"()')&&line.includes('sym_name = "'+symbol+'"'));
    assert.ok(start>=0);
    const end=lines.findIndex((line,index)=>index>start&&/^  }(?:\)|$)/.test(line));
    assert.ok(end>start);
    const body=lines.slice(start,end);
    /** @param {(line:string)=>boolean} matches */
    const occurrence=matches=>{
      const found=body.filter(matches);
      assert.equal(found.length,1);
      return found[0];
    };
    const created=occurrence(line=>line.includes('"tsfg_core.domain.array_create"'));
    assert.ok(created?.includes('"tsfg_core.domain.array_create"()'));
    assert.ok(created.includes('array_versions = "[]"'));
    assert.ok(created.includes('element_domain = "'+bottom+'"'));
    const read=occurrence(line=>line.includes('"tsfg_core.domain.array_read"')&&line.includes('array_node = "'+old+'"'));
    assert.match(read,/ -> f64$/);
    const rhs=occurrence(line=>line.includes('func.call')&&line.includes('tsfg_core.function_id = "'+mark.id+'"'));
    const add=occurrence(line=>line.includes('"tsfg_core.add"'));
    const write=occurrence(line=>line.includes('"tsfg_core.domain.array_store"')&&line.includes('array_node = "'+target+'"'));
    const order=[created,read,rhs,add,write].map(line=>body.indexOf(line));
    assert.ok(order.every((position,index)=>index===0||order[index-1]<position));
  };
  const core=lowerFormalHir(hir,context,publication);
  checkBody(core);
  if(process.env.TSFG_CORE_IR_EXE)await t.test('both static modes retain the original checked occurrence and lexical effect order',async()=>{
    const canonicalized=await invokeCore(core);
    accepted(canonicalized);
    checkBody(canonicalized.stdout.toString('utf8'));
    const optimized=await invokeCore(core,'--optimize');
    accepted(optimized);
    assert.deepEqual(optimized.stdout,canonicalized.stdout);
  });
});
