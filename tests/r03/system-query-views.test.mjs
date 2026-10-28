// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {canonical,sha256} from '../../compiler/identity.mjs';
import {coreQuote} from '../../compiler/mlir-strings.mjs';
import {readSystemQueryFacts,printSystemQueryFacts} from '../../compiler/system-query-facts.mjs';
import {emitSystemQueryCore} from '../../compiler/system-query-core.mjs';
import {readSystemQueryEffects} from '../../compiler/system-query-effects.mjs';

const inputs=['view-direct','view-imported','view-aliases','view-same-owner'].map(name=>{
  const bytes=readFileSync(new URL('./testdata/system-query-views/'+name+'-facts.json',import.meta.url)),packet=JSON.parse(bytes.toString('utf8'));
  return {name,bytes,packet,context:{family:'tsfg.system-query-context-candidate',version:6,requestBytes:readFileSync(new URL('./testdata/system-query-views/'+name+'-request.json',import.meta.url)),expectedPackageId:packet.packageId}};
});
const tool=process.env.TSFG_QUERY_VIEW_CORE_EXE,output=process.env.TSFG_QUERY_VIEW_CORE_OUTPUT,enabled=Boolean(tool&&output),children=[];
const groupBytes=readFileSync(new URL('./testdata/system-query-views/view-parenthesized-facts.json',import.meta.url)),groupPacket=JSON.parse(groupBytes.toString('utf8'));
const grouped={bytes:groupBytes,packet:groupPacket,context:{family:'tsfg.system-query-context-candidate',version:6,requestBytes:readFileSync(new URL('./testdata/system-query-views/view-parenthesized-request.json',import.meta.url)),expectedPackageId:groupPacket.packageId}};
const run=(name,input,command='--canonicalize',expected=0)=>{
  mkdirSync(output,{recursive:true});const prefix=output+'/'+String(children.length).padStart(3,'0')+'-'+name;
  const child=spawnSync(tool,['--system-query',command],{input,windowsHide:true,maxBuffer:8388608,timeout:60000});
  writeFileSync(prefix+'-input.mlir',input);writeFileSync(prefix+'-stdout.raw',child.stdout??Buffer.alloc(0));writeFileSync(prefix+'-stderr.raw',child.stderr??Buffer.alloc(0));
  children.push({name,command,pid:child.pid,status:child.status,error:child.error?.message??null,stdoutBytes:child.stdout?.length,stderr:child.stderr?.toString('utf8')});writeFileSync(output+'/children.json',JSON.stringify(children,null,2)+'\n');
  assert.ifError(child.error);assert.equal(child.status,expected,child.stderr.toString('utf8'));return child.stdout;
};

test('parenthesized view arguments retain original bindings, types and borrow anchors',()=>{
  const facts=readSystemQueryFacts(grouped.bytes,grouped.context),ir=emitSystemQueryCore(facts,grouped.context),loop=facts.systems[0].loops[0];
  assert.deepEqual(printSystemQueryFacts(facts,grouped.context),grouped.bytes);
  const write=loop.statements[0].value.value.arguments[0],read=loop.statements[1].value.value.arguments[0],nested=facts.scalarHelpers.find(h=>h.declaration.name==='scaledX').statements.at(-1).value.left.arguments[0];
  for(const value of [write,read,nested]){assert.equal(value.kind,'parentheses');assert.equal(value.expression.kind,'bindingReference');assert.equal(value.type,value.expression.type);}
  assert.equal(write.expression.binding,loop.bindings[0].declaration.id);assert.equal(read.expression.binding,write.expression.binding);
  assert.equal(nested.expression.binding,facts.scalarHelpers.find(h=>h.declaration.name==='scaledX').parameters[0].binding.id);
  const borrow=ir.split('\n').find(line=>line.includes('"tsfg.view_borrow"'));assert.ok(borrow);
  assert.ok(borrow.includes('tsfg_source.start = '+read.range.start+' : i64'));assert.ok(borrow.includes('tsfg_source.end = '+read.range.end+' : i64'));
  const packet=structuredClone(grouped.packet),arg=packet.payload.systems[0].loops[0].statements[0].value.value.arguments[0],other=packet.payload.systems[0].loops[0].bindings[1].componentType;
  arg.type=other;arg.flowType=other;packet.packageId=sha256('tsfg.system-query.package.v6\0'+packet.schemaHash+'\0'+canonical(packet.payload));
  assert.throws(()=>readSystemQueryFacts(Buffer.from(canonical(packet)+'\n'),{...grouped.context,expectedPackageId:packet.packageId}),/grouping logical type differs/);
});

test('independent parenthesized view calls preserve caller columns and transitive effects',{skip:!enabled},()=>{
  const facts=readSystemQueryFacts(grouped.bytes,grouped.context),ir=emitSystemQueryCore(facts,grouped.context),bound=run('parenthesized',ir);
  assert.deepEqual(run('parenthesized-roundtrip',bound),bound);
  const raw=run('parenthesized-effects',bound,'--effects'),effects=readSystemQueryEffects(raw,facts,grouped.context),loop=effects.systems[0].loops[0];
  assert.deepEqual(loop.operations.map(op=>op.kind),['read','read','write','write','read','read','write']);
  assert.deepEqual(loop.operations.map(op=>op.callPath.length),[1,1,1,0,0,2,0]);
  assert.deepEqual(loop.operations.map(op=>op.sourceBinding),[0,1,0,0,0,0,0].map(index=>loop.columns[index].sourceBinding));
  assert.equal(loop.columns[0].mode,'write');assert.equal(loop.operations.at(-1).kind,'write');
});

for(const input of inputs)test('real view helper Source owns formal permissions and typed calls: '+input.name,()=>{
  const facts=readSystemQueryFacts(input.bytes,input.context),ir=emitSystemQueryCore(facts,input.context);
  assert.deepEqual(printSystemQueryFacts(facts,input.context),input.bytes);assert.equal(facts.format.version,6);
  assert.equal(facts.scalarHelpers.length,3);assert.ok(ir.includes('tsfg.query_version = 3 : i32'));
  assert.ok(input.packet.payload.program.files.some(file=>file.content.includes('function unused(v:i32)')));
  assert.ok(input.packet.payload.nodes.some(node=>node.kind==='KindClassDeclaration'&&node.name==='Box'));
  const byName=new Map(facts.scalarHelpers.map(helper=>[helper.declaration.name,helper]));
  assert.deepEqual(byName.get('update').parameters.map(p=>p.view?.access.mode??'f32'),['write','read','f32']);
  assert.equal(byName.get('scaledX').parameters[0].view.access.mode,'read');assert.equal(byName.get('readX').parameters[0].view.access.mode,'read');
  assert.equal(ir.split('"func.call"').length-1,3);assert.equal(ir.split('"tsfg.view_borrow"').length-1,input.name==='view-same-owner'?2:1);
  for(const helper of facts.scalarHelpers){assert.notEqual(helper.id,helper.sourceId);assert.notEqual(helper.id,helper.declaration.id);assert.equal(helper.statements.at(-1).value.sourceType,'f32');}
});

for(const input of inputs)test('independent view helper SSA, roundtrip and caller column effects: '+input.name,{skip:!enabled},()=>{
  const facts=readSystemQueryFacts(input.bytes,input.context),ir=emitSystemQueryCore(facts,input.context),bound=run(input.name,ir);
  assert.deepEqual(run(input.name+'-roundtrip',bound),bound);assert.deepEqual(run(input.name+'-optimize',bound,'--optimize'),bound);
  const raw=run(input.name+'-effects',bound,'--effects'),effects=readSystemQueryEffects(raw,facts,input.context);
  assert.equal(effects.version,3);assert.equal(canonical(effects)+'\n',raw.toString('utf8'));
  const names=new Map(facts.components.map(row=>[row.typeId,row.declaration.name])),fields=new Map(input.packet.payload.types.flatMap(type=>type.fields?.map(field=>[field.id,field.name])??[]));
  const system=effects.systems[0],operations=system.loops[0].operations,label=op=>names.get(op.componentType)+'.'+fields.get(op.sourceField);
  assert.deepEqual(operations.map(op=>op.kind),['read','read','write','write','read','read','write']);
  assert.deepEqual(operations.map(label),['Position.x',input.name==='view-same-owner'?'Position.x':'Velocity.x','Position.x','Position.x','Position.y','Position.x','Position.y']);
  assert.deepEqual(operations.map(op=>op.callPath.length),[1,1,1,0,0,2,0]);
  const p=system.loops[0].columns[0],v=system.loops[0].columns[1];
  assert.deepEqual(operations.map(op=>op.sourceBinding),[p.sourceBinding,input.name==='view-same-owner'?p.sourceBinding:v.sourceBinding,p.sourceBinding,p.sourceBinding,p.sourceBinding,p.sourceBinding,p.sourceBinding]);
  assert.ok(operations.every(op=>op.componentType===system.loops[0].columns[op.tupleIndex].componentType));
  assert.deepEqual(system.capabilities.map(row=>names.get(row.componentType)+':'+row.mode).sort(),['Position:write','Velocity:read']);
  const helperNames=new Map(facts.scalarHelpers.map(row=>[row.id,row.declaration.name]));
  assert.deepEqual(operations[5].callPath.map(row=>helperNames.get(row.functionId)),['scaledX','readX']);
  assert.equal(operations[5].source.path,input.name==='view-imported'?'/src/helpers.ts':'/src/main.ts');
  for(const helper of effects.scalarHelpers){const name=helperNames.get(helper.functionId);assert.ok(helper.fieldEffects.length>0);assert.equal(helper.calls.length,name==='scaledX'?1:0);}
  assert.deepEqual(effects.conflicts,[]);
});

test('owning view facts reject formal mode/component/signature and original actual-binding mutations',()=>{
  const input=inputs[0],mutations=[
    packet=>{const p=packet.payload.scalarHelpers.find(h=>h.declaration.name==='update').parameters[0];p.view.access.mode='read';p.view.access.wrapper=packet.payload.builtins.find(row=>row.name==='Read');},
    packet=>{const p=packet.payload.scalarHelpers.find(h=>h.declaration.name==='update').parameters[0];p.view.access.componentType=packet.payload.scalarHelpers.find(h=>h.declaration.name==='update').parameters[1].logicalType;},
    packet=>{packet.payload.scalarHelpers.find(h=>h.declaration.name==='update').signature.parameters.reverse();},
    packet=>{const helper=packet.payload.scalarHelpers.find(h=>h.declaration.name==='scaledX');helper.parameters[0].view=null;},
    packet=>{packet.payload.scalarHelpers.find(h=>h.declaration.name==='readX').parameters[0].view.access.componentRange.start++;},
    packet=>{const call=packet.payload.systems[0].loops[0].statements[0].value.value;call.arguments.reverse();},
    packet=>{const p=packet.payload.scalarHelpers.find(h=>h.declaration.name==='update').parameters[0];p.view.access.wrapper=packet.payload.builtins.find(row=>row.name==='Query');},
  ];
  for(const mutate of mutations){const packet=structuredClone(input.packet);mutate(packet);packet.packageId=sha256('tsfg.system-query.package.v6\0'+packet.schemaHash+'\0'+canonical(packet.payload));
    assert.throws(()=>readSystemQueryFacts(Buffer.from(canonical(packet)+'\n'),{...input.context,expectedPackageId:packet.packageId}));}
});

test('independent verifier binds view function modes, narrowing SSA and real callee field source',{skip:!enabled},()=>{
  const input=inputs[0],facts=readSystemQueryFacts(input.bytes,input.context),ir=emitSystemQueryCore(facts,input.context),update=facts.scalarHelpers.find(h=>h.declaration.name==='update');
  const header='@'+coreQuote('query_helper_'+update.id.slice(7));assert.ok(ir.includes(header));
  const lines=ir.split('\n'),borrow=lines.find(line=>line.includes('"tsfg.view_borrow"'));assert.ok(borrow);
  const target=lines.find(line=>line.includes(header)&&line.includes('func.func'));assert.ok(target);
  const variants=[['formal-mode',ir.replace(target,target.replace('#write','#read'))],
    ['widening-borrow',ir.replace(borrow,borrow.replace('mode = "read"','mode = "write"'))],
    ['borrow-anchor',ir.replace(borrow,borrow.replace(/tsfg_source.start = (\d+)/,(_,start)=>'tsfg_source.start = '+(Number(start)+1)))],
    ['missing-borrow',ir.replace(borrow+'\n','')],
    ['wrong-helper-signature',ir.replace('tsfg_core.signature_hash = '+coreQuote(update.signatureHash),'tsfg_core.signature_hash = '+coreQuote('sha256:'+'0'.repeat(64)))],
    ['helper-source-field',ir.replace(/source_field = "sha256:([0-9a-f])/,(_,first)=>'source_field = "sha256:'+(first==='0'?'1':'0'))]];
  for(const [name,bad] of variants){assert.notEqual(bad,ir,name);assert.equal(run(name,bad,'--canonicalize',3).length,0);}
});

test('independent original helper annotation rejects a rehashed formal permission claim',{skip:!enabled},()=>{
  const input=inputs[0],facts=readSystemQueryFacts(input.bytes,input.context),ir=emitSystemQueryCore(facts,input.context),packet=structuredClone(input.packet);
  const formal=packet.payload.scalarHelpers.find(h=>h.declaration.name==='update').parameters[0];
  formal.view.access.mode='read';formal.view.access.wrapper=packet.payload.builtins.find(row=>row.name==='Read');
  packet.packageId=sha256('tsfg.system-query.package.v6\0'+packet.schemaHash+'\0'+canonical(packet.payload));
  const bad=ir.replace('tsfg.query_facts = '+coreQuote(canonical(input.packet)),'tsfg.query_facts = '+coreQuote(canonical(packet)));
  assert.notEqual(bad,ir);assert.equal(run('rehashed-formal-permission',bad,'--canonicalize',3).length,0);
});

test('cold effects bind transitive memory sequence, caller owner and callee call path',{skip:!enabled},()=>{
  const input=inputs[1],facts=readSystemQueryFacts(input.bytes,input.context),raw=run('view-cold',emitSystemQueryCore(facts,input.context),'--effects'),base=JSON.parse(raw.toString('utf8'));
  const mutations=[value=>{value.systems[0].loops[0].operations[0].callPath=[];},
    value=>{value.systems[0].loops[0].operations[5].callPath.reverse();},
    value=>{value.systems[0].loops[0].operations[0].source.path='/src/main.ts';},
    value=>{const loop=value.systems[0].loops[0];loop.operations[0].sourceBinding=loop.columns[1].sourceBinding;loop.operations[0].tupleIndex=1;},
    value=>{value.scalarHelpers.find(row=>row.fieldEffects.length).fieldEffects=[];},
    value=>{const system=value.systems[0];system.loops[0].operations=[];system.loops[0].fieldEffects=[];system.fieldEffects=[];},
    value=>{value.systems[0].loops[0].operations.reverse();}];
  for(const mutate of mutations){const value=structuredClone(base);mutate(value);assert.throws(()=>readSystemQueryEffects(Buffer.from(canonical(value)+'\n'),facts,input.context));}
});
