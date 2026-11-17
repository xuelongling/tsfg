// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {addFiniteTerminalReturnCarriers,buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {buildTypedLayouts} from '../../compiler/typed-layouts.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
import {accepted,invokeCore,rejected} from './generic-core-package-capture.mjs';
import {staticPublication} from './typed-array-publication-fixtures.mjs';

test('actual empty Array read preserves a checked terminal frontier across two direct calls',async t=>{
  const bytes=await readFile(new URL('./testdata/typed-array-terminal-call/empty-tail-chain-package.json',import.meta.url));
  assert.equal(sha256(bytes),'sha256:f2b6665bba0bed8020212b6a584ec9900bb57ee9556a50e1ec2de006a0bbfce0');
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const publication=staticPublication(facts),built=buildHir(facts,context,publication);
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const {hir}=built,[leaf,relay,tail]=['leaf','relay','tail'].map(name=>hir.functions.find(fn=>fn.name===name));
  assert.ok(leaf&&relay&&tail);
  assert.equal(hir.functions.length,3);
  assert.deepEqual(hir.exports.map(row=>row.functionId),[tail.id]);
  const bottom=sha256('tsfg.actual-domain.v1\0[]'),scalar=sha256('tsfg.actual-domain.v1\0'+canonical([leaf.returnType.id]));
  const options={publicationContext:publication},proofs=buildFiniteCoreDomains(hir,context,options);
  const proof=proofs.definition,[read]=proof.arrayReaching.reads;
  assert.equal(proof.arrayReaching.reads.length,1);
  assert.deepEqual([read.node,read.status,read.versions,read.sources],[leaf.id+'/body/1/value','missing',[],[]]);
  const callNodes=[relay,tail].map(fn=>fn.id+'/body/0/value');
  const actualNodes=[read.node,...callNodes,...[leaf,relay,tail].map(fn=>fn.id+'/return')];
  for(const plan of [proof,proofs.reached])for(const id of actualNodes){
    const row=plan.nodes.find(node=>node.id===id);assert.ok(row);
    assert.deepEqual([row.domainId,row.pending,row.arrayOwners],[bottom,[],[]]);
  }
  const sites=new Map(proof.fieldReaching.callContexts.map(row=>[row.site,row.target]));
  for(const [i,fn] of [leaf,relay].entries())assert.equal(sites.get(callNodes[i]+'\0'+fn.id),fn.id);
  assert.equal(sites.size,2);

  // Lowering re-verifies the complete original Source packet and constructs
  // its own plans. Inspect the emitted functions and actual call signatures.
  const core=lowerFormalHir(hir,context,publication);
  const plan=addFiniteTerminalReturnCarriers(hir,proof,buildTypedLayouts(hir,context,options),()=>{});
  const bodies=new Map();
  for(const fn of [leaf,relay,tail]){
    const abi=plan.abi.find(row=>row.functionId===fn.id);
    assert.equal(abi.result,scalar);
    assert.equal(abi.id,sha256('tsfg.finite-abi.v1\0'+canonical({parameters:[],result:scalar})));
    const start=core.indexOf('  func.func @"f'+fn.id.slice(7)+'"');
    assert.ok(start>=0);
    const end=core.indexOf('\n  }',start);
    assert.ok(end>start);
    const lines=core.slice(start,end).split('\n');
    assert.ok(lines[0].includes('() -> f64 attributes'));
    assert.ok(lines[0].includes('tsfg_core.finite_abi = "'+abi.id+'"'));
    assert.ok(lines.at(-1).includes(' : (f64) -> ()'));
    assert.ok(lines.at(-1).includes('"func.return"'));
    bodies.set(fn.id,lines);
  }
  const leafLines=bodies.get(leaf.id),create=leafLines.find(line=>line.includes('"tsfg_core.domain.array_create"'));
  assert.ok(create.includes('"tsfg_core.domain.array_create"()'));
  assert.ok(create.includes('array_versions = "[]"'));
  assert.ok(create.includes('element_domain = "'+bottom+'"'));
  /** @param {string} line */
  const checkedRead=line=>line.includes('"tsfg_core.domain.array_read"')&&line.includes('array_node = "'+read.node+'"');
  assert.match(leafLines.find(checkedRead),/ -> f64$/);
  const edges=[[relay,leaf],[tail,relay]];
  for(const [caller,callee] of edges){
    const calls=bodies.get(caller.id).filter(line=>line.includes('"func.call"'));
    assert.equal(calls.length,1);
    assert.ok(calls[0].includes('callee = @"f'+callee.id.slice(7)+'"'));
    assert.ok(calls[0].includes('tsfg_core.signature_hash = "'+callee.signatureHash+'"'));
    assert.ok(calls[0].includes('tsfg_core.finite_abi = "'+plan.abi.find(row=>row.functionId===callee.id).id+'"'));
    assert.match(calls[0],/ : \(\) -> f64$/);
  }
  if(process.env.TSFG_CORE_IR_EXE)await t.test('both static modes admit the actual call chain and reject a stale signed ABI',async()=>{
    const canonicalized=await invokeCore(core);
    accepted(canonicalized);
    const printed=canonicalized.stdout.toString('utf8').split(/\r?\n/);
    assert.match(printed.find(checkedRead),/ -> f64$/);
    const printedCalls=printed.filter(line=>line.includes('"func.call"'));
    assert.equal(printedCalls.length,edges.length);
    for(const [caller,callee] of edges){
      const {start,end}=caller.body[0].value.range;
      const call=printedCalls.find(line=>line.includes('tsfg_source.start = '+start+' : i64')
        &&line.includes('tsfg_source.end = '+end+' : i64'));
      assert.ok(call);
      assert.ok(call.includes('callee = @f'+callee.id.slice(7)));
      assert.ok(call.includes('tsfg_core.function_id = "'+callee.id+'"'));
      assert.ok(call.includes('tsfg_core.finite_abi = "'+plan.abi.find(row=>row.functionId===callee.id).id+'"'));
      assert.match(call,/ : \(\) -> f64$/);
    }
    const optimized=await invokeCore(core,'--optimize');
    accepted(optimized);
    assert.deepEqual(optimized.stdout,canonicalized.stdout);
    const call=bodies.get(tail.id).find(line=>line.includes('"func.call"'));
    const stale=proof.abi.find(row=>row.functionId===relay.id).id;
    const wrong=core.replace(call,call.replace(/tsfg_core.finite_abi = "[^"]+"/,'tsfg_core.finite_abi = "'+stale+'"'));
    assert.notEqual(wrong,core);
    const failure=await invokeCore(wrong);
    rejected(failure);
    assert.ok(failure.stderr.toString('utf8').includes('direct call authority/ABI'));
  });
});
