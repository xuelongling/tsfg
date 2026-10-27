// SPDX-License-Identifier: MIT
// Positive packets/requests are complete, unmodified actual Go producer bytes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonical,sha256} from '../../compiler/identity.mjs';
import {originId} from '../../compiler/typed-array-schema.mjs';
import {readSystemQueryFacts,printSystemQueryFacts,systemQueryFactsFormat} from '../../compiler/system-query-facts.mjs';

const fixture=name=>{
  const bytes=readFileSync(new URL('./testdata/system-query/'+name+'-facts.json',import.meta.url));
  const requestBytes=readFileSync(new URL('./testdata/system-query/'+name+'-request.json',import.meta.url));
  const packet=JSON.parse(bytes.toString());
  return {bytes,packet,context:{family:'tsfg.system-query-context-candidate',version:1,requestBytes,expectedPackageId:packet.packageId}};
};
const actual=fixture('architecture');
const query=facts=>facts.systems[0].parameters[0].query;
const inputQuery=packet=>packet.payload.systems[0].parameters[0].query;
const edit=mutate=>{
  const packet=structuredClone(actual.packet);mutate(packet,packet.payload);
  packet.packageId=sha256('tsfg.system-query.package.v1\0'+packet.schemaHash+'\0'+canonical(packet.payload));
  return {bytes:Buffer.from(canonical(packet)+'\n'),context:{...actual.context,expectedPackageId:packet.packageId}};
};

test('actual architecture Source packet owns complete original context and ordered component accesses',()=>{
  const facts=readSystemQueryFacts(actual.bytes,actual.context),system=facts.systems[0],access=query(facts);
  assert.deepEqual(printSystemQueryFacts(facts,actual.context),actual.bytes);
  assert.deepEqual(facts.program,actual.packet.payload.program);
  assert.deepEqual(facts.nodes,actual.packet.payload.nodes);
  assert.deepEqual(system.declaration,actual.packet.payload.systems[0].declaration);
  assert.equal(system.declaration.id,originId(system.declaration.sourcePath,system.declaration.nameRange));
  assert.deepEqual(system.signature,system.declaration);
  assert.deepEqual(system.declKey,{sourcePath:'/src/main.ts',path:[],kind:'function',name:'integrate'});
  assert.deepEqual(system.parameters.map(row=>row.binding.id),actual.packet.payload.systems[0].parameters.map(row=>row.binding.id));
  assert.deepEqual(access.items.map(row=>[row.index,row.mode,row.component.name]),[[0,'write','Position'],[1,'read','Velocity']]);
  assert.ok(access.items.every(row=>/^sha256:[0-9a-f]{64}$/.test(row.componentType)));
  assert.notEqual(access.items[0].componentType,access.items[1].componentType);
  assert.deepEqual(facts.components.map(row=>row.sourceType).sort(),actual.packet.payload.types.filter(row=>row.nominalKey?.category==='component').map(row=>row.id).sort());
  assert.equal(facts.format.schemaHash,systemQueryFactsFormat.schemaHash);
  assert.ok(Object.isFrozen(facts)&&Object.isFrozen(access)&&Object.isFrozen(access.items)&&access.items.every(Object.isFrozen));
  assert.ok(facts.program.files.find(row=>row.path==='/src/main.ts').content.includes('😀'));
  assert.ok(actual.packet.payload.types.filter(row=>row.nominalKey?.category==='component').every(row=>row.fields.every(field=>field.readonly===false)));
});

test('actual aliases retain builtin targets and generic component substitutions across original files',()=>{
  const input=fixture('aliases'),facts=readSystemQueryFacts(input.bytes,input.context),access=query(facts);
  assert.deepEqual(printSystemQueryFacts(facts,input.context),input.bytes);
  assert.equal(access.tupleSourcePath,'/src/aliases.ts');
  assert.equal(access.items[0].componentSourcePath,'/src/main.ts');
  assert.equal(access.items[1].componentSourcePath,'/src/aliases.ts');
  assert.ok(access.aliases.some(row=>row.declaration.kind==='KindTypeParameter'&&row.target.name==='Position'));
  assert.ok(access.aliases.some(row=>row.target.kind==='KindTupleType'&&row.target.name===''));
  assert.deepEqual(access.items.map(row=>row.componentType),query(readSystemQueryFacts(actual.bytes,actual.context)).items.map(row=>row.componentType));
  assert.deepEqual(facts.program,input.packet.payload.program);
});

test('actual duplicate tuple occurrences keep original order and modes',()=>{
  const input=fixture('duplicate'),facts=readSystemQueryFacts(input.bytes,input.context),items=query(facts).items;
  assert.deepEqual(printSystemQueryFacts(facts,input.context),input.bytes);
  assert.deepEqual(items.map(row=>row.mode),['read','write','read']);
  assert.equal(items[0].componentType,items[1].componentType);
  assert.notEqual(items[0].componentType,items[2].componentType);
  assert.equal(new Set(items.map(row=>row.range.start)).size,3);
});

test('actual zero-argument wrapper alias resolves its original definition',()=>{
  const input=fixture('wrapper-alias'),facts=readSystemQueryFacts(input.bytes,input.context),access=query(facts);
  assert.deepEqual(printSystemQueryFacts(facts,input.context),input.bytes);
  assert.deepEqual(access.items.map(row=>[row.mode,row.component.name]),[['write','Position'],['read','Velocity']]);
  const source=facts.program.files.find(row=>row.path===access.tupleSourcePath).content;
  assert.equal(source.slice(access.items[0].range.start,access.items[0].range.end),'WPos');
  assert.ok(access.aliases.some(row=>row.declaration.name==='WPos'&&row.target.name==='Write'));
});

test('actual complete Program preserves unused class and unrelated ordinary function',()=>{
  const input=fixture('complete'),facts=readSystemQueryFacts(input.bytes,input.context);
  assert.deepEqual(printSystemQueryFacts(facts,input.context),input.bytes);
  assert.deepEqual(facts.nodes,input.packet.payload.nodes);
  assert.ok(facts.nodes.some(row=>row.kind==='KindClassDeclaration'&&row.name==='Box'));
  assert.ok(facts.nodes.some(row=>row.kind==='KindFunctionDeclaration'&&row.name==='unrelated'));
  assert.equal(facts.components.length,2);
});

const cases=[
  ['wrong family',packet=>{packet.family='foreign';}],
  ['wrong version',packet=>{packet.version=2;}],
  ['wrong schema',packet=>{packet.schemaHash='sha256:'+'0'.repeat(64);}],
  ['wrong request identity',packet=>{packet.requestId='sha256:'+'0'.repeat(64);}],
  ['ordinary scalar parameter logical type',(_packet,payload)=>{payload.systems[0].parameters[1].logicalType='u32';}],
  ['original system return type',(_packet,payload)=>{payload.systems[0].returnType='f32';}],
  ['forged builtin alias mode',packet=>{
    const access=inputQuery(packet),item=access.items[0],type=packet.payload.types.find(row=>row.id==='f32'),target=access.items[1].wrapper;
    item.mode='read';item.wrapper=target;
    access.aliases.push({useSourcePath:'/src/main.ts',useRange:item.range,declaration:{id:originId(type.sourcePath,type.nameRange),sourcePath:type.sourcePath,kind:'KindTypeAliasDeclaration',name:type.name,range:type.declarationRange,nameRange:type.nameRange},target});
  }],
  ['wrong target',(_packet,payload)=>{payload.program.target.pointerBits='32';}],
  ['wrong profile hash',(_packet,payload)=>{payload.profileSHA256='0'.repeat(64);}],
  ['wrong declaration context',(_packet,payload)=>{payload.profilePath='/src/minimal-arrays-v8.d.ts';}],
  ['partial source inventory',(_packet,payload)=>{payload.program.files.pop();}],
  ['extra original source field',(_packet,payload)=>{payload.program.files[0].foreign=1;}],
  ['partial AST root closure',(_packet,payload)=>{payload.nodes=payload.nodes.filter(row=>row.kind!=='KindSourceFile');}],
  ['wrong AST parent',(_packet,payload)=>{payload.nodes[1].parent='';}],
  ['wrong original declaration ID',packet=>{inputQuery(packet).items[0].component.id='sha256:'+'0'.repeat(64);}],
  ['wrong original binding anchor',(_packet,payload)=>{payload.systems[0].parameters[0].binding.nameRange.start++;}],
  ['wrong parameter order',(_packet,payload)=>{payload.systems[0].parameters.reverse();payload.systems[0].parameters.forEach((row,index)=>row.index=index);}],
  ['partial parameters',(_packet,payload)=>{payload.systems[0].parameters.pop();}],
  ['wrong wrapper context',packet=>{inputQuery(packet).items[0].wrapper=inputQuery(packet).items[0].component;}],
  ['wrong Read/Write mode',packet=>{inputQuery(packet).items[0].mode='read';}],
  ['structural readonly access',packet=>{inputQuery(packet).items[0].mode='readonly';}],
  ['unowned component type',packet=>{inputQuery(packet).items[0].componentType='nominal:'+'0'.repeat(64);}],
  ['different owned component type',packet=>{inputQuery(packet).items[0].componentType=inputQuery(packet).items[1].componentType;}],
  ['wrong component occurrence source',packet=>{inputQuery(packet).items[0].componentSourcePath='/src/system-query-context.d.ts';}],
  ['wrong component UTF16 anchor',packet=>{inputQuery(packet).items[0].componentRange.start++;}],
  ['wrong tuple order',packet=>{inputQuery(packet).items.reverse();inputQuery(packet).items.forEach((row,index)=>row.index=index);}],
  ['partial Query tuple',packet=>{inputQuery(packet).items.pop();}],
  ['extra access field',packet=>{inputQuery(packet).items[0].foreign=1;}],
  ['wrong marker alias target',(_packet,payload)=>{payload.markerAliases[0].target=payload.builtins[0];}],
  ['duplicate marker alias proof',(_packet,payload)=>{payload.markerAliases.push(structuredClone(payload.markerAliases[0]));}],
  ['changed original field readonly',(_packet,payload)=>{payload.types.find(row=>row.nominalKey?.category==='component').fields[0].readonly=true;}],
  ['changed original field type',(_packet,payload)=>{payload.types.find(row=>row.nominalKey?.category==='component').fields[0].type='u32';}],
  ['synthetic non-fixed component content',(_packet,payload)=>{payload.types.find(row=>row.nominalKey?.category==='component').fields[0].type='void';}],
  ['missing original field',(_packet,payload)=>{payload.types.find(row=>row.nominalKey?.category==='component').fields.pop();}],
];
for(const [name,mutate]of cases)test('cold Source boundary rejects rehashed '+name,()=>{
  const changed=edit(mutate);assert.throws(()=>readSystemQueryFacts(changed.bytes,changed.context));
});

test('cold alias proof rejects rehashed foreign generic substitution target',()=>{
  const input=fixture('aliases'),packet=structuredClone(input.packet),access=inputQuery(packet);
  const substitution=access.aliases.find(row=>row.declaration.kind==='KindTypeParameter'&&row.useRange.start===121);
  substitution.target=access.items[1].component;
  packet.packageId=sha256('tsfg.system-query.package.v1\0'+packet.schemaHash+'\0'+canonical(packet.payload));
  assert.throws(()=>readSystemQueryFacts(Buffer.from(canonical(packet)+'\n'),{...input.context,expectedPackageId:packet.packageId}));
});

test('context, digest, canonical bytes and ownership cannot be substituted',()=>{
  const facts=readSystemQueryFacts(actual.bytes,actual.context);
  assert.throws(()=>readSystemQueryFacts(actual.bytes,{...actual.context,expectedPackageId:'sha256:'+'0'.repeat(64)}));
  assert.throws(()=>readSystemQueryFacts(actual.bytes,{...actual.context,requestBytes:Buffer.from('{}\n')}));
  const packet=structuredClone(actual.packet);packet.packageId='sha256:'+'0'.repeat(64);
  assert.throws(()=>readSystemQueryFacts(Buffer.from(canonical(packet)+'\n'),actual.context));
  assert.throws(()=>readSystemQueryFacts(Buffer.concat([actual.bytes,Buffer.from('\n')]),actual.context));
  assert.throws(()=>readSystemQueryFacts(Buffer.from('{"family":"a","family":"b"}\n'),actual.context));
  assert.throws(()=>printSystemQueryFacts({...facts},actual.context));
  assert.throws(()=>printSystemQueryFacts(facts,{...actual.context,requestBytes:Buffer.from('{}\n')}));
  const output=printSystemQueryFacts(facts,actual.context);output.fill(0);
  assert.deepEqual(printSystemQueryFacts(facts,actual.context),actual.bytes);
});
