// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { decodeReferenceFacts } from '../../compiler/reference-facts.mjs';
import { buildReferenceHir, printReferenceHir, readReferenceHir } from '../../compiler/reference-hir.mjs';
import { lowerHir } from '../../compiler/hir.mjs';
import { invokeCore, accepted } from './generic-core-package-capture.mjs';

const fixture = name => new URL('./fixtures/reference-source/' + name, import.meta.url);
const sha256 = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
// Fixed role expectations, independent of local type IDs and lowering helpers.
/** @type {[string,string,string,string,string][]} */
const expected = [['i','readI32','scalar','i32','i32'], ['f','readF32','scalar','f32','f32'],
  ['d','readNumber','number','f64','f64'], ['b','readBool','boolean','bool','i1']];
const declarationHash = 'sha256:60974c1fa82cc549da3a9268f5d82ab10b58f52e2612a377ee4577f05af52c86';
let loaded;
async function actual() {
  if (!loaded) loaded = load();
  return loaded;
}
async function load() {
  const [bytes, bindingBytes, sourceBytes, declarationBytes] = await Promise.all([
    readFile(fixture('scalars.facts.json')), readFile(fixture('scalars.binding.json')),
    readFile(fixture('scalars.source.ts')), readFile(fixture('minimal-conversions-v5.d.ts')),
  ]);
  assert.equal(bytes.length, 19035); assert.equal(bindingBytes.length, 973);
  assert.equal(sourceBytes.length, 340); assert.equal(declarationBytes.length, 17464);
  assert.equal(sha256(bytes), 'sha256:e9a9c6cfedc125189f9efb6c8862798f082d5707837182c0ab348d5616cff56a');
  assert.equal(sha256(bindingBytes), 'sha256:923edf87baeafa9ce629ac94fedfd10c84bfe1f2945e7651e0319544e030db29');
  assert.equal(sha256(sourceBytes), 'sha256:dc0f924a811a2642b94b158742a4f05e58de27fac657d10eb892027da50a5f01');
  assert.equal(sha256(declarationBytes), declarationHash);
  const binding = JSON.parse(bindingBytes.toString('utf8'));
  /** @type {[string,Buffer,boolean][]} */
  const originals = [['/original/main.ts',sourceBytes,false],
    ['/original/minimal-conversions-v5.d.ts',declarationBytes,true]];
  assert.equal(binding.sources.length, 2);
  for (const [path, content, declaration] of originals) {
    const origin = binding.sources.find(value => value.path === path); assert.ok(origin);
    assert.equal(origin.sha256, sha256(content)); assert.equal(origin.utf16Length, content.toString('utf8').length);
    assert.equal(origin.declaration, declaration); assert.deepEqual(origin.surrogateStarts, []);
  }
  // These are retained official Source facts, not newly checked Source inputs.
  const owned = buildReferenceHir(decodeReferenceFacts(bytes, binding));
  const persisted = Buffer.from(printReferenceHir(owned)), hir = readReferenceHir(persisted); persisted.fill(0);
  assert.deepEqual(hir, owned); assert.equal(hir.format.version, 4);
  assert.equal(hir.format.semanticProfile, 'tsfg-owned-class-facts-candidate-v4');
  assert.equal(hir.classes.length, 1);
  const owner = hir.classes[0], types = new Map(hir.types.map(type => [type.id,type]));
  assert.equal(owner.name, 'Scalars'); assert.equal(owner.fields.length, 4); assert.equal(owner.methods.length, 4);
  assert.equal(owner.constructor.access, 'public'); assert.equal(owner.constructor.signature.parameters.length, 4);
  assert.equal(owner.constructor.body.length, 4);
  for (const [index,[name,methodName,kind,role]] of expected.entries()) {
    const field = owner.fields[index], type = types.get(field.type), parameter = owner.constructor.signature.parameters[index];
    assert.equal(field.name, name); assert.ok(type); assert.equal(type.kind, kind); assert.equal(type.scalar, role);
    assert.equal(field.initializer, null); assert.equal(field.initializerCompatibility, null);
    assert.equal(parameter.type, field.type);
    const assignment = owner.constructor.body[index].expression;
    assert.equal(assignment.kind, 'ref.field.write'); assert.equal(assignment.left.symbol, field.symbol);
    assert.equal(assignment.right.kind, 'ref.parameter'); assert.equal(assignment.right.symbol, parameter.symbol);
    assert.equal(assignment.right.type, field.type);
    assert.deepEqual(assignment.compatibility, {assignable:true,members:[],origin:assignment.right.origin,
      sourceType:field.type,targetType:field.type});
    const method = owner.methods[index]; assert.equal(method.name, methodName); assert.equal(method.signature.return, field.type);
    assert.equal(method.body.length, 1); assert.equal(method.body[0].kind, 'return');
    assert.equal(method.body[0].expression.kind, 'ref.field.read');
    assert.equal(method.body[0].expression.symbol, field.symbol); assert.equal(method.body[0].expression.type, field.type);
    if (index < 2) {
      const nominal = type.nominal; assert.ok(nominal);
      const alias = index === 0 ? {start:797,end:849} : {start:1287,end:1339};
      const brand = index === 0 ? {start:376,end:386} : {start:1260,end:1270};
      const path = '/original/minimal-conversions-v5.d.ts';
      assert.deepEqual(nominal, {source:path,sha256:declarationHash,version:'minimal-conversions-v5',
        alias:{source:path,...alias},brand:{source:path,...brand}});
      const text = declarationBytes.toString('utf8');
      assert.equal(text.slice(alias.start,alias.end), 'type ' + role + ' = number & { readonly [__tsfg_' + role + ']: true };');
      assert.equal(text.slice(brand.start,brand.end), '__tsfg_' + role);
    } else assert.equal(type.nominal, null);
  }
  const core = lowerHir(hir);
  assert.equal(core, lowerHir(readReferenceHir(Buffer.from(printReferenceHir(hir)))));
  return {hir,owner,core};
}
function only(items, label) {
  assert.equal(items.length, 1, label); return items[0];
}
const parameterPattern = /(%[A-Za-z0-9_]+):\s*(!tsfg_core\.ref<"[^"]+">|i32|f32|f64|i1)/g;
// Narrow readers of the two public text forms. No type inference or production
// verification algorithm is reproduced; every expected scalar role is fixed above.
function functions(core) {
  const emitted = [...core.matchAll(/^  func\.func ([^\n]+)\n([\s\S]*?)^  \}/gm)].map(([,header,body]) => {
    const result = header.match(/\) (?:-> (i32|f32|f64|i1) )?attributes /); assert.ok(result);
    return {attributes:header,body,result:result[1] ?? '()',
      parameters:[...header.matchAll(parameterPattern)].map(([,value,type]) => ({value,type}))};
  });
  if (emitted.length) return emitted;
  return [...core.matchAll(/^  "func\.func"\(\) <\{function_type = \(([^\n]*)\) -> (\(\)|i32|f32|f64|i1), sym_name = "[^"]+"\}> \(\{\n  \^bb0\(([^\n]*)\):\n([\s\S]*?)^  \}\) \{([^\n]*)\} : \(\) -> \(\)$/gm)]
    .map(([,inputs,result,parameters,body,attributes]) => {
      const parsed = [...parameters.matchAll(parameterPattern)].map(([,value,type]) => ({value,type}));
      assert.deepEqual(parsed.map(value => value.type), inputs.split(/,\s*/));
      return {attributes,body,result,parameters:parsed};
    });
}
function operations(body, name) {
  return body.split('\n').flatMap(line => {
    const match = line.match(/^\s*(?:(%[A-Za-z0-9_]+) = )?"([^"]+)"\(([^)]*)\) \{(.*)\} : \(([^)]*)\) -> (.*)$/);
    return !match || match[2] !== name ? [] : [{value:match[1],operands:match[3] ? match[3].split(/,\s*/) : [],
      attributes:match[4],inputs:match[5] ? match[5].split(/,\s*/) : [],result:match[6]}];
  });
}
function anchor(attributes, origin) {
  assert.ok(attributes.includes('tsfg_source.start = ' + origin.start + ' : i64'));
  assert.ok(attributes.includes('tsfg_source.end = ' + origin.end + ' : i64'));
}
function memberKey(owner, field) {
  return sha256(['tsfg.core-reference.member.v1',owner.runtimeKey,'field',field.origin.source,
    String(field.origin.start),String(field.origin.end),field.name].join('\0'));
}
function checkCallable(all, hir, owner, item, name, roles, result) {
  const fn = only(all.filter(value => value.attributes.includes('tsfg_core.logical_name = ' + JSON.stringify(name))
    && value.attributes.includes('tsfg_core.reference_owner = ' + JSON.stringify(owner.runtimeKey))), name);
  const source = hir.sources.findIndex(value => value.path === item.origin.source); assert.ok(source >= 0);
  const kind = name === 'constructor' ? 'constructor' : 'method';
  const signature = sha256('tsfg.core-reference.signature.v1\0(' + roles.join(',') + ')->' + result);
  const key = sha256(['tsfg.core-reference.callable.v1',owner.runtimeKey,kind,item.origin.source,
    String(item.origin.start),String(item.origin.end),signature].join('\0'));
  for (const [attribute,value] of [['reference_kind',kind],['signature_hash',signature],['function_id',key]])
    assert.ok(fn.attributes.includes('tsfg_core.' + attribute + ' = ' + JSON.stringify(value)));
  for (const [attribute,value] of [['source_index',source],['function_start',item.origin.start],['function_end',item.origin.end]])
    assert.ok(fn.attributes.includes('tsfg_core.' + attribute + ' = ' + value + ' : i64'));
  return fn;
}
function checkCore(core, data) {
  const {hir,owner} = data, all = functions(core); assert.equal(all.length, 5);
  const access = sha256('tsfg.core-reference.access.v1\0' + owner.runtimeKey), role = 'ref:' + access;
  const receiverType = '!tsfg_core.ref<' + JSON.stringify(access) + '>';
  const ctor = checkCallable(all,hir,owner,owner.constructor,'constructor',[role,'i32','f32','f64','bool'],'none');
  assert.deepEqual(ctor.parameters.map(value => value.type), [receiverType,'i32','f32','f64','i1']);
  assert.equal(ctor.result, '()');
  const stores = operations(ctor.body,'tsfg_core.ref.field.write'); assert.equal(stores.length, 4);
  const done = only(operations(ctor.body,'func.return'), 'constructor return');
  assert.deepEqual(done.operands, []); assert.deepEqual(done.inputs, []); assert.equal(done.result, '()');
  for (const [index,[name,methodName,,scalar,mlirType]] of expected.entries()) {
    const field = owner.fields[index], key = memberKey(owner,field), store = stores[index];
    assert.equal(field.name,name); assert.ok(store.attributes.includes('field = ' + JSON.stringify(key)));
    assert.ok(store.attributes.includes('initialize = false'));
    assert.deepEqual(store.operands, [ctor.parameters[0].value,ctor.parameters[index + 1].value]);
    assert.deepEqual(store.inputs, [receiverType,mlirType]); assert.equal(store.result,'()');
    anchor(store.attributes,owner.constructor.body[index].expression.origin);
    // Field metadata uses semantic bool; its actual MLIR storage and ABI use i1.
    const metadata = only([...core.matchAll(/\{access = "public", end = \d+ : i64, has_initializer = false, key = "[^"]+", name = "[^"]+", ordinal = \d+ : i64, readonly = false, source = \d+ : i64, start = \d+ : i64, type = "[^"]+"\}/g)]
      .filter(value => value[0].includes('key = ' + JSON.stringify(key))), 'typed field metadata')[0];
    assert.ok(metadata.includes('name = ' + JSON.stringify(name))); assert.ok(metadata.includes('type = ' + JSON.stringify(scalar)));
    assert.ok(metadata.includes('start = ' + field.origin.start + ' : i64'));
    assert.ok(metadata.includes('end = ' + field.origin.end + ' : i64'));
    const method = owner.methods[index], fn = checkCallable(all,hir,owner,method,methodName,[role],scalar);
    assert.deepEqual(fn.parameters.map(value => value.type), [receiverType]); assert.equal(fn.result,mlirType);
    const read = only(operations(fn.body,'tsfg_core.ref.field.read'),methodName + ' read');
    assert.deepEqual(read.operands,[fn.parameters[0].value]); assert.deepEqual(read.inputs,[receiverType]);
    assert.equal(read.result,mlirType); assert.ok(read.attributes.includes('field = ' + JSON.stringify(key)));
    anchor(read.attributes,method.body[0].expression.origin);
    const returned = only(operations(fn.body,'func.return'),methodName + ' return');
    assert.deepEqual(returned.operands,[read.value]); assert.deepEqual(returned.inputs,[mlirType]); assert.equal(returned.result,'()');
    anchor(returned.attributes,method.body[0].origin);
    assert.equal(operations(fn.body,'tsfg_core.ref.field.write').length,0);
  }
  assert.doesNotMatch(core, /"tsfg_core\.constant"|"tsfg_core\.ref\.alloc"|"tsfg_core\.ref\.call"|"func\.call"/,
    'the actual typed parameter/field/getter program needs no literal settlement or calls');
}

test('actual nominal four-scalar fields constructor parameters and getter returns reach public Core unchanged', async () => {
  const data = await actual(); checkCore(data.core,data);
});
test('actual four-scalar Core survives real C++ canonical roundtrip and optimization while wire9 rejects references', async () => {
  const data = await actual();
  const first = await invokeCore(data.core); accepted(first);
  const roundtrip = await invokeCore(first.stdout); accepted(roundtrip);
  const optimized = await invokeCore(first.stdout,'--optimize'); accepted(optimized);
  assert.deepEqual(roundtrip.stdout,first.stdout); assert.deepEqual(optimized.stdout,first.stdout);
  checkCore(first.stdout.toString('utf8'),data);
  const wire = await invokeCore(first.stdout,'--emit-bytecode');
  assert.equal(wire.close.code,3,wire.stderr.toString('utf8')); assert.equal(wire.stdout.length,0);
  assert.match(wire.stderr.toString('utf8'),/\[r04-core-reference-unsupported\]/);
});
