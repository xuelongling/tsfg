// SPDX-License-Identifier: MIT
// Complete independent Source15 and alternate-custody Core oracles; no Product output fills expectations.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';
import { buildHir, verifyHir, printHir, readHir, lowerHir } from '../../compiler/hir.mjs';
import { hash, copy, canonical, exactKeys, frozenJSON, independent } from './first-exception-core-source-oracle.mjs';
import { control, originalIdentities, printLiteralGraph } from './region-exception-core-oracle.mjs';
const schema='sha256:62e69eda2f22f85d55d132bff04f0b60229db69031ca51113c746d6e9424b359';
const oraclePin='sha256:cde1a548f871a237c1d036d677c4535a715fd1106c011e7bd726f38c5370102f';

/** @param {any} c @param {any} graph @param {any} expected */
function completeGraphRelations(c,graph,expected) {
  assert.equal(graph.schemaHash,schema);
  const m=graph.module.attributes['tsfg_core.exception'],fn=graph.module.functions[0];
  const text=canonical(expected)+'\n',semantic=copy(expected);delete semantic.snapshot;
  assert.equal(m.hir_jcs,text);assert.equal(m.hir_hash,hash(text));assert.equal(m.semantic_hir_hash,hash(canonical(semantic)));
  assert.equal(m.schema,schema);assert.equal(m.hir_schema,expected.format.schemaHash);
  for(const row of graph.identityPreimages)assert.equal(hash(row.domain+'\0'+schema+'\0'+canonical(row.record)),row.id,row.name);
  assert.deepEqual({frames:m.frames.length,blocks:m.blocks.length,values:m.values.length,bindings:m.bindings.length,
    edges:m.edges.length,operations:fn.blocks.flatMap(block=>block.operations).length},c.counts);
  assert.equal(m.payload_types.length,1);assert.deepEqual(m.payload_types[0].members,[expected.functions[0].body.bindings[0].type]);
  assert.equal(m.values[0].definition,'parameter');assert.equal(m.values[0].range.start,expected.functions[0].body.bindings[0].range.start);
  assert.equal(m.blocks.at(-1).role,'escape');assert.equal(m.blocks.at(-1).scope,expected.functions[0].body.scope);
  assert.deepEqual(m.blocks.at(-1).frames,[]);assert.deepEqual(m.blocks.at(-1).range,expected.functions[0].range);
  assert.deepEqual(m.values.at(-1).range,expected.functions[0].range);assert.equal(fn.blocks.at(-1).operations.at(-1).opcode,'tsfg_exception.propagate');
  assert.equal(fn.blocks[0].operations[0].opcode,'tsfg_core.fuel');assert.equal(fn.blocks[0].operations[0].attributes.event,1);
  if(c.name==='standaloneBlock') {
    assert.deepEqual(m.frames,[]);assert.deepEqual(m.blocks[1].frames,[]);assert.deepEqual(m.blocks[1].pending,[]);
    assert.deepEqual(m.edges.map(edge=>edge.kind),['enter','escape']);
    assert.deepEqual(m.blocks[2].pending,[{scope:expected.functions[0].body.body[0].region.scope,statement:0}]);
  }
  if(c.name==='tryFinallyWithoutCatch') {
    const final=expected.functions[0].body.body[0].finallyRegion;
    assert.equal(m.frames[0].catch_scope,'');assert.equal(m.frames[0].catch_binding,'');assert.equal(m.frames[0].finally_scope,final.scope);
    assert.equal(m.blocks[2].scope,final.scope);assert.equal(final.body.length,0);assert.equal(fn.blocks[2].operations.length,1);
    assert.equal(fn.blocks[2].operations[0].opcode,'cf.br');assert.deepEqual(m.edges.map(edge=>edge.kind),['enter','finally','escape']);
    assert.deepEqual(m.blocks[2].pending,m.blocks[3].pending);assert.equal(m.blocks[2].parameters.length,1);
  }
  if(c.name==='catchWithoutBinding') {
    assert.equal(m.frames[0].catch_binding,'');assert.equal(m.frames[0].finally_scope,'');assert.equal(m.bindings.length,1);
    assert.equal(m.blocks[2].parameters[0],m.values[2].id);assert.deepEqual(m.blocks[2].pending,[]);
    const packs=fn.blocks.flatMap(block=>block.operations).filter(op=>op.opcode==='tsfg_exception.pack');
    assert.equal(packs.length,2);assert.equal(packs[0].operands[0].id,m.values[0].id);assert.equal(packs[1].operands[0].id,m.values[0].id);
    assert.equal(packs[1].results[0].id,m.values[3].id);assert.notEqual(packs[1].results[0].id,m.values[2].id);
    assert.deepEqual(m.edges[2].arguments,[m.values[3].id]);assert.deepEqual(m.edges.map(edge=>edge.kind),['enter','catch','escape']);
  }
}

test('complete independent ordinary regions and corpus30 exception Core lowering',async t=>{
  const rawOracle=await readFile(new URL('region-exception-core.source-oracles.json',import.meta.url));
  assert.equal(hash(rawOracle),oraclePin);const data=JSON.parse(rawOracle.toString('utf8'));assert.equal(data.contract,schema);
  for(const c of [...data.cases,data.corpus30])await t.test(c.name,async t=>{
    /** @type {any} */ let snapshot,expected,hir,graph;
    /** @type {Buffer[]} */ let buffers;
    let core='',literal='',ready=false,lowered=false;
    await t.test('completeActualPacketTenFieldColdAndManualHirControl',async()=>{
      const fixture=new URL(c.fixtureRelative,import.meta.url),names=['request.json','response.json','origin.json'];
      buffers=await Promise.all(names.map(name=>readFile(new URL(name,fixture))));
      assert.deepEqual(buffers.map(hash),[c.pins.request,c.pins.response,c.pins.origin]);
      const manual=control(c);expected=manual.hir;originalIdentities(c,expected);
      assert.deepEqual(buffers[0],Buffer.from(manual.requestText));assert.deepEqual(buffers[1],Buffer.from(manual.responseText));
      assert.deepEqual(buffers[2],Buffer.from(canonical(c.origin)));assert.equal(c.origin.requestSha256,hash(buffers[0]));
      assert.equal(c.origin.responseSha256,hash(buffers[1]));assert.equal(hash(canonical(manual.snapshot)),c.pins.cold);
      if(c.name!=='corpus30') {
        assert.equal(Buffer.byteLength(c.source.literal),c.source.bytes);assert.equal(c.source.literal.length,c.source.length);
        assert.equal(hash(c.source.literal),c.source.hash);assert.equal(c.input.files[0].content,c.source.literal);
      }
      const passedRequest=Uint8Array.from(buffers[0]),passedResponse=Uint8Array.from(buffers[1]),origin=copy(c.origin);
      const imported=await importCapturedFrontendResponse(passedRequest,passedResponse,origin);
      assert.equal(imported.status,'ok',canonical(imported));snapshot=imported.snapshot;assert.deepEqual(snapshot,manual.snapshot);
      exactKeys(snapshot,['format','snapshotId','sourceOrigin','inputIdentity','identityInput','sources','target','facts','exports','capture']);
      frozenJSON(snapshot);independent(snapshot,origin);
      assert.deepEqual(validateFrontendSnapshot(copy(snapshot)),{snapshotId:manual.snapshot.snapshotId,functions:1,calls:0});
      const caller=copy(snapshot),before=canonical(caller),built=buildHir(caller);
      assert.equal(built.status,'ok',canonical(built));exactKeys(built,['status','hir']);hir=built.hir;
      assert.deepEqual(hir,expected,'complete frozen pre-Product manual HIR plus actual Source-only custody');
      exactKeys(hir,['format','snapshot','inputIdentity','sources','target','types','functions','modules','exports']);
      assert.equal(canonical(caller),before);frozenJSON(hir);independent(hir,caller);
      const text=canonical(expected)+'\n';assert.equal(hash(text),c.pins.hir);assert.equal(printHir(hir),text);
      const cold=copy(hir),coldBefore=canonical(cold),verified=verifyHir(cold);
      assert.deepEqual(verified,expected);assert.equal(canonical(cold),coldBefore);frozenJSON(verified);independent(verified,cold);
      const read=readHir(Uint8Array.from(Buffer.from(text)));assert.deepEqual(read,expected);assert.equal(printHir(read),text);
      const [coreBytes,graphBytes]=await Promise.all([c.coreFile,c.graphFile].map(name=>readFile(new URL(name,import.meta.url))));
      assert.equal(hash(coreBytes),c.pins.core);assert.equal(hash(graphBytes),c.pins.graph);
      literal=coreBytes.toString('utf8');graph=JSON.parse(graphBytes.toString('utf8'));
      assert.equal(printLiteralGraph(graph),literal);completeGraphRelations(c,graph,expected);
      if(c.name==='corpus30') {
        const [firstGraphBytes,firstText]=await Promise.all(['first-exception-core.typed-cfg.json','first-exception-core.expected.mlir']
          .map(name=>readFile(new URL(name,import.meta.url))));
        const first=JSON.parse(firstGraphBytes.toString('utf8')),firstMeta=first.module.attributes['tsfg_core.exception'];
        const changed=copy(graph),meta=changed.module.attributes['tsfg_core.exception'];
        assert.notEqual(meta.hir_hash,firstMeta.hir_hash);assert.notEqual(meta.hir_jcs,firstMeta.hir_jcs);
        assert.equal(meta.program_id,firstMeta.program_id);assert.notEqual(literal,firstText.toString('utf8'));
        meta.hir_hash=firstMeta.hir_hash;meta.hir_jcs=firstMeta.hir_jcs;assert.deepEqual(changed,first,'only full provenance differs');
      }
      assert.deepEqual(Buffer.from(passedRequest),buffers[0]);assert.deepEqual(Buffer.from(passedResponse),buffers[1]);assert.deepEqual(origin,c.origin);
      passedRequest.fill(0);passedResponse.fill(0);origin.producerDirty=!origin.producerDirty;
      assert.deepEqual(snapshot,manual.snapshot);assert.deepEqual(hir,expected);ready=true;
    });
    if(!ready)return;
    await t.test('publicLowerHirMatchesWholeLiteralCoreAndTypedGraph',()=>{
      try{core=lowerHir(hir);}catch(error){t.diagnostic(JSON.stringify({name:error.name,code:error.code,ruleId:error.ruleId,phase:error.phase}));throw error;}
      assert.equal(core,literal,'every block, current carrier, alias event, edge, source anchor and complete metadata');
      assert.equal(hash(core),c.pins.core);lowered=true;
    });
    if(!lowered)return;
    await t.test('coldDeterminismCallerInvarianceAndVerificationPrecedence',()=>{
      const caller=copy(hir),before=canonical(caller),verified=verifyHir(caller);
      assert.equal(lowerHir(caller),literal);assert.equal(canonical(caller),before);
      const text=printHir(caller),wire=Uint8Array.from(Buffer.from(text)),read=readHir(wire);
      assert.equal(lowerHir(read),literal);assert.equal(lowerHir(verified),literal);assert.equal(lowerHir(hir),core);
      wire.fill(0);caller.functions[0].body.bindings[0].name='changed caller';assert.deepEqual(read,expected);assert.deepEqual(verified,expected);
      assert.deepEqual(hir,expected);assert.equal(lowerHir(read),literal);assert.equal(printLiteralGraph(graph),literal);
      const invalid=copy(hir);invalid.functions[0].body.parentScope=invalid.functions[0].declaringScope;
      assert.throws(()=>lowerHir(invalid),{name:'TypeError',code:/^r03-exception-hir-/,ruleId:'r01-input-boundary',phase:'hir'});
      assert.deepEqual(buffers.map(hash),[c.pins.request,c.pins.response,c.pins.origin]);assert.equal(lowerHir(hir),literal);
    });
  });
  t.diagnostic('Node-only complete Source15 three/corpus30 text+typed CFG; native consumer/wire/Runtime remain OPEN');
});
