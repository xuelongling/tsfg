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

const inputs=['direct','imported','local-export'].map(name=>{
  const bytes=readFileSync(new URL('./testdata/system-query-scalars/'+name+'-facts.json',import.meta.url)),packet=JSON.parse(bytes.toString('utf8'));
  return {name,bytes,packet,context:{family:'tsfg.system-query-context-candidate',version:4,requestBytes:readFileSync(new URL('./testdata/system-query-scalars/'+name+'-request.json',import.meta.url)),expectedPackageId:packet.packageId}};
});
const tool=process.env.TSFG_QUERY_SCALAR_CORE_EXE,output=process.env.TSFG_QUERY_SCALAR_CORE_OUTPUT,enabled=Boolean(tool&&output),children=[];
// Fully rederived malformed input from the imported public pair: the target
// is module-private and export {} keeps its original module role. The old
// owning reader/emitter and C++ both accepted this exact retained Core.
test('private named import cannot resolve a module-local scalar declaration',()=>{
  const bytes=readFileSync(new URL('./testdata/system-query-scalars/private-import-malformed-facts.json',import.meta.url)),packet=JSON.parse(bytes.toString('utf8'));
  const context={family:'tsfg.system-query-context-candidate',version:4,requestBytes:readFileSync(new URL('./testdata/system-query-scalars/private-import-malformed-request.json',import.meta.url)),expectedPackageId:packet.packageId};
  assert.throws(()=>readSystemQueryFacts(bytes,context),/original named import has no unique module export/);
});
const run=(name,input,command='--canonicalize',expected=0)=>{
  mkdirSync(output,{recursive:true});const prefix=output+'/'+String(children.length).padStart(3,'0')+'-'+name;
  const child=spawnSync(tool,['--system-query',command],{input,windowsHide:true,maxBuffer:8388608,timeout:60000});
  writeFileSync(prefix+'-input.mlir',input);writeFileSync(prefix+'-stdout.raw',child.stdout??Buffer.alloc(0));writeFileSync(prefix+'-stderr.raw',child.stderr??Buffer.alloc(0));
  children.push({name,command,pid:child.pid,status:child.status,error:child.error?.message??null,stdoutBytes:child.stdout?.length,stderr:child.stderr?.toString('utf8')});writeFileSync(output+'/children.json',JSON.stringify(children,null,2)+'\n');
  assert.ifError(child.error);assert.equal(child.status,expected,child.stderr.toString('utf8'));return child.stdout;
};
test('private named import is independently rejected from retained actual Core',{skip:!enabled},()=>{
  const bytes=readFileSync(new URL('./testdata/system-query-scalars/private-import-malformed.mlir',import.meta.url));
  assert.equal(run('private-export',bytes,'--canonicalize',3).length,0);
});
for(const input of inputs)test('owned scalar helper identity and complete Source: '+input.name,()=>{
  const facts=readSystemQueryFacts(input.bytes,input.context),ir=emitSystemQueryCore(facts,input.context);
  assert.deepEqual(printSystemQueryFacts(facts,input.context),input.bytes);
  assert.equal(facts.format.version,4);assert.equal(facts.scalarHelpers.length,input.name==='direct'?1:2);
  assert.ok(input.packet.payload.program.files.some(file=>file.content.includes('function unused(v:i32)')));
  assert.ok(input.packet.payload.nodes.some(node=>node.kind==='KindClassDeclaration'&&node.name==='Box'));
  assert.ok(!facts.scalarHelpers.some(helper=>helper.declaration.name==='unused'));
  for(const helper of facts.scalarHelpers){assert.notEqual(helper.sourceId,helper.id);assert.notEqual(helper.declaration.id,helper.id);assert.ok(ir.includes('tsfg.query_source_helper = '+coreQuote(helper.sourceId)));}
  assert.equal(ir.split('"func.call"').length-1,input.name==='direct'?1:2);
  assert.ok(ir.includes('tsfg.query_version = 3 : i32'));assert.ok(!ir.includes('@"query_helper_unused"'));
});

for(const input of inputs)test('actual typed scalar helpers canonicalize, roundtrip and effects: '+input.name,{skip:!enabled},()=>{
  const facts=readSystemQueryFacts(input.bytes,input.context),ir=emitSystemQueryCore(facts,input.context),bound=run(input.name,ir);
  assert.deepEqual(run(input.name+'-roundtrip',bound),bound);assert.deepEqual(run(input.name+'-optimize',bound,'--optimize'),bound);
  const effects=readSystemQueryEffects(run(input.name+'-effects',bound,'--effects'),facts,input.context);
  assert.equal(effects.version,3);assert.equal(effects.scalarHelpers.length,facts.scalarHelpers.length);
  const system=effects.systems[0];assert.deepEqual(system.loops[0].operations.map(row=>row.kind),['read','read','write','read','read','write']);
  assert.equal(system.calls.length,1);assert.equal(system.fieldEffects.reduce((n,row)=>n+row.readCount,0),4);assert.equal(system.fieldEffects.reduce((n,row)=>n+row.writeCount,0),2);
  assert.deepEqual(effects.conflicts,[]);
  for(const helper of effects.scalarHelpers)assert.deepEqual(helper.fieldEffects,[]);
  const bySource=new Map(facts.scalarHelpers.map(row=>[row.sourceId,row.declaration.name]));
  const scaled=effects.scalarHelpers.find(row=>bySource.get(row.sourceHelperId)==='scaled');
  assert.equal(scaled.calls.length,input.name==='direct'?0:1);assert.equal(scaled.transitiveCallees.length,input.name==='direct'?0:1);
  assert.deepEqual(scaled.directCallees,scaled.transitiveCallees);
});

test('owning v4 scalar directory rejects changed actual target, arguments, body and inventory',()=>{
  const input=inputs[1];
  const mutations=[packet=>packet.payload.scalarHelpers.pop(),packet=>{packet.payload.scalarHelpers[0].signature.returnType='i32';},
    packet=>{const helper=packet.payload.scalarHelpers.find(row=>row.value.kind==='binary');helper.value.operator='+';},
    packet=>{packet.payload.scalarHelpers[0].parameters.reverse();packet.payload.scalarHelpers[0].parameters.forEach((row,index)=>row.index=index);},
    packet=>{packet.payload.systems[0].loops[0].statements[0].value.value.arguments.reverse();},
    packet=>{const call=packet.payload.systems[0].loops[0].statements[0].value.value,other=packet.payload.scalarHelpers.find(row=>row.id!==call.callee);call.callee=other.id;call.signature=other.signature;},
    packet=>{packet.payload.scalarHelpers[0].returnRange.start++;}];
  for(const mutate of mutations){const packet=structuredClone(input.packet);mutate(packet);packet.packageId=sha256('tsfg.system-query.package.v4\0'+packet.schemaHash+'\0'+canonical(packet.payload));
    assert.throws(()=>readSystemQueryFacts(Buffer.from(canonical(packet)+'\n'),{...input.context,expectedPackageId:packet.packageId}));}
});

test('independent C++ rejects scalar call SSA, original identity and helper-body forgeries',{skip:!enabled},()=>{
  const input=inputs[1],facts=readSystemQueryFacts(input.bytes,input.context),ir=emitSystemQueryCore(facts,input.context),scaled=facts.scalarHelpers.find(row=>row.declaration.name==='scaled'),multiply=facts.scalarHelpers.find(row=>row.declaration.name==='multiply');
  const callMatch=ir.match(/"func.call"\(([^)]+)\)/);assert.ok(callMatch);const args=callMatch[1].split(',').map(value=>value.trim());assert.equal(args.length,2);
  const helperMultiply=ir.lastIndexOf('"tsfg_core.mul"');assert.ok(helperMultiply>0);
  const variants=[['argument-order',ir.replace(callMatch[0],'"func.call"('+[...args].reverse().join(', ')+')')],
    ['callee-symbol',ir.replace('callee = '+ '@'+coreQuote('query_helper_'+scaled.id.slice(7)),'callee = @'+coreQuote('query_helper_'+multiply.id.slice(7)))],
    ['source-id-as-core',ir.replace('tsfg_core.function_id = '+coreQuote(scaled.id),'tsfg_core.function_id = '+coreQuote(scaled.sourceId))],
    ['signature',ir.replace('tsfg_core.signature_hash = '+coreQuote(scaled.signatureHash),'tsfg_core.signature_hash = '+coreQuote('sha256:'+'0'.repeat(64)))],
    ['helper-operator',ir.slice(0,helperMultiply)+ir.slice(helperMultiply).replace('"tsfg_core.mul"','"tsfg_core.add"')],
    ['callee-anchor',ir.replace(/callee_start = (\d+) : i64/,(_,start)=>'callee_start = '+(Number(start)+1)+' : i64')],
    ['return-operand',ir.replace(/"func.return"\(%qv\d+\)/,'"func.return"(%harg0)')]];
  const packet=structuredClone(input.packet),body=packet.payload.scalarHelpers.find(row=>row.value.kind==='binary');body.value.operator='+';
  packet.packageId=sha256('tsfg.system-query.package.v4\0'+packet.schemaHash+'\0'+canonical(packet.payload));
  variants.push(['rehashed-wrong-original-body',ir.replace('tsfg.query_facts = '+coreQuote(canonical(input.packet)),'tsfg.query_facts = '+coreQuote(canonical(packet)))]);
  for(const [name,bad] of variants){assert.notEqual(bad,ir,name);assert.equal(run(name,bad,'--canonicalize',3).length,0);}
});

test('effects3 owning boundary binds actual scalar calls and pure transitive summaries',{skip:!enabled},()=>{
  const input=inputs[1],facts=readSystemQueryFacts(input.bytes,input.context),raw=run('effects-boundary',emitSystemQueryCore(facts,input.context),'--effects'),base=JSON.parse(raw.toString('utf8'));
  const mutations=[value=>{value.scalarHelpers=[];},value=>{value.scalarHelpers.find(row=>row.calls.length).calls=[];},
    value=>{value.scalarHelpers.find(row=>row.transitiveCallees.length).transitiveCallees=[];},
    value=>{value.systems[0].loops[0].calls[0].calleeSource.start++;},value=>{value.systems[0].calls[0].sourceHelperId=value.systems[0].calls[0].functionId;}];
  for(const mutate of mutations){const value=structuredClone(base);mutate(value);assert.throws(()=>readSystemQueryEffects(Buffer.from(canonical(value)+'\n'),facts,input.context));}
});
