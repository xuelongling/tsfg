// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {analyzeCommonProgram,createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {commonProgramCore} from '../../compiler/common-program-core.mjs';
import {commonProgramPhysical} from '../../compiler/common-program-physical.mjs';
import {commonBorrowEvents} from '../../compiler/common-program-borrow-events.mjs';
import {createCommonBorrowProof,readCommonBorrowProof,writeCommonBorrowProof} from '../../compiler/common-program-borrow-proof.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
import {commonIdentity} from '../../compiler/common-program-identities.mjs';
import {normalizeClosure} from '../../compiler/modules.mjs';
import {originId,signatureId} from '../../compiler/typed-array-schema.mjs';
import {compileCommonBorrowProof} from '../../compiler/pipeline.mjs';
const cases=['safe-lastuse','later-use-conflict','borrow-completions'].map(name=>{
  const facts=readCommonProgramFacts(readFileSync(new URL('./testdata/common-borrow-proof/'+name+'-facts.json',import.meta.url))),hir=projectCommonProgram(facts),publication=createCommonProgramPublication(hir),request={targets:hir.closure.requiredRoots.filter(row=>row.kind==='kernel').map(row=>row.target).sort()};
  return {name,hir,publication,request};
});
const safe=cases[0],completed=cases[2],tool=process.env.TSFG_COMMON_BORROW_CORE,output=process.env.TSFG_COMMON_BORROW_OUTPUT,children=[];
const proofOf=row=>createCommonBorrowProof(row.hir,row.publication,row.request);
const reachable=(proof,from,to)=>{
  const pending=[canonical(from)],seen=new Set(),target=canonical(to);
  for(let i=0;i<pending.length;i++){const next=pending[i];if(next===target)return true;if(seen.has(next))continue;seen.add(next);
    for(const edge of proof.events.flows)if(canonical(edge.from)===next)pending.push(canonical(edge.to));}
  return false;
};
test('real last captured Span use propagates through its call before resize',()=>{
  const proof=proofOf(safe),reader=safe.hir.functions.find(fn=>fn.name==='readCurrent'),capture=safe.hir.functions.find(fn=>fn.name==='captureSpanOrdinary');assert.ok(reader&&capture);
  const use=proof.events.uses.find(row=>row.at.functionId===reader.id),resize=proof.events.effects.find(row=>row.at.functionId===capture.id&&row.at.name==='array_resize');assert.ok(use&&resize);
  const definition=proof.events.definitions.find(row=>row.at.functionId===capture.id);assert.ok(definition);
  assert.deepEqual(use.descriptors,[definition.descriptor]);assert.deepEqual(resize.owners,definition.owners);
  assert.ok(proof.events.calls.some(row=>row.target===reader.id&&row.completion==='normal'));
  assert.ok(reachable(proof,use.at,resize.at));assert.ok(!reachable(proof,resize.at,use.at));
  assert.ok(Object.isFrozen(proof.events.flows));assert.ok(Object.isFrozen(definition.descriptor.origins));
});
test('whole Source preserves actual Span normal and language return propagation',()=>{
  const proof=proofOf(completed),relay=completed.hir.functions.find(fn=>fn.name==='relayBorrowCompletion'),caller=completed.hir.functions.find(fn=>fn.name==='borrowCompletions');assert.ok(relay&&caller);
  const routes=proof.events.calls.filter(row=>row.at.functionId===caller.id&&row.target===relay.id);assert.deepEqual([...new Set(routes.map(row=>row.completion))].sort(),['language','normal']);
  const descriptor=proof.events.definitions.find(row=>row.at.functionId===caller.id);assert.ok(descriptor);
  for(const route of routes){assert.ok(proof.events.uses.some(row=>row.at.functionId===caller.id&&row.descriptors.some(value=>canonical(value)===canonical(descriptor.descriptor))&&reachable(proof,route.successor,row.at)));}
  assert.ok(completed.hir.functions.some(fn=>fn.name==='arrayOrdinary'));assert.ok(completed.hir.types.some(type=>type.name==='Box'));
});
test('a direct tail return forwards the same ReadSpan through both call completions',()=>{
  const facts=structuredClone(completed.hir.snapshot),payload=facts.payload;
  const relay=payload.functions.find(fn=>fn.name==='relayBorrowCompletion'),name='nextBorrowCompletionx';
  const caller=payload.functions.find(fn=>fn.name==='borrowCompletions');
  const call=caller.body[2].tryBlock.body[0].initializer,source=payload.files.find(file=>file.path===relay.sourcePath);
  const previous=source.content,start=previous.length;
  assert.equal(previous.slice(call.calleeRange.start,call.calleeRange.end),relay.name);
  assert.equal(name.length,relay.name.length);
  const prefix=previous.slice(relay.declarationRange.start,relay.returnAnnotationRange.end).replace(relay.name,name)+'{';
  const returnedCall=relay.name+'('+relay.parameters.map(parameter=>parameter.name).join(',')+')';
  const addition=prefix+'return '+returnedCall+';}';
  source.content=previous.slice(0,call.calleeRange.start)+name+previous.slice(call.calleeRange.end)+addition+'\n';
  source.byteLength=Buffer.byteLength(source.content);
  source.utf16Length=source.content.length;
  source.sha256=sha256(source.content).slice(7);
  const files=payload.files.map(({path,content,sha256})=>({path,content,sha256}));
  for(const type of payload.types)if(['value','reference'].includes(type.kind))
    type.runtimeKey=sha256('tsfg.array-facts.runtime-class.v8\0'+canonical({files:files.map(({path,sha256})=>({path,sha256})),nominalKey:type.nominalKey}));
  const declarationRange={start,end:start+addition.length},declarationScope={start:0,end:source.utf16Length};
  const shift=start-relay.declarationRange.start,move=range=>range===null?null:{start:range.start+shift,end:range.end+shift};
  const id=sha256('tsfg.array-facts.function.v8\0'+canonical({sourcePath:source.path,declarationRange}));
  const parameters=relay.parameters.map(parameter=>{
    const nameRange=move(parameter.nameRange);
    return {...parameter,id:originId(source.path,nameRange),lexicalOwner:id,nameRange,annotationRange:move(parameter.annotationRange),
      declarationRange:move(parameter.declarationRange),elementAnnotationRange:move(parameter.elementAnnotationRange)};
  });
  const returnStart=start+prefix.length,callStart=returnStart+'return '.length,calleeEnd=callStart+relay.name.length;
  let argumentStart=calleeEnd+1;
  const args=parameters.map((parameter,index)=>{
    const range={start:argumentStart,end:argumentStart+parameter.name.length};argumentStart=range.end+1;
    return {...call.arguments[index],binding:parameter.id,range};
  });
  const callRange={start:callStart,end:callStart+returnedCall.length};
  const body=[{kind:'return',range:{start:returnStart,end:declarationRange.end-1},
    value:{...call,range:callRange,calleeRange:{start:callStart,end:calleeEnd},arguments:args}}];
  for(const fn of payload.functions)if(fn.sourcePath===source.path&&fn.lexicalParent===null&&!fn.ownerType)fn.declarationScope=declarationScope;
  for(const roots of [payload.closure.roots,payload.closure.requiredRoots])for(const root of roots)
    if(root.kind==='module-initialization'&&root.sourcePath===source.path)root.range=declarationScope;
  const forward={...relay,name,id,declarationRange,declarationScope,nameRange:move(relay.nameRange),
    returnAnnotationRange:move(relay.returnAnnotationRange),parameters,body};
  payload.functions.push(forward);
  payload.functions.sort((a,b)=>a.sourcePath.localeCompare(b.sourcePath)||a.declarationRange.start-b.declarationRange.start);
  call.callee=id;
  call.signature={...call.signature,declarationRange,id:signatureId(source.path,declarationRange)};
  const tuples=roots=>roots.map(({kind,sourcePath,name})=>({kind,sourcePath,name}));
  const compilationClosure=normalizeClosure({roots:tuples(payload.closure.roots),requiredRoots:tuples(payload.closure.requiredRoots)});
  const request={family:'tsfg.program-facts-request-candidate',version:facts.version,schemaHash:facts.schemaHash,input:{
    sourceRoot:payload.sourceRoot,rootFile:payload.rootFile,files,declarations:payload.declarations,config:payload.config,target:payload.target,
    compilationClosure,hostImports:payload.hostImports.map(({sourcePath,name,capabilityId,parameterTypes,returnType})=>({sourcePath,name,capabilityId,parameterTypes,returnType}))}};
  facts.requestId=sha256('tsfg.program-facts.request.v'+facts.version+'\0'+canonical(request)+'\n');
  facts.packageId=sha256('tsfg.program-facts.package.v'+facts.version+'\0'+facts.schemaHash+'\0'+canonical(payload));

  const hir=projectCommonProgram(facts),publication=createCommonProgramPublication(hir);
  const proof=proofOf({hir,publication,request:completed.request});
  const forwardId=hir.functions.find(fn=>fn.name===name).id,relayId=hir.functions.find(fn=>fn.name===relay.name).id;
  const callerId=hir.functions.find(fn=>fn.name===caller.name).id;
  const descriptor=proof.events.definitions.find(row=>row.at.functionId===callerId);
  assert.ok(descriptor);
  const routes=(functionId,target)=>proof.events.calls.filter(row=>row.at.functionId===functionId&&row.target===target);
  for(const [functionId,target] of [[callerId,forwardId],[forwardId,relayId]])
    assert.deepEqual([...new Set(routes(functionId,target).map(row=>row.completion))].sort(),['language','normal']);
  for(const route of routes(callerId,forwardId))
    assert.ok(proof.events.uses.some(row=>row.at.functionId===callerId&&reachable(proof,route.successor,row.at)
      &&row.descriptors.some(value=>canonical(value)===canonical(descriptor.descriptor))));

  const withRelayGraph=change=>{
    const changed=structuredClone(publication),contract=changed.contracts.find(row=>row.functionId===relayId);
    contract.returnOrigins=change(contract.returnOrigins);
    const {digest,...fields}=contract;
    contract.digest=commonIdentity('published-contract',fields);
    changed.expectedDigest=commonIdentity('publication',{scopeDigest:changed.scopeDigest,contracts:changed.contracts});
    return changed;
  };
  assert.throws(()=>analyzeCommonProgram(hir,withRelayGraph(()=>null)),{code:'r03-common-program-readspan-return-escape'});
  assert.throws(()=>analyzeCommonProgram(hir,withRelayGraph(graph=>({...graph,normal:[]}))),{code:'r03-common-program-readspan-return-escape'});
  assert.throws(()=>analyzeCommonProgram(hir,withRelayGraph(graph=>({...graph,language:[],exits:{...graph.exits,language:[]}}))),
    {code:'r03-common-program-readspan-return-escape'});
  assert.throws(()=>analyzeCommonProgram(hir,withRelayGraph(graph=>({
    ...graph,normal:[...graph.normal,graph.nodes.length],
    nodes:[...graph.nodes,{kind:'nonowning',type:graph.nodes[graph.normal[0]].type}]
  }))),{code:'r03-common-program-readspan-return-escape'});
});
test('later callee use retains the existing structural conflict and cannot publish proof',()=>{
  const row=cases[1];assert.throws(()=>proofOf(row),{code:'r03-common-program-borrow-conflict'});
});
test('owning proof read/write binds the full fixed input and rejects changed relationships',()=>{
  const proof=proofOf(safe),bytes=writeCommonBorrowProof(proof,safe.hir,safe.publication,safe.request);
  assert.equal(bytes.toString('utf8'),canonical(proof)+'\n');assert.deepEqual(readCommonBorrowProof(bytes,safe.hir,safe.publication,safe.request),proof);
  const mutations=[value=>{value.inputIdentity='sha256:'+'0'.repeat(64);},value=>{value.version=2;},value=>{value.events.uses.pop();},value=>{value.events.flows.pop();},
    value=>{value.events.definitions[0].owners=[];},value=>{value.events.calls[0].completion='language';},value=>{value.events.effects[0].pending=!value.events.effects[0].pending;},value=>{value.extra=true;}];
  for(const mutate of mutations){const value=structuredClone(proof);mutate(value);assert.throws(()=>readCommonBorrowProof(Buffer.from(canonical(value)+'\n'),safe.hir,safe.publication,safe.request));}
  assert.throws(()=>readCommonBorrowProof(Buffer.from(canonical(proof)),safe.hir,safe.publication,safe.request));
  assert.throws(()=>readCommonBorrowProof(Buffer.alloc(8388609,32),safe.hir,safe.publication,safe.request));
  if(false){
    // @ts-expect-error Public proof collections are readonly typed output.
    proof.events.uses.push(proof.events.uses[0]);
    // @ts-expect-error Source/operation identities are readonly.
    proof.events.definitions[0].at.source.start=0;
  }
});

test('genuine Borrow root evidence charges heap visits and indexes each root heap once',()=>{
  const {hir,publication}=completed;
  const records=new Map(publication.contracts.map(row=>[row.functionId,row]));
  const {values:{actual}}=commonProgramPhysical(hir,records);
  const roots=[...actual.contexts.values()].filter(row=>row.root);
  const measure=name=>{
    const root=roots.find(row=>row.plan.owner.name===name);assert.ok(root);
    const heap=new Map(root.entryHeap),entries=heap.entries.bind(heap);let work=0,passes=0;
    heap[Symbol.iterator]=()=>{passes++;return entries();};
    const events=commonBorrowEvents({model:{spend:(amount=1)=>{work+=amount;}},objects:actual.objects,cyclicFunctions:new Set()});
    events.begin(root,heap);
    return {work,passes,minimum:heap.size+root.args.length+[...heap.keys()].filter(key=>key.startsWith('global:')).length};
  };
  const scalar=measure('borrowCompletions'),span=measure('relayBorrowCompletion');
  assert.deepEqual({scalarVisitsPaid:scalar.work>=scalar.minimum,spanHeapPasses:span.passes},
    {scalarVisitsPaid:true,spanHeapPasses:2});
});
test('Borrow work covers materializing call and flow rows as well as sorting them',()=>{
  const {hir,publication}=completed,records=new Map(publication.contracts.map(row=>[row.functionId,row]));
  const {values:{actual}}=commonProgramPhysical(hir,records),roots=[...actual.contexts.values()].filter(row=>row.root);
  const caller=roots.find(row=>row.plan.owner.name==='borrowCompletions');
  const originalCallee=roots.find(row=>row.plan.owner.name==='relayBorrowCompletion');
  assert.ok(caller&&originalCallee);
  const callee={...originalCallee,root:false};
  const call=caller.plan.graph.blocks.flatMap(block=>block.instructions).find(op=>op.properties.function_id===callee.plan.owner.id);
  const returned=callee.plan.graph.blocks.flatMap(block=>block.instructions).find(op=>op.name==='func.return');
  assert.ok(call&&returned);
  const block=caller.plan.graph.blocks.findIndex(row=>row.name===call.successors[0]);
  const next=caller.plan.graph.blocks[block].instructions[0];
  const callAt=caller.id+'/observed-call',returnAt=callee.id+'/observed-return';
  const measure=(complete,flow)=>{
    let work=0;
    const proof=commonBorrowEvents({model:{spend:(amount=1)=>{work+=amount;}},objects:actual.objects,cyclicFunctions:new Set()});
    proof.begin(caller,caller.entryHeap);proof.begin(callee,callee.entryHeap);
    proof.before(caller,call,callAt);proof.before(callee,returned,returnAt);
    proof.blockSite(caller.plan.owner.id,call.successors[0],{functionId:caller.plan.owner.id,block,index:0,
      name:next.name.replace('tsfg_program.',''),source:{path:caller.plan.owner.sourcePath,...next.range}});
    proof.call(callAt,callee,caller,call.successors);
    if(complete)proof.after(callee,returned,{refs:new Set()},returnAt);
    if(flow)proof.edge(caller.id+'/entry',callAt);
    work=0;
    const events=proof.finish();
    return {work,calls:events.calls.length,flows:events.flows.length};
  };
  const pending=measure(false,false),normal=measure(true,false),flow=measure(true,true);
  assert.deepEqual([pending.calls,normal.calls,flow.flows],[0,1,1]);
  // Sorting charges one row read and one table slot. Each emitted row also
  // pays for materialization, and the flow pays for its traversed edge.
  assert.deepEqual([normal.work-pending.work,flow.work-normal.work],[3,4]);
});
for(const field of ['publication','request'])test('public Common Borrow proof owns '+field+' before artifact admission',{skip:!tool},async()=>{
  const publication=structuredClone(safe.publication),request=structuredClone(safe.request);
  const pending=compileCommonBorrowProof(safe.hir,publication,request,{core:tool});
  if(field==='publication')assert.ok(Reflect.set(publication,'expectedDigest','sha256:'+'0'.repeat(64)));
  else request.targets.splice(0,request.targets.length,'sha256:'+'0'.repeat(64));
  const result=await pending;
  assert.deepEqual(result.proof,proofOf(safe));
  assert.deepEqual(result.hir,safe.hir);
});

const run=(name,command,input,status=0)=>{
  mkdirSync(output,{recursive:true});const prefix=output+'/'+String(children.length).padStart(3,'0')+'-'+name;
  const child=spawnSync(tool,['--common-program',command],{input,windowsHide:true,maxBuffer:8388608,timeout:60000});
  writeFileSync(prefix+'-input.mlir',input);writeFileSync(prefix+'-stdout.raw',child.stdout??Buffer.alloc(0));writeFileSync(prefix+'-stderr.raw',child.stderr??Buffer.alloc(0));
  children.push({name,command,pid:child.pid,status:child.status,error:child.error?.message??null,stdoutBytes:child.stdout?.length,stderr:child.stderr?.toString('utf8')});writeFileSync(output+'/children.json',JSON.stringify(children,null,2)+'\n');
  assert.ifError(child.error);assert.equal(child.status,status,child.stderr.toString('utf8'));return child.stdout;
};
for(const row of [safe,completed])test('independent actual Common Core borrow proof: '+row.name,{skip:!tool||!output},()=>{
  const emitted=commonProgramCore(row.hir,row.publication,row.request,{borrowProof:true});assert.equal(emitted.text,commonProgramCore(row.hir,row.publication,row.request).text);
  const bound=run(row.name+'-canonical','--canonicalize',emitted.text),raw=run(row.name,'--borrow-proof',bound);
  assert.deepEqual(readCommonBorrowProof(raw,row.hir,row.publication,row.request),emitted.borrowProof);assert.equal(raw.toString('utf8'),canonical(emitted.borrowProof)+'\n');
  assert.deepEqual(run(row.name+'-roundtrip','--canonicalize',bound),bound);assert.deepEqual(run(row.name+'-stable','--borrow-proof',bound),raw);
  const forged=emitted.text.replace('hir_hash = "sha256:','hir_hash = "sha256:0');assert.notEqual(forged,emitted.text);assert.equal(run(row.name+'-wrong-input','--borrow-proof',forged,3).length,0);
});
