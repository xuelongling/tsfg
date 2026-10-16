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
// Handwritten f64 expectations; neither floatBits nor host numeric parsing is an oracle.
/** @type {[string,string,string][]} */
const expected = [['Base','baseValue','3ff0000000000000'], ['Derived','derivedValue','4000000000000000']];
let loaded;
async function actual() {
  if (!loaded) loaded = load();
  return loaded;
}
async function load() {
  const [bytes, bindingBytes, main, declaration] = await Promise.all([
    readFile(fixture('field-initialization-order.facts.json')), readFile(fixture('field-initialization-order.binding.json')),
    readFile(fixture('field-initialization-order.source.ts')), readFile(fixture('ancestor-super-method.declaration.d.ts')),
  ]);
  assert.equal(bytes.length,6769); assert.equal(bindingBytes.length,978); assert.equal(main.length,149); assert.equal(declaration.length,362);
  assert.equal(sha256(bytes),'sha256:d29ae0428a3d63d9ee4150d677f3a64e9383f44e4601127fa39175e4d04c1861');
  assert.equal(sha256(bindingBytes),'sha256:6ea670b6e22ebddda9b4d3a32e0f80b722af25668c31ce74eb73cbf5ab63b2b7');
  assert.equal(sha256(main),'sha256:61e6ada9b719f354a1bb74de37c0c8792ec5701d81dd43cbe2dfa6d0459c706a');
  assert.equal(sha256(declaration),'sha256:d629059f5175a580a8a7b19531c7d8cff1bfa7b61320f6638cf4ee25fbf5a141');
  const binding = JSON.parse(bindingBytes.toString('utf8'));
  /** @type {[string,Buffer,boolean,number[]][]} */
  const originals = [['/original/main.ts',main,false,[3]], ['/original/minimal-scalars-v2.d.ts',declaration,true,[]]];
  assert.equal(binding.sources.length,2); assert.equal(main.toString('utf8').length,147);
  for (const [path,content,isDeclaration,surrogates] of originals) {
    const record = binding.sources.find(value => value.path === path); assert.ok(record);
    assert.equal(record.sha256,sha256(content)); assert.equal(record.utf16Length,content.toString('utf8').length);
    assert.equal(record.declaration,isDeclaration); assert.deepEqual(record.surrogateStarts,surrogates);
  }
  // Retained official Source4 output; no fresh Source execution is implied.
  const facts = decodeReferenceFacts(bytes,binding), owned = buildReferenceHir(facts);
  const persisted = Buffer.from(printReferenceHir(owned)), hir = readReferenceHir(persisted); persisted.fill(0);
  assert.deepEqual(hir,owned); assert.equal(hir.format.version,4);
  assert.equal(hir.format.semanticProfile,'tsfg-owned-class-facts-candidate-v4');
  assert.equal(hir.context.scope,'class:field-initialization-order'); assert.equal(hir.classes.length,2);
  const base = hir.classes.find(value => value.name === 'Base'), derived = hir.classes.find(value => value.name === 'Derived');
  assert.ok(base); assert.ok(derived); assert.equal(base.base,''); assert.equal(derived.base,base.id);
  assert.notEqual(base.runtimeKey,derived.runtimeKey);
  for (const [index,[name,fieldName]] of expected.entries()) {
    const owner = hir.classes.find(value => value.name === name), raw = facts.graph.classes.find(value => value.name === name);
    assert.ok(owner); assert.ok(raw); assert.equal(owner.fields.length,1); assert.equal(owner.methods.length,0);
    const ctor = owner.constructor, field = owner.fields[0], literal = field.initializer;
    assert.equal(ctor.access,'public'); assert.deepEqual(ctor.signature.parameters,[]); assert.equal(ctor.signature.return,owner.instanceType);
    assert.deepEqual(ctor.initializationFields,[field.id]); assert.equal(field.name,fieldName); assert.equal(field.ordinal,0);
    const type = hir.types.find(value => value.id === field.type); assert.ok(type); assert.equal(type.kind,'number'); assert.equal(type.scalar,'f64');
    assert.equal(literal.kind,'scalar.literal.unresolved'); assert.equal(literal.token,index === 0 ? '1' : '2');
    assert.deepEqual(literal.numericLiteral,{state:'unresolved',officialType:literal.type,defaultScalar:'i32',contextType:field.type});
    assert.deepEqual(field.initializerCompatibility,{assignable:true,members:[],origin:literal.origin,sourceType:literal.type,targetType:field.type});
    assert.deepEqual(owner.origin,raw.origin); assert.deepEqual(ctor.origin,raw.constructor.origin);
    assert.deepEqual(field.origin,raw.fields[0].origin); assert.deepEqual(literal.origin,raw.fields[0].initializer.origin);
    assert.equal(main.toString('utf8').slice(literal.origin.start,literal.origin.end),literal.token);
    assert.equal(main.toString('utf8').slice(field.origin.start,field.origin.end),fieldName + ': number = ' + literal.token + ';');
  }
  assert.equal(base.constructor.kind,'implicit-base'); assert.equal(base.constructor.initializationPhase,'before-body');
  assert.deepEqual(base.constructor.initializationBoundary,{kind:'entry'}); assert.deepEqual(base.constructor.body,[]);
  assert.equal(derived.constructor.kind,'explicit'); assert.equal(derived.constructor.initializationPhase,'after-successful-super');
  assert.equal(derived.constructor.body.length,1);
  const call = derived.constructor.body[0].expression;
  assert.equal(call.kind,'ref.super.construct'); assert.equal(call.dispatch,'direct-base-constructor');
  assert.equal(call.staticTarget,base.constructor.id); assert.equal(call.receiver.kind,'ref.super');
  assert.equal(call.receiver.symbol,base.symbol); assert.equal(call.receiver.type,base.constructorType);
  assert.deepEqual(call.arguments,[]); assert.deepEqual(call.argumentCompatibility,[]);
  assert.deepEqual(call.resolvedSignature,{parameters:[],return:base.instanceType});
  assert.equal(derived.constructor.superCall,call.id);
  assert.deepEqual(derived.constructor.initializationBoundary,{kind:'successful-return',expressionId:call.id});
  assert.equal(main.toString('utf8').slice(call.origin.start,call.origin.end),'super()');
  assert.equal(main.toString('utf8').slice(call.receiver.origin.start,call.receiver.origin.end),'super');
  const core = lowerHir(hir); assert.equal(core,lowerHir(readReferenceHir(Buffer.from(printReferenceHir(hir)))));
  return {hir,base,derived,core};
}
function only(values,label) { assert.equal(values.length,1,label); return values[0]; }
const parameter = /(%[A-Za-z0-9_]+):\s*(!tsfg_core\.ref<"[^"]+">)/g;
// Read only the public emitted and canonical Core text; no lowering helper or
// initialization/roots algorithm is shared with these independent expectations.
function functions(core) {
  const emitted = [...core.matchAll(/^  func\.func ([^\n]+)\n([\s\S]*?)^  \}/gm)]
    .map(([,header,body]) => ({attributes:header,body,parameters:[...header.matchAll(parameter)].map(([,value,type]) => ({value,type}))}));
  if (emitted.length) return emitted;
  return [...core.matchAll(/^  "func\.func"\(\) <\{function_type = \(([^\n]*)\) -> \(\), sym_name = "[^"]+"\}> \(\{\n  \^bb0\(([^\n]*)\):\n([\s\S]*?)^  \}\) \{([^\n]*)\} : \(\) -> \(\)$/gm)]
    .map(([,inputs,parameters,body,attributes]) => {
      const parsed = [...parameters.matchAll(parameter)].map(([,value,type]) => ({value,type}));
      assert.deepEqual(parsed.map(value => value.type),inputs.split(/,\s*/)); return {attributes,body,parameters:parsed};
    });
}
function operations(body) {
  return body.split('\n').flatMap(line => {
    const match = line.match(/^\s*(?:(%[A-Za-z0-9_]+) = )?"([^"]+)"\(([^)]*)\) (?:<\{([^}]*)\}> )?\{(.*)\} : \(([^)]*)\) -> (.*)$/);
    return !match ? [] : [{value:match[1],name:match[2],operands:match[3] ? match[3].split(/,\s*/) : [],
      attributes:(match[4] ? match[4] + ', ' : '') + match[5],inputs:match[6] ? match[6].split(/,\s*/) : [],result:match[7]}];
  });
}
function anchor(attributes,origin) {
  assert.ok(attributes.includes('tsfg_source.start = ' + origin.start + ' : i64'));
  assert.ok(attributes.includes('tsfg_source.end = ' + origin.end + ' : i64'));
}
function roots(attributes) {
  const key = 'tsfg_core.reference_roots = ', at = attributes.indexOf(key); assert.ok(at >= 0);
  const start = at + key.length; assert.equal(attributes[start],'[');
  let depth = 0, end = -1;
  for (let i = start; i < attributes.length; i++) {
    if (attributes[i] === '[') depth++;
    if (attributes[i] === ']' && --depth === 0) { end = i + 1; break; }
  }
  assert.ok(end > start); const text = attributes.slice(start + 1,end - 1);
  const pattern = /\{block = (\d+) : i64, instruction = (\d+) : i64, registers = \[([^\]]*)\]\}/g;
  const matches = [...text.matchAll(pattern)]; assert.equal(text.replace(pattern,'').replace(/[,\s]/g,''),'');
  return matches.map(([,block,instruction,registers]) => ({block:Number(block),instruction:Number(instruction),
    registers:registers.trim() ? registers.split(',').map(value => {
      const item = value.trim().match(/^(\d+)(?: : i64)?$/); assert.ok(item); return Number(item[1]);
    }) : []}));
}
function checkCore(core,data,canonical = false) {
  const all = functions(core); assert.equal(all.length,2);
  const descriptors = [...core.matchAll(/constructor = \{([^{}]*)\}/g)].map(value => value[1]); assert.equal(descriptors.length,2);
  const checked = [];
  for (const [name,,bits] of expected) {
    const owner = name === 'Base' ? data.base : data.derived, field = owner.fields[0], ctor = owner.constructor;
    const access = sha256('tsfg.core-reference.access.v1\0' + owner.runtimeKey), type = '!tsfg_core.ref<' + JSON.stringify(access) + '>';
    const signature = sha256('tsfg.core-reference.signature.v1\0(ref:' + access + ')->none');
    const callable = sha256(['tsfg.core-reference.callable.v1',owner.runtimeKey,'constructor',ctor.origin.source,
      String(ctor.origin.start),String(ctor.origin.end),signature].join('\0'));
    const member = sha256(['tsfg.core-reference.member.v1',owner.runtimeKey,'field',field.origin.source,
      String(field.origin.start),String(field.origin.end),field.name].join('\0'));
    const fn = only(all.filter(value => value.attributes.includes('tsfg_core.reference_owner = ' + JSON.stringify(owner.runtimeKey))),name);
    assert.equal(fn.parameters.length,1); assert.equal(fn.parameters[0].type,type);
    for (const [key,value] of [['function_id',callable],['signature_hash',signature],['reference_kind','constructor'],['logical_name','constructor']])
      assert.ok(fn.attributes.includes('tsfg_core.' + key + ' = ' + JSON.stringify(value)));
    const source = data.hir.sources.findIndex(value => value.path === ctor.origin.source); assert.ok(source >= 0);
    for (const [key,value] of [['source_index',source],['function_start',ctor.origin.start],['function_end',ctor.origin.end]])
      assert.ok(fn.attributes.includes('tsfg_core.' + key + ' = ' + value + ' : i64'));
    const descriptor = only(descriptors.filter(value => value.includes('key = ' + JSON.stringify(callable))),name + ' metadata');
    assert.ok(descriptor.includes('phase = ' + JSON.stringify(ctor.initializationPhase)));
    assert.ok(descriptor.includes('initialization = [' + JSON.stringify(member) + ']'));
    assert.ok(descriptor.includes('parameters = [' + JSON.stringify('ref:' + access) + ']'));
    assert.ok(descriptor.includes('result = "none"'));
    const ops = operations(fn.body), sequence = ops.map(value => value.name);
    assert.deepEqual(sequence,name === 'Base' ? ['tsfg_core.fuel','tsfg_core.constant','tsfg_core.ref.field.write','func.return']
      : ['tsfg_core.fuel','tsfg_core.ref.base','func.call','tsfg_core.constant','tsfg_core.ref.field.write','func.return']);
    const constant = only(ops.filter(value => value.name === 'tsfg_core.constant'),name + ' exact initializer');
    assert.deepEqual(constant.operands,[]); assert.equal(constant.result,'f64');
    assert.ok(constant.attributes.includes('value = ' + JSON.stringify(bits))); anchor(constant.attributes,field.initializer.origin);
    const store = only(ops.filter(value => value.name === 'tsfg_core.ref.field.write'),name + ' own store');
    assert.deepEqual(store.operands,[fn.parameters[0].value,constant.value]); assert.deepEqual(store.inputs,[type,'f64']);
    assert.equal(store.result,'()'); assert.ok(store.attributes.includes('initialize = true'));
    assert.ok(store.attributes.includes('field = ' + JSON.stringify(member))); anchor(store.attributes,field.origin);
    const returned = ops[ops.length - 1]; assert.deepEqual(returned.operands,[]); assert.deepEqual(returned.inputs,[]);
    assert.equal(returned.result,'()'); anchor(returned.attributes,ctor.origin);
    if (canonical) assert.deepEqual(roots(fn.attributes),name === 'Base' ? [] : [{block:0,instruction:2,registers:[0,1]}]);
    checked.push({fn,ops,type,signature,callable});
  }
  const [base,derived] = checked, baseView = derived.ops[1], call = derived.ops[2];
  const origin = data.derived.constructor.body[0].expression.origin;
  assert.deepEqual(baseView.operands,[derived.fn.parameters[0].value]); assert.deepEqual(baseView.inputs,[derived.type]);
  assert.equal(baseView.result,base.type); assert.ok(baseView.attributes.includes('class = ' + JSON.stringify(data.base.runtimeKey)));
  anchor(baseView.attributes,data.derived.constructor.body[0].expression.receiver.origin);
  assert.deepEqual(call.operands,[baseView.value]); assert.deepEqual(call.inputs,[base.type]); assert.equal(call.result,'()');
  assert.ok(call.attributes.includes('callee = @"r' + base.callable.slice(7) + '"')
    || call.attributes.includes('callee = @r' + base.callable.slice(7)));
  assert.ok(call.attributes.includes('tsfg_core.function_id = ' + JSON.stringify(base.callable)));
  assert.ok(call.attributes.includes('tsfg_core.signature_hash = ' + JSON.stringify(base.signature))); anchor(call.attributes,origin);
  assert.doesNotMatch(core,/"tsfg_core\.ref\.alloc"|"tsfg_core\.ref\.view"|"tsfg_core\.ref\.call"/);
}

test('actual inherited number fields retain Source initialization boundaries and exact public Core order',async () => {
  const data = await actual(); checkCore(data.core,data);
});
test('real C++ preserves inherited initialization signatures order and complete roots while wire9 rejects references',async () => {
  const data = await actual();
  // The real consumer runs before canonical representation assertions.
  const first = await invokeCore(data.core); accepted(first);
  const roundtrip = await invokeCore(first.stdout); accepted(roundtrip);
  const optimized = await invokeCore(first.stdout,'--optimize'); accepted(optimized);
  assert.deepEqual(roundtrip.stdout,first.stdout); assert.deepEqual(optimized.stdout,first.stdout);
  // Handworked roots: Derived this is needed by the later own-field store;
  // current Base-view call operand is also a root. The later scalar is absent.
  checkCore(first.stdout.toString('utf8'),data,true);
  const wire = await invokeCore(first.stdout,'--emit-bytecode');
  assert.equal(wire.close.code,3,wire.stderr.toString('utf8')); assert.equal(wire.stdout.length,0);
  assert.match(wire.stderr.toString('utf8'),/\[r04-core-reference-unsupported\]/);
});
