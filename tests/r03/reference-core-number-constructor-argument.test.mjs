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
// Handwritten exact f64(5); no host decimal parsing or product helper is an oracle.
const fiveBits = '4014000000000000';
let loaded;
async function actual() {
  if (!loaded) loaded = load();
  return loaded;
}
function underlying(value) {
  while (value.kind === 'ref.view') value = value.value;
  return value;
}
async function load() {
  const [bytes,bindingBytes,main,declaration] = await Promise.all([
    readFile(fixture('construct.facts.json')),readFile(fixture('construct.binding.json')),
    readFile(fixture('construct.source.ts')),readFile(fixture('ancestor-super-method.declaration.d.ts')),
  ]);
  assert.equal(bytes.length,11353); assert.equal(bindingBytes.length,955); assert.equal(main.length,212); assert.equal(declaration.length,362);
  assert.equal(sha256(bytes),'sha256:e0dcbfba0174a9e5f02f36018bde40ddcb9e7afe7ae51450c7d0e3a81a5d82f3');
  assert.equal(sha256(bindingBytes),'sha256:6b0fe5978070e44c3c1fc052d337fca3bb865610c6ea4b5a0afa7fdce0223c37');
  assert.equal(sha256(main),'sha256:da9e9ffdb7c7df29d02698db9fc62f6826c4166f7ba079e8d9b7b53c1f04ffce');
  assert.equal(sha256(declaration),'sha256:d629059f5175a580a8a7b19531c7d8cff1bfa7b61320f6638cf4ee25fbf5a141');
  const binding = JSON.parse(bindingBytes.toString('utf8'));
  /** @type {[string,Buffer,boolean][]} */
  const originals = [['/original/main.ts',main,false],['/original/minimal-scalars-v2.d.ts',declaration,true]];
  assert.equal(binding.sources.length,2);
  for (const [path,content,isDeclaration] of originals) {
    const source = binding.sources.find(value => value.path === path); assert.ok(source);
    assert.equal(source.sha256,sha256(content)); assert.equal(source.utf16Length,content.toString('utf8').length);
    assert.equal(source.declaration,isDeclaration); assert.deepEqual(source.surrogateStarts,[]);
  }
  // These retained official Source4 bytes grant no fresh Source or VM execution credit.
  const facts = decodeReferenceFacts(bytes,binding), owned = buildReferenceHir(facts);
  const persisted = Buffer.from(printReferenceHir(owned)), hir = readReferenceHir(persisted); persisted.fill(0);
  assert.deepEqual(hir,owned); assert.equal(hir.format.version,4);
  assert.equal(hir.format.semanticProfile,'tsfg-owned-class-facts-candidate-v4'); assert.equal(hir.classes.length,2);
  const counter = hir.classes.find(value => value.name === 'Counter'), factory = hir.classes.find(value => value.name === 'Factory');
  assert.ok(counter); assert.ok(factory); assert.notEqual(counter.runtimeKey,factory.runtimeKey);
  assert.equal(counter.constructor.access,'public'); assert.equal(factory.constructor.access,'public');
  const fresh = factory.fields.find(value => value.name === 'fresh'), make = factory.methods.find(value => value.name === 'make');
  assert.ok(fresh); assert.ok(make); assert.equal(fresh.type,counter.instanceType);
  const construct = underlying(fresh.initializer), returned = underlying(make.body[0].expression);
  assert.equal(construct.kind,'ref.construct'); assert.equal(returned.kind,'ref.construct');
  const parameter = counter.constructor.signature.parameters[0]; assert.equal(counter.constructor.signature.parameters.length,1);
  const target = hir.types.find(value => value.id === parameter.type); assert.ok(target);
  assert.equal(target.kind,'number'); assert.equal(target.scalar,'f64');
  for (const expression of [construct,returned]) {
    assert.equal(expression.dispatch,'direct-constructor'); assert.equal(expression.staticTarget,counter.constructor.id);
    assert.equal(expression.type,counter.instanceType); assert.equal(expression.receiver.symbol,counter.symbol);
    assert.equal(expression.receiver.type,counter.constructorType); assert.equal(expression.arguments.length,1);
    assert.equal(expression.resolvedSignature.return,counter.instanceType);
    assert.deepEqual(expression.resolvedSignature.parameters,[parameter]); assert.equal(expression.argumentCompatibility.length,1);
  }
  const literal = construct.arguments[0]; assert.equal(literal.kind,'scalar.literal.unresolved'); assert.equal(literal.token,'5');
  assert.deepEqual(literal.numericLiteral,{state:'unresolved',officialType:literal.type,defaultScalar:'i32',contextType:parameter.type});
  assert.deepEqual(literal.origin,{source:'/original/main.ts',start:147,end:148});
  assert.deepEqual(construct.argumentCompatibility,[{assignable:true,members:[],origin:literal.origin,
    sourceType:literal.type,targetType:parameter.type}]);
  const text = main.toString('utf8'); assert.equal(text.slice(literal.origin.start,literal.origin.end),'5');
  assert.equal(text.slice(construct.origin.start,construct.origin.end),'new Counter(5)');
  assert.equal(text.slice(parameter.origin.start,parameter.origin.end),'seed: number');
  const seed = make.signature.parameters[0]; assert.equal(make.signature.parameters.length,1); assert.equal(seed.type,parameter.type);
  assert.equal(returned.arguments[0].kind,'ref.parameter'); assert.equal(returned.arguments[0].symbol,seed.symbol);
  assert.equal(returned.arguments[0].type,parameter.type);
  assert.deepEqual(returned.argumentCompatibility,[{assignable:true,members:[],origin:returned.arguments[0].origin,
    sourceType:parameter.type,targetType:parameter.type}]);
  return {hir,counter,factory,fresh,make,construct,returned,literal};
}
function only(values,label) { assert.equal(values.length,1,label); return values[0]; }
const parameterPattern = /(%[A-Za-z0-9_]+):\s*(!tsfg_core\.ref<"[^"]+">|f64)/g;
function functions(core) {
  const emitted = [...core.matchAll(/^  func\.func ([^\n]+)\n([\s\S]*?)^  \}/gm)]
    .map(([,header,body]) => ({attributes:header,body,parameters:[...header.matchAll(parameterPattern)].map(([,value,type]) => ({value,type}))}));
  if (emitted.length) return emitted;
  return [...core.matchAll(/^  "func\.func"\(\) <\{function_type = \(([^\n]*)\) -> (.*?), sym_name = "[^"]+"\}> \(\{\n  \^bb0\(([^\n]*)\):\n([\s\S]*?)^  \}\) \{([^\n]*)\} : \(\) -> \(\)$/gm)]
    .map(([,inputs,,parameters,body,attributes]) => {
      const parsed = [...parameters.matchAll(parameterPattern)].map(([,value,type]) => ({value,type}));
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
function reference(owner) { return '!tsfg_core.ref<' + JSON.stringify(sha256('tsfg.core-reference.access.v1\0' + owner.runtimeKey)) + '>'; }
function callable(all,owner,name) {
  return only(all.filter(value => value.attributes.includes('tsfg_core.reference_owner = ' + JSON.stringify(owner.runtimeKey))
    && value.attributes.includes('tsfg_core.logical_name = ' + JSON.stringify(name))),owner.name + '.' + name);
}
function objectSource(value,ops) {
  const views = new Map(ops.filter(op => op.name === 'tsfg_core.ref.view').map(op => [op.value,op.operands[0]])), seen = new Set();
  while (views.has(value)) { assert.ok(!seen.has(value)); seen.add(value); value = views.get(value); }
  return value;
}
// Narrow canonical attribute reader. Expected roots are hand worked below;
// no liveness analysis or production helper is used to generate an expectation.
function roots(attributes) {
  const key = 'tsfg_core.reference_roots = ', at = attributes.indexOf(key); assert.ok(at >= 0);
  const start = at + key.length; assert.equal(attributes[start],'['); let depth = 0, end = -1;
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
  const all = functions(core); assert.equal(all.length,3);
  const counterType = reference(data.counter), factoryType = reference(data.factory);
  const target = callable(all,data.counter,'constructor'); assert.deepEqual(target.parameters.map(value => value.type),[counterType,'f64']);
  const signature = sha256('tsfg.core-reference.signature.v1\0(ref:' + counterType.match(/<"([^"]+)">/)[1] + ',f64)->none');
  const ctor = data.counter.constructor;
  const key = sha256(['tsfg.core-reference.callable.v1',data.counter.runtimeKey,'constructor',ctor.origin.source,
    String(ctor.origin.start),String(ctor.origin.end),signature].join('\0'));
  assert.ok(target.attributes.includes('tsfg_core.function_id = ' + JSON.stringify(key)));
  assert.ok(target.attributes.includes('tsfg_core.signature_hash = ' + JSON.stringify(signature)));
  for (const name of ['constructor','make']) {
    const fn = callable(all,data.factory,name), ops = operations(fn.body), expression = name === 'constructor' ? data.construct : data.returned;
    assert.deepEqual(fn.parameters.map(value => value.type),name === 'constructor' ? [factoryType] : [factoryType,'f64']);
    const allocation = only(ops.filter(value => value.name === 'tsfg_core.ref.alloc'),name + ' allocation');
    assert.deepEqual(allocation.operands,[]); assert.equal(allocation.result,counterType);
    assert.ok(allocation.attributes.includes('class = ' + JSON.stringify(data.counter.runtimeKey))); anchor(allocation.attributes,expression.origin);
    const call = only(ops.filter(value => value.name === 'func.call'),name + ' explicit ctor call');
    assert.equal(call.result,'()'); assert.deepEqual(call.inputs,[counterType,'f64']);
    assert.equal(call.operands[0],allocation.value); assert.ok(ops.indexOf(allocation) < ops.indexOf(call));
    assert.ok(call.attributes.includes('tsfg_core.function_id = ' + JSON.stringify(key)));
    assert.ok(call.attributes.includes('tsfg_core.signature_hash = ' + JSON.stringify(signature))); anchor(call.attributes,expression.origin);
    if (name === 'constructor') {
      const constant = only(ops.filter(value => value.name === 'tsfg_core.constant'),'literal constructor argument');
      assert.deepEqual(constant.operands,[]); assert.equal(constant.result,'f64');
      assert.ok(constant.attributes.includes('value = ' + JSON.stringify(fiveBits))); anchor(constant.attributes,data.literal.origin);
      assert.ok(ops.indexOf(constant) < ops.indexOf(allocation),'argument evaluation precedes allocation and ctor call');
      assert.equal(call.operands[1],constant.value);
      const store = only(ops.filter(value => value.name === 'tsfg_core.ref.field.write'),'fresh reference field store');
      assert.ok(ops.indexOf(call) < ops.indexOf(store)); assert.equal(store.operands[0],fn.parameters[0].value);
      assert.equal(objectSource(store.operands[1],ops),allocation.value,'fresh stores the same allocated object through any checked views');
      assert.deepEqual(store.inputs,[factoryType,counterType]); assert.ok(store.attributes.includes('initialize = true')); anchor(store.attributes,data.fresh.origin);
      const fieldKey = sha256(['tsfg.core-reference.member.v1',data.factory.runtimeKey,'field',data.fresh.origin.source,
        String(data.fresh.origin.start),String(data.fresh.origin.end),data.fresh.name].join('\0'));
      assert.ok(store.attributes.includes('field = ' + JSON.stringify(fieldKey)));
      if (canonical) assert.deepEqual(roots(fn.attributes),[
        {block:0,instruction:2,registers:[0]},{block:0,instruction:3,registers:[0,2]},
      ]);
    } else {
      assert.equal(ops.filter(value => value.name === 'tsfg_core.constant').length,0,'typed seed argument remains its original scalar SSA');
      assert.equal(call.operands[1],fn.parameters[1].value);
      const returned = only(ops.filter(value => value.name === 'func.return'),'make return');
      assert.ok(ops.indexOf(call) < ops.indexOf(returned)); assert.deepEqual(returned.inputs,[counterType]);
      assert.equal(objectSource(only(returned.operands,'returned object'),ops),allocation.value);
      if (canonical) assert.deepEqual(roots(fn.attributes),[
        {block:0,instruction:1,registers:[]},{block:0,instruction:2,registers:[2]},
      ]);
    }
  }
  if (canonical) assert.deepEqual(roots(target.attributes),[]);
}

test('actual construct Source retains literal and typed number argument signatures witnesses and cold HIR',async () => {
  await actual();
});
test('public Core and real C++ preserve exact constructor arguments object identity and safepoint roots',async () => {
  const data = await actual();
  // Initial RED must stop at the real public entry; no C++ call precedes it.
  const core = lowerHir(data.hir); checkCore(core,data);
  const first = await invokeCore(core); accepted(first);
  const roundtrip = await invokeCore(first.stdout); accepted(roundtrip);
  const optimized = await invokeCore(first.stdout,'--optimize'); accepted(optimized);
  assert.deepEqual(roundtrip.stdout,first.stdout); assert.deepEqual(optimized.stdout,first.stdout);
  checkCore(first.stdout.toString('utf8'),data,true);
  assert.equal(core,lowerHir(readReferenceHir(Buffer.from(printReferenceHir(data.hir)))));
  const wire = await invokeCore(first.stdout,'--emit-bytecode');
  assert.equal(wire.close.code,3,wire.stderr.toString('utf8')); assert.equal(wire.stdout.length,0);
  assert.match(wire.stderr.toString('utf8'),/\[r04-core-reference-unsupported\]/);
});
