// SPDX-License-Identifier: MIT
// Real owned Go programs to the static Core consumer; no kernel execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {canonical,sha256} from '../../compiler/identity.mjs';
import {coreQuote} from '../../compiler/mlir-strings.mjs';
import {commonFieldId} from '../../compiler/common-program-identities.mjs';
import {readSystemQueryFacts} from '../../compiler/system-query-facts.mjs';
import {emitSystemQueryCore} from '../../compiler/system-query-core.mjs';
import {systemQueryFixture} from './system-query-fixtures.mjs';

const names=['architecture','aliases','duplicate','complete','wrapper-alias',
  'loop-architecture','loop-aliases','loop-multiple','loop-shared-component','loop-inheritance'];
const tool=process.env.TSFG_QUERY_CORE_EXE,output=process.env.TSFG_QUERY_CORE_OUTPUT;
const enabled=Boolean(tool&&output),children=[];
const programs=names.map(name=>{
  const input=systemQueryFixture(name),facts=readSystemQueryFacts(input.bytes,input.context);
  return {name,...input,facts};
});
const operationCount=(text,name)=>text.split('"'+name+'"').length-1;

/** @param {import('../../compiler/system-query-facts.mjs').SystemQueryLoopExpression} value
 * @returns {{loads:number,stores:number,arithmetic:number}} */
function sourceOperations(value){
  if(value.kind==='binary'){
    assert.ok(value.left&&value.right);
    const left=sourceOperations(value.left),right=sourceOperations(value.right);
    return {loads:left.loads+right.loads,stores:left.stores+right.stores,arithmetic:left.arithmetic+right.arithmetic+1};
  }
  if(value.kind==='fieldAssignment'){
    assert.ok(value.value&&value.target);
    const rhs=sourceOperations(value.value),compound=value.operator!=='=';
    return {loads:rhs.loads+Number(compound),stores:rhs.stores+1,arithmetic:rhs.arithmetic+Number(compound)};
  }
  return {loads:Number(value.kind==='fieldAccess'),stores:0,arithmetic:0};
}

for(const program of programs)test('actual Source to typed query Core: '+program.name,()=>{
  const text=emitSystemQueryCore(program.facts,program.context);
  assert.equal(typeof text,'string');
  assert.ok(text.includes('tsfg.query_stage = "logical"'));
  assert.ok(text.includes('tsfg.query_facts = '+coreQuote(canonical(program.packet))));
  assert.ok(text.includes('tsfg.query_request = '+coreQuote(canonical(JSON.parse(program.context.requestBytes.toString('utf8'))))));
  const loops=program.facts.systems.flatMap(system=>system.loops);
  assert.equal(operationCount(text,'tsfg.parallel_for'),loops.length);
  assert.equal(operationCount(text,'tsfg.column'),loops.reduce((n,loop)=>n+loop.bindings.length,0));
  const expected=loops.flatMap(loop=>loop.statements).map(statement=>sourceOperations(statement.value));
  assert.equal(operationCount(text,'tsfg.field_load'),expected.reduce((n,row)=>n+row.loads,0));
  assert.equal(operationCount(text,'tsfg.field_store'),expected.reduce((n,row)=>n+row.stores,0));
  const arithmetic=['add','sub','mul','div'].reduce((n,name)=>n+operationCount(text,'tsfg_core.'+name),0);
  assert.equal(arithmetic,expected.reduce((n,row)=>n+row.arithmetic,0));
  for(const system of program.facts.systems){
    assert.ok(text.includes('tsfg.query_source_function = '+coreQuote(system.declaration.id)));
    assert.ok(!text.includes('tsfg_core.function_id = '+coreQuote(system.declaration.id)));
  }
});

test('Core emission retains the selected original cold receipt and request identity',()=>{
  const program=programs.find(row=>row.name==='loop-architecture');assert.ok(program);
  assert.throws(()=>emitSystemQueryCore(program.facts,{...program.context,expectedPackageId:'sha256:'+'0'.repeat(64)}));
  const other=programs.find(row=>row.name==='loop-inheritance');assert.ok(other);
  assert.throws(()=>emitSystemQueryCore(program.facts,{...program.context,requestBytes:other.context.requestBytes}));
});

function invoke(label,input,mode='canonicalize',status=0){
  assert.ok(tool&&output,'an explicitly selected static Core consumer and output directory are required');
  mkdirSync(output,{recursive:true});
  const args=['--system-query','--'+mode],result=spawnSync(tool,args,{input:Buffer.from(input),windowsHide:true,timeout:60000,maxBuffer:8388608});
  const stdout=result.stdout??Buffer.alloc(0),stderr=result.stderr??Buffer.alloc(0);
  writeFileSync(output+'/'+label+'.input.mlir',input);
  writeFileSync(output+'/'+label+'.stdout.bin',stdout);writeFileSync(output+'/'+label+'.stderr.bin',stderr);
  children.push({label,args,pid:result.pid,status:result.status,signal:result.signal,error:result.error?.message??null,
    inputBytes:Buffer.byteLength(input),inputSHA256:sha256(input),stdoutBytes:stdout.length,stdoutSHA256:sha256(stdout),stderrBytes:stderr.length,stderrSHA256:sha256(stderr)});
  writeFileSync(output+'/children.json',JSON.stringify(children,null,2)+'\n');
  assert.ifError(result.error);assert.equal(result.status,status,stderr.toString());
  return {stdout,stderr};
}

for(const program of programs)test('independent static C++ query roundtrip: '+program.name,{skip:!enabled},()=>{
  const logical=emitSystemQueryCore(program.facts,program.context),bound=invoke(program.name+'-canonical',logical),
    repeated=invoke(program.name+'-roundtrip',bound.stdout.toString()),optimized=invoke(program.name+'-optimize',logical,'optimize');
  assert.deepEqual(repeated.stdout,bound.stdout);assert.deepEqual(optimized.stdout,bound.stdout);
  assert.ok(bound.stdout.toString().includes('tsfg.query_stage = "bound"'));
  assert.ok(bound.stdout.toString().includes('tsfg.query_layouts'));
});

test('independent C++ derives bound field offsets instead of trusting a reordered layout',{skip:!enabled},()=>{
  const program=programs.find(row=>row.name==='loop-architecture');assert.ok(program);
  const bound=invoke('layout-input',emitSystemQueryCore(program.facts,program.context)).stdout.toString(),
    attribute=bound.match(/tsfg\.query_layouts = "(?:\\.|[^"\\])*"/);
  assert.ok(attribute);
  let fields=0;
  const changedAttribute=attribute[0].replace(/\\22offset\\22:([04])(?=,|})/g,(text,offset)=>
    fields++<2?text.replace(':'+offset,offset==='0'?':4':':0'):text);
  assert.ok(fields>=2);assert.notEqual(changedAttribute,attribute[0]);
  const changed=bound.replace(attribute[0],changedAttribute);
  assert.equal(invoke('wrong-bound-field-offsets',changed,'canonicalize',3).stdout.length,0);
});

test('independent C++ refuses a different valid f32 operation at the original Source node',{skip:!enabled},()=>{
  const program=programs.find(row=>row.name==='loop-architecture');assert.ok(program);
  const original=emitSystemQueryCore(program.facts,program.context),changed=original.replace('"tsfg_core.mul"','"tsfg_core.add"');
  assert.notEqual(changed,original);const rejected=invoke('wrong-f32-operation',changed,'canonicalize',3);
  assert.equal(rejected.stdout.length,0);
});

test('independent C++ refuses another valid same-operator Source anchor',{skip:!enabled},()=>{
  const program=programs.find(row=>row.name==='loop-architecture');assert.ok(program);
  const statements=program.facts.systems[0].loops[0].statements,first=statements[0].value.value,second=statements[1].value.value;
  assert.ok(first&&second);
  const from='tsfg_source.start = '+first.range.start+' : i64, tsfg_source.end = '+first.range.end+' : i64',
    to='tsfg_source.start = '+second.range.start+' : i64, tsfg_source.end = '+second.range.end+' : i64';
  const original=emitSystemQueryCore(program.facts,program.context),changed=original.split('\n').map(line=>
    line.includes('"tsfg_core.mul"')&&line.includes(from)?line.replace(from,to):line).join('\n');
  assert.notEqual(changed,original);assert.equal(invoke('wrong-operator-source-anchor',changed,'canonicalize',3).stdout.length,0);
});

test('independent C++ replays original syntax after a forged Source packet is rehashed',{skip:!enabled},()=>{
  const program=programs.find(row=>row.name==='loop-architecture');assert.ok(program);
  const packet=structuredClone(program.packet),statements=packet.payload.systems[0].loops[0].statements;
  statements[0].value.value.operatorRange={...statements[1].value.value.operatorRange};
  packet.packageId=sha256('tsfg.system-query.package.v3\0'+packet.schemaHash+'\0'+canonical(packet.payload));
  const original=emitSystemQueryCore(program.facts,program.context),from='tsfg.query_facts = '+coreQuote(canonical(program.packet)),
    changed=original.replace(from,'tsfg.query_facts = '+coreQuote(canonical(packet)));
  assert.notEqual(changed,original);assert.equal(invoke('rehashed-wrong-source-operator',changed,'canonicalize',3).stdout.length,0);
});

test('independent C++ derives implicit constructor facts from the original class',{skip:!enabled},()=>{
  const program=programs.find(row=>row.name==='loop-architecture');assert.ok(program);
  const original=emitSystemQueryCore(program.facts,program.context);
  for(const kind of ['access','signature']){
    const packet=structuredClone(program.packet),position=packet.payload.types.find(row=>row.name==='Position');
    assert.ok(position?.construction);
    if(kind==='access')position.construction.access='private';
    else position.construction.signature.id='sha256:'+'0'.repeat(64);
    packet.packageId=sha256('tsfg.system-query.package.v3\0'+packet.schemaHash+'\0'+canonical(packet.payload));
    const changed=original.replace('tsfg.query_facts = '+coreQuote(canonical(program.packet)),
      'tsfg.query_facts = '+coreQuote(canonical(packet)));
    assert.notEqual(changed,original);assert.equal(invoke('wrong-construction-'+kind,changed,'canonicalize',3).stdout.length,0);
  }
});

test('independent C++ binds a component decorator to its actual lexical declaration',{skip:!enabled},()=>{
  const program=programs.find(row=>row.name==='complete');assert.ok(program);
  const packet=structuredClone(program.packet),request=JSON.parse(program.context.requestBytes.toString('utf8')),
    source=packet.payload.program.files.find(row=>row.path==='/src/main.ts');assert.ok(source);
  const before=source.content;source.content=before.replace('function unrelated(','function component(');
  assert.notEqual(source.content,before);assert.equal(source.content.length,before.length);
  assert.equal(Buffer.byteLength(source.content),Buffer.byteLength(before));source.sha256=sha256(source.content).slice(7);
  const declarations=packet.payload.nodes.filter(node=>node.sourcePath===source.path&&node.name==='unrelated');
  assert.equal(declarations.length,1);declarations[0].name='component';
  for(const file of request.input.files)if(file.path===source.path){file.content=source.content;file.sha256=source.sha256;}
  const files=packet.payload.program.files.map(({path,sha256})=>({path,sha256}));
  for(const type of packet.payload.types)if(type.nominalKey)
    type.runtimeKey=sha256('tsfg.array-facts.runtime-class.v8\0'+canonical({files,nominalKey:type.nominalKey}));
  packet.requestId=sha256('tsfg.system-query.request.v3\0'+canonical(request)+'\n');
  // This is malformed Source/Core input, never another passing Go example.
  // The local ordinary function now hoist-shadows the owned global decorator.
  const original=emitSystemQueryCore(program.facts,program.context);
  const eofKind=packet.payload.nodes.find(node=>node.kind==='KindEndOfFile'||node.kind==='KindEndOfFileToken')?.kind;
  assert.ok(eofKind);
  for(const disguise of ['named','hidden',eofKind,'KindExportDeclaration','KindExportAssignment',
    'KindVariableDeclaration','KindTypeParameter','KindBindingElement','absorbed-neighbor']){
    const negative=structuredClone(packet);
    if(disguise!=='named'){
      const declaration=negative.payload.nodes.find(node=>node.sourcePath===source.path&&node.name==='component');
      assert.ok(declaration);
      if(disguise==='absorbed-neighbor'){
        const box=negative.payload.nodes.find(node=>node.sourcePath===source.path&&node.kind==='KindClassDeclaration'&&node.name==='Box');
        assert.ok(box);assert.ok(box.range.end<declaration.range.start);
        const removed=new Set([declaration.id]);
        for(const node of negative.payload.nodes)if(removed.has(node.parent))removed.add(node.id);
        negative.payload.nodes=negative.payload.nodes.filter(node=>!removed.has(node.id));
        box.range.end=declaration.range.end;
      }else{
        declaration.name='';declaration.nameRange=null;
        if(disguise!=='hidden')declaration.kind=disguise;
        if(['KindVariableDeclaration','KindTypeParameter','KindBindingElement'].includes(disguise)){
          const start=source.content.indexOf('export function component(');
          assert.ok(start>=declaration.range.start&&start+6<declaration.range.end);
          declaration.name='export';declaration.nameRange={start,end:start+6};
        }
      }
      if(disguise!=='hidden'){
        const renamed=new Map();
        for(const node of negative.payload.nodes){
          const previous=node.id;node.parent=renamed.get(node.parent)??node.parent;
          node.id=sha256('tsfg.system-query.node.v1\0'+canonical({sourcePath:node.sourcePath,kind:node.kind,range:node.range,parent:node.parent}));
          renamed.set(previous,node.id);
        }
      }
    }
    negative.packageId=sha256('tsfg.system-query.package.v3\0'+negative.schemaHash+'\0'+canonical(negative.payload));
    const changed=original
      .replace('tsfg.query_facts = '+coreQuote(canonical(program.packet)),'tsfg.query_facts = '+coreQuote(canonical(negative)))
      .replace('tsfg.query_request = '+coreQuote(canonical(JSON.parse(program.context.requestBytes.toString('utf8')))),
        'tsfg.query_request = '+coreQuote(canonical(request)))
      .replace('tsfg_core.input_identity = '+coreQuote(program.facts.inputIdentity),'tsfg_core.input_identity = '+coreQuote(packet.requestId))
      .replace('tsfg_core.source_hash = '+coreQuote(sha256(before)),'tsfg_core.source_hash = '+coreQuote('sha256:'+source.sha256));
    assert.notEqual(changed,original);
    assert.equal(invoke('hoisted-component-shadow-'+disguise,changed,'canonicalize',3).stdout.length,0);
  }
});

test('independent C++ cannot omit a real system from both the asserted facts and Core body',{skip:!enabled},()=>{
  const program=programs.find(row=>row.name==='loop-architecture');assert.ok(program);
  assert.equal(program.facts.systems.length,1);
  const packet=structuredClone(program.packet);packet.payload.systems=[];
  packet.packageId=sha256('tsfg.system-query.package.v3\0'+packet.schemaHash+'\0'+canonical(packet.payload));
  const original=emitSystemQueryCore(program.facts,program.context),start=original.indexOf('\n  func.func @');
  assert.ok(start>0);
  const emptyModule=original.slice(0,start)+'\n}\n',changed=emptyModule.replace(
    'tsfg.query_facts = '+coreQuote(canonical(program.packet)),
    'tsfg.query_facts = '+coreQuote(canonical(packet)));
  assert.notEqual(changed,emptyModule);assert.equal(invoke('omitted-original-system',changed,'canonicalize',3).stdout.length,0);
});

test('independent C++ cannot relabel an original Source function as a lowered identity',{skip:!enabled},()=>{
  const program=programs.find(row=>row.name==='loop-architecture');assert.ok(program);
  const original=emitSystemQueryCore(program.facts,program.context),changed=original.replace(
    /tsfg_core\.function_id = "sha256:[0-9a-f]{64}"/,
    'tsfg_core.function_id = '+coreQuote(program.facts.systems[0].declaration.id));
  assert.notEqual(changed,original);assert.equal(invoke('wrong-function-identity-domain',changed,'canonicalize',3).stdout.length,0);
});

test('independent C++ refuses source-field shadow substitution and a conflicting borrow declaration',{skip:!enabled},()=>{
  const program=programs.find(row=>row.name==='loop-inheritance');assert.ok(program);
  const loop=program.facts.systems[0].loops[0],assignment=loop.statements[0].value;
  assert.ok(assignment.target&&assignment.target.sourceField);
  const types=program.packet.payload.types,base=types.find(row=>row.name==='Base');
  assert.ok(base&&Array.isArray(base.fields));const baseField=base.fields.find(row=>row.name==='x');assert.ok(baseField);
  const baseType=program.facts.components.find(row=>row.sourceType===base.id);assert.ok(baseType);
  const original=emitSystemQueryCore(program.facts,program.context),from='source_field = '+coreQuote(assignment.target.sourceField),
    shadow=original.replace(from,'source_field = '+coreQuote(baseField.id))
      .replace('field = '+coreQuote(assignment.target.property),'field = '+coreQuote(commonFieldId(baseType.typeId,baseField.name)));
  assert.notEqual(shadow,original);assert.equal(invoke('wrong-shadow-field',shadow,'canonicalize',3).stdout.length,0);
  const changedMode=original.replace('mode = "write"','mode = "read"');
  assert.notEqual(changedMode,original);assert.equal(invoke('wrong-borrow-mode',changedMode,'canonicalize',3).stdout.length,0);
});

test('independent C++ refuses a different query exchange version',{skip:!enabled},()=>{
  const program=programs.find(row=>row.name==='loop-architecture');assert.ok(program);
  const original=emitSystemQueryCore(program.facts,program.context),changed=original.replace(/tsfg.query_version = 2\s*:\s*i32/,'tsfg.query_version = 3 : i32');
  assert.notEqual(changed,original);assert.equal(invoke('wrong-query-version',changed,'canonicalize',3).stdout.length,0);
});
