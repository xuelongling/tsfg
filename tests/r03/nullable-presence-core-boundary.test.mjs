// SPDX-License-Identifier: MIT
// The Core seam consumes whole verified private HIR; no Source/native execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { emitNullableCore } from '../../compiler/nullable-core-emitter.mjs';
/** @param {any} value @returns {string} */
function jcs(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + jcs(value[key])).join(',') + '}';
}
const sha = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const fresh = value => JSON.parse(jcs(value));
const hirRaw = readFileSync(new URL('./nullable-presence-hir-first.json', import.meta.url));
assert.equal(sha(hirRaw), 'sha256:4b70ae12a6e499e2b08007a84bfb1c09f161053fad71ac8ddd61d6e5bdf28bd3');
const { cases, typePreimages } = JSON.parse(hirRaw.toString('utf8'));
const coreRaw = readFileSync(new URL('./nullable-presence-core-first.json', import.meta.url));
assert.equal(sha(coreRaw), 'sha256:36d4c3e469536da1bca2ff44b1fdf8273077e653539163344d185114d04ceb37');
const { cases:goldens } = JSON.parse(coreRaw.toString('utf8'));
const hir = row => fresh(row.expectedHir), context = row => fresh(row.context);
const primary = (row,range) => ({ sourceId:row.expectedSnapshot.source.path,start:range.start,end:range.end });
/** @typedef {TypeError & {code:string,ruleId:string,phase:string,primary?:{sourceId:string,start:number,end:number}}} BoundaryError */
/** @param {unknown} caught */
function typedError(caught) { assert.ok(caught instanceof TypeError); return /** @type {BoundaryError} */ (caught); }
function rejects(action,category,anchor = undefined) {
  assert.throws(action,caught => {
    const error = typedError(caught); assert.equal(error.code,'r03-nullable-' + category);
    assert.equal(error.message,error.code + ': invalid private nullable presence HIR');
    assert.equal(error.ruleId,'r01-input-boundary'); assert.equal(error.phase,'hir');
    if (anchor === undefined) assert.ok(!Object.hasOwn(error,'primary'));
    else { assert.deepStrictEqual(error.primary,anchor); assert.ok(Object.isFrozen(error.primary)); }
    return true;
  });
}

test('nullable presence Core cold object repetition keeps complete text masks tags and calls', () => {
  for (let index = 0; index < cases.length; index++) {
    const row = cases[index], golden = goldens[index]; assert.equal(golden.name,row.name);
    const actual = emitNullableCore(JSON.parse(row.hirJcsNoLf),context(row));
    const repeated = emitNullableCore(JSON.parse(jcs(hir(row))),context(row));
    assert.equal(actual,golden.expectedCore); assert.equal(repeated,golden.expectedCore);
    assert.equal(Buffer.byteLength(actual),golden.expectedCoreBytes);
    assert.equal(sha(actual),golden.expectedCoreSHA256);
    assert.deepStrictEqual([...actual.matchAll(/"tsfg_nullable\.tag_test".*?tag = ([12]) : i32/g)].map(match => Number(match[1])),
      row.literalSourcePlan.guards.map(guard => guard.tag));
    assert.ok(actual.includes('!tsfg_nullable.i32<' + row.literalSourcePlan.mask + '>'));
    assert.equal((actual.match(/"tsfg_nullable\.get"/g) ?? []).length,1);
    assert.equal((actual.match(/"func.call"/g) ?? []).length,1);
    assert.equal((actual.match(/"tsfg_core\.fuel"/g) ?? []).length,2);
  }
});

test('nullable presence Core forwards exact selected context and rejects cross capture contexts', () => {
  for (const row of cases) {
    /** @type {[any,string][]} */
    const malformed = [[null,'schema'], [{},'schema'], [{ ...context(row),extra:true },'schema'],
      [{ ...context(row),sourceVersion:3 },'context'],
      [{ ...context(row),sourceSchemaHash:'sha256:' + '0'.repeat(64) },'context']];
    for (const [ctx,category] of malformed) rejects(() => emitNullableCore(hir(row),ctx),category);
    for (const other of cases) if (row !== other)
      rejects(() => emitNullableCore(hir(row),context(other)),'identity');
    const ctx = context(row); ctx.expectedPackageId = 'sha256:' + '0'.repeat(64);
    rejects(() => emitNullableCore(hir(row),ctx),'identity');
  }
});

test('nullable presence Core omitted and undefined contexts keep the default3 refusal of HIR4', () => {
  for (const row of cases) for (const action of [() => emitNullableCore(hir(row)),() => emitNullableCore(hir(row),undefined)])
    assert.throws(action,caught => {
      const error = typedError(caught); assert.equal(error.code,'r03-nullable-schema');
      assert.equal(error.message,'r03-nullable-schema: owned nullable candidate differs');
      assert.equal(error.ruleId,'r01-input-boundary'); assert.equal(error.phase,'hir');
      assert.ok(!Object.hasOwn(error,'primary')); return true;
    });
});

test('nullable presence Core rejects bad typed leaves bindings guard order and call signature at original Source anchors', () => {
  for (const row of cases) {
    const fn = row.expectedHir.functions[0], guard = fn.body[0], get = fn.body.at(-1).value;
    const call = row.expectedHir.functions[1].body[0].value;
    /** @type {[string,string,any,(value:any)=>void][]} */
    const changes = [
      ['absence tag','flow',guard.condition.tagRange,value => { value.functions[0].body[0].condition.tag = 3; }],
      ['guard bool','type',guard.condition.range,value => { value.functions[0].body[0].condition.type = typePreimages[0].record.id; }],
      ['declared operand mask','type',guard.condition.operand.range,value => { value.functions[0].body[0].condition.operand.type = typePreimages[0].record.id; }],
      ['get binding','binding',get.operand.range,value => { value.functions[0].body.at(-1).value.operand.binding = fn.parameters[1].id; }],
      ['get type','type',get.range,value => { value.functions[0].body.at(-1).value.type = typePreimages[1].record.id; }],
      ['get kind','capability',get.range,value => { value.functions[0].body.at(-1).value.kind = 'reference'; }],
      ['full signature','signature',call.range,value => { value.functions[1].body[0].value.signatureHash = 'sha256:' + '0'.repeat(64); }],
      ['original range','range',guard.range,value => { value.functions[0].body[0].range = { start:0,end:1 }; }],
    ];
    for (const [label,category,range,change] of changes) {
      const value = hir(row); change(value); assert.notEqual(jcs(value),row.hirJcsNoLf,label);
      rejects(() => emitNullableCore(value,context(row)),category,primary(row,range));
    }
    if (row.literalSourcePlan.guards.length === 2) {
      const value = hir(row); [value.functions[0].body[0],value.functions[0].body[1]] = [value.functions[0].body[1],value.functions[0].body[0]];
      rejects(() => emitNullableCore(value,context(row)),'range',primary(row,guard.range));
    }
  }
});

test('nullable presence Core emits no partial text for unknown owners or valid declaration IDs with a forged body', () => {
  const row = cases[2];
  const missing = hir(row); missing.functions[0] = null;
  rejects(() => emitNullableCore(missing,context(row)),'schema');
  const unknown = hir(row); unknown.functions[0].id = 'sha256:' + '0'.repeat(64); unknown.functions[0].extra = true;
  rejects(() => emitNullableCore(unknown,context(row)),'schema');
  const value = hir(row), original = row.expectedHir.functions[0];
  value.functions[0].body.at(-1).value.operand.binding = original.parameters[1].id;
  assert.equal(value.functions[0].id,original.id); assert.equal(value.functions[0].signatureHash,original.signatureHash);
  rejects(() => emitNullableCore(value,context(row)),'binding',primary(row,original.body.at(-1).value.operand.range));
});

test('nullable presence Core checks caller graphs before any getter or proxy trap', () => {
  let calls = 0;
  const hit = () => { calls++; throw new Error('untrusted caller behavior'); };
  const proxy = () => new Proxy({}, { get:hit,getPrototypeOf:hit,ownKeys:hit,getOwnPropertyDescriptor:hit,has:hit });
  const row = cases[2];
  rejects(() => emitNullableCore(proxy(),context(row)),'schema');
  rejects(() => emitNullableCore(hir(row),proxy()),'schema');
  const value = hir(row); Object.defineProperty(value,'source',{ enumerable:true,get:hit });
  rejects(() => emitNullableCore(value,context(row)),'schema');
  const ctx = context(row); Object.defineProperty(ctx,'expectedOrigin',{ enumerable:true,get:hit });
  rejects(() => emitNullableCore(hir(row),ctx),'schema');
  assert.equal(calls,0);
});

// Independently authored85-byte keep/entry scalar3 protocol and whole HIR from
// 20m's new STRUCTURAL control, now consumed at this Core seam for the first time.
// No Go capture/execution is claimed. The complete Core text below was worked
// by hand from the existing grammar: one %v0 argument and fuel per function,
// keep returns %v0, entry calls keep into %v1 then returns %v1. No emitter,
// builder, printer, adapter or previous Core test supplied these expected bytes.
const scalar3Hir = {"format":{"family":"tsfg.nullable-hir-candidate","schemaHash":"sha256:24a04b0b595cae59ccf52a939f4671cea0369c46bd705f56726d028ab1df5a71","version":3},"functions":[{"body":[{"kind":"return","range":{"end":34,"start":25},"value":{"binding":"s3","kind":"reference","range":{"end":33,"start":31},"type":"sha256:376ee983062e25a6fa2c9159a5cbe375a944bc253ce3a22d60386b9678ac797b"}}],"id":"sha256:cc93422c9d7e7d3aff189667f43d324a06ad78613e0a76301cad14e81c006233","name":"keep","ownedSymbol":"s1","parameters":[{"id":"s3","name":"n","range":{"end":15,"start":14},"type":"sha256:376ee983062e25a6fa2c9159a5cbe375a944bc253ce3a22d60386b9678ac797b"}],"range":{"end":35,"start":0},"returnType":{"id":"sha256:376ee983062e25a6fa2c9159a5cbe375a944bc253ce3a22d60386b9678ac797b","kind":"scalar","name":"i32"},"role":"internal","signatureHash":"sha256:0efea2107f2b928ba61de6e6fa9d404fff614055cfe43059d02e25717b915ef7"},{"body":[{"kind":"return","range":{"end":84,"start":69},"value":{"arguments":[{"binding":"s4","kind":"reference","range":{"end":82,"start":81},"type":"sha256:376ee983062e25a6fa2c9159a5cbe375a944bc253ce3a22d60386b9678ac797b"}],"kind":"call","range":{"end":83,"start":75},"signatureHash":"sha256:0efea2107f2b928ba61de6e6fa9d404fff614055cfe43059d02e25717b915ef7","target":"sha256:cc93422c9d7e7d3aff189667f43d324a06ad78613e0a76301cad14e81c006233","type":"sha256:376ee983062e25a6fa2c9159a5cbe375a944bc253ce3a22d60386b9678ac797b"}}],"id":"sha256:8b60efaa1117aa97f2cc9cd200255f9ef30abbda5ccf24158f829f4b66f74b6f","name":"entry","ownedSymbol":"s2","parameters":[{"id":"s4","name":"n","range":{"end":59,"start":58},"type":"sha256:376ee983062e25a6fa2c9159a5cbe375a944bc253ce3a22d60386b9678ac797b"}],"range":{"end":85,"start":35},"returnType":{"id":"sha256:376ee983062e25a6fa2c9159a5cbe375a944bc253ce3a22d60386b9678ac797b","kind":"scalar","name":"i32"},"role":"entry","signatureHash":"sha256:0efea2107f2b928ba61de6e6fa9d404fff614055cfe43059d02e25717b915ef7"}],"inputIdentity":"sha256:f12c752e474c031b452441133471bda0c59420108997c0cc093971dc0afc0aac","snapshot":{"capture":{"request":"{\"family\":\"tsfg.nullable-facts-request-candidate\",\"input\":{\"config\":{\"allowJs\":false,\"noEmit\":true,\"strict\":true},\"declarations\":{\"paths\":[\"/src/minimal-integers-v3.d.ts\"],\"version\":\"minimal-integers-v3\"},\"files\":[{\"content\":\"function keep(n:i32):i32{return n;}\\nexport function entry(n:i32):i32{return keep(n);}\",\"path\":\"/src/main.ts\"},{\"content\":\"interface Object {}\\ninterface Function {}\\ninterface CallableFunction {}\\ninterface NewableFunction {}\\ninterface IArguments {}\\ninterface String {}\\ninterface Number {}\\ninterface Boolean {}\\ninterface RegExp {}\\ninterface Array<T> {}\\ntype bool = boolean;\\ndeclare const __tsfg_i32: unique symbol;\\ntype i32 = number & { readonly [__tsfg_i32]: true };\\ntype f64 = number;\\ndeclare const __tsfg_i8: unique symbol;\\ntype i8 = number & { readonly [__tsfg_i8]: true };\\ndeclare const __tsfg_i16: unique symbol;\\ntype i16 = number & { readonly [__tsfg_i16]: true };\\ndeclare const __tsfg_i64: unique symbol;\\ntype i64 = number & { readonly [__tsfg_i64]: true };\\ndeclare const __tsfg_u8: unique symbol;\\ntype u8 = number & { readonly [__tsfg_u8]: true };\\ndeclare const __tsfg_u16: unique symbol;\\ntype u16 = number & { readonly [__tsfg_u16]: true };\\ndeclare const __tsfg_u32: unique symbol;\\ntype u32 = number & { readonly [__tsfg_u32]: true };\\ndeclare const __tsfg_u64: unique symbol;\\ntype u64 = number & { readonly [__tsfg_u64]: true };\\ndeclare const __tsfg_isize: unique symbol;\\ntype isize = number & { readonly [__tsfg_isize]: true };\\ndeclare const __tsfg_usize: unique symbol;\\ntype usize = number & { readonly [__tsfg_usize]: true };\\n\",\"path\":\"/src/minimal-integers-v3.d.ts\"}],\"rootFile\":\"/src/main.ts\",\"sourceRoot\":\"/src\",\"target\":{\"llvmDataLayout\":\"e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128\",\"pointerBits\":\"64\",\"target\":\"windows-x86_64-msvc\",\"triple\":\"x86_64-pc-windows-msvc\"}},\"schemaHash\":\"sha256:24a04b0b595cae59ccf52a939f4671cea0369c46bd705f56726d028ab1df5a71\",\"version\":3}","response":"{\"family\":\"tsfg.nullable-facts-package-candidate\",\"packageId\":\"sha256:120579bc822ffa92f8c931f5f264ce1642c3193840d3cd2bb8a15f1c58c00e92\",\"payload\":{\"exports\":[{\"definition\":{\"end\":57,\"start\":51},\"name\":\"entry\",\"range\":{\"end\":85,\"start\":35},\"sourcePath\":\"/src/main.ts\",\"target\":\"s2\"}],\"facts\":{\"functions\":[{\"body\":[{\"expression\":{\"kind\":\"reference\",\"range\":{\"end\":33,\"start\":31},\"symbol\":\"s3\",\"type\":\"i32\"},\"kind\":\"return\",\"range\":{\"end\":34,\"start\":25}}],\"name\":\"keep\",\"parameterInitializers\":[null],\"parameters\":[{\"id\":\"s3\",\"kind\":\"parameter\",\"name\":\"n\",\"presence\":{\"annotation\":{\"end\":19,\"start\":16},\"default\":false,\"null\":false,\"optional\":false,\"range\":{\"end\":19,\"start\":14},\"undefined\":false},\"range\":{\"end\":15,\"start\":14},\"type\":\"i32\",\"writable\":true}],\"range\":{\"end\":35,\"start\":0},\"returnType\":\"i32\",\"symbol\":\"s1\"},{\"body\":[{\"expression\":{\"arguments\":[{\"kind\":\"reference\",\"range\":{\"end\":82,\"start\":81},\"symbol\":\"s4\",\"type\":\"i32\"}],\"kind\":\"call\",\"range\":{\"end\":83,\"start\":75},\"signature\":{\"parameters\":[\"i32\"],\"presence\":[{\"annotation\":{\"end\":19,\"start\":16},\"default\":false,\"null\":false,\"optional\":false,\"range\":{\"end\":19,\"start\":14},\"undefined\":false}],\"returnType\":\"i32\"},\"target\":\"s1\",\"type\":\"i32\"},\"kind\":\"return\",\"range\":{\"end\":84,\"start\":69}}],\"name\":\"entry\",\"parameterInitializers\":[null],\"parameters\":[{\"id\":\"s4\",\"kind\":\"parameter\",\"name\":\"n\",\"presence\":{\"annotation\":{\"end\":63,\"start\":60},\"default\":false,\"null\":false,\"optional\":false,\"range\":{\"end\":63,\"start\":58},\"undefined\":false},\"range\":{\"end\":59,\"start\":58},\"type\":\"i32\",\"writable\":true}],\"range\":{\"end\":85,\"start\":35},\"returnType\":\"i32\",\"symbol\":\"s2\"}],\"inputs\":[\"/src/main.ts\",\"/src/minimal-integers-v3.d.ts\"],\"status\":\"ok\",\"symbols\":[{\"id\":\"s1\",\"kind\":\"function\",\"name\":\"keep\",\"range\":{\"end\":13,\"start\":8},\"type\":\"i32\",\"writable\":false},{\"id\":\"s2\",\"kind\":\"function\",\"name\":\"entry\",\"range\":{\"end\":57,\"start\":51},\"type\":\"i32\",\"writable\":false},{\"id\":\"s3\",\"kind\":\"parameter\",\"name\":\"n\",\"presence\":{\"annotation\":{\"end\":19,\"start\":16},\"default\":false,\"null\":false,\"optional\":false,\"range\":{\"end\":19,\"start\":14},\"undefined\":false},\"range\":{\"end\":15,\"start\":14},\"type\":\"i32\",\"writable\":true},{\"id\":\"s4\",\"kind\":\"parameter\",\"name\":\"n\",\"presence\":{\"annotation\":{\"end\":63,\"start\":60},\"default\":false,\"null\":false,\"optional\":false,\"range\":{\"end\":63,\"start\":58},\"undefined\":false},\"range\":{\"end\":59,\"start\":58},\"type\":\"i32\",\"writable\":true}]},\"files\":[{\"byteLength\":85,\"digest\":\"sha256:b78b6c0a336379295e060119d0ab5dca9046d173af32d3d6b4d9736282180837\",\"length\":85,\"path\":\"/src/main.ts\",\"positionUnit\":\"utf16\"},{\"byteLength\":1214,\"digest\":\"sha256:9fc1955899e303b5815590f7150f60662f3cece0a633c94a2a06669cf509a96e\",\"length\":1214,\"path\":\"/src/minimal-integers-v3.d.ts\",\"positionUnit\":\"utf16\"}],\"inputIdentity\":\"sha256:f12c752e474c031b452441133471bda0c59420108997c0cc093971dc0afc0aac\"},\"requestId\":\"sha256:ecbd0adb7f0e2596ae4eccdfbda1ac247fde9e6fe615908bcbfd61e575be7fd3\",\"schemaHash\":\"sha256:24a04b0b595cae59ccf52a939f4671cea0369c46bd705f56726d028ab1df5a71\",\"version\":3}"},"exports":[{"definition":{"end":57,"start":51},"name":"entry","range":{"end":85,"start":35},"sourcePath":"/src/main.ts","target":"s2"}],"format":{"family":"tsfg.frontend-nullable-candidate","schemaHash":"sha256:24a04b0b595cae59ccf52a939f4671cea0369c46bd705f56726d028ab1df5a71","version":3},"functions":[{"body":[{"expression":{"kind":"reference","range":{"end":33,"start":31},"symbol":"s3","type":"i32"},"kind":"return","range":{"end":34,"start":25}}],"name":"keep","parameterInitializers":[null],"parameters":[{"id":"s3","kind":"parameter","name":"n","presence":{"annotation":{"end":19,"start":16},"default":false,"null":false,"optional":false,"range":{"end":19,"start":14},"undefined":false},"range":{"end":15,"start":14},"type":"i32","writable":true}],"range":{"end":35,"start":0},"returnType":"i32","symbol":"s1"},{"body":[{"expression":{"arguments":[{"kind":"reference","range":{"end":82,"start":81},"symbol":"s4","type":"i32"}],"kind":"call","range":{"end":83,"start":75},"signature":{"parameters":["i32"],"presence":[{"annotation":{"end":19,"start":16},"default":false,"null":false,"optional":false,"range":{"end":19,"start":14},"undefined":false}],"returnType":"i32"},"target":"s1","type":"i32"},"kind":"return","range":{"end":84,"start":69}}],"name":"entry","parameterInitializers":[null],"parameters":[{"id":"s4","kind":"parameter","name":"n","presence":{"annotation":{"end":63,"start":60},"default":false,"null":false,"optional":false,"range":{"end":63,"start":58},"undefined":false},"range":{"end":59,"start":58},"type":"i32","writable":true}],"range":{"end":85,"start":35},"returnType":"i32","symbol":"s2"}],"identityInput":{"config":{"allowJs":false,"noEmit":true,"strict":true},"declarations":{"paths":["/src/minimal-integers-v3.d.ts"],"version":"minimal-integers-v3"},"files":[{"content":"function keep(n:i32):i32{return n;}\nexport function entry(n:i32):i32{return keep(n);}","path":"/src/main.ts"},{"content":"interface Object {}\ninterface Function {}\ninterface CallableFunction {}\ninterface NewableFunction {}\ninterface IArguments {}\ninterface String {}\ninterface Number {}\ninterface Boolean {}\ninterface RegExp {}\ninterface Array<T> {}\ntype bool = boolean;\ndeclare const __tsfg_i32: unique symbol;\ntype i32 = number & { readonly [__tsfg_i32]: true };\ntype f64 = number;\ndeclare const __tsfg_i8: unique symbol;\ntype i8 = number & { readonly [__tsfg_i8]: true };\ndeclare const __tsfg_i16: unique symbol;\ntype i16 = number & { readonly [__tsfg_i16]: true };\ndeclare const __tsfg_i64: unique symbol;\ntype i64 = number & { readonly [__tsfg_i64]: true };\ndeclare const __tsfg_u8: unique symbol;\ntype u8 = number & { readonly [__tsfg_u8]: true };\ndeclare const __tsfg_u16: unique symbol;\ntype u16 = number & { readonly [__tsfg_u16]: true };\ndeclare const __tsfg_u32: unique symbol;\ntype u32 = number & { readonly [__tsfg_u32]: true };\ndeclare const __tsfg_u64: unique symbol;\ntype u64 = number & { readonly [__tsfg_u64]: true };\ndeclare const __tsfg_isize: unique symbol;\ntype isize = number & { readonly [__tsfg_isize]: true };\ndeclare const __tsfg_usize: unique symbol;\ntype usize = number & { readonly [__tsfg_usize]: true };\n","path":"/src/minimal-integers-v3.d.ts"}],"rootFile":"/src/main.ts","sourceRoot":"/src","target":{"llvmDataLayout":"e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128","pointerBits":"64","target":"windows-x86_64-msvc","triple":"x86_64-pc-windows-msvc"}},"inputIdentity":"sha256:f12c752e474c031b452441133471bda0c59420108997c0cc093971dc0afc0aac","inputs":[{"byteLength":85,"digest":"sha256:b78b6c0a336379295e060119d0ab5dca9046d173af32d3d6b4d9736282180837","length":85,"path":"/src/main.ts","positionUnit":"utf16"},{"byteLength":1214,"digest":"sha256:9fc1955899e303b5815590f7150f60662f3cece0a633c94a2a06669cf509a96e","length":1214,"path":"/src/minimal-integers-v3.d.ts","positionUnit":"utf16"}],"snapshotId":"sha256:713c67485c62b9d619d57344ed2afcf60565e8fb8046a6792c49f3add7b0fe55","source":{"content":"function keep(n:i32):i32{return n;}\nexport function entry(n:i32):i32{return keep(n);}","hash":"sha256:b78b6c0a336379295e060119d0ab5dca9046d173af32d3d6b4d9736282180837","path":"/src/main.ts"},"sourceOrigin":{"kind":"owned-go-nullable-response","producerBaseOid":"0000000000000000000000000000000000000000","producerDirty":true,"requestSha256":"sha256:32b5add3df7d78538a0151ca162f38f7631540329d5b6c8c7cc0de9e51870599","responseSha256":"sha256:d235c49be7aa35f5e086241aa0865fcbf850e283011c3d424f3b91ca2c7ca3d9","testedInputSetHash":"sha256:0000000000000000000000000000000000000000000000000000000000000000"},"symbols":[{"id":"s1","kind":"function","name":"keep","range":{"end":13,"start":8},"type":"i32","writable":false},{"id":"s2","kind":"function","name":"entry","range":{"end":57,"start":51},"type":"i32","writable":false},{"id":"s3","kind":"parameter","name":"n","presence":{"annotation":{"end":19,"start":16},"default":false,"null":false,"optional":false,"range":{"end":19,"start":14},"undefined":false},"range":{"end":15,"start":14},"type":"i32","writable":true},{"id":"s4","kind":"parameter","name":"n","presence":{"annotation":{"end":63,"start":60},"default":false,"null":false,"optional":false,"range":{"end":63,"start":58},"undefined":false},"range":{"end":59,"start":58},"type":"i32","writable":true}],"target":{"llvmDataLayout":"e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128","pointerBits":"64","target":"windows-x86_64-msvc","triple":"x86_64-pc-windows-msvc"}},"source":{"content":"function keep(n:i32):i32{return n;}\nexport function entry(n:i32):i32{return keep(n);}","hash":"sha256:b78b6c0a336379295e060119d0ab5dca9046d173af32d3d6b4d9736282180837","path":"/src/main.ts"},"target":{"llvmDataLayout":"e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128","pointerBits":"64","target":"windows-x86_64-msvc","triple":"x86_64-pc-windows-msvc"},"types":[{"id":"sha256:376ee983062e25a6fa2c9159a5cbe375a944bc253ce3a22d60386b9678ac797b","kind":"scalar","name":"i32"}]};
const scalar3Core = "module attributes {tsfg_core.version = \"0.9.0\", tsfg_core.input_identity = \"sha256:f12c752e474c031b452441133471bda0c59420108997c0cc093971dc0afc0aac\", tsfg_core.source_hash = \"sha256:b78b6c0a336379295e060119d0ab5dca9046d173af32d3d6b4d9736282180837\", tsfg_core.source_path = \"/src/main.ts\", tsfg_core.target = \"windows-x86_64-msvc\", tsfg_core.triple = \"x86_64-pc-windows-msvc\", tsfg_core.data_layout = \"e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128\", tsfg_core.bytecode_schema = \"sha256:3dea6ce5de996dfa3e7141cced985243ea74ac9bb80f03636c6694343118f2a6\", tsfg_core.source_length = 85 : i64, tsfg_core.nullable = {family = \"tsfg.core-nullable-candidate\", version = 1 : i32, schema = \"sha256:8f99963869ac2fed97db0ce90171d89593e4a3de667288eace4fc141c7cbc4bd\", profile = \"i32-null-undefined-internal-v1\"}} {\n  func.func @\"keep\"(%v0: i32) -> i32 attributes {tsfg_core.function_id = \"sha256:cc93422c9d7e7d3aff189667f43d324a06ad78613e0a76301cad14e81c006233\", tsfg_core.signature_hash = \"sha256:0efea2107f2b928ba61de6e6fa9d404fff614055cfe43059d02e25717b915ef7\", tsfg_core.type_id = \"sha256:376ee983062e25a6fa2c9159a5cbe375a944bc253ce3a22d60386b9678ac797b\", tsfg_core.function_start = 0 : i64, tsfg_core.function_end = 35 : i64, tsfg_nullable.role = \"internal\"} {\n    \"tsfg_core.fuel\"() {event = 1 : i32, tsfg_source.start = 0 : i64, tsfg_source.end = 35 : i64} : () -> ()\n    \"func.return\"(%v0) {tsfg_source.start = 25 : i64, tsfg_source.end = 34 : i64} : (i32) -> ()\n  }\n  func.func @\"entry\"(%v0: i32) -> i32 attributes {tsfg_core.function_id = \"sha256:8b60efaa1117aa97f2cc9cd200255f9ef30abbda5ccf24158f829f4b66f74b6f\", tsfg_core.signature_hash = \"sha256:0efea2107f2b928ba61de6e6fa9d404fff614055cfe43059d02e25717b915ef7\", tsfg_core.type_id = \"sha256:376ee983062e25a6fa2c9159a5cbe375a944bc253ce3a22d60386b9678ac797b\", tsfg_core.function_start = 35 : i64, tsfg_core.function_end = 85 : i64, tsfg_nullable.role = \"entry\"} {\n    \"tsfg_core.fuel\"() {event = 1 : i32, tsfg_source.start = 35 : i64, tsfg_source.end = 85 : i64} : () -> ()\n    %v1 = \"func.call\"(%v0) {callee = @\"keep\", tsfg_core.function_id = \"sha256:cc93422c9d7e7d3aff189667f43d324a06ad78613e0a76301cad14e81c006233\", tsfg_core.signature_hash = \"sha256:0efea2107f2b928ba61de6e6fa9d404fff614055cfe43059d02e25717b915ef7\", tsfg_source.start = 75 : i64, tsfg_source.end = 83 : i64} : (i32) -> i32\n    \"func.return\"(%v1) {tsfg_source.start = 69 : i64, tsfg_source.end = 84 : i64} : (i32) -> ()\n  }\n}\n";
test('nullable presence Core retains complete synthetic scalar3 text for omitted and undefined context', () => {
  assert.equal(scalar3Hir.source.content,'function keep(n:i32):i32{return n;}\nexport function entry(n:i32):i32{return keep(n);}');
  assert.equal(scalar3Hir.source.content.length,85);
  assert.equal(sha(jcs(scalar3Hir)),'sha256:3563e9f019afed634328e19898a9fde61a461e1ee0b57c49a88d1a42c1d625ef');
  assert.equal(Buffer.byteLength(scalar3Core),2477);
  assert.equal(sha(scalar3Core),'sha256:f1307af56276b69a340a0694473002236f51259dfcf113d7858bc5a81ff7f4dc');
  assert.equal(emitNullableCore(fresh(scalar3Hir)),scalar3Core);
  assert.equal(emitNullableCore(fresh(scalar3Hir),undefined),scalar3Core);
});

// The four finite selected modules are small. This suite does not claim a
// maximum legal8MiB output boundary, backend acceptance or runtime equivalence.
