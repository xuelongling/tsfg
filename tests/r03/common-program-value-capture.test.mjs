// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram,verifyCommonProgramHir,printCommonProgramHir,readCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {emitCommonProgramCore} from '../../compiler/common-program-core.mjs';
import {commonProgramPhysical} from '../../compiler/common-program-physical.mjs';
import {commonIdentity} from '../../compiler/common-program-identities.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
const packet=name=>readCommonProgramFacts(readFileSync(new URL('./testdata/common-value-capture/'+name+'.json',import.meta.url)));
const names=['local-const','local-let','owner-write','sibling-write','sibling-early-write','parameter','parameter-rebind','ancestor','ancestor-rebind','shadow','copy-scalar','return-copy','nested-value','nested-copy','managed-fields','owner-resize','slot-replaced','borrow-slot-replaced','alias-type','named-import','const-field-write','const-managed-field-write'];
// These retained fixtures construct base value classes. Check the Source9
// control/data protocol across both inline and explicit public constructors;
// physical inline layout, sharing and copy isolation remain the tests below.
/** @param {string} core @param {ReturnType<typeof projectCommonProgram>} hir */
function assertValueConstructionProtocol(core,hir){
  const unquote=token=>{/** @type {unknown} */ const value=JSON.parse(token);assert.ok(typeof value==='string');return value;},
    functions=core.slice(core.indexOf('\n')+1).split(/(?=^  func\.func )/m).filter(text=>text.startsWith('  func.func ')).map(text=>{
      const header=text.split('\n')[0],identity=/tsfg_program.function_id = "([^"]+)"/.exec(header);assert.ok(identity);
      const rows=text.split('\n').flatMap(line=>{
        const op=/^\s+(?:(%\w+) = )?"([^"]+)"\(([^)]*)\)/.exec(line);if(!op)return [];
        const property=/properties = ("(?:\\.|[^"\\])*")/.exec(line),view=/view_type = ("(?:\\.|[^"\\])*")/.exec(line),
          edges=/\[([^\]]+)\]/.exec(line),source=/tsfg_source.start = (\d+) : i64, tsfg_source.end = (\d+) : i64/.exec(line);assert.ok(source);
        /** @type {Record<string,unknown>} */ const properties=property?JSON.parse(unquote(property[1])):{};
        return [{name:op[2],result:op[1]??null,operands:op[3]?op[3].split(',').map(value=>value.trim()):[],properties,
          view:view?unquote(view[1]):null,successors:edges?edges[1].split(',').map(value=>value.trim().slice(1)):[],
          range:[Number(source[1]),Number(source[2])],line}];
      });
      return {id:identity[1],header,text,rows};
    });
  const blockValue=(fn,label)=>{
    const line=fn.text.split('\n').find(row=>row.startsWith('  ^'+label+'('));assert.ok(line);
    const parameter=/^  \^[^(]+\((%\w+): (.+)\):$/.exec(line);assert.ok(parameter);
    assert.equal(/carrier<"(?:receiver|initialization):/.test(parameter[2]),false,'normal selected result is language data, not a control carrier');
    return parameter[1];
  };
  let constructions=0;
  for(const caller of functions)for(const create of caller.rows.filter(row=>row.name==='tsfg_program.receiver_create')){
    const type=hir.types.find(row=>row.kind==='value'&&row.id===create.properties.owner);if(!type)continue;
    constructions++;assert.ok(!type.base,'these fixed value fixtures use base constructors');
    assert.deepEqual(create.properties,{construction:type.construction.id,new_target:type.id,owner:type.id});
    const frame=create.result;assert.ok(frame);assert.deepEqual(create.operands,[]);assert.equal(create.view,'receiver:'+type.id);
    let owner=caller,entryFrame=frame,completion;
    if(type.construction.functionId){
      const call=caller.rows.find(row=>row.name==='tsfg_program.invoke'&&row.properties.function_id===type.construction.functionId&&row.operands.includes(frame));assert.ok(call);
      assert.ok(caller.rows.indexOf(create)<caller.rows.indexOf(call));assert.equal(call.successors.length,2);
      const ctor=functions.find(fn=>fn.id===type.construction.functionId);assert.ok(ctor);owner=ctor;
      assert.ok(ctor.header.includes('tsfg_program.role = "construction-body"'));
      const parameters=/\((.*?)\) (?:->|attributes)/.exec(ctor.header);assert.ok(parameters);
      const signature=parameters[1].split(',').map(value=>value.trim()),frameIndex=signature.findIndex(value=>value.endsWith(': !tsfg_program.carrier<"receiver:'+type.id+'">'));
      assert.ok(frameIndex>=0);entryFrame=signature[frameIndex].split(': ')[0];assert.equal(call.operands[frameIndex],frame);
      assert.deepEqual(caller.rows.filter(row=>row.operands.includes(frame)).map(row=>row.name),['tsfg_program.invoke'],'caller passes Frame only to its real constructor');
      completion=call;
    }
    const allocate=owner.rows.find(row=>row.name==='tsfg_program.receiver_allocate'&&row.operands[0]===entryFrame),
      bind=owner.rows.find(row=>row.name==='tsfg_program.receiver_bind'&&row.operands[0]===entryFrame);assert.ok(allocate&&bind);
    assert.deepEqual(allocate.properties,{owner:type.id});assert.equal(allocate.view,type.id);
    assert.deepEqual(bind.properties,{owner:type.id});assert.deepEqual(bind.operands,[entryFrame,allocate.result]);assert.equal(bind.successors.length,2);
    const selected=blockValue(owner,bind.successors[0]),begin=owner.rows.find(row=>row.name==='tsfg_program.initialize_begin'&&row.operands[0]===entryFrame);assert.ok(begin);
    assert.deepEqual(begin.properties,{owner:type.id});assert.deepEqual(begin.operands,[entryFrame,selected]);assert.equal(begin.view,'initialization:'+type.id);
    assert.ok(owner.rows.indexOf(allocate)<owner.rows.indexOf(bind)&&owner.rows.indexOf(bind)<owner.rows.indexOf(begin));
    let cursor=begin.result;assert.ok(cursor);let previous=owner.rows.indexOf(begin);
    for(const fieldId of type.construction.initializationFields){
      const previousCursor=cursor,field=type.fields.find(row=>row.id===fieldId),define=owner.rows.find(row=>row.name==='tsfg_program.initialize_field'&&row.properties.field===fieldId&&row.operands[0]===previousCursor);assert.ok(field&&define);
      assert.deepEqual(define.properties,{field:field.id,owner:type.id});assert.deepEqual(define.operands.slice(0,2),[previousCursor,selected]);
      assert.equal(define.view,'initialization:'+type.id);assert.deepEqual(define.range,[field.origin.start,field.origin.end]);
      let copied=owner.rows.find(row=>row.result===define.operands[2]);const visited=new Set();
      while(copied?.name==='tsfg_program.carrier_cast'){assert.equal(visited.has(copied),false);visited.add(copied);const value=copied.operands[0];copied=owner.rows.find(row=>row.result===value);}
      assert.ok(copied);assert.equal(copied.name,'tsfg_program.value_copy');assert.equal(copied.properties.type,field.type);
      assert.ok(owner.rows.indexOf(copied)<owner.rows.indexOf(define)&&owner.rows.indexOf(define)>previous);
      assert.deepEqual(owner.rows.filter(row=>row.operands.includes(previousCursor)).map(row=>row.name),['tsfg_program.initialize_field'],'cursor is consumed only by its next field');
      previous=owner.rows.indexOf(define);cursor=define.result;assert.ok(cursor);
    }
    const finalCursor=cursor,end=owner.rows.find(row=>row.name==='tsfg_program.initialize_end'&&row.operands[0]===finalCursor),
      result=owner.rows.find(row=>row.name==='tsfg_program.receiver_result'&&row.operands[0]===entryFrame);assert.ok(end&&result);
    assert.deepEqual(end.properties,{owner:type.id});assert.deepEqual(end.operands,[finalCursor,selected]);assert.ok(previous<owner.rows.indexOf(end)&&owner.rows.indexOf(end)<owner.rows.indexOf(result));
    assert.deepEqual(owner.rows.filter(row=>row.operands.includes(finalCursor)).map(row=>row.name),['tsfg_program.initialize_end']);
    assert.deepEqual(result.properties,{owner:type.id});assert.equal(result.successors.length,2);
    assert.ok(owner.rows.filter(row=>row.operands.includes(entryFrame)).every(row=>['receiver_allocate','receiver_bind','initialize_begin','receiver_get','receiver_result'].map(name=>'tsfg_program.'+name).includes(row.name)),
      'constructor Frame never enters ordinary value copies, storage, environments or returns');
    completion??=result;const returned=blockValue(caller,completion.successors[0]);
    assert.ok(caller.rows.some(row=>row.name==='tsfg_program.value_copy'&&row.operands[0]===returned&&row.properties.type===type.id),
      'successful value receiver is copied as value data at the caller');
    assert.ok(caller.rows.indexOf(create)<caller.rows.indexOf(completion));
  }
  assert.ok(constructions>0,'the public source really constructs a value via Source9');
  assert.doesNotMatch(core,/"tsfg_program\.construct_value"/);
}
for(const name of names)test('complete official nominal value capture retains inline copies in shared environment: '+name,()=>{
  const source=packet(name),hir=projectCommonProgram(source),types=new Map(hir.types.map(t=>[t.id,t])),
    slots=hir.environments.flatMap(e=>e.slots).filter(s=>types.get(s.type)?.kind==='value');
  assert.ok(slots.length>0);
  assert.deepEqual(readCommonProgramHir(Buffer.from(printCommonProgramHir(hir))),hir);
  const publication=createCommonProgramPublication(hir),request={targets:hir.closure.requiredRoots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()};
  if(['owner-resize','borrow-slot-replaced'].includes(name)){
    assert.throws(()=>emitCommonProgramCore(hir,publication,request),e=>e instanceof Error&&'code'in e&&['r03-common-program-borrow-pending','r03-common-program-borrow-conflict'].includes(String(e.code)));return;
  }
  const core=emitCommonProgramCore(hir,publication,request);
  assert.match(core,/tsfg_program.env_load/);assertValueConstructionProtocol(core,hir);assert.match(core,/tsfg_program.value_copy/);
  if(process.env.TSFG_VALUE_CORE_ROOT){mkdirSync(process.env.TSFG_VALUE_CORE_ROOT,{recursive:true});writeFileSync(process.env.TSFG_VALUE_CORE_ROOT+'/'+name+'.mlir',core);}
});
for(const change of ['owner','binding','type','occurrence','entry-root','source-spelling'])test('self-hashed original value capture rejects '+change,()=>{
  const value=structuredClone(packet('parameter')),owner=value.payload.functions.find(f=>f.name==='fromValue'),reader=value.payload.functions.find(f=>f.name==='readOwned'),held=owner.parameters.find(p=>p.name==='held');
  if(change==='owner')held.lexicalOwner=reader.id;
  if(change==='binding')reader.captures[0].binding=value.payload.functions.find(f=>f.name==='makeOwnedReader').parameters[0].id;
  if(change==='type')held.declaredType='i32';
  if(change==='occurrence')reader.captures[0].occurrences[0].range.start++;
  if(change==='entry-root')value.payload.entryCompatibilityRoots.push({functionId:owner.id,parameterBinding:held.id,viewType:held.declaredType,origin:{source:owner.sourcePath,...held.declarationRange},roots:[]});
  if(change==='source-spelling'){
    const source=value.payload.files.find(f=>f.path==='/src/main.ts');source.content=source.content.replace('return held.n;','return seed.n;');source.sha256=sha256(source.content).slice(7);
    for(const type of value.payload.types)if(['reference','value'].includes(type.kind))type.runtimeKey=sha256('tsfg.array-facts.runtime-class.v8\0'+canonical({files:value.payload.files.map(({path,sha256})=>({path,sha256})),nominalKey:type.nominalKey}));
  }
  value.packageId=sha256('tsfg.program-facts.package.v2\0'+value.schemaHash+'\0'+canonical(value.payload));
  assert.throws(()=>projectCommonProgram(readCommonProgramFacts(Buffer.from(canonical(value)+'\n'))),e=>e instanceof Error&&'code'in e&&e.code===({owner:'r03-common-program-lexical',binding:'r03-common-program-capture',type:'r03-common-program-source',occurrence:'r03-common-program-capture','entry-root':'r03-common-program-compatibility-entry','source-spelling':'r03-common-program-binding'})[change]);
});
for(const change of ['key','owner','binding','type','activation','parent'])test('cold inline value environment slot rejects '+change,()=>{
  const hir=structuredClone(projectCommonProgram(packet('local-const'))),types=new Map(hir.types.map(t=>[t.id,t])),env=hir.environments.find(e=>e.slots.some(s=>types.get(s.type)?.kind==='value')),slot=env.slots.find(s=>types.get(s.type)?.kind==='value');
  if(change==='key')slot.key='foreign-slot';if(change==='owner')env.owner=hir.functions.find(f=>f.name==='left').id;
  if(change==='binding')slot.binding=hir.functions.find(f=>f.name==='left').parameters[0].id;if(change==='type')slot.type=hir.types.find(t=>t.kind==='scalar').id;
  if(change==='activation')hir.functions.find(f=>f.name==='readOwned').activationEnvironment=env.id;if(change==='parent')env.parent='foreign-layout';
  assert.throws(()=>verifyCommonProgramHir(hir),e=>e instanceof Error&&'code'in e&&e.code==='r03-common-program-reconstruct');
});
test('fixed Published original value rebinding write remains authoritative',()=>{
  const hir=projectCommonProgram(packet('sibling-write')),publication=structuredClone(createCommonProgramPublication(hir)),writer=hir.functions.find(f=>f.name==='replace'),contract=publication.contracts.find(c=>c.functionId===writer.id);
  contract.upper.captures.find(c=>c.write).write=false;const{digest,...body}=contract;contract.digest=commonIdentity('published-contract',body);publication.expectedDigest=commonIdentity('publication',{scopeDigest:publication.scopeDigest,contracts:publication.contracts});
  assert.throws(()=>emitCommonProgramCore(hir,publication,{targets:hir.closure.requiredRoots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()}),e=>e instanceof Error&&'code'in e&&e.code==='r03-common-program-contract');
});
for(const name of ['const-field-write','const-managed-field-write'])test('fixed const value field writes consume original Published authority: '+name,()=>{
  const hir=projectCommonProgram(packet(name)),publication=structuredClone(createCommonProgramPublication(hir)),reader=hir.functions.find(f=>f.name==='readOwned'),contract=publication.contracts.find(c=>c.functionId===reader.id),slot=hir.environments.flatMap(e=>e.slots).find(s=>reader.captures.some(c=>c.binding===s.binding)&&hir.types.find(t=>t.id===s.type)?.kind==='value');
  assert.equal(slot.writable,false);assert.equal(contract.upper.captures.find(c=>c.slot===slot.key).write,true);
  contract.upper.captures.find(c=>c.slot===slot.key).write=false;const{digest,...body}=contract;contract.digest=commonIdentity('published-contract',body);publication.expectedDigest=commonIdentity('publication',{scopeDigest:publication.scopeDigest,contracts:publication.contracts});
  assert.throws(()=>emitCommonProgramCore(hir,publication,{targets:hir.closure.requiredRoots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()}),e=>e instanceof Error&&'code'in e&&e.code==='r03-common-program-contract');
});
for(const name of ['copy-scalar','nested-copy','managed-fields','const-managed-field-write'])test('original actual value copies isolate inline storage and retain managed identities: '+name,()=>{
  const hir=projectCommonProgram(packet(name)),publication=createCommonProgramPublication(hir),physical=commonProgramPhysical(hir,new Map(publication.contracts.map(c=>[c.functionId,c]))),
    owner=hir.functions.find(f=>f.name==='makeOwnedReader'),reader=hir.functions.find(f=>f.name==='readOwned'),slots=hir.environments.flatMap(e=>e.slots),
    held=slots.find(s=>s.binding===owner.bindings.find(b=>b.name==='held').id),old=slots.find(s=>s.binding===owner.bindings.find(b=>b.name==='old').id),type=hir.types.find(t=>t.id===held.type),
    contexts=[...physical.values.actual.contexts.values()].filter(c=>c.plan.owner.id===reader.id&&!c.repeated);
  assert.ok(contexts.length>0);assert.equal(held.type,old.type);
  const expected=name==='copy-scalar'?{byteSize:4,alignment:4,referenceCount:0}:name==='nested-copy'?{byteSize:8,alignment:4,referenceCount:0}:name==='const-managed-field-write'?{byteSize:24,alignment:8,referenceCount:2}:{byteSize:40,alignment:8,referenceCount:3};
  assert.deepEqual(physical.carriers.layout(type.id),expected);
  assert.deepEqual(type.fields.map(f=>f.name),name==='copy-scalar'?['n']:name==='nested-copy'?['n','inner']:name==='const-managed-field-write'?['n','ref','a']:['n','ref','a','span']);
  for(const context of contexts)for(const environment of context.args[0].refs){
    const current=context.entryHeap.get(environment+'/slot/'+held.key),previous=context.entryHeap.get(environment+'/slot/'+old.key);
    assert.equal(current.unknown,false);assert.equal(previous.unknown,false);assert.ok(current.refs.size>0);assert.ok(previous.refs.size>0);
    assert.ok([...current.refs].every(ref=>!previous.refs.has(ref)));
    for(const ref of [...current.refs,...previous.refs])assert.equal(physical.values.actual.objects.get(ref).type,type.id);
    for(const field of type.fields.filter(f=>['inner','ref','a','span'].includes(f.name))){
      const left=new Set([...current.refs].flatMap(ref=>[...context.entryHeap.get(ref+'/field/'+field.id).refs])),right=new Set([...previous.refs].flatMap(ref=>[...context.entryHeap.get(ref+'/field/'+field.id).refs]));
      assert.ok(left.size>0);assert.ok(right.size>0);
      if(field.name==='inner')assert.ok([...left].every(ref=>!right.has(ref)));
      else assert.deepEqual([...left].sort(),[...right].sort());
    }
  }
});
test('current region versions preserve old value children after replacing the shared slot',()=>{
  const hir=projectCommonProgram(packet('slot-replaced')),publication=createCommonProgramPublication(hir),physical=commonProgramPhysical(hir,new Map(publication.contracts.map(c=>[c.functionId,c]))),
    owner=hir.functions.find(f=>f.name==='makeOwnedReader'),slots=hir.environments.flatMap(e=>e.slots),held=slots.find(s=>s.binding===owner.bindings.find(b=>b.name==='held').id),old=slots.find(s=>s.binding===owner.bindings.find(b=>b.name==='old').id),
    type=hir.types.find(t=>t.id===held.type),contexts=[...physical.values.actual.contexts.values()].filter(c=>c.plan.owner.id===owner.id&&c.regionScope&&c.returned.region.roots.size),nodes=physical.values.actual.regions.nodes;
  assert.ok(contexts.length>0);assert.deepEqual(physical.carriers.layout(type.id),{byteSize:40,alignment:8,referenceCount:3});
  for(const context of contexts)for(const environment of context.returned.region.roots){
    const current=context.normalRegions.get(environment).get('slot/'+held.key),previous=context.normalRegions.get(environment).get('slot/'+old.key);
    assert.equal(current.opaque,false);assert.equal(previous.opaque,false);assert.ok(current.roots.size>0);assert.ok(previous.roots.size>0);assert.ok([...current.roots].every(id=>!previous.roots.has(id)));
    for(const field of type.fields.filter(f=>['ref','a','span'].includes(f.name))){
      const left=new Set([...current.roots].flatMap(id=>[...context.normalRegions.get(id).get('field/'+field.id).roots].map(id=>nodes.get(id).reference))),right=new Set([...previous.roots].flatMap(id=>[...context.normalRegions.get(id).get('field/'+field.id).roots].map(id=>nodes.get(id).reference)));
      assert.ok(left.size>0);assert.ok(right.size>0);assert.ok([...left].every(ref=>!right.has(ref)),field.name);
    }
  }
});
