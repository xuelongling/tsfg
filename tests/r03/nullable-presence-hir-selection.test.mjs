// SPDX-License-Identifier: MIT
// Only the named pure object seams consume these four frozen actual captures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildNullableHir, verifyNullableHir } from '../../compiler/nullable-hir.mjs';
import { importNullableCapturedResponse } from '../../compiler/nullable-frontend.mjs';
/** @param {any} value @returns {string} */
function jcs(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + jcs(value[key])).join(',') + '}';
}
const sha = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const fresh = value => JSON.parse(jcs(value));
const raw = readFileSync(new URL('./nullable-presence-hir-first.json', import.meta.url));
assert.equal(sha(raw), 'sha256:4b70ae12a6e499e2b08007a84bfb1c09f161053fad71ac8ddd61d6e5bdf28bd3');
const { cases, typePreimages, coreSchemaHash:core } = JSON.parse(raw.toString('utf8'));
const context = row => fresh(row.context), snapshot = row => fresh(row.expectedSnapshot), hir = row => fresh(row.expectedHir);
const primary = (row, range) => ({ sourceId:row.expectedSnapshot.source.path, start:range.start, end:range.end });
/** @typedef {TypeError & {code:string,ruleId:string,phase:string,primary?:{sourceId:string,start:number,end:number}}} BoundaryError */
/** @param {unknown} caught */
function typedError(caught) { assert.ok(caught instanceof TypeError); return /** @type {BoundaryError} */ (caught); }
function rejects(action, category, anchor = undefined) {
  assert.throws(action, caught => {
    const error = typedError(caught);
    assert.equal(error.code, 'r03-nullable-' + category);
    assert.equal(error.message, error.code + ': invalid private nullable presence HIR');
    assert.equal(error.ruleId, 'r01-input-boundary'); assert.equal(error.phase, 'hir');
    if (anchor === undefined) assert.ok(!Object.hasOwn(error, 'primary'));
    else { assert.deepStrictEqual(error.primary, anchor); assert.ok(Object.isFrozen(error.primary)); }
    return true;
  });
}

test('nullable presence HIR keeps all four declared masks ordered guards and complete scalar calls', () => {
  for (const row of cases) {
    const actual = buildNullableHir(snapshot(row), context(row));
    assert.deepStrictEqual(actual, row.expectedHir);
    const fn = actual.functions[0], expected = row.expectedHir.functions[0];
    const guardCount = row.literalSourcePlan.guards.length;
    assert.equal(fn.body.length, guardCount + 1);
    for (let i = 0; i < guardCount; i++) {
      const guard = fn.body[i], plan = row.literalSourcePlan.guards[i];
      assert.equal(guard.kind, 'if'); assert.equal(guard.condition.kind, 'nullableTagTest');
      assert.equal(guard.condition.tag, plan.tag);
      assert.equal(guard.condition.type, typePreimages[1].record.id);
      assert.equal(guard.condition.operand.type, expected.parameters[0].type);
      assert.equal(guard.condition.operand.binding, expected.parameters[0].id);
      assert.equal(guard.thenBody.length, 1); assert.equal(guard.thenBody[0].kind, 'block');
      assert.equal(guard.thenBody[0].body.length, 1); assert.deepStrictEqual(guard.elseBody, []);
      assert.equal(guard.thenBody[0].body[0].value.binding, expected.parameters[1].id);
    }
    const get = fn.body.at(-1).value;
    assert.equal(get.kind, 'nullableGet'); assert.equal(get.type, typePreimages[0].record.id);
    assert.equal(get.operand.type, expected.parameters[0].type);
    assert.equal(get.operand.binding, expected.parameters[0].id);
    assert.ok(!Object.hasOwn(get, 'proof') && !Object.hasOwn(get, 'flow'));
    const call = actual.functions[1].body[0].value;
    assert.equal(call.target, fn.id); assert.equal(call.signatureHash, fn.signatureHash);
    assert.equal(call.arguments.length, 2); assert.equal(call.arguments[0].kind, 'nullableWrap');
    assert.equal(call.arguments[0].type, expected.parameters[0].type);
    assert.deepStrictEqual(verifyNullableHir(JSON.parse(jcs(actual)), context(row)), row.expectedHir);
  }
});

test('nullable presence HIR exact context selection rejects malformed and cross capture selectors', () => {
  for (const row of cases) {
    /** @type {[any,string][]} */
    const vectors = [[null,'schema'], [false,'schema'], [4,'schema'], [[], 'schema'], [{},'schema'],
      [{ ...context(row), sourceVersion:3 },'context'],
      [{ ...context(row), sourceSchemaHash:'sha256:' + '0'.repeat(64) },'context'],
      [{ ...context(row), extra:true },'schema']];
    for (const key of Object.keys(row.context)) { const value = context(row); delete value[key]; vectors.push([value,'schema']); }
    for (const [value, category] of vectors) {
      rejects(() => buildNullableHir(snapshot(row), fresh(value)), category);
      rejects(() => verifyNullableHir(hir(row), fresh(value)), category);
    }
    const origin = context(row); origin.expectedOrigin.producerDirty = false;
    rejects(() => buildNullableHir(snapshot(row), origin), 'identity');
    rejects(() => verifyNullableHir(hir(row), origin), 'identity');
    const packageId = context(row); packageId.expectedPackageId = 'sha256:' + '0'.repeat(64);
    rejects(() => buildNullableHir(snapshot(row), packageId), 'identity');
    rejects(() => verifyNullableHir(hir(row), packageId), 'identity');
    for (const other of cases) if (other !== row) {
      rejects(() => buildNullableHir(snapshot(row), context(other)), 'identity');
      rejects(() => verifyNullableHir(hir(row), context(other)), 'identity');
    }
  }
});

test('nullable presence HIR exact root format and complete nested snapshot cannot be substituted', () => {
  const row = cases[2];
  for (const key of Object.keys(row.expectedHir)) {
    const value = hir(row); delete value[key]; rejects(() => verifyNullableHir(value, context(row)), 'schema');
  }
  const extra = hir(row); extra.proof = true; rejects(() => verifyNullableHir(extra, context(row)), 'schema');
  for (const [key, replacement] of [['version',3], ['schemaHash','sha256:' + '0'.repeat(64)], ['family','other']]) {
    const value = hir(row); value.format[key] = replacement;
    rejects(() => verifyNullableHir(value, context(row)), 'schema');
  }
  for (const key of ['functions','symbols','target','source']) {
    const value = hir(row);
    if (key === 'functions') value.snapshot.functions[0].body[0].condition.left.presenceFlow.null = false;
    if (key === 'symbols') value.snapshot.symbols[0].name = 'renamed';
    if (key === 'target') value.snapshot.target.pointerBits = '32';
    if (key === 'source') value.snapshot.source.content += ' ';
    rejects(() => verifyNullableHir(value, context(row)), 'snapshot');
  }
});

test('nullable presence HIR guard shape kind mask tag binding and ranges use only original owners', () => {
  for (const row of cases) for (let index = 0; index < row.literalSourcePlan.guards.length; index++) {
    const original = row.expectedHir.functions[0].body[index], condition = original.condition;
    const block = original.thenBody[0], returned = block.body[0];
    /** @type {[string,string,any,(guard:any)=>void][]} */
    const vectors = [
      ['if shape','schema',original.range, g => { g.proof = true; }],
      ['if kind','capability',original.range, g => { g.kind = 'block'; }],
      ['if range','range',original.range, g => { g.range = { start:0,end:1 }; }],
      ['condition shape','schema',condition.range, g => { delete g.condition.tag; }],
      ['condition kind','capability',condition.range, g => { g.condition.kind = 'reference'; }],
      ['condition type','type',condition.range, g => { g.condition.type = typePreimages[0].record.id; }],
      ['condition range','range',condition.range, g => { g.condition.range = { start:0,end:1 }; }],
      ['numeric tag','flow',condition.tagRange, g => { g.condition.tag = 3; }],
      ['tag spelling','flow',condition.tagRange, g => { g.condition.tag = 'null'; }],
      ['tag range','range',condition.tagRange, g => { g.condition.tagRange = { start:0,end:1 }; }],
      ['operand mask','type',condition.operand.range, g => { g.condition.operand.type = typePreimages[0].record.id; }],
      ['operand binding','binding',condition.operand.range, g => { g.condition.operand.binding = row.expectedHir.functions[0].parameters[1].id; }],
      ['operand range','range',condition.operand.range, g => { g.condition.operand.range = { start:0,end:1 }; }],
      ['then array','capability',original.range, g => { g.thenBody = []; }],
      ['else array','capability',original.range, g => { g.elseBody = [fresh(block)]; }],
      ['block kind','capability',block.range, g => { g.thenBody[0].kind = 'return'; }],
      ['block range','range',block.range, g => { g.thenBody[0].range = { start:0,end:1 }; }],
      ['block body length','capability',block.range, g => { g.thenBody[0].body = []; }],
      ['then return kind','capability',returned.range, g => { g.thenBody[0].body[0].kind = 'local'; }],
      ['fallback binding','binding',returned.value.range, g => { g.thenBody[0].body[0].value.binding = row.expectedHir.functions[0].parameters[0].id; }],
    ];
    for (const [label, category, range, change] of vectors) {
      const value = hir(row); change(value.functions[0].body[index]);
      assert.notEqual(jcs(value), row.hirJcsNoLf, label);
      rejects(() => verifyNullableHir(value, context(row)), category, primary(row, range));
    }
  }
});

test('nullable presence HIR guarded extraction cannot retag a declaration or accept a forged proof', () => {
  for (const row of cases) {
    const fn = row.expectedHir.functions[0], tail = fn.body.at(-1), get = tail.value;
    /** @type {[string,string,any,(fn:any)=>void][]} */
    const vectors = [
      ['function name','symbol',fn.range, f => { f.name = 'renamed'; }],
      ['owned symbol','symbol',fn.range, f => { f.ownedSymbol = 's2'; }],
      ['role','symbol',fn.range, f => { f.role = 'entry'; }],
      ['parameter binding','binding',fn.parameters[0].range, f => { f.parameters[0].id = fn.parameters[1].id; }],
      ['declared mask','signature',fn.parameters[0].range, f => { f.parameters[0].type = typePreimages[0].record.id; }],
      ['return kind','capability',tail.range, f => { f.body.at(-1).kind = 'block'; }],
      ['return range','range',tail.range, f => { f.body.at(-1).range = { start:0,end:1 }; }],
      ['get shape','schema',get.range, f => { f.body.at(-1).value.proof = 'present'; }],
      ['get kind','capability',get.range, f => { f.body.at(-1).value.kind = 'reference'; }],
      ['get type','type',get.range, f => { f.body.at(-1).value.type = typePreimages[1].record.id; }],
      ['get range','range',get.range, f => { f.body.at(-1).value.range = { start:0,end:1 }; }],
      ['get operand type','type',get.operand.range, f => { f.body.at(-1).value.operand.type = typePreimages[0].record.id; }],
      ['get operand binding','binding',get.operand.range, f => { f.body.at(-1).value.operand.binding = fn.parameters[1].id; }],
    ];
    for (const [label, category, range, change] of vectors) {
      const value = hir(row); change(value.functions[0]);
      assert.notEqual(jcs(value), row.hirJcsNoLf, label);
      rejects(() => verifyNullableHir(value, context(row)), category, primary(row, range));
    }
    for (const key of ['id','signatureHash']) {
      const value = hir(row); value.functions[0][key] = 'sha256:' + '0'.repeat(64);
      rejects(() => verifyNullableHir(value, context(row)), 'identity');
    }
    const changed = hir(row); changed.functions[0].body.at(-1).value.operand.binding = fn.parameters[1].id;
    // Function identity covers its complete declaration, never a body digest.
    // Recomputing that valid declaration identity cannot authorize the bad get.
    changed.functions[0].id = sha('tsfg.core-nullable-candidate.function.v1\0' + core + '\0'
      + jcs(row.identityPreimages.functions[0].function.value));
    assert.equal(changed.functions[0].id, fn.id);
    rejects(() => verifyNullableHir(changed, context(row)), 'binding', primary(row, get.operand.range));
  }
});

test('nullable presence HIR preserves guard order and exact complete call signatures', () => {
  for (const row of cases) {
    const original = row.expectedHir.functions[1].body[0].value, wrap = original.arguments[0];
    /** @type {[string,string,any,(call:any)=>void][]} */
    const vectors = [
      ['call target','signature',original.range, c => { c.target = row.expectedHir.functions[1].id; }],
      ['call signature','signature',original.range, c => { c.signatureHash = 'sha256:' + '0'.repeat(64); }],
      ['complete arguments','signature',original.range, c => { c.arguments.pop(); }],
      ['declared result','type',original.range, c => { c.type = typePreimages[1].record.id; }],
      ['call range','range',original.range, c => { c.range = { start:0,end:1 }; }],
      ['lift mask','type',wrap.range, c => { c.arguments[0].type = typePreimages[0].record.id; }],
      ['lift kind','capability',wrap.range, c => { c.arguments[0].kind = 'nullableGet'; }],
    ];
    for (const [label, category, range, change] of vectors) {
      const value = hir(row); change(value.functions[1].body[0].value);
      assert.notEqual(jcs(value), row.hirJcsNoLf, label);
      rejects(() => verifyNullableHir(value, context(row)), category, primary(row, range));
    }
    if (row.literalSourcePlan.guards.length === 2) {
      const value = hir(row); [value.functions[0].body[0],value.functions[0].body[1]] = [value.functions[0].body[1],value.functions[0].body[0]];
      rejects(() => verifyNullableHir(value, context(row)), 'range', primary(row, row.expectedHir.functions[0].body[0].range));
    }
  }
});

test('nullable presence HIR omitted and undefined contexts retain default3 rejection', () => {
  for (const row of cases) for (const action of [
    () => buildNullableHir(snapshot(row)), () => buildNullableHir(snapshot(row), undefined),
    () => verifyNullableHir(hir(row)), () => verifyNullableHir(hir(row), undefined),
  ]) assert.throws(action, caught => {
    const error = typedError(caught);
    assert.equal(error.code, 'r03-nullable-schema'); assert.equal(error.phase, 'hir');
    assert.equal(error.ruleId, 'r01-input-boundary');
    assert.equal(error.message, 'r03-nullable-schema: owned nullable candidate differs');
    assert.ok(!Object.hasOwn(error, 'primary')); return true;
  });
});

test('nullable presence HIR fresh synthetic scalar3 control retains whole old projection', () => {
  // Independent protocol/STRUCTURAL control only, never an actual Go capture.
  const S3 = 'sha256:24a04b0b595cae59ccf52a939f4671cea0369c46bd705f56726d028ab1df5a71';
  const content = 'function keep(n:i32):i32{return n;}\nexport function entry(n:i32):i32{return keep(n);}';
  assert.equal(content.length, 85);
  const range = (start,end) => ({ start,end });
  const presence = (start,end,annotation) => ({ undefined:false, null:false, optional:false, default:false,
    range:range(start,end), annotation:range(annotation,end) });
  const p0 = { id:'s3',name:'n',kind:'parameter',type:'i32',writable:true,range:range(14,15),presence:presence(14,19,16) };
  const p1 = { id:'s4',name:'n',kind:'parameter',type:'i32',writable:true,range:range(58,59),presence:presence(58,63,60) };
  const functions = [
    { name:'keep',symbol:'s1',parameters:[fresh(p0)],parameterInitializers:[null],returnType:'i32',range:range(0,35),
      body:[{ kind:'return',range:range(25,34),expression:{ kind:'reference',type:'i32',symbol:'s3',range:range(31,33) } }] },
    { name:'entry',symbol:'s2',parameters:[fresh(p1)],parameterInitializers:[null],returnType:'i32',range:range(35,85),
      body:[{ kind:'return',range:range(69,84),expression:{ kind:'call',type:'i32',target:'s1',range:range(75,83),
        arguments:[{ kind:'reference',type:'i32',symbol:'s4',range:range(81,82) }],
        signature:{ parameters:['i32'],returnType:'i32',presence:[fresh(p0.presence)] } } }] },
  ];
  const symbols = [{ id:'s1',name:'keep',kind:'function',type:'i32',writable:false,range:range(8,13) },
    { id:'s2',name:'entry',kind:'function',type:'i32',writable:false,range:range(51,57) },fresh(p0),fresh(p1)];
  const input = fresh(cases[0].expectedSnapshot.identityInput);
  input.files.find(file => file.path === input.rootFile).content = content;
  const files = input.files.map(file => ({ path:file.path,digest:sha(file.content),byteLength:Buffer.byteLength(file.content),length:file.content.length,positionUnit:'utf16' }));
  const facts = { status:'ok',inputs:files.map(file => file.path),functions,symbols };
  const exports = [{ name:'entry',target:'s2',sourcePath:input.rootFile,range:range(35,85),definition:range(51,57) }];
  const requestText = jcs({ family:'tsfg.nullable-facts-request-candidate',version:3,schemaHash:S3,input });
  const inputIdentity = sha(jcs(input)), payload = { inputIdentity,files,facts,exports };
  const responseText = jcs({ family:'tsfg.nullable-facts-package-candidate',version:3,schemaHash:S3,
    requestId:sha('tsfg.nullable-facts.request.v3\0' + requestText),packageId:sha('tsfg.nullable-facts.package.v3\0' + S3 + '\0' + jcs(payload)),payload });
  const sourceOrigin = { kind:'owned-go-nullable-response',producerBaseOid:'0'.repeat(40),producerDirty:true,
    requestSha256:sha(requestText),responseSha256:sha(responseText),testedInputSetHash:'sha256:' + '0'.repeat(64) };
  const snapshotId = sha('tsfg.frontend-nullable-candidate.snapshot.v3\0' + S3 + '\0' + jcs({ inputIdentity,sourceOrigin }));
  const source = { path:input.rootFile,content,hash:sha(content) };
  const expectedSnapshot = { format:{ family:'tsfg.frontend-nullable-candidate',version:3,schemaHash:S3 },snapshotId,
    sourceOrigin,inputIdentity,identityInput:input,source,target:input.target,inputs:files,functions,symbols,exports,
    capture:{ request:requestText,response:responseText } };
  const actual = importNullableCapturedResponse(Buffer.from(requestText),Buffer.from(responseText),fresh(sourceOrigin));
  assert.deepStrictEqual(actual, { status:'ok',snapshot:expectedSnapshot });
  const scalar = typePreimages[0].record;
  const signatureHash = sha('tsfg.core-nullable-candidate.signature.v1\0' + core + '\0' + jcs({ parameters:[scalar.id],returnType:scalar.id }));
  const id = name => sha('tsfg.core-nullable-candidate.function.v1\0' + core + '\0' + jcs({ name,signatureHash,source:{ path:source.path,digest:source.hash } }));
  const hirFunctions = functions.map((fn,index) => ({ id:id(fn.name),name:fn.name,ownedSymbol:fn.symbol,signatureHash,
    role:index ? 'entry' : 'internal',range:fn.range,returnType:fresh(scalar),
    parameters:fn.parameters.map(p => ({ id:p.id,name:p.name,type:scalar.id,range:p.range })),
    body:[{ kind:'return',range:fn.body[0].range,value:index
      ? { kind:'call',type:scalar.id,target:id('keep'),signatureHash,range:range(75,83),arguments:[{ kind:'reference',type:scalar.id,binding:'s4',range:range(81,82) }] }
      : { kind:'reference',type:scalar.id,binding:'s3',range:range(31,33) } }] }));
  const expected = { format:{ family:'tsfg.nullable-hir-candidate',version:3,schemaHash:S3 },snapshot:expectedSnapshot,
    inputIdentity,source,target:input.target,types:[fresh(scalar)],functions:hirFunctions };
  assert.deepStrictEqual(buildNullableHir(fresh(expectedSnapshot)), expected);
  assert.deepStrictEqual(verifyNullableHir(fresh(expected)), expected);
});

test('nullable presence HIR unknown function owners do not acquire a trusted primary', () => {
  const row = cases[2];
  const missingOwner = hir(row); missingOwner.functions[0] = null;
  rejects(() => verifyNullableHir(missingOwner,context(row)), 'schema');
  const unknownOwner = hir(row);
  unknownOwner.functions[0].id = 'sha256:' + '0'.repeat(64);
  unknownOwner.functions[0].extra = true;
  // Exact shape is checked before function identity. A rejected table position
  // alone never establishes the supplied function's trusted Source ownership.
  // This does not require an unstated identity-over-shape error priority.
  rejects(() => verifyNullableHir(unknownOwner,context(row)), 'schema');
});

test('nullable presence HIR validates all function identities before local bodies', () => {
  for (const row of cases) {
    const value = hir(row);
    value.functions[0].body[0].condition.tag = 3;
    value.functions[1].id = 'sha256:' + '0'.repeat(64);
    // H6 gives global function-table identities an explicit stage before any
    // source-ordered local body comparison; this adds no within-node priority.
    rejects(() => verifyNullableHir(value,context(row)), 'identity');
  }
});
