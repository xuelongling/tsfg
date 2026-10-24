// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {canonical,sha256} from '../../compiler/identity.mjs';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {typedArrayStringUnits} from '../../compiler/typed-array-literals.mjs';
import {optionalPropertyProfile} from '../../compiler/optional-property-profile.mjs';
import {optionalPropertyFactsFormat,optionalPropertyHirFormat,readOptionalPropertyFacts,writeOptionalPropertyFacts,
  buildOptionalPropertyHir,verifyOptionalPropertyHir,readOptionalPropertyHir,writeOptionalPropertyHir} from '../../compiler/optional-property-hir.mjs';
const bytes=await readFile(new URL('./testdata/optional-property-v1/source-package.json',import.meta.url));
const original=JSON.parse(bytes.toString());
const context=()=>({family:'tsfg.optional-property-facts-context-candidate',version:1,factsBytes:Buffer.from(bytes),expectedPackageId:original.packageId});
const field=(packet,type,name)=>packet.payload.types.find(row=>row.name===type).fields.find(row=>row.name===name);
const type=(hir,name)=>hir.types.find(row=>row.sourceType===name||Object.hasOwn({Maybe:6,Missing:45,Present:74},name)
  &&row.origin?.nameRange.start===({Maybe:6,Missing:45,Present:74}[name]));
const clone=()=>structuredClone(original);
function reseal(packet){packet.packageId=sha256('tsfg.optional-property-facts.package.v1\0'+packet.schemaHash+'\0'+canonical(packet.payload));return packet;}
function rejected(change){const packet=clone();change(packet);reseal(packet);assert.throws(()=>writeOptionalPropertyFacts(packet));}

test('the complete selected packet becomes owned typed HIR and canonical roundtrips',()=>{
  const packet=readOptionalPropertyFacts(bytes);
  assert.deepEqual({family:packet.family,version:packet.version,schemaHash:packet.schemaHash},optionalPropertyFactsFormat);
  assert.equal(writeOptionalPropertyFacts(packet).toString(),bytes.toString());
  const result=buildOptionalPropertyHir(packet,context());assert.equal(result.status,'ok',JSON.stringify(result.diagnostics));
  const hir=result.hir;assert.deepEqual(hir.format,optionalPropertyHirFormat);
  assert.equal(hir.sources.length,2);assert.equal(hir.sources[0].content.length,307);
  assert.equal(hir.types.length,packet.payload.types.length);assert.equal(hir.functions.length,2);
  assert.deepEqual(hir.exports.map(row=>row.name),['run']);
  assert.deepEqual(hir.functions.map(row=>row.range),[{start:128,end:218},{start:219,end:306}]);
  const maybe=type(hir,'Maybe'),missing=type(hir,'Missing'),present=type(hir,'Present');
  const maybeValue=maybe.fields.find(row=>row.name==='value'),presentValue=present.fields.find(row=>row.name==='value');
  const union=type(hir,'union<i32,undefined>'),i32=type(hir,'i32');
  assert.deepEqual(maybeValue.propertyPresence,{optional:true,declaredType:i32.id,questionTokenRange:{start:30,end:31}});
  assert.equal(maybeValue.type,union.id);
  assert.deepEqual(presentValue.propertyPresence,{optional:false,declaredType:union.id,questionTokenRange:null});
  assert.deepEqual(missing.fields.map(row=>row.name),['tag']);
  assert.equal(maybe.construction.initialization.find(row=>row.field===maybeValue.id).kind,'fieldDefine');
  const inspect=hir.functions[0],condition=inspect.body[0].condition;
  assert.equal(condition.kind,'propertyPresenceTest');assert.equal(condition.semantics,'prototype-aware');
  assert.equal(condition.property,maybeValue.id);assert.equal(condition.type,type(hir,'bool').id);
  assert.deepEqual(condition.range,{start:166,end:178});assert.deepEqual(condition.left.range,{start:166,end:173});
  assert.deepEqual(condition.right.range,{start:177,end:178});assert.deepEqual(condition.operatorRange,{start:174,end:176});
  assert.deepEqual(condition.left.codeUnits,[118,97,108,117,101]);assert.equal(condition.right.binding,inspect.parameters[0].id);
  const coalesce=inspect.body[0].then[0].value;assert.equal(coalesce.operator,'??');assert.equal(coalesce.left.type,union.id);
  assert.equal(coalesce.left.declaredType,union.id);assert.equal(coalesce.left.property,maybeValue.id);
  assert.deepEqual(coalesce.left.range,{start:189,end:196});assert.equal(coalesce.right.decimal,'7');
  assert.equal(inspect.body[1].value.decimal,'3');
  const sum=hir.functions[1].body[0].value;
  assert.equal(sum.operator,'+');assert.equal(sum.left.target,inspect.id);assert.equal(sum.right.target,inspect.id);
  assert.equal(sum.left.arguments[0].target,missing.id);assert.equal(sum.right.arguments[0].target,present.id);
  assert.deepEqual(sum.left.arguments[0].range,{start:264,end:277});assert.deepEqual(sum.right.arguments[0].range,{start:289,end:302});
  const [absence,presence]=hir.compatibilityWitnesses;
  assert.deepEqual(absence.missingOptionalProperties,[maybeValue.id]);assert.equal(absence.compatibility.members.length,1);
  assert.deepEqual(presence.missingOptionalProperties,[]);assert.equal(presence.compatibility.members.length,2);
  assert.equal(presence.compatibility.members.find(row=>row.target===maybeValue.id).source,presentValue.id);
  assert.deepEqual(verifyOptionalPropertyHir(hir,context()),hir);
  const printed=writeOptionalPropertyHir(hir,context());assert.equal(printed.toString(),canonical(hir)+'\n');
  assert.equal(printed.length,24733);
  assert.equal(sha256(printed),'sha256:ddb62103bf9a21c766b781b1eebca627675822acf046d299e61096b6d13c4c6a');
  assert.deepEqual(readOptionalPropertyHir(printed,context()),hir);
  assert.ok(Object.isFrozen(hir)&&Object.isFrozen(maybeValue.propertyPresence));
  assert.throws(()=>readTypedArrayFacts(bytes));
});

const mutations={
  'selected family':p=>{p.family='tsfg.array-facts-package-candidate';},
  'selected version':p=>{p.version=8;},
  'selected schema':p=>{p.schemaHash='sha256:'+'0'.repeat(64);},
  'request identity':p=>{p.requestId='sha256:'+'0'.repeat(64);},
  'optional flag':p=>{field(p,'Maybe','value').propertyPresence.optional=false;},
  'optional declared type':p=>{field(p,'Maybe','value').propertyPresence.declaredType='union<i32,undefined>';},
  'question anchor':p=>{field(p,'Maybe','value').propertyPresence.questionTokenRange={start:29,end:30};},
  'required question':p=>{field(p,'Present','value').propertyPresence.questionTokenRange={start:30,end:31};},
  'field identity':p=>{field(p,'Maybe','value').id=field(p,'Present','value').id;},
  'field source anchor':p=>{field(p,'Maybe','value').origin.start=24;},
  'presence field':p=>{p.payload.functions[0].body[0].condition.property=field(p,'Maybe','tag').id;},
  'presence operator':p=>{p.payload.functions[0].body[0].condition.operator='===';},
  'presence operand':p=>{p.payload.functions[0].body[0].condition.right=p.payload.functions[0].body[0].condition.left;},
  'presence key':p=>{p.payload.functions[0].body[0].condition.left.codeUnits=[116,97,103];},
  'presence result':p=>{p.payload.functions[0].body[0].condition.type='i32';},
  'read type':p=>{p.payload.functions[0].body[0].then[0].value.left.type='i32';},
  'flow type':p=>{p.payload.functions[0].body[0].then[0].value.left.flowType='string';},
  'constructor fields':p=>{p.payload.types.find(row=>row.name==='Maybe').construction.initializationFields.pop();},
  'missing witness removed':p=>{p.payload.compatibilityWitnesses[0].missingOptionalProperties=[];},
  'missing witness wrong field':p=>{p.payload.compatibilityWitnesses[0].missingOptionalProperties=[field(p,'Maybe','tag').id];},
  'false absence on present':p=>{p.payload.compatibilityWitnesses[1].missingOptionalProperties=[field(p,'Maybe','value').id];},
  'mapping target lost':p=>{p.payload.compatibilityWitnesses[1].compatibility.members.pop();},
  'mapping source wrong':p=>{p.payload.compatibilityWitnesses[1].compatibility.members[0].source=field(p,'Present','tag').id;},
  'unknown selected field':p=>{field(p,'Maybe','value').absent=true;},
};
for(const [name,change] of Object.entries(mutations))test('resealed facts reject '+name,()=>rejected(change));

test('context, ownership and whole HIR mutations fail before publication',()=>{
  const packet=readOptionalPropertyFacts(bytes),hir=buildOptionalPropertyHir(packet,context()).hir;
  const wrong=context();wrong.expectedPackageId='sha256:'+'0'.repeat(64);
  assert.equal(buildOptionalPropertyHir(packet,wrong).status,'error');
  let touched=0;const accessor=context();Object.defineProperty(accessor,'family',{enumerable:true,get(){touched++;return 'x';}});
  assert.equal(buildOptionalPropertyHir(packet,accessor).status,'error');assert.equal(touched,0);
  assert.equal(buildOptionalPropertyHir(packet,new Proxy(context(),{})).status,'error');
  assert.equal(buildOptionalPropertyHir(packet,vm.runInNewContext('({family:"x"})')).status,'error');
  for(const mutate of [h=>{h.types[0].kind='bogus';},h=>{h.functions[0].body[0].condition.property='wrong';},
    h=>{h.format.contractVersion='0.16.0';},h=>{h.format.schemaHash='sha256:'+'0'.repeat(64);},
    h=>{h.functions[0].body[0].then[0].value.left.type=type(h,'i32').id;},h=>{h.compatibilityWitnesses[0].missingOptionalProperties=[];}]){
    const copy=structuredClone(hir);mutate(copy);assert.throws(()=>verifyOptionalPropertyHir(copy,context()));
    assert.throws(()=>writeOptionalPropertyHir(copy,context()));
  }
  const mutable=structuredClone(packet),built=buildOptionalPropertyHir(mutable,context()).hir;
  mutable.payload.functions.length=0;assert.equal(built.functions.length,2);
  const c=context(),bound=buildOptionalPropertyHir(packet,c).hir;c.factsBytes.fill(0);assert.equal(bound.functions.length,2);
});

test('canonical and bounded selected readers reject malformed inputs',()=>{
  for(const text of [bytes.toString().trim(),bytes.toString()+'\n',bytes.toString().replace('{','{"family":"duplicate",')])
    assert.throws(()=>readOptionalPropertyFacts(Buffer.from(text)));
  assert.throws(()=>readOptionalPropertyFacts(Buffer.alloc(2097153)));
  const deep={};let cursor=deep;for(let n=0;n<65;n++)cursor=cursor.child={};assert.throws(()=>writeOptionalPropertyFacts(deep));
  let touched=0;const getter={get payload(){touched++;return {};}};assert.throws(()=>writeOptionalPropertyFacts(getter));assert.equal(touched,0);
  assert.throws(()=>writeOptionalPropertyFacts(new Proxy(original,{})));
  assert.throws(()=>writeOptionalPropertyFacts(vm.runInNewContext('({})')));
  const bad=clone();bad.packageId='sha256:'+'0'.repeat(64);assert.throws(()=>writeOptionalPropertyFacts(bad));
  const wrong=context();wrong.expectedPackageId='sha256:'+'0'.repeat(64);
  assert.throws(()=>readOptionalPropertyHir(Buffer.alloc(2097153),wrong),{code:'r03-typed-array-context'});
  let hirTouched=0;const hirGetter={get body(){hirTouched++;return [];}};
  assert.throws(()=>verifyOptionalPropertyHir(hirGetter,wrong));assert.equal(hirTouched,0);
});

test('selected presence token decoder preserves escaped UTF16 without evaluating source',()=>{
  assert.deepEqual(typedArrayStringUnits('"\\u0076\\x61lue"'),[118,97,108,117,101]);
  assert.deepEqual(typedArrayStringUnits("'\\u{1f680}\\ud800\\0'"),[0xd83d,0xde80,0xd800,0]);
  assert.deepEqual(typedArrayStringUnits('"va\\\nlue"'),[118,97,108,117,101]);
  for(const token of ['"\\u{110000}"','"\\x0"','"\\1"','"\\01"','"line\nfeed"'])assert.throws(()=>typedArrayStringUnits(token));
});

// Controlled semantic-seam transformations of the frozen actual packet. These
// are not new Source outputs or evidence of a new official Source execution.
function declarationSeam(spelling,declared='i32',kind=undefined) {
  const packet=clone(),owner=packet.payload.types.find(row=>row.name==='Maybe');
  const value=owner.fields.find(row=>row.name==='value');owner.fields=[value];
  const content='class Maybe { value?:'+spelling+'; }\n'+(spelling==='N'?'type N=i32;\n':'');
  const start=content.indexOf('value'),nameRange={start,end:start+5};
  value.id=sha256('tsfg.array-facts.field.v8\0'+canonical({sourcePath:owner.sourcePath,nameRange}));
  value.origin={source:owner.sourcePath,start,end:content.indexOf(';')+1};
  value.propertyPresence={optional:true,declaredType:declared,questionTokenRange:{start:start+5,end:start+6}};
  const catalogue=packet.payload.types.filter(row=>!['reference','value'].includes(row.kind));
  if(kind==='array')catalogue.push({id:declared,kind:'array',elementType:'i32'});
  if(declared==='f64')catalogue.push({...catalogue.find(row=>row.id==='i32'),id:'f64',name:'f64'});
  const members=[declared,'undefined'].sort();value.type='union<'+members.join(',')+'>';
  if(!catalogue.some(row=>row.id===value.type))catalogue.push({id:value.type,kind:'union',members});
  catalogue.push(owner);
  return {payload:packet.payload,sources:new Map([[owner.sourcePath,{content}]]),types:new Map(catalogue.map(row=>[row.id,row]))};
}
for(const [spelling,declared,kind] of [['N','i32',undefined],['Array<i32>','array<i32>','array'],['number','f64',undefined]])
  test('controlled declaration seam accepts Source-supported spelling '+spelling,()=>{
    const data=declarationSeam(spelling,declared,kind);
    optionalPropertyProfile.createValidation().validateFields(data.payload,data.sources,data.types);
  });

test('controlled presence seam preserves value nominal receiver and field identity',()=>{
  const packet=clone(),owner=packet.payload.types.find(row=>row.name==='Maybe');owner.kind='value';
  const types=new Map(packet.payload.types.map(row=>[row.id,row]));
  const source=packet.payload.files[0].content,condition=packet.payload.functions[0].body[0].condition;
  optionalPropertyProfile.createValidation().validateExpression(condition,types,source);
  const changed=structuredClone(condition);changed.property=owner.fields.find(row=>row.name==='tag').id;
  assert.throws(()=>optionalPropertyProfile.createValidation().validateExpression(changed,types,source));
});

test('controlled nominal chain permits 64 base edges and rejects 65 or a cycle',()=>{
  const packet=clone(),owner=packet.payload.types.find(row=>row.name==='Maybe');
  const types=new Map(packet.payload.types.map(row=>[row.id,row]));let previous=owner.id;
  for(let index=1;index<=65;index++) {
    const id='controlled-derived-'+index;types.set(id,{id,kind:'reference',fields:[],base:previous});previous=id;
  }
  const source=packet.payload.files[0].content,condition=packet.payload.functions[0].body[0].condition;
  condition.right.flowType='controlled-derived-64';
  optionalPropertyProfile.createValidation().validateExpression(condition,types,source);
  const read=packet.payload.functions[0].body[0].then[0].value.left;read.receiver.flowType='controlled-derived-64';
  optionalPropertyProfile.createValidation().validateExpression(read,types,source);
  condition.right.flowType='controlled-derived-65';
  assert.throws(()=>optionalPropertyProfile.createValidation().validateExpression(condition,types,source));
  owner.base='controlled-derived-64';condition.right.flowType='controlled-derived-64';
  assert.throws(()=>optionalPropertyProfile.createValidation().validateExpression(condition,types,source));
});
