// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {lowerHir,printHir,readHir} from '../../compiler/hir.mjs';
import {invokeCore,accepted,rejected} from './generic-core-package-capture.mjs';
import {readPacket} from './generic-core-package-wire.mjs';
const first=JSON.parse(await readFile(new URL('./module-callable-immutable-global-first.json',import.meta.url),'utf8'));
const boundaries=JSON.parse(await readFile(new URL('./module-callable-immutable-global-boundaries.json',import.meta.url),'utf8'));
const firstGold=JSON.parse(await readFile(new URL('./module-callable-core-first.json',import.meta.url),'utf8'));
const kernelGold=JSON.parse(await readFile(new URL('./module-callable-core-kernel.json',import.meta.url),'utf8'));
const cases=[...firstGold.rows.map(row=>({row,input:row.id==='bool'?first:first.i32})),
  ...kernelGold.rows.map(row=>({row,input:boundaries.kernelCases.find(c=>c.name===row.name)}))];
const bare=id=>id.slice(7);
for(const{row,input}of cases)test('real formal Core whole/canonical/R04: '+row.id,async()=>{
  const before=JSON.stringify(input);
  const raw=lowerHir(readHir(Buffer.from(printHir(input.hir))));
  assert.equal(raw,row.expectedRawCore);
  const first=await invokeCore(raw);accepted(first);
  const second=await invokeCore(first.stdout);accepted(second);
  assert.deepEqual(first.stdout,second.stdout);
  const emitted=await invokeCore(second.stdout,'--emit-bytecode');accepted(emitted);
  const packet=readPacket(emitted.stdout),view=row.expectedFormalView,state=view.moduleState;
  assert.equal(packet.mode,1);assert.equal(packet.inputIdentity,bare(view.inputIdentity));
  assert.equal(packet.sourceHash,bare(view.source.hash));assert.equal(packet.sourcePath,view.source.path);
  assert.equal(packet.sourceLength,view.source.length);
  assert.equal(packet.functions.length,row.counts.functions);
  assert.deepEqual(packet.functions.map(fn=>[fn.id,fn.signature,fn.typeId,fn.name,fn.start,fn.end]),
    view.functions.map(fn=>[bare(fn.id),bare(fn.signatureHash),bare(fn.returnType.id),fn.name,fn.range.start,fn.range.end]));
  assert.deepEqual(packet.tables.sources,state.sources.map(s=>({hash:bare(s.hash),path:s.path,length:s.length})));
  assert.deepEqual(packet.tables.modules,state.modules.map(m=>({id:bare(m.id),
    source:state.sources.findIndex(s=>s.path===m.sourcePath),
    initializer:view.functions.findIndex(fn=>fn.id===m.initializer),
    dependencies:m.dependencies.map(p=>state.modules.findIndex(m=>m.sourcePath===p))})));
  assert.deepEqual(packet.tables.globals.map(g=>[g.id,g.name,g.start,g.end]),
    state.globals.map(g=>[bare(g.id),g.name,g.range.start,g.range.end]));
  assert.deepEqual(packet.tables.roots.map(r=>[r.name,r.function]),
    state.closure.roots.map(r=>[r.name,view.functions.findIndex(fn=>fn.id===r.target)]));
  assert.deepEqual(packet.tables.initialization,state.closure.initialization.map(id=>view.functions.findIndex(fn=>fn.id===id)));
  assert.equal(JSON.stringify(input),before);
});

const bool=firstGold.rows[0],raw=bool.expectedRawCore;
const originalLeaf=first.hir.functions.find(fn=>fn.name==='leaf');
const formalLeaf=bool.expectedFormalView.functions.find(fn=>fn.name==='leaf');
const init=first.hir.functions.find(fn=>fn.kind==='module-initialization');
const callLine=text=>text.split('\n').find(line=>line.includes('"func.call"'));
const mutateCall=(text,from,to)=>text.replace(callLine(text),callLine(text).replace(from,to));
const functionText=(text,symbol)=>text.match(/^  func.func .*?^  }\n/gms).find(body=>body.includes(' @"'+symbol+'"('));
const leafText=functionText(raw,formalLeaf.symbol);
const foreign='sha256:'+ 'f'.repeat(64);
/** @type {Array<[string,string,RegExp]>} */
const mutations=[
  ['function-id',raw.replace(leafText,leafText.replace('tsfg_core.function_id = "'+formalLeaf.id+'"','tsfg_core.function_id = "'+originalLeaf.id+'"')),/r04-core-invalid/],
  ['signature',raw.replace(leafText,leafText.replace(formalLeaf.signatureHash,originalLeaf.signatureHash)),/r04-core-invalid/],
  ['call-id',mutateCall(raw,formalLeaf.id,originalLeaf.id),/r04-core-invalid/],
  ['call-signature',mutateCall(raw,formalLeaf.signatureHash,originalLeaf.signatureHash),/r04-core-invalid/],
  ['callee',mutateCall(raw,formalLeaf.symbol,'f'+bare(originalLeaf.id)),/core-ir-|r04-core-invalid/],
  ['initializer-signature',raw.replace(bool.expectedFormalView.functions[0].signatureHash,init.signatureHash),/r04-core-invalid/],
  ['module-id',raw.replace('id = "'+bool.expectedFormalView.moduleState.modules[0].id+'"','id = "'+foreign+'"'),/core-ir-module/],
  ['global-id',raw.replace('id = "'+bool.expectedFormalView.moduleState.globals[0].id+'"','id = "'+foreign+'"'),/core-ir-module/],
  ['global-index',raw.replace('global = 0 : i64','global = 1 : i64'),/core-ir-module/],
  ['missing-function',raw.replace(leafText,''),/core-ir-|r04-core-invalid/],
  ['extra-function',raw.replace(leafText,leafText+leafText),/core-ir-|r04-core-invalid/],
  ['initialization-index',raw.replace('tsfg_core.initialization = [0 : i64]','tsfg_core.initialization = [1 : i64]'),/core-ir-module/],
  ['root-index',raw.replace('name = "entry", function = 3 : i64','name = "entry", function = 0 : i64'),/core-ir-module/],
  ['source-range',mutateCall(raw,'tsfg_source.end = 182 : i64','tsfg_source.end = 255 : i64'),/r04-core-invalid/]
];
for(const[name,changed,diagnostic]of mutations)test('formal consumer independent negative: '+name,async()=>{
  assert.notEqual(changed,raw,'mutation must alter the full original');
  const result=await invokeCore(changed,'--emit-bytecode');rejected(result);
  assert.match(result.stderr.toString('utf8'),diagnostic);
});

test('whole gold catches a legal unrooted omission beyond formal IR validity',async()=>{
  const row=kernelGold.rows.find(row=>row.name==='retarget-same-signature-peer');
  assert.equal(row.counts.originalClosureFunctions,3);assert.equal(row.counts.emittedFunctions,4);
  const leaf=row.expectedFormalView.functions.find(fn=>fn.name==='leaf');
  const changed=row.expectedRawCore.replace(functionText(row.expectedRawCore,leaf.symbol),'')
    .replace('name = "entry", function = 3 : i64','name = "entry", function = 2 : i64');
  assert.notEqual(changed,row.expectedRawCore);
  // Repair the shifted entry root after deleting index2; all other indices stay.
  // The producer's complete-four literal equality is the preservation oracle.
  const canonical=await invokeCore(changed);accepted(canonical);
  const emitted=await invokeCore(canonical.stdout,'--emit-bytecode');accepted(emitted);
  assert.equal(readPacket(emitted.stdout).functions.length,3);
});
