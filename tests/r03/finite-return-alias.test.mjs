// SPDX-License-Identifier: MIT
// Real checked facts and the production producer: this is not C++ IR execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {scalarTypeIds,sha256} from '../../compiler/identity.mjs';

test('checked identity helper keeps its real argument and return SSA in formal Core',async()=>{
  const bytes=await readFile(new URL('./testdata/typed-array-source514/32182fb1de5d58081e32f41557eb01de78e99056565fde9b7569c2a5a76eabb7-package.json',import.meta.url));
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
    factsBytes:bytes,expectedPackageId:facts.packageId},built=buildHir(facts,context);
  assert.equal(built.status,'ok');const hir=built.hir,pass=hir.functions.find(fn=>fn.name==='pass');assert.ok(pass);
  const plan=buildFiniteCoreDomains(hir,context).definition,core=lowerFormalHir(hir,context);
  assert.deepEqual(plan.fieldReaching.returnAliases.find(row=>row.functionId===pass.id),{functionId:pass.id,parameter:0});
  const body=core.split('  func.func @"f'+pass.id.slice(7)+'"')[1].split('\n  }')[0];
  const parameter=/^\((%\w+):/.exec(body.trimStart());assert.ok(parameter);
  const returned=body.split('\n').find(line=>line.includes('"func.return"'));assert.ok(returned);
  assert.ok(returned.includes(parameter[1]));
  const calls=core.split('\n').filter(line=>line.includes('"func.call"')&&line.includes(pass.id));
  assert.equal(calls.length,1);assert.match(calls[0],/"func\.call"\(%\w+\)/);
});

test('actual returned Box alias write supplies the original parameter field read',async()=>{
  const bytes=await readFile(new URL('./testdata/typed-array-entry/8b00667e6a16cfd97810e62c23d5fb59e98aead813d7ecd0e507153f45d156ea-package.json',import.meta.url));
  assert.equal(bytes.length,10789);assert.equal(sha256(bytes),'sha256:f5756133f6132a705b36d787c40dc6acbf345fbdd8add5115caac61ea8f440a1');
  /** @type {{payload:{files:{path:string,content:string}[],functions:{name:string,body:{value?:{flowType:string}}[]}[]}}} */
  const raw=JSON.parse(bytes.toString()),sourceFile=raw.payload.files.find(file=>file.path==='/src/main.ts'),
    original=raw.payload.functions.find(fn=>fn.name==='run');assert.ok(sourceFile);assert.ok(original);
  const source=sourceFile.content;
  assert.equal(original.body.at(-1)?.value?.flowType,'union<i32,undefined>','official flow is not the actual field-state proof');
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
    factsBytes:bytes,expectedPackageId:facts.packageId},built=buildHir(facts,context);assert.equal(built.status,'ok');
  const hir=built.hir,same=hir.functions.find(fn=>fn.name==='same'),run=hir.functions.find(fn=>fn.name==='run');
  assert.ok(same);assert.ok(run);
  const plan=buildFiniteCoreDomains(hir,context).definition,core=lowerFormalHir(hir,context);
  assert.deepEqual(plan.fieldReaching.returnAliases.find(row=>row.functionId===same.id),{functionId:same.id,parameter:0});
  const read=plan.fieldReaching.reads.find(row=>row.node.startsWith(run.id+'/')),
    write=plan.fieldReaching.writes.find(row=>row.id.startsWith(run.id+'/'));
  assert.ok(read);assert.ok(write);assert.ok(read.reaching.length>0);
  assert.ok(read.reaching.every(row=>row.versions.length===1&&row.versions[0]===write.id));
  const node=plan.nodes.find(row=>row.id===read.node);assert.ok(node);
  assert.deepEqual(plan.domains.find(row=>row.id===node.domainId)?.actualTypes,[scalarTypeIds.i32]);
  const body=core.split('  func.func @"f'+run.id.slice(7)+'"')[1].split('\n  }')[0],lines=body.split('\n'),
    call=lines.find(line=>line.includes('"func.call"')&&line.includes(same.id)),
    store=lines.find(line=>line.includes('"tsfg_core.domain.field_store"')),
    access=lines.find(line=>line.includes('"tsfg_core.domain.field_read"'));
  assert.ok(call);assert.ok(store);assert.ok(access);
  assert.equal(lines.filter(line=>line.includes('"func.call"')).length,1);
  assert.ok(body.indexOf(call)<body.indexOf(store)&&body.indexOf(store)<body.indexOf(access));
  const callResult=/^\s*(%\w+) =/.exec(call);assert.ok(callResult);
  assert.ok(store.includes('('+callResult[1]+','),'field write uses the actual identity-call result');
  assert.ok(store.includes('tsfg_source.start = '+source.indexOf('alias.n=1')+' : i64'));
  assert.ok(access.includes('tsfg_source.start = '+source.lastIndexOf('b.n')+' : i64'));
  const parameter=/^\((%\w+):/.exec(body.trimStart());assert.ok(parameter);
  assert.ok(access.includes('('+parameter[1]+')'),'read remains on the original parameter SSA');
});
