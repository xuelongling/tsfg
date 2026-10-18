// SPDX-License-Identifier: MIT
// Independent complete first172B Core text/typed-CFG oracle at the public lowering seam.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';
import { buildHir, verifyHir, printHir, readHir, lowerHir } from '../../compiler/hir.mjs';
import { source, declarations, sourceDigest, declarationDigest, hirSchemaHash, ids, identityPreimages,
  expectedTransport, expectedHir, hash, copy, canonical, exactKeys, independent, frozenJSON } from './first-exception-core-source-oracle.mjs';

const fixture = new URL('../fixtures/r03/m21-exception/first/', import.meta.url);
const coreSchema = 'sha256:62e69eda2f22f85d55d132bff04f0b60229db69031ca51113c746d6e9424b359';
const pins = {
  'request.json':'sha256:8b081a06e3853bf8557206f3aafac4f8211622a224899a363c7c63bb34a030ed',
  'response.json':'sha256:45317ccc970c8464d90cba8da674aea3da5756fbb39a7ba5dfc3326fad2d1a5a',
  'origin.json':'sha256:58842dfb6862b162c2cd82a6e79298905ebd3eec5d6e30618797d5e91b67f612',
  'source.ts':'sha256:4c5cfdea7fa418d1b0eaeda99b01cb1e749266ecd8ecb9c0154df4cb7219c8c2',
  'first-exception-core.expected.mlir':'sha256:f5ab6e689e281bda32db5232b2e7671d2a5c9c0bd7c819d83dffc7662d04185a',
  'first-exception-core.typed-cfg.json':'sha256:fe825ec752d3358a893bce3f26a4cdd8a4e54a0bfd5468ad9e86887392df2fa8',
};

// Oracle-only printer for the frozen literal graph; never parses or validates Product MLIR.
// UTF8 bytes, rather than JavaScript code units, determine the adopted private string syntax.
function quoted(value) {
  return '"' + Array.from(Buffer.from(value,'utf8'), byte => byte >= 32 && byte <= 126 && byte !== 34 && byte !== 92
    ? String.fromCharCode(byte) : '\\' + byte.toString(16).toUpperCase().padStart(2,'0')).join('') + '"';
}
/** @param {any} value @param {string} [key] @returns {string} */
function attribute(value, key = '') {
  if (typeof value === 'string') return quoted(value);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return value + ' : ' + (['version','event'].includes(key) ? 'i32' : 'i64');
  if (Array.isArray(value)) return '[' + value.map(child => attribute(child)).join(', ') + ']';
  assert.ok(value && Object.getPrototypeOf(value) === Object.prototype);
  return '{' + Object.entries(value).map(([name, child]) => name + ' = ' + attribute(child,name)).join(', ') + '}';
}
/** @param {any} cfg @returns {string} */
function printLiteralGraph(cfg) {
  const fn = cfg.module.functions[0], blocks = fn.blocks;
  const typed = values => values.map(value => value.name + ': ' + value.type).join(', ');
  const lines = ['module attributes ' + attribute(cfg.module.attributes) + ' {',
    '  func.func @' + quoted(fn.symbol) + '(' + typed(blocks[0].arguments) + ') -> ' + fn.resultType
      + ' attributes ' + attribute(fn.attributes) + ' {'];
  for (const block of blocks) {
    if (block.label !== null) lines.push('  ' + block.label + (block.arguments.length ? '(' + typed(block.arguments) + ')' : '') + ':');
    for (const op of block.operations) {
      if (op.opcode === 'cf.br') {
        assert.equal(op.successors.length,1);
        const successor = blocks.find(candidate => candidate.id === op.successors[0].block);
        assert.ok(successor && successor.label !== null);
        const args = op.operands.map(value => value.name + ' : ' + value.type).join(', ');
        lines.push('    cf.br ' + successor.label + (args ? '(' + args + ')' : '') + ' ' + attribute(op.attributes));
      } else {
        const result = op.results.length ? op.results.map(value => value.name).join(', ') + ' = ' : '';
        const outputType = op.results.length ? op.results[0].type : '()';
        lines.push('    ' + result + quoted(op.opcode) + '(' + op.operands.map(value => value.name).join(', ') + ') '
          + attribute(op.attributes) + ' : (' + op.operands.map(value => value.type).join(', ') + ') -> ' + outputType);
      }
    }
  }
  return lines.concat(['  }','}','']).join('\n');
}

test('first172B public lowerHir emits complete independently specified exception Core CFG', async t => {
  /** @type {any} */ let snapshot, manual, hir, cfg;
  let expectedText = '', core = '', controlsPassed = false, lowerPassed = false;
  /** @type {Buffer[]} */ let originalBytes;
  await t.test('actualPacketFullColdAndFullManualHirControl', async () => {
    const names = ['request.json','response.json','origin.json','source.ts'];
    originalBytes = await Promise.all(names.map(name => readFile(new URL(name,fixture))));
    names.forEach((name,index) => assert.equal(hash(originalBytes[index]),pins[name]));
    const [requestBytes,responseBytes,originBytes,sourceBytes] = originalBytes;
    const origin = JSON.parse(originBytes.toString('utf8')), originBefore = canonical(origin);
    exactKeys(origin,['kind','producerBaseOid','producerDirty','requestSha256','responseSha256','testedInputSetHash']);
    assert.deepEqual(sourceBytes,Buffer.from(source)); assert.equal(Buffer.byteLength(source),172); assert.equal(source.length,170);
    assert.equal(hash(source),sourceDigest); assert.equal(hash(declarations),declarationDigest); assert.equal(Buffer.byteLength(declarations),1214);
    const transport = expectedTransport(origin); manual = expectedHir(origin);
    assert.deepEqual(requestBytes,Buffer.from(transport.requestText)); assert.deepEqual(responseBytes,Buffer.from(transport.responseText));
    assert.equal(origin.requestSha256,hash(requestBytes)); assert.equal(origin.responseSha256,hash(responseBytes));
    for (const row of identityPreimages) assert.equal(hash(row.scalar === undefined
      ? row.domain+'\0'+hirSchemaHash+'\0'+canonical(row.record) : row.domain+'\0'+row.scalar),row.id);
    const callerRequest = Uint8Array.from(requestBytes), callerResponse = Uint8Array.from(responseBytes);
    const imported = await importCapturedFrontendResponse(callerRequest,callerResponse,origin);
    assert.equal(imported.status,'ok',canonical(imported)); snapshot = imported.snapshot;
    assert.deepEqual(snapshot,transport.snapshot); frozenJSON(imported); independent(imported,origin);
    exactKeys(snapshot,['format','snapshotId','sourceOrigin','inputIdentity','identityInput','sources','target','facts','exports','capture']);
    assert.deepEqual(validateFrontendSnapshot(copy(snapshot)),{snapshotId:transport.snapshot.snapshotId,functions:1,calls:0});
    const snapshotBefore = canonical(snapshot), built = buildHir(snapshot);
    assert.equal(built.status,'ok',canonical(built)); exactKeys(built,['status','hir']); hir = built.hir;
    assert.deepEqual(hir,manual); exactKeys(hir,['format','snapshot','inputIdentity','sources','target','types','functions','modules','exports']);
    frozenJSON(hir); independent(hir,snapshot); assert.equal(canonical(snapshot),snapshotBefore);
    const printed = canonical(manual)+'\n'; assert.equal(printHir(hir),printed);
    const cold = copy(hir), coldBefore = canonical(cold), verified = verifyHir(cold);
    assert.deepEqual(verified,manual); frozenJSON(verified); independent(verified,cold); assert.equal(canonical(cold),coldBefore);
    const read = readHir(Uint8Array.from(Buffer.from(printed))); assert.deepEqual(read,manual); assert.equal(printHir(read),printed);
    const [rawText,rawCfg] = await Promise.all(['first-exception-core.expected.mlir','first-exception-core.typed-cfg.json']
      .map(name => readFile(new URL(name,import.meta.url))));
    assert.equal(hash(rawText),pins['first-exception-core.expected.mlir']); assert.equal(hash(rawCfg),pins['first-exception-core.typed-cfg.json']);
    expectedText = rawText.toString('utf8'); cfg = JSON.parse(rawCfg.toString('utf8'));
    assert.equal(cfg.schemaHash,coreSchema); assert.equal(printLiteralGraph(cfg),expectedText);
    const metadata = cfg.module.attributes['tsfg_core.exception'];
    assert.equal(metadata.hir_jcs,printed); assert.equal(metadata.hir_hash,hash(printed));
    const semantic = copy(manual); delete semantic.snapshot;
    assert.equal(metadata.semantic_hir_hash,hash(canonical(semantic)));
    assert.equal(metadata.program_id,'sha256:ff0cbbfc31dc2ced5a9ef7eaa5f1e69317d5cb1ad4037cfcfbe3afad30f51560'); assert.equal(metadata.hir_schema,hirSchemaHash);
    assert.equal(cfg.identityPreimages.length,17);
    for (const row of cfg.identityPreimages) assert.equal(hash(row.domain+'\0'+coreSchema+'\0'+canonical(row.record)),row.id,row.name);
    assert.deepEqual([metadata.frames.length,metadata.blocks.length,metadata.values.length,metadata.bindings.length,metadata.edges.length],[1,5,5,3,4]);
    assert.deepEqual(metadata.blocks.map(block => block.pending),[[],[],[],[{scope:ids.catchScope,statement:0}],[{scope:ids.catchScope,statement:0}]]);
    assert.deepEqual(metadata.blocks[4].frames,[]); assert.equal(metadata.blocks[4].scope,ids.rootScope);
    assert.equal(metadata.bindings[2].value,metadata.bindings[0].value); assert.equal(metadata.bindings[2].from_binding,ids.parameter);
    assert.equal(metadata.bindings[1].type,ids.unknown); assert.equal(metadata.bindings[1].value,metadata.values[2].id);
    assert.equal(cfg.module.functions[0].blocks.flatMap(block => block.operations).length,7);
    assert.equal(expectedText.endsWith('\n'),true); assert.equal(expectedText.endsWith('\n\n'),false); assert.ok(!expectedText.includes('\r'));
    assert.match(expectedText,/\\F0\\9F\\98\\80/); assert.match(expectedText,/\\22/); assert.match(expectedText,/\\5C/);
    assert.deepEqual(Buffer.from(callerRequest),requestBytes); assert.deepEqual(Buffer.from(callerResponse),responseBytes);
    assert.equal(canonical(origin),originBefore); callerRequest.fill(0); callerResponse.fill(0); origin.producerDirty = !origin.producerDirty;
    assert.deepEqual(hir,manual); assert.deepEqual(snapshot,transport.snapshot); controlsPassed = true;
  });
  if (!controlsPassed) return;
  await t.test('existingPublicLowerHirCompleteLiteralCoreAndTypedCfg', () => {
    // BASE verifies this exact HIR and throws its real typed lowering capability; no future imports.
    try { core = lowerHir(hir); }
    catch (error) { t.diagnostic(JSON.stringify({name:error.name,code:error.code,ruleId:error.ruleId,phase:error.phase})); throw error; }
    assert.equal(typeof core,'string'); assert.equal(core,expectedText,'entire literal MLIR, embedded HIR, metadata, typed SSA and all four transfers');
    assert.equal(hash(core),pins['first-exception-core.expected.mlir']); lowerPassed = true;
  });
  if (!lowerPassed) return;
  await t.test('coldRoundTripDeterminismAndCallerInvariance', () => {
    const caller = copy(hir), before = canonical(caller), verified = verifyHir(caller);
    assert.equal(lowerHir(caller),expectedText); assert.equal(canonical(caller),before);
    const bytes = Uint8Array.from(Buffer.from(printHir(caller))), read = readHir(bytes);
    assert.equal(lowerHir(read),expectedText); assert.equal(lowerHir(verified),expectedText); assert.equal(lowerHir(hir),core);
    bytes.fill(0); caller.functions[0].body.body[0].catchClause.region.bindings[0].name = 'changed caller';
    assert.deepEqual(verified,manual); assert.deepEqual(read,manual); assert.deepEqual(hir,manual);
    assert.equal(lowerHir(read),expectedText); assert.equal(printLiteralGraph(cfg),expectedText);
    assert.equal(hash(originalBytes[0]),pins['request.json']); assert.equal(hash(originalBytes[1]),pins['response.json']);
  });
  await t.test('completeHirVerificationPrecedesLoweringSelection', () => {
    const invalid = copy(hir); invalid.functions[0].body.body[0].catchClause.region.bindings[0].type = ids.i32;
    assert.throws(() => lowerHir(invalid),{name:'TypeError',code:/^r03-exception-hir-/,ruleId:'r01-input-boundary',phase:'hir'});
    assert.deepEqual(hir,manual); assert.equal(lowerHir(hir),expectedText);
  });
  t.diagnostic('Node first172B only: full literal text/typed CFG; native consumer, canonical1/2, wire and execution remain OPEN');
});
