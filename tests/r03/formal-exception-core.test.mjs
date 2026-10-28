// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {importCapturedFrontendResponse,validateFrontendSnapshot} from '../../compiler/frontend.mjs';
import {buildHir,verifyHir,printHir,readHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {expectedHir,hash,canonical} from './formal-exception-source-oracle.mjs';
import {expectedExceptionControl} from './formal-exception-control-oracle.mjs';
import {expectedExceptionModule} from './formal-exception-module-oracle.mjs';
import {invokeCore,accepted,rejected} from './generic-core-package-capture.mjs';
import {createExceptionOracle} from './exception-hir-v2-oracle.mjs';

async function firstProgram(){
  const root=new URL('../fixtures/r03/m21-exception/first/',import.meta.url);
  const names=['request.json','response.json','origin.json'];
  const bytes=await Promise.all(names.map(name=>readFile(new URL(name,root))));
  assert.deepEqual(bytes.map(hash),['sha256:8b081a06e3853bf8557206f3aafac4f8211622a224899a363c7c63bb34a030ed',
    'sha256:45317ccc970c8464d90cba8da674aea3da5756fbb39a7ba5dfc3326fad2d1a5a',
    'sha256:58842dfb6862b162c2cd82a6e79298905ebd3eec5d6e30618797d5e91b67f612']);
  const origin=JSON.parse(bytes[2].toString()),imported=await importCapturedFrontendResponse(bytes[0],bytes[1],origin);
  assert.equal(imported.status,'ok');validateFrontendSnapshot(imported.snapshot);
  const built=buildHir(imported.snapshot);assert.equal(built.status,'ok');
  const hir=readHir(Buffer.from(printHir(verifyHir(built.hir))));
  assert.deepEqual(hir,expectedHir(origin));return hir;
}

test('complete captured payload corpus uses its actual target and full function tables',
  {skip:!process.env.TSFG_CORE_IR_EXE},async t=>{
    const root=new URL('../fixtures/r03/m21-exception/corpus/',import.meta.url);
    const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
    for(const item of manifest.cases)await t.test(item.directory+' '+item.test,async()=>{
      const dir=new URL(item.directory+'/',root);
      const bytes=await Promise.all(['request.json','response.json','origin.json'].map(file=>readFile(new URL(file,dir))));
      for(const [index,file] of ['request.json','response.json','origin.json'].entries())
        assert.equal(hash(bytes[index]),'sha256:'+item.files[file].sha256);
      const imported=await importCapturedFrontendResponse(bytes[0],bytes[1],JSON.parse(bytes[2].toString('utf8')));
      assert.equal(imported.status,'ok',JSON.stringify(imported));
      const built=buildHir(imported.snapshot);assert.equal(built.status,'ok',JSON.stringify(built));
      assert.equal(built.hir.functions.length,imported.snapshot.facts.functions.length);
      if(imported.snapshot.target===null){
        assert.throws(()=>lowerFormalHir(built.hir),/target/);return;
      }
      const core=lowerFormalHir(built.hir),first=await invokeCore(core);accepted(first);
      const second=await invokeCore(first.stdout);accepted(second);assert.deepEqual(second.stdout,first.stdout);
    });
  });
test('complete first owned exception program enters ordinary Core and canonical fixedpoint',
  {skip:!process.env.TSFG_CORE_IR_EXE},async()=>{
    const hir=await firstProgram(),before=printHir(hir),core=lowerFormalHir(hir);
    const first=await invokeCore(core);accepted(first);
    const second=await invokeCore(first.stdout);accepted(second);assert.deepEqual(second.stdout,first.stdout);
    assert.equal(printHir(hir),before);assert.match(core,/tsfg_core.exception_program/);
  });

for (const [name,packetHash] of [['while-finally','sha256:4ecaea020dd8f165159207425065bab846be348b9f133df9a8bbc42afa7a39e7'],
  ['indirect-current-rethrow','sha256:2c5e0f0de879b2bd5f1e284d3573d25459b35938cfcc68c7b367ca65adcf9b11']]) {
  test('complete official '+name+' retains typed control and ordinary fixedpoint',{skip:!process.env.TSFG_CORE_IR_EXE},async()=>{
    const root=new URL('../fixtures/r03/m21-exception/controls/'+name+'/',import.meta.url);
    const [request,response,origin]=await Promise.all(['request.json','response.json','origin.json'].map(file=>readFile(new URL(file,root))));
    assert.equal(hash(response),packetHash);
    const imported=await importCapturedFrontendResponse(request,response,JSON.parse(origin.toString('utf8')));assert.equal(imported.status,'ok');
    const built=buildHir(imported.snapshot);assert.equal(built.status,'ok');
    const hir=readHir(Buffer.from(printHir(verifyHir(built.hir))));
    assert.deepEqual(hir,expectedExceptionControl(name,imported.snapshot),'complete independent new-node/type/region/function expectations');
    assert.equal(hir.functions.length,name==='while-finally'?1:2);
    if(name==='while-finally'){
      const loop=hir.functions[0].body.body[1];assert.equal(loop.kind,'while');
      assert.equal(loop.bodyRegion.body[0].kind,'try');assert.equal(loop.bodyRegion.body[0].finallyRegion.body[0].kind,'local');
    }else{
      const [fail,entry]=hir.functions;
      assert.equal(entry.body.body[0].initializer.target,fail.id);
      const invoke=entry.body.body[1].tryRegion.body[0].value;
      assert.equal(invoke.kind,'indirectCall');assert.equal(invoke.callee.binding,entry.body.body[0].binding);
      const caught=entry.body.body[1].catchClause;
      assert.equal(caught.region.body[0].value.binding,caught.binding);
    }
    const core=lowerFormalHir(hir),first=await invokeCore(core);accepted(first);
    const second=await invokeCore(first.stdout);accepted(second);assert.deepEqual(second.stdout,first.stdout);
  });
}

for(const name of ['standalone-block','try-finally-without-catch','catch-without-binding','false-with-present-else'])
  test('ordinary retained region control '+name,{skip:!process.env.TSFG_CORE_IR_EXE},async()=>{
    const root=new URL('../fixtures/r03/exception-region-presence/'+name+'/',import.meta.url);
    const [request,response,origin]=await Promise.all(['request.json','response.json','origin.json'].map(file=>readFile(new URL(file,root))));
    const imported=await importCapturedFrontendResponse(request,response,JSON.parse(origin.toString('utf8')));assert.equal(imported.status,'ok');
    const built=buildHir(imported.snapshot);assert.equal(built.status,'ok');
    const core=lowerFormalHir(built.hir),first=await invokeCore(core);accepted(first);
    const second=await invokeCore(first.stdout);accepted(second);assert.deepEqual(second.stdout,first.stdout);
  });

function lineChange(core,name,ordinal,change){
  let count=0;const lines=core.split('\n');
  const index=lines.findIndex(line=>line.includes('"'+name+'"')&&++count===ordinal);
  assert.notEqual(index,-1);const before=lines[index];lines[index]=change(before);assert.notEqual(lines[index],before);
  return lines.join('\n');
}
test('ordinary independent admission rejects forged current payload, handlers and pending completion',
  {skip:!process.env.TSFG_CORE_IR_EXE},async t=>{
    const hir=await firstProgram(),core=lowerFormalHir(hir),attempt=hir.functions[0].body.body[0];
    const original=/([%a-z0-9]+) = "tsfg_eh.pack"/.exec(core)[1];
    const bool='sha256:811afa3745352bcd218d039b4539ec7e7ca8d103420dbc4c8ab8d6119e850721';
    /** @type {[string,()=>string][]} */
    const cases=[
      ['payload tag retains actual width',()=>lineChange(core,'tsfg_eh.pack',1,line=>line.replace(hir.functions[0].body.bindings[0].type,bool))],
      ['nearest catch identity',()=>lineChange(core,'tsfg_eh.route',1,line=>line.replace(attempt.catchClause.region.scope,attempt.finallyRegion.scope))],
      ['rethrow reads current catch cell',()=>lineChange(core,'tsfg_eh.route',2,line=>line.replace(/\(%v\d+\)/,'('+original+')'))],
      ['finally preserves pending kind',()=>lineChange(core,'tsfg_eh.route',2,line=>line.replace('completion = "throw"','completion = "return"'))],
      ['finally resumes saved block argument',()=>lineChange(core,'tsfg_eh.raise',1,line=>line.replace(/\(%v\d+\)/,'('+original+')'))],
      ['catch binding initialization',()=>lineChange(core,'tsfg_eh.store',2,line=>line.replace('initialize = true','initialize = false'))],
      ['original full throw anchor',()=>lineChange(core,'tsfg_eh.pack',1,line=>line.replace('start = 56','start = 55'))],
      ['Fuel cannot enter a user handler',()=>lineChange(core,'tsfg_core.fuel',1,line=>line.replace('() {','() [^bb2] {'))],
    ];
    for(const [name,change] of cases)await t.test(name,async()=>{
      const result=await invokeCore(change());rejected(result);
      assert.match(result.stderr.toString(),/core-ir-formal-exception|core-ir-invalid/);
    });
    assert.equal(core,lowerFormalHir(hir));
  });
test('formal wire12 remains unsupported after ordinary admission',{skip:!process.env.TSFG_CORE_IR_EXE},async()=>{
  const result=await invokeCore(lowerFormalHir(await firstProgram()),'--emit-bytecode');
  assert.equal(result.close.code,3);assert.equal(result.stdout.length,0);
  assert.match(result.stderr.toString(),/\[r04-core-exception-unsupported\]/);
});

// Mutations are submitted directly to the independent consumer. Recompute
// serialization hashes only, never run the producer's verifier over bad input.
function changedProgram(core,hir,change){
  const changed=structuredClone(hir);change(changed);
  const before=canonical(hir)+'\n',after=canonical(changed)+'\n';assert.notEqual(after,before);
  const quoted=text=>'"'+Array.from(Buffer.from(text),byte=>byte>=32&&byte<=126&&byte!==34&&byte!==92
    ?String.fromCharCode(byte):'\\'+byte.toString(16).toUpperCase().padStart(2,'0')).join('')+'"';
  assert.ok(core.includes('hir = '+quoted(before)));
  return core.replace('hir = '+quoted(before),'hir = '+quoted(after))
    .replace('hir_hash = "'+hash(before)+'"','hir_hash = "'+hash(after)+'"')
    .replace('tsfg_core.input_identity = "'+hir.inputIdentity+'"','tsfg_core.input_identity = "'+changed.inputIdentity+'"')
    .replace('tsfg_core.source_hash = "'+hir.sources[0].hash+'"','tsfg_core.source_hash = "'+changed.sources[0].hash+'"')
    .replace('tsfg_core.source_length = '+hir.sources[0].length+' : i64','tsfg_core.source_length = '+changed.sources[0].length+' : i64');
}
test('ordinary consumer independently refuses cold Source profile and logical binding forgeries',
  {skip:!process.env.TSFG_CORE_IR_EXE},async t=>{
    const hir=await firstProgram(),core=lowerFormalHir(hir);
    const requestChange=change=>h=>{
      const request=JSON.parse(h.snapshot.capture.request);change(request.input);
      h.snapshot.capture.request=canonical(request);h.snapshot.sourceOrigin.requestSha256=hash(h.snapshot.capture.request);
    };
    /** @type {[string,(hir:any)=>void,RegExp][]} */
    const cases=[
      ['actual producer identity shape',h=>{h.snapshot.sourceOrigin.producerBaseOid='g'.repeat(40);},/complete owned Source envelope/],
      ['actual input-set digest shape',h=>{h.snapshot.sourceOrigin.testedInputSetHash='sha256:'+'g'.repeat(64);},/complete owned Source envelope/],
      ['strict input configuration',requestChange(input=>{input.config.strict=false;}),/Source declaration\/configuration contract/],
      ['extra input configuration',requestChange(input=>{input.config.skipLibCheck=true;}),/Source declaration\/configuration contract/],
      ['unknown declaration profile',requestChange(input=>{input.declarations.version='invented';}),/declaration profile/],
      ['logical root traversal',requestChange(input=>{input.sourceRoot='/src/..';}),/Source logical roots/],
      ['own parameter cannot double as capture',h=>{h.functions[0].captures=[{binding:h.functions[0].parameters[0],read:true,write:false}];},/captures differ/],
      ['Source parameter IDs must be distinct',h=>{h.functions[0].parameters.push(h.functions[0].parameters[0]);},/own ordered Source parameters/],
    ];
    for(const [name,change,diagnostic] of cases)await t.test(name,async()=>{
      const result=await invokeCore(changedProgram(core,hir,change));rejected(result);
      assert.match(result.stderr.toString(),/core-ir-formal-exception/);assert.match(result.stderr.toString(),diagnostic);
    });
    assert.equal(core,lowerFormalHir(hir));
  });

const formalControls=[
  ['finally-overrides','sha256:da0b14005571347c6972cc84b57f18c4efe7224cd9c4152a77fa73be80cfa7d8'],
  ['catch-write-statement','sha256:d431c3a0b6e15b96a23c3b03094bb0dbe5a5a8d9c6b812fcd7d1c5e27625f598'],
  ['catch-write-nested','sha256:7a1b8d4bd3d666c7d9a898a6d7ac62c5f63e7ed4174111e17165e1ff34d0975b'],
  ['module-initialization','sha256:52de1db4d66779fea3376102df4f455b72c687348659e92abb42c20350ebb6b7'],
  ['literal-true-while','sha256:7687f88c2d5416331f8b57305da958da9ed27781968dff06f62bfef96e712870'],
];
for(const [name,pin] of formalControls)test('complete Source21h '+name+' ordinary fixedpoint',
  {skip:!process.env.TSFG_CORE_IR_EXE},async()=>{
    const root=new URL('../fixtures/r03/m21-exception/controls/'+name+'/',import.meta.url);
    const [request,response,origin]=await Promise.all(['request.json','response.json','origin.json'].map(file=>readFile(new URL(file,root))));
    assert.equal(hash(response),pin);const imported=await importCapturedFrontendResponse(request,response,JSON.parse(origin.toString('utf8')));
    assert.equal(imported.status,'ok',JSON.stringify(imported));const built=buildHir(imported.snapshot);assert.equal(built.status,'ok',JSON.stringify(built));
    const hir=readHir(Buffer.from(printHir(verifyHir(built.hir))));
    assert.equal(hir.functions.length,imported.snapshot.facts.functions.length,'complete table, including non-entry declarations');
    assert.deepEqual(hir.target,JSON.parse(request.toString('utf8')).input.target);
    if(name==='finally-overrides'||name==='literal-true-while')assert.deepEqual(hir,expectedExceptionControl(name,imported.snapshot));
    if(name==='module-initialization')assert.deepEqual(hir,expectedExceptionModule(imported.snapshot));
    const core=lowerFormalHir(hir);
    if(name==='literal-true-while')assert.match(core,/"tsfg_eh\.unreachable"/);
    const first=await invokeCore(core);accepted(first);const second=await invokeCore(first.stdout);accepted(second);
    assert.deepEqual(second.stdout,first.stdout);
  });

test('C++ identifier property data matches the exact language Unicode properties',async()=>{
  const header=await readFile(new URL('../../compiler/core-ir/formal-exception-identifiers.h',import.meta.url),'utf8');
  /** @type {[string,RegExp][]} */
  const properties=[['ID_Start',/^\p{ID_Start}$/u],['ID_Continue',/^\p{ID_Continue}$/u]];
  for(const [property,pattern] of properties){
    const body=header.split(property+'[] = {')[1]?.split('};')[0];assert.ok(body);
    const ranges=Array.from(body.matchAll(/\{0x([0-9a-f]+),0x([0-9a-f]+)\}/g),m=>[parseInt(m[1],16),parseInt(m[2],16)]);
    assert.ok(ranges.length>0);let index=0,previous=-1;
    for(const [first,last] of ranges){assert.ok(first>previous&&last>=first);previous=last;}
    for(let point=0;point<=0x10ffff;point++){
      while(index<ranges.length&&point>ranges[index][1])index++;
      const present=index<ranges.length&&point>=ranges[index][0];
      assert.equal(present,pattern.test(String.fromCodePoint(point)),property+' U+'+point.toString(16));
    }
  }
});

function reframeColdSource(hir,change){
  const snapshot=hir.snapshot,request=JSON.parse(snapshot.capture.request),response=JSON.parse(snapshot.capture.response);
  change(request.input,response.payload.facts);
  const input={...request.input,files:request.input.files.map(({path,content})=>({path,content})).sort((a,b)=>a.path<b.path?-1:1)};
  const inputIdentity=hash(canonical(input));snapshot.identityInput=input;snapshot.inputIdentity=inputIdentity;hir.inputIdentity=inputIdentity;
  const sources=input.files.filter(file=>!file.path.endsWith('.d.ts')).map(file=>({...file,hash:hash(file.content),length:file.content.length,positionUnit:'utf16'}));
  hir.sources=sources;snapshot.sources=structuredClone(sources);snapshot.facts=structuredClone(response.payload.facts);
  response.payload.inputIdentity=inputIdentity;response.payload.files=input.files.map(file=>({path:file.path,digest:hash(file.content),
    byteLength:Buffer.byteLength(file.content),length:file.content.length,positionUnit:'utf16'}));
  snapshot.capture.request=canonical(request);response.requestId=hash('tsfg.exception-facts.request.v1\0'+snapshot.capture.request);
  response.packageId=hash('tsfg.exception-facts.package.v1\0'+response.schemaHash+'\0'+canonical(response.payload));
  snapshot.capture.response=canonical(response);snapshot.sourceOrigin.requestSha256=hash(snapshot.capture.request);
  snapshot.sourceOrigin.responseSha256=hash(snapshot.capture.response);
  snapshot.snapshotId=hash('tsfg.frontend-exception-candidate.snapshot.v1\0'+response.schemaHash+'\0'
    +canonical({inputIdentity,sourceOrigin:snapshot.sourceOrigin}));
}
test('ordinary Source lexer rejects invalid decoded identifier positions before semantic identity checking',
  {skip:!process.env.TSFG_CORE_IR_EXE},async t=>{
    const hir=await firstProgram(),core=lowerFormalHir(hir);
    for(const [name,spelling] of [['ASCII escape start','\\u0028'],['ASCII escape continuation','e\\u0028'],
      ['Unicode punctuation','\\u{1f600}'],['Unicode digit at start','\\u0660']])await t.test(name,async()=>{
      const changed=changedProgram(core,hir,h=>reframeColdSource(h,input=>{
        const file=input.files.find(file=>!file.path.endsWith('.d.ts'));assert.ok(file.content.includes('function entry'));
        file.content=file.content.replace('function entry','function '+spelling);
      }));
      const result=await invokeCore(changed);rejected(result);assert.match(result.stderr.toString(),/decoded Source identifier code point/);
    });
  });
test('ordinary Source rejects unknown cold nested declaration and lexical-parent references without abort',
  {skip:!process.env.TSFG_CORE_IR_EXE},async t=>{
    const root=new URL('../fixtures/r03/m21-exception/corpus/08/',import.meta.url);
    const [request,response,origin]=await Promise.all(['request.json','response.json','origin.json'].map(file=>readFile(new URL(file,root))));
    const imported=await importCapturedFrontendResponse(request,response,JSON.parse(origin.toString('utf8')));assert.equal(imported.status,'ok');
    const built=buildHir(imported.snapshot);assert.equal(built.status,'ok');const hir=built.hir,core=lowerFormalHir(hir);
    /** @type {[string,(facts:any)=>void,RegExp][]} */
    const changes=[
      ['declaration symbol',facts=>{facts.functions[0].body[0].exception.catchClause.block.body[0].symbol.id='unregistered';},/unknown function symbol/],
      ['lexical parent',facts=>{facts.functions[1].lexicalParent='unregistered';},/unknown lexical parent function/],
    ];
    for(const [name,change,diagnostic] of changes)await t.test(name,async()=>{
      const result=await invokeCore(changedProgram(core,hir,h=>reframeColdSource(h,(_input,facts)=>change(facts))));
      rejected(result);assert.match(result.stderr.toString(),diagnostic);
    });
  });

async function capturedControl(name){
  const root=new URL('../fixtures/r03/m21-exception/controls/'+name+'/',import.meta.url);
  const [request,response,origin]=await Promise.all(['request.json','response.json','origin.json'].map(file=>readFile(new URL(file,root))));
  const imported=await importCapturedFrontendResponse(request,response,JSON.parse(origin.toString()));assert.equal(imported.status,'ok');
  const built=buildHir(imported.snapshot);assert.equal(built.status,'ok');return built.hir;
}
test('ordinary Source resolves the nearest callable name before direct-call admission',
  {skip:!process.env.TSFG_CORE_IR_EXE},async()=>{
    const hir=await capturedControl('indirect-current-rethrow'),core=lowerFormalHir(hir),fail=hir.functions[0];
    let changed=changedProgram(core,hir,h=>{
      reframeColdSource(h,(_input,facts)=>{
        const before=facts.functions[1].body[1].exception.tryBlock.body[0].expression;
        facts.functions[1].body[1].exception.tryBlock.body[0].expression={kind:'call',type:'i32',range:before.range,
          target:facts.functions[0].symbol,name:'selected',arguments:before.arguments};
      });
      const before=h.functions[1].body.body[1].tryRegion.body[0].value;
      h.functions[1].body.body[1].tryRegion.body[0].value={kind:'directCall',type:before.type,range:before.range,
        target:fail.id,arguments:before.arguments,signature:{ownerKind:'function',owner:fail.id,type:fail.type}};
    });
    // Change the actual SSA call too, omitting the selected-cell load that a
    // claimed direct call would not perform. This must fail at Source resolution.
    const loaded=/"tsfg_eh.invoke_indirect"\((%v\d+), /.exec(changed)[1];
    changed=changed.split('\n').filter(line=>!line.includes(loaded+' = "tsfg_eh.load"')).join('\n');
    changed=lineChange(changed,'tsfg_eh.invoke_indirect',1,line=>line.replace('tsfg_eh.invoke_indirect','tsfg_eh.invoke')
      .replace(/\(%v\d+, /,'(').replace(/callable_type = "[^"]+"/,'callee = "f'+fail.id.slice(7)+'", function_id = "'+fail.id+'"')
      .replace(/: \(!tsfg_eh\.value<"[^"]+">, /,': ('));
    const result=await invokeCore(changed);rejected(result);assert.match(result.stderr.toString(),/direct call scope\/signature/);
  });
test('ordinary Source joins its own ordered parameters before actual initialization',
  {skip:!process.env.TSFG_CORE_IR_EXE},async t=>{
    const hir=await capturedControl('indirect-current-rethrow'),core=lowerFormalHir(hir),own=hir.functions[0].parameters[0];
    const foreign=changedProgram(core,hir,h=>{h.functions[0].parameters[0]=h.functions[1].parameters[0];});
    const removed=foreign.split('\n').filter(line=>!(line.includes('"tsfg_eh.store"')&&line.includes('binding = "'+own+'"'))).join('\n');
    const ordered=await capturedControl('finally-overrides'),orderedCore=lowerFormalHir(ordered);
    /** @type {[string,string,RegExp][]} */
    const cases=[['foreign parameter and omitted own init',removed,/own ordered Source parameters/],
      ['reversed own parameters',changedProgram(orderedCore,ordered,h=>{h.functions[0].parameters.reverse();}),/own ordered Source parameters/],
      ['missing actual parameter init',core.split('\n').filter(line=>!(line.includes('"tsfg_eh.store"')&&line.includes('binding = "'+own+'"'))).join('\n'),/operation does not match owned/]];
    for(const [name,input,diagnostic] of cases)await t.test(name,async()=>{
      const result=await invokeCore(input);rejected(result);assert.match(result.stderr.toString(),diagnostic);
    });
  });

test('ordinary Source predeclares a nearest local before its initializer (TDZ)',
  {skip:!process.env.TSFG_CORE_IR_EXE},async()=>{
    const hir=await firstProgram(),core=lowerFormalHir(hir),remap=new Map(),entity=createExceptionOracle().entity;
    let changed=changedProgram(core,hir,h=>{
      reframeColdSource(h,(input,facts)=>{
        const file=input.files.find(file=>!file.path.endsWith('.d.ts'));
        file.content=file.content.replace('const copied','const value ');
        const symbol=facts.symbols.find(symbol=>symbol.name==='copied');symbol.name='value';symbol.range.end--;
        const local=facts.functions[0].body[0].exception.finallyBlock.body[0].symbol;local.name='value';local.range.end--;
      });
      const f=h.functions[0],module=h.modules[0];
      remap.set(module.id,entity('module',{source:{path:module.sourcePath,digest:h.sources[0].hash},external:true}));
      remap.set(f.id,entity('function',{module:remap.get(module.id),parent:null,declaringScopePath:[],name:f.name,
        signatureHash:f.signatureHash,range:f.range}));
      remap.set(f.declaringScope,entity('scope',{ownerKind:'module',owner:remap.get(module.id),path:[]}));
      const visit=node=>{
        if(!node||typeof node!=='object')return;
        if(node.kind==='region'){
          remap.set(node.scope,entity('scope',{ownerKind:'function',owner:remap.get(f.id),path:node.path}));
          const ordinals={};for(const b of node.bindings){
            remap.set(b.id,entity('binding',{ownerKind:'function',owner:remap.get(f.id),scopePath:node.path,role:b.role,index:ordinals[b.role]??0}));
            ordinals[b.role]=(ordinals[b.role]??0)+1;
            if(b.name==='copied'){b.name='value';b.range.end--;}
          }
        }
        for(const value of Object.values(node))if(value&&typeof value==='object')for(const child of Array.isArray(value)?value:[value])visit(child);
      };visit(f.body);
      const replace=value=>typeof value==='string'?remap.get(value)??value:Array.isArray(value)?value.map(replace):value&&typeof value==='object'
        ?Object.fromEntries(Object.entries(value).map(([key,child])=>[key,key==='snapshot'?child:replace(child)])):value;
      Object.assign(h,replace(h));
    });
    for(const [before,after] of remap)changed=changed.replaceAll(before,after).replaceAll('f'+before.slice(7),'f'+after.slice(7));
    changed=lineChange(changed,'tsfg_eh.cell',3,line=>line.replace('end = 148','end = 147'));
    const result=await invokeCore(changed);rejected(result);assert.match(result.stderr.toString(),/reference scope, TDZ or original binding/);
  });

test('ordinary stdin budgets bytes before MLIR parsing and accepts the exact limit',
  {skip:!process.env.TSFG_CORE_IR_EXE},async()=>{
    const limit=8388608,core=lowerFormalHir(await firstProgram());
    const padded=core+'//'+ ' '.repeat(limit-Buffer.byteLength(core)-3)+'\n';
    assert.equal(Buffer.byteLength(padded),limit);accepted(await invokeCore(padded));
    const overflow='!\n'+' '.repeat(limit-1);assert.equal(Buffer.byteLength(overflow),limit+1);
    const result=await invokeCore(overflow);rejected(result);
    assert.match(result.stderr.toString(),/^\[core-ir-input-budget\]/);assert.doesNotMatch(result.stderr.toString(),/parse|loc\(/);
    for(const [command,diagnostic] of [['--emit-string-candidate','core-ir-string-budget'],['--emit-array-candidate','core-ir-array-budget']]){
      const packet=await invokeCore(overflow,command);rejected(packet);
      assert.equal(packet.stderr.toString().trim(),'['+diagnostic+'] input exceeds candidate byte budget');
    }
  });

test('ordinary Source cannot resolve a shadowed constructor through the type namespace',
  {skip:!process.env.TSFG_CORE_IR_EXE},async()=>{
    const root=new URL('../fixtures/r03/m21-exception/corpus/20/',import.meta.url);
    const [request,response,origin]=await Promise.all(['request.json','response.json','origin.json'].map(file=>readFile(new URL(file,root))));
    const imported=await importCapturedFrontendResponse(request,response,JSON.parse(origin.toString()));assert.equal(imported.status,'ok');
    const built=buildHir(imported.snapshot);assert.equal(built.status,'ok');const hir=built.hir,core=lowerFormalHir(hir),map=new Map();
    const entity=createExceptionOracle().entity;
    const replace=value=>typeof value==='string'?map.get(value)??value:Array.isArray(value)?value.map(replace):value&&typeof value==='object'
      ?Object.fromEntries(Object.entries(value).map(([key,child])=>[key,key==='snapshot'?child:replace(child)])):value;
    const positive=await invokeCore(core);accepted(positive);
    const fixed=await invokeCore(positive.stdout);accepted(fixed);assert.deepEqual(fixed.stdout,positive.stdout);
    let oldEnd=0,oldReadEnd=0;
    let changed=changedProgram(core,hir,h=>{
      reframeColdSource(h,(input,facts)=>{
        const file=input.files.find(file=>!file.path.endsWith('.d.ts'));file.content=file.content.replaceAll('value','Pair ');
        const param=facts.functions[0].parameters[0],symbol=facts.symbols.find(s=>s.id===param.id);
        oldEnd=param.range.end;param.name='Pair';param.range.end--;symbol.name='Pair';symbol.range.end--;
        const read=facts.functions[0].body[1].expression;oldReadEnd=read.range.end;read.range.end--;
      });
      const f=h.functions[0],module=h.modules[0],nominal=h.types.find(t=>t.kind==='aggregate');
      map.set(nominal.id,entity('type',{kind:'aggregate',source:{path:module.sourcePath,digest:h.sources[0].hash},
        category:nominal.category,declarationPath:nominal.nominalKey.declarationPath}));
      for(const type of h.types.filter(t=>t.kind==='callable'))map.set(type.id,entity('type',replace({kind:type.kind,parameters:type.parameters,returnType:type.returnType})));
      for(const ctor of nominal.constructors){
        const signature=entity('signature',{parameters:[],returnType:map.get(nominal.id)});map.set(ctor.signatureHash,signature);
        map.set(ctor.id,entity('constructor',{owner:map.get(nominal.id),ordinal:0,signatureHash:signature}));
      }
      map.set(module.id,entity('module',{source:{path:module.sourcePath,digest:h.sources[0].hash},external:true}));
      map.set(f.id,entity('function',{module:map.get(module.id),parent:null,declaringScopePath:[],name:f.name,signatureHash:f.signatureHash,range:f.range}));
      map.set(f.declaringScope,entity('scope',{ownerKind:'module',owner:map.get(module.id),path:[]}));
      map.set(f.body.scope,entity('scope',{ownerKind:'function',owner:map.get(f.id),path:[]}));
      const ordinals={};for(const b of f.body.bindings){
        map.set(b.id,entity('binding',{ownerKind:'function',owner:map.get(f.id),scopePath:[],role:b.role,index:ordinals[b.role]??0}));
        ordinals[b.role]=(ordinals[b.role]??0)+1;
        if(b.role==='parameter'){b.name='Pair';b.range.end--;}
      }
      f.body.body[1].value.range.end--;Object.assign(h,replace(h));h.types.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    });
    for(const [before,after] of map)changed=changed.replaceAll(before,after).replaceAll('f'+before.slice(7),'f'+after.slice(7));
    changed=changed.replaceAll('end = '+oldEnd+' : i64','end = '+(oldEnd-1)+' : i64');
    changed=lineChange(changed,'tsfg_eh.load',1,line=>line.replace('end = '+oldReadEnd,'end = '+(oldReadEnd-1)));
    const result=await invokeCore(changed);rejected(result);assert.match(result.stderr.toString(),/constructor name is shadowed/);
  });
