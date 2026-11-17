// SPDX-License-Identifier: MIT
// Positive packets/requests are complete, unmodified actual Go producer bytes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonical,sha256} from '../../compiler/identity.mjs';
import {originId} from '../../compiler/typed-array-schema.mjs';
import {readSystemQueryFacts,printSystemQueryFacts,systemQueryFactsFormat} from '../../compiler/system-query-facts.mjs';
import {systemQueryFixture as fixture} from './system-query-fixtures.mjs';

const actual=fixture('architecture');
const query=facts=>facts.systems[0].parameters[0].query;
const inputQuery=packet=>packet.payload.systems[0].parameters[0].query;
const edit=(mutate,input=actual)=>{
  const packet=structuredClone(input.packet);mutate(packet,packet.payload);
  packet.packageId=sha256('tsfg.system-query.package.v6\0'+packet.schemaHash+'\0'+canonical(packet.payload));
  return {bytes:Buffer.from(canonical(packet)+'\n'),context:{...input.context,expectedPackageId:packet.packageId}};
};


test('cold Source boundary rejects an unsupported system declaration prefix',()=>{
  const request=JSON.parse(actual.context.requestBytes.toString());
  const changed=edit((packet,payload)=>{
    const {declaration}=payload.systems[0];
    const modifier=payload.nodes.find(node=>node.sourcePath===declaration.sourcePath
      && node.kind==='KindExportKeyword' && node.range.start>=declaration.range.start
      && node.range.end<=declaration.nameRange.start);
    assert.ok(modifier);
    assert.ok(!payload.nodes.some(node=>node.parent===modifier.id));
    const source=payload.program.files.find(file=>file.path===declaration.sourcePath);
    const {start,end}=modifier.range;
    assert.equal(source.content.slice(start,end),'export');
    source.content=source.content.slice(0,start)+'async '+source.content.slice(end);
    source.sha256=sha256(source.content).slice(7);
    const files=payload.program.files.map(({path,sha256})=>({path,sha256}));
    for(const type of payload.types)if(type.runtimeKey){
      type.runtimeKey=sha256('tsfg.array-facts.runtime-class.v8\0'+canonical({files,nominalKey:type.nominalKey}));
    }
    const requestFile=request.input.files.find(file=>file.path===source.path);
    Object.assign(requestFile,{content:source.content,sha256:source.sha256});
    packet.requestId=sha256('tsfg.system-query.request.v6\0'+canonical(request)+'\n');
    modifier.kind='KindAsyncKeyword';
    modifier.range.end=start+'async'.length;
    const {sourcePath,kind,range,parent}=modifier;
    modifier.id=sha256('tsfg.system-query.node.v1\0'+canonical({sourcePath,kind,range,parent}));
  });
  changed.context.requestBytes=Buffer.from(canonical(request)+'\n');
  assert.throws(()=>readSystemQueryFacts(changed.bytes,changed.context),{
    code:'r10-system-query-source',message:/system declaration prefix has unsupported semantics/,
  });
});

function multiSystemInput(){
  const read=name=>readFileSync(new URL('./testdata/system-query-effects/'+name,import.meta.url));
  const bytes=read('multi-facts.json'),packet=JSON.parse(bytes.toString('utf8'));
  return {bytes,packet,context:{...actual.context,requestBytes:read('multi-request.json'),expectedPackageId:packet.packageId}};
}

function omitDeclarationNodes(payload,{sourcePath,range}){
  const nodes=payload.nodes.filter(node=>node.sourcePath!==sourcePath||node.range.start<range.start||node.range.end>range.end);
  assert.ok(nodes.length<payload.nodes.length);
  payload.nodes=nodes;
}

test('actual Source retains every marked system in order, including systems without loops',()=>{
  const input=multiSystemInput(),facts=readSystemQueryFacts(input.bytes,input.context);
  const oracle=JSON.parse(readFileSync(new URL('./testdata/system-query-effects/expected.json',import.meta.url),'utf8'));
  assert.deepEqual(facts.systems.map(row=>[row.declaration.name,row.loops.length]),oracle.systems.map(row=>[row.name,row.loops]));
  assert.deepEqual(printSystemQueryFacts(facts,input.context),input.bytes);
});

for(const name of ['readPosition2','writePositionY'])test('cold Source boundary rejects an omitted marked system: '+name,()=>{
  const input=multiSystemInput(),changed=edit((_packet,payload)=>{
    const systems=payload.systems.filter(row=>row.declaration.name!==name);
    assert.equal(systems.length,payload.systems.length-1);
    if(name==='writePositionY')omitDeclarationNodes(payload,payload.systems.find(row=>row.declaration.name===name).declaration);
    payload.systems=systems;
  },input);
  const reason=name==='readPosition2'?/complete Source marked system inventory differs/:/r03-common-program-source/;
  assert.throws(()=>readSystemQueryFacts(changed.bytes,changed.context),reason);
});

test('cold Source boundary requires the original decorator occurrence',()=>{
  const input=multiSystemInput(),changed=edit((_packet,payload)=>{
    const {markerRange}=payload.systems[0];
    const decorator=payload.nodes.find(row=>row.kind==='KindDecorator'&&row.sourcePath===payload.program.rootFile&&row.range.start===markerRange.start&&row.range.end===markerRange.end);
    assert.ok(decorator);
    payload.nodes=payload.nodes.filter(row=>row.id!==decorator.id&&row.parent!==decorator.id);
  },input);
  assert.throws(()=>readSystemQueryFacts(changed.bytes,changed.context),/original system decorator occurrence differs/);
});

test('cold Source boundary keeps every original top-level AST declaration',()=>{
  const input=fixture('complete'),changed=edit((_packet,payload)=>{
    const declaration=payload.nodes.find(node=>node.kind==='KindFunctionDeclaration'&&node.name==='unrelated');
    assert.ok(declaration);
    omitDeclarationNodes(payload,declaration);
  },input);
  assert.throws(()=>readSystemQueryFacts(changed.bytes,changed.context),/r03-common-program-source/);
});

test('the private v6 owner rejects the removed v4 packet and context route',()=>{
  const packet=structuredClone(actual.packet);packet.version=4;
  assert.throws(()=>readSystemQueryFacts(Buffer.from(canonical(packet)+'\n'),{...actual.context,version:4}));
});

test('actual architecture Source packet owns complete original context and ordered component accesses',()=>{
  assert.match(actual.packet.payload.program.files.find(file=>file.path==='/src/main.ts').content,/@system\s+export function integrate\(/);
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
  ['wrong version',packet=>{packet.version=1;}],
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
  packet.packageId=sha256('tsfg.system-query.package.v6\0'+packet.schemaHash+'\0'+canonical(packet.payload));
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

test('cold fields retain the original Source initializer type and literal payload',async t=>{
  const input=fixture('loop-inheritance');
  const original=input.packet.payload.types.find(type=>type.name==='Base').fields.find(field=>field.name==='x');
  const source=input.packet.payload.program.files.find(file=>file.path===original.origin.source);
  const {start,end}=original.initializer.range;
  assert.equal(source.content.slice(start,end),'0');
  assert.equal(original.type,'f32');
  assert.equal(original.initializer.bits,'00000000');
  assert.deepEqual(printSystemQueryFacts(readSystemQueryFacts(input.bytes,input.context),input.context),input.bytes);

  for(const {name,change,message} of [
    {name:'different floating payload',change:{bits:'3f800000'},message:/component field initializer payload differs/},
    {name:'different literal spelling',change:{token:'1',bits:'3f800000'},message:/original field initializer spelling differs/},
    {name:'different flow type',change:{flowType:'i32'},message:/component field initializer type or relation differs/},
    {name:'different logical type',change:{type:'f64',flowType:'f64',bits:'0000000000000000'},message:/component field initializer type or relation differs/},
  ])await t.test(name,()=>{
    const altered=edit((_packet,payload)=>{
      Object.assign(payload.types.find(type=>type.name==='Base').fields.find(field=>field.name==='x').initializer,change);
    },input);
    assert.throws(()=>readSystemQueryFacts(altered.bytes,altered.context),message);
  });
});


test('cold fields retain the original Source integer initializer decimal',()=>{
  const directory=new URL('./testdata/system-query-i32-field-compound/',import.meta.url);
  const bytes=readFileSync(new URL('package.json',directory));
  const requestBytes=readFileSync(new URL('request.json',directory));
  const packet=JSON.parse(bytes.toString());
  const context={family:'tsfg.system-query-context-candidate',version:6,requestBytes,expectedPackageId:packet.packageId};
  assert.deepEqual(printSystemQueryFacts(readSystemQueryFacts(bytes,context),context),bytes);

  const altered=edit((_packet,payload)=>{
    const initializer=payload.types.find(type=>type.name==='Box').fields[0].initializer;
    assert.equal(initializer.token,'7');
    assert.equal(initializer.decimal,'7');
    initializer.decimal='8';
  },{bytes,packet,context});
  assert.throws(()=>readSystemQueryFacts(altered.bytes,altered.context),/component field initializer payload differs/);
});

test('cold component types derive implicit construction from the original declarations',async t=>{
  const input=fixture('loop-inheritance');
  const {types}=input.packet.payload;
  const base=types.find(type=>type.name==='Base');
  const position=types.find(type=>type.name==='Position');
  assert.equal(base.construction.kind,'implicit-base');
  assert.equal(position.construction.kind,'implicit-derived');
  assert.equal(position.base,base.id);
  assert.deepEqual(printSystemQueryFacts(readSystemQueryFacts(input.bytes,input.context),input.context),input.bytes);

  for(const {name,change,message} of [
    {name:'implicit base access',change:(_position,base)=>{base.construction.access='private';},message:/component construction access differs/},
    {name:'implicit derived access',change:position=>{position.construction.access='protected';},message:/component construction access differs/},
    {name:'constructor signature digest',change:position=>{position.construction.signature.id='sha256:'+'0'.repeat(64);},message:/r03-typed-array-construction/},
    {name:'constructor initialization order',change:position=>{position.construction.initializationFields.reverse();},message:/r03-typed-array-field-initialization/},
    {name:'constructor initialization phase',change:position=>{position.construction.initializationPhase='before-body';},message:/r03-typed-array-construction/},
    {name:'implicit forwarding target',change:position=>{position.construction.implicitForward.target=position.construction.id;},message:/r03-typed-array-construction-forward/},
  ])await t.test(name,()=>{
    const altered=edit((_packet,payload)=>change(
      payload.types.find(type=>type.id===position.id),payload.types.find(type=>type.id===base.id)
    ),input);
    assert.throws(()=>readSystemQueryFacts(altered.bytes,altered.context),message);
  });
});


test('cold component catalogue rejects types outside the Query declaration profile',async t=>{
  const input=fixture('loop-inheritance');
  for(const [kind,name] of [['array','Array'],['readSpan','ReadSpan']])await t.test(name,()=>{
    const altered=edit((_packet,payload)=>{
      const declaration=payload.nodes.find(node=>node.kind==='KindInterfaceDeclaration'&&node.name===name&&node.sourcePath==='/src/minimal-arrays-v8.d.ts');
      const index=payload.nodes.find(node=>node.parent===declaration.id&&node.kind==='KindIndexSignature');
      payload.types.push({constructor:null,id:kind+'<f32>',kind,elementType:'f32',sourcePath:declaration.sourcePath,
        declarationRange:declaration.range,nameRange:declaration.nameRange,indexSignatureRange:index.range});
      payload.types.sort((left,right)=>Buffer.compare(Buffer.from(left.id),Buffer.from(right.id)));
    },input);
    assert.throws(()=>readSystemQueryFacts(altered.bytes,altered.context),/Query type context has unsupported non-fixed declaration/);
  });
});

test('cold component markers keep the original lexical value binding',()=>{
  const input=fixture('complete'),request=JSON.parse(input.context.requestBytes.toString('utf8'));
  assert.deepEqual(printSystemQueryFacts(readSystemQueryFacts(input.bytes,input.context),input.context),input.bytes);
  const changed=edit((packet,payload)=>{
    const source=payload.program.files.find(file=>file.path==='/src/main.ts');
    const before=source.content;
    source.content=before.replace('function unrelated(','function component(');
    assert.notEqual(source.content,before);
    assert.equal(source.content.length,before.length);
    assert.equal(Buffer.byteLength(source.content),Buffer.byteLength(before));
    source.sha256=sha256(source.content).slice(7);
    const declaration=payload.nodes.find(node=>node.sourcePath===source.path&&node.kind==='KindFunctionDeclaration'&&node.name==='unrelated');
    assert.ok(declaration);
    declaration.name='component';
    const files=payload.program.files.map(({path,sha256})=>({path,sha256}));
    for(const type of payload.types)if(type.nominalKey)
      type.runtimeKey=sha256('tsfg.array-facts.runtime-class.v8\0'+canonical({files,nominalKey:type.nominalKey}));
    Object.assign(request.input.files.find(file=>file.path===source.path),{content:source.content,sha256:source.sha256});
    packet.requestId=sha256('tsfg.system-query.request.v6\0'+canonical(request)+'\n');
  },input);
  changed.context.requestBytes=Buffer.from(canonical(request)+'\n');
  assert.throws(()=>readSystemQueryFacts(changed.bytes,changed.context),{
    code:'r10-system-query-source',message:/component decorator value binding differs/,
  });
});

test('cold component markers retain the owning class declaration',()=>{
  const input=fixture('loop-inheritance');
  assert.deepEqual(printSystemQueryFacts(readSystemQueryFacts(input.bytes,input.context),input.context),input.bytes);
  const changed=edit((_packet,payload)=>{
    const position=payload.types.find(type=>type.name==='Position');
    const base=payload.types.find(type=>type.name==='Base');
    assert.notDeepEqual(position.markerOrigin.range,base.markerOrigin.range);
    [position.markerOrigin.range,base.markerOrigin.range]=[base.markerOrigin.range,position.markerOrigin.range];
  },input);
  assert.throws(()=>readSystemQueryFacts(changed.bytes,changed.context),{
    code:'r10-system-query-source',message:/component decorator occurrence differs/,
  });
});
