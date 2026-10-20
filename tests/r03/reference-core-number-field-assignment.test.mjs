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
// Fixed exact f64(2), independent of floatBits and host numeric parsing.
const assignmentBits = '4000000000000000';
let loaded;
async function actual() {
  if (!loaded) loaded = load();
  return loaded;
}
async function load() {
  const [bytes,bindingBytes,main,declaration] = await Promise.all([
    readFile(fixture('readonly.facts.json')),readFile(fixture('readonly.binding.json')),
    readFile(fixture('readonly.source.ts')),readFile(fixture('ancestor-super-method.declaration.d.ts')),
  ]);
  assert.equal(bytes.length,20369); assert.equal(bindingBytes.length,955); assert.equal(main.length,473); assert.equal(declaration.length,362);
  assert.equal(sha256(bytes),'sha256:f666c821e48ad8dbe0d094b55ccc9871924a37a0754a3a3b55e6606ab5d48028');
  assert.equal(sha256(bindingBytes),'sha256:5e68eb9f5bcd41da79fff05f13e0c820b8db8f705549c5ed3c1505de5d81032e');
  assert.equal(sha256(main),'sha256:b98cb3ba62f29e3cd16ccd71574a3e34a1a9a62f625ff79c4c1adb23916575b0');
  assert.equal(sha256(declaration),'sha256:d629059f5175a580a8a7b19531c7d8cff1bfa7b61320f6638cf4ee25fbf5a141');
  const binding = JSON.parse(bindingBytes.toString('utf8'));
  /** @type {[string,Buffer,boolean][]} */
  const originals = [['/original/main.ts',main,false],['/original/minimal-scalars-v2.d.ts',declaration,true]];
  assert.equal(binding.sources.length,2);
  for (const [path,content,isDeclaration] of originals) {
    const record = binding.sources.find(value => value.path === path); assert.ok(record);
    assert.equal(record.sha256,sha256(content)); assert.equal(record.utf16Length,content.toString('utf8').length);
    assert.equal(record.declaration,isDeclaration); assert.deepEqual(record.surrogateStarts,[]);
  }
  // This is retained official Source4 output, not a new Source execution.
  const facts = decodeReferenceFacts(bytes,binding), owned = buildReferenceHir(facts);
  const persisted = Buffer.from(printReferenceHir(owned)), hir = readReferenceHir(persisted); persisted.fill(0);
  assert.deepEqual(hir,owned); assert.equal(hir.format.version,5);
  assert.equal(hir.format.semanticProfile,'tsfg-owned-class-facts-candidate-v5'); assert.equal(hir.classes.length,3);
  const readView = hir.classes.find(value => value.name === 'ReadView'), mutable = hir.classes.find(value => value.name === 'Mutable');
  const holder = hir.classes.find(value => value.name === 'Holder'); assert.ok(readView); assert.ok(mutable); assert.ok(holder);
  const targetField = readView.fields.find(value => value.name === 'value'), sourceField = mutable.fields.find(value => value.name === 'value');
  const holderField = holder.fields.find(value => value.name === 'view'); assert.ok(targetField); assert.ok(sourceField); assert.ok(holderField);
  assert.equal(targetField.ordinal,0); assert.equal(targetField.readonly,true);
  assert.equal(sourceField.ordinal,1); assert.equal(sourceField.readonly,false);
  assert.equal(mutable.fields[0].name,'padding'); assert.equal(holderField.type,readView.instanceType);
  const ctor = holder.constructor; assert.equal(ctor.access,'public'); assert.equal(ctor.signature.parameters.length,1);
  const parameter = ctor.signature.parameters[0]; assert.equal(parameter.type,mutable.instanceType); assert.equal(ctor.body.length,2);
  const saved = ctor.body[0].expression, write = ctor.body[1].expression, literal = write.right;
  assert.equal(saved.kind,'ref.field.write'); assert.equal(saved.left.symbol,holderField.symbol);
  assert.equal(saved.right.kind,'ref.view'); assert.equal(saved.right.value.kind,'ref.parameter');
  assert.equal(saved.right.value.symbol,parameter.symbol);
  assert.equal(saved.right.sourceType,mutable.instanceType); assert.equal(saved.right.targetType,readView.instanceType);
  assert.deepEqual(saved.right.members,[{source:sourceField.symbol,target:targetField.symbol}]);
  assert.equal(write.kind,'ref.field.write'); assert.equal(write.left.kind,'ref.field.location');
  assert.equal(write.left.symbol,sourceField.symbol); assert.equal(write.left.receiver.kind,'ref.parameter');
  assert.equal(write.left.receiver.symbol,parameter.symbol); assert.equal(write.left.type,sourceField.type);
  const type = hir.types.find(value => value.id === sourceField.type); assert.ok(type); assert.equal(type.kind,'number'); assert.equal(type.scalar,'f64');
  assert.equal(literal.kind,'scalar.literal.unresolved'); assert.equal(literal.token,'2'); assert.equal(write.type,literal.type);
  assert.deepEqual(literal.numericLiteral,{state:'unresolved',officialType:literal.type,defaultScalar:'i32',contextType:sourceField.type});
  assert.deepEqual(write.compatibility,{assignable:true,members:[],origin:literal.origin,sourceType:literal.type,targetType:sourceField.type});
  assert.deepEqual(literal.origin,{source:'/original/main.ts',start:298,end:299});
  assert.equal(main.toString('utf8').slice(literal.origin.start,literal.origin.end),'2');
  assert.equal(main.toString('utf8').slice(write.origin.start,write.origin.end),'source.value = 2');
  assert.equal(main.toString('utf8').slice(write.left.receiver.origin.start,write.left.receiver.origin.end),'source');
  const original = facts.graph.classes.find(value => value.name === 'Holder'); assert.ok(original);
  assert.deepEqual(literal.origin,original.constructor.body[1].expression.right.origin);
  assert.deepEqual(write.compatibility,original.constructor.body[1].expression.compatibility);
  return {hir,readView,mutable,holder,targetField,sourceField,holderField,saved,write,literal};
}
function only(values,label) { assert.equal(values.length,1,label); return values[0]; }
const parameterPattern = /(%[A-Za-z0-9_]+):\s*(!tsfg_core\.ref<"[^"]+">|f64|i1)/g;
// These narrow readers consume public Core text, without importing lowering,
// dispatch, numerical conversion or verifier helpers.
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
function member(owner,field) {
  return sha256(['tsfg.core-reference.member.v1',owner.runtimeKey,'field',field.origin.source,
    String(field.origin.start),String(field.origin.end),field.name].join('\0'));
}
function reference(owner) { return '!tsfg_core.ref<' + JSON.stringify(sha256('tsfg.core-reference.access.v1\0' + owner.runtimeKey)) + '>'; }
function checkCore(core,data) {
  const all = functions(core); assert.equal(all.length,7);
  const fn = only(all.filter(value => value.attributes.includes('tsfg_core.reference_owner = ' + JSON.stringify(data.holder.runtimeKey))
    && value.attributes.includes('tsfg_core.logical_name = "constructor"')),'actual Holder constructor');
  const holderType = reference(data.holder), mutableType = reference(data.mutable), viewType = reference(data.readView);
  assert.deepEqual(fn.parameters.map(value => value.type),[holderType,mutableType]);
  const access = type => 'ref:' + type.match(/<"([^"]+)">/)[1];
  const signature = sha256('tsfg.core-reference.signature.v1\0(' + [access(holderType),access(mutableType)].join(',') + ')->none');
  assert.ok(fn.attributes.includes('tsfg_core.signature_hash = ' + JSON.stringify(signature)));
  assert.ok(fn.attributes.includes('tsfg_core.function_start = ' + data.holder.constructor.origin.start + ' : i64'));
  assert.ok(fn.attributes.includes('tsfg_core.function_end = ' + data.holder.constructor.origin.end + ' : i64'));
  const ops = operations(fn.body);
  assert.deepEqual(ops.map(value => value.name),['tsfg_core.fuel','tsfg_core.ref.view','tsfg_core.ref.field.write',
    'tsfg_core.constant','tsfg_core.ref.field.write','func.return']);
  const [self,source] = fn.parameters, view = ops[1], saved = ops[2], constant = ops[3], written = ops[4];
  assert.deepEqual(view.operands,[source.value]); assert.deepEqual(view.inputs,[mutableType]); assert.equal(view.result,viewType);
  const sourceKey = member(data.mutable,data.sourceField), targetKey = member(data.readView,data.targetField);
  const views = [...core.matchAll(/\{key = "[^"]+", members = \[([^\]]*)\], source = "(ref:[^"]+)", target = "(ref:[^"]+)"\}/g)];
  const projection = only(views.filter(value => value[2] === access(mutableType) && value[3] === access(viewType)),
    'actual cross-layout Mutable-to-ReadView projection');
  assert.equal(projection[1],'{source = ' + JSON.stringify(sourceKey) + ', target = ' + JSON.stringify(targetKey) + '}');
  assert.ok(view.attributes.includes('view = ' + views.indexOf(projection) + ' : i64')); anchor(view.attributes,data.saved.right.origin);
  assert.deepEqual(saved.operands,[self.value,view.value]); assert.deepEqual(saved.inputs,[holderType,viewType]);
  assert.ok(saved.attributes.includes('field = ' + JSON.stringify(member(data.holder,data.holderField))));
  assert.ok(saved.attributes.includes('initialize = false')); anchor(saved.attributes,data.saved.origin);
  assert.deepEqual(constant.operands,[]); assert.equal(constant.result,'f64');
  assert.ok(constant.attributes.includes('value = ' + JSON.stringify(assignmentBits))); anchor(constant.attributes,data.literal.origin);
  // The writable alias remains the original Mutable parameter, never the saved
  // ReadView SSA. This verifies representation, not an executed value of two.
  assert.deepEqual(written.operands,[source.value,constant.value]); assert.deepEqual(written.inputs,[mutableType,'f64']);
  assert.ok(written.attributes.includes('field = ' + JSON.stringify(sourceKey)));
  assert.ok(written.attributes.includes('initialize = false')); assert.equal(written.result,'()'); anchor(written.attributes,data.write.origin);
  assert.deepEqual(ops[5].operands,[]); assert.equal(ops[5].result,'()');
  const read = only(all.filter(value => value.attributes.includes('tsfg_core.reference_owner = ' + JSON.stringify(data.holder.runtimeKey))
    && value.attributes.includes('tsfg_core.logical_name = "read"')),'actual readonly read method');
  const reads = operations(read.body).filter(value => value.name === 'tsfg_core.ref.field.read'); assert.equal(reads.length,2);
  assert.deepEqual(reads[0].operands,[read.parameters[0].value]); assert.equal(reads[0].result,viewType);
  assert.ok(reads[0].attributes.includes('field = ' + JSON.stringify(member(data.holder,data.holderField))));
  assert.deepEqual(reads[1].operands,[reads[0].value]); assert.deepEqual(reads[1].inputs,[viewType]); assert.equal(reads[1].result,'f64');
  assert.ok(reads[1].attributes.includes('field = ' + JSON.stringify(targetKey)));
  assert.doesNotMatch(core,/"tsfg_core\.ref\.alloc"/,'this actual alias/view fixture never allocates a second object');
}

test('actual readonly source retains its direct number assignment context witness and cross-layout view in cold HIR',async () => {
  await actual();
});
test('public lower and real C++ preserve exact number field assignment through the original writable alias',async () => {
  const data = await actual();
  // First product action: the initial RED is the actual unresolved-literal
  // capability refusal. C++ is reached only after this public entry succeeds.
  const core = lowerHir(data.hir);
  checkCore(core,data);
  const first = await invokeCore(core); accepted(first);
  const roundtrip = await invokeCore(first.stdout); accepted(roundtrip);
  const optimized = await invokeCore(first.stdout,'--optimize'); accepted(optimized);
  assert.deepEqual(roundtrip.stdout,first.stdout); assert.deepEqual(optimized.stdout,first.stdout);
  checkCore(first.stdout.toString('utf8'),data);
  assert.equal(core,lowerHir(readReferenceHir(Buffer.from(printReferenceHir(data.hir)))));
  const wire = await invokeCore(first.stdout,'--emit-bytecode');
  assert.equal(wire.close.code,3,wire.stderr.toString('utf8')); assert.equal(wire.stdout.length,0);
  assert.match(wire.stderr.toString('utf8'),/\[r04-core-reference-unsupported\]/);
});
