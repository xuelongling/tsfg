// SPDX-License-Identifier: MIT
// Checked Source facts and source-only expected data; no IR/VM execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts,writeTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,verifyHir,printHir,readHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {sha256,canonical} from '../../compiler/identity.mjs';
import {staticPublication} from './typed-array-publication-fixtures.mjs';
const expected=JSON.parse(await readFile(new URL('./testdata/typed-array-dense-length/source-expected.json',import.meta.url),'utf8'));
// Packet hashes bind actual public producer bytes, independently of the semantic
// oracle frozen before these packets or any current producer plan was read.
const packetHashes={positive:'77b656fc4fd783abda77d17baeec95e80bb24819a668ed94c7a4eafd53dd4da2',
  negative:'12627e3117cb511baa395ec817b34da14407ffd67b3840087179be697263c7ed'};
async function actual(kind){
  const row=expected[kind],bytes=await readFile(new URL('./testdata/typed-array-dense-length/'+row.sourceSHA+'-package.json',import.meta.url));
  assert.equal(sha256(bytes).slice(7),packetHashes[kind]);const snapshot=readTypedArrayFacts(bytes);
  assert.deepEqual(writeTypedArrayFacts(snapshot),bytes,'owned checked packet roundtrip');
  const source=snapshot.payload.files.find(file=>file.path===snapshot.payload.rootFile);
  assert.equal(source.content,row.sourceText);assert.equal(sha256(source.content).slice(7),row.sourceSHA);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:snapshot.packageId};
  return {snapshot,context,publication:staticPublication(snapshot)};
}
function operations(body){
  return body.split('\n').flatMap((line,index)=>{
    const op=/^\s*(?:(%\w+) = )?"([\w.]+)"\(([^)]*)\) \{(.*)\} :/.exec(line);
    return op?[{result:op[1],name:op[2],inputs:op[3]?op[3].split(', '):[],attrs:op[4],index}]:[];
  });
}
function owner(name,definitions){
  const seen=new Set();while(true){
    assert.ok(!seen.has(name),'finite alias walk');seen.add(name);const op=definitions.get(name);
    if(!op||!['tsfg_core.domain.view','tsfg_core.domain.refine','tsfg_core.domain.copy'].includes(op.name))return name;
    assert.equal(op.inputs.length,1);name=op.inputs[0];
  }
}
test('actual same/alias/afterShrink preserve successful no-change resize and original owner',async()=>{
  const {snapshot,context,publication}=await actual('positive'),built=buildHir(snapshot,context,publication);
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));const hir=built.hir;
  assert.deepEqual(verifyHir(hir,context,publication),hir);
  assert.deepEqual(readHir(Buffer.from(printHir(hir,context,publication)),context,publication),hir);
  const core=lowerFormalHir(hir,context,publication);assert.equal(hir.format.contractVersion,'0.16.0');
  for(const row of expected.positive.cases){
    const fn=hir.functions.find(fn=>fn.name===row.name),state=hir.readSpanPlan.functions.find(state=>state.functionId===fn.id);
    assert.equal(state.views.length,1,row.name);const view=state.views[0];
    const events=state.events.filter(event=>event.kind==='array-resize-effect');
    assert.deepEqual(events.map(event=>event.exactLength),row.previous,row.name+' preceding successful lengths');
    assert.deepEqual(events.map(event=>event.newLength),row.requested,row.name+' actual resize RHS');
    assert.deepEqual(events.map(event=>event.nonStructural),row.nonStructural,row.name+' no-change classification');
    const body=core.split('  func.func @"f'+fn.id.slice(7)+'"')[1].split('\n  }')[0],ops=operations(body);
    const definitions=new Map(ops.filter(op=>op.result).map(op=>[op.result,op]));
    const creates=ops.filter(op=>op.name==='tsfg_core.domain.array_create'),spans=ops.filter(op=>op.name==='tsfg_core.domain.read_span'),
      resizes=ops.filter(op=>op.name==='tsfg_core.domain.array_resize'),reads=ops.filter(op=>op.name==='tsfg_core.domain.array_read');
    assert.equal(creates.length,1,row.name+' no fresh replacement');assert.equal(spans.length,1);
    assert.equal(resizes.length,row.requested.length,row.name+' dynamic resize operations remain');assert.equal(reads.length,1);
    assert.equal(owner(spans[0].inputs[0],definitions),creates[0].result,row.name+' view has original Array');
    assert.equal(owner(reads[0].inputs[0],definitions),spans[0].result,row.name+' checked read uses original view');
    for(let i=0;i<events.length;++i){
      const event=events[i],op=resizes[i];
      assert.equal(canonical(event.owner),canonical(view.owner),row.name+' alias owner stays identical');
      assert.equal(event.sequence>view.origin.createEvent&&event.sequence<view.lastUseEvent,row.active[i],row.name+' actual active interval');
      assert.equal(expected.positive.sourceText.slice(event.range.start,event.range.end),row.resizeText[i]);
      assert.equal(owner(op.inputs[0],definitions),creates[0].result,row.name+' resize uses same Array');
      const rhs=definitions.get(owner(op.inputs[1],definitions));assert.equal(rhs.name,'tsfg_core.constant');
      const number=/\bvalue = "(\d+)"/.exec(rhs.attrs)??/\bvalue = (\d+) :/.exec(rhs.attrs);
      assert.ok(number,row.name+' real numeric RHS SSA');assert.equal(Number(number[1]),row.requested[i]);
      const start=/tsfg_source.start = (\d+) : i64/.exec(op.attrs),end=/tsfg_source.end = (\d+) : i64/.exec(op.attrs);
      assert.ok(start&&end);assert.equal(Number(start[1]),event.range.start);assert.equal(Number(end[1]),event.range.end);
      assert.equal(op.index>spans[0].index&&op.index<reads[0].index,row.active[i],row.name+' real operation order');
    }
  }
});
test('actual active-view shrink remains a direct structural conflict',async()=>{
  const {snapshot,context,publication}=await actual('negative'),built=buildHir(snapshot,context,publication);
  assert.equal(built.status,'error');assert.equal(built.hir,undefined);
  const diagnostic=built.diagnostics[0],row=expected.negative;
  assert.equal(diagnostic.code,row.diagnostic);assert.equal(diagnostic.conflict.sourceKind,row.sourceKind);
  assert.equal(row.sourceText.slice(diagnostic.primary.start,diagnostic.primary.end),row.primary);
  assert.ok(diagnostic.related.some(item=>item.kind==='borrow-last-use'&&row.sourceText.slice(item.start,item.end)===row.lastUse));
});
