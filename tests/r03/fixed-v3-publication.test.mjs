// SPDX-License-Identifier: MIT
// Retained complete facts and pure compiler metadata only. No frontend aggregate,
// Core text is compiler metadata only; Runtime/VM and C++ Graph stay unexecuted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=process.env.TSFG_PUB3_IMPLEMENTATION_ROOT??fileURLToPath(new URL('../..',import.meta.url));
const api=await import(pathToFileURL(root+'/compiler/common-program-analysis.mjs').href),
  factsApi=await import(pathToFileURL(root+'/compiler/common-program-facts.mjs').href),
  hirApi=await import(pathToFileURL(root+'/compiler/common-program-hir.mjs').href),
  identities=await import(pathToFileURL(root+'/compiler/common-program-identities.mjs').href);
const bytes=readFileSync(new URL('./testdata/common-counter-host/counter.json',import.meta.url)),
  facts=factsApi.readCommonProgramFacts(bytes),context=JSON.parse(readFileSync(new URL('./testdata/common-counter-host/host-context.json',import.meta.url),'utf8')),
  hir=hirApi.buildCommonProgramHir(facts,{family:'tsfg.common-program-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId},context);
const make=()=>api.createCommonProgramPublication(hir),copy=value=>structuredClone(value);
const retainInteropFixture=(name,current,publication)=>{const output=process.env.TSFG_PUB3_INTEROP_OUTPUT;if(output)writeFileSync(output+'/'+name+'.json',JSON.stringify({hir:current,publication,request:{targets:[]}},null,2)+'\n');};
const rebind=publication=>{
  for(const row of publication.contracts){const {digest,...body}=row;row.digest=identities.commonIdentity('published-contract',body);}
  publication.scopeDigest=identities.commonIdentity('publication-scope',publication.scope);
  publication.expectedDigest=identities.commonIdentity('publication',{scopeDigest:publication.scopeDigest,contracts:publication.contracts});return publication;
};
const boundary=error=>error instanceof TypeError&&'code' in error;

test('first publication binds complete fixed-v4 rows including explicit null capability',()=>{
  const publication=make();assert.equal(publication.format.version,4);
  assert.equal(publication.scope.profile,'common-program-fixed-v4');
  assert.deepEqual(publication.contracts.map(row=>row.functionId),hir.functions.map(fn=>fn.id));
  assert.equal(publication.scope.functions.length,hir.functions.length);
  assert.ok(publication.contracts.some(row=>row.returnOrigins===null),'Host-dependent return protocol stays unresolved');
  assert.ok(publication.contracts.some(row=>row.returnOrigins?.format.version===5),'closed ordinary Source has a real Graph5');
  assert.deepEqual(publication.scope.storage,{fields:[],results:[]});
});

test('real cold reader admits identity only and returns an owned immutable snapshot',()=>{
  const publication=make(),encoded=api.printCommonProgramPublication(publication,hir),read=api.readCommonProgramPublication(Buffer.from(encoded),hir);
  assert.ok(encoded.endsWith('\n'));assert.deepEqual(read,publication);assert.notEqual(read,publication);assert.ok(Object.isFrozen(read));
  assert.ok(Object.isFrozen(read.contracts));assert.ok(Object.isFrozen(read.scope.types));retainInteropFixture('counter',hir,read);
});

test('same-group null rows cannot be removed even when all digests are recomputed',()=>{
  const publication=copy(make()),index=publication.contracts.findIndex(row=>row.returnOrigins===null);assert.ok(index>=0);
  publication.contracts.splice(index,1);rebind(publication);
  assert.throws(()=>api.verifyCommonProgramPublication(publication,hir),boundary);
});

test('old publication and graph formats are rejected at their actual cold boundaries',()=>{
  for(const version of [2,3]){const old=copy(make());old.format.version=version;assert.throws(()=>api.verifyCommonProgramPublication(old,hir),boundary);}
  for(const version of [3,4]){const graph=copy(make()),row=graph.contracts.find(row=>row.returnOrigins!==null);row.returnOrigins.format.version=version;rebind(graph);
    assert.throws(()=>api.verifyCommonProgramPublication(graph,hir),error=>boundary(error)&&error.code==='return-origin-graph-boundary');}
});

test('scope and graph interpretation corruption cannot be repaired by self-consistent hashes',()=>{
  const wrongScope=copy(make());wrongScope.scope.functions[0].signatureHash='sha256:'+'0'.repeat(64);rebind(wrongScope);
  assert.throws(()=>api.verifyCommonProgramPublication(wrongScope,hir),boundary);
  const wrongType=copy(make());wrongType.scope.types[0].label+='-unowned';rebind(wrongType);
  assert.throws(()=>api.verifyCommonProgramPublication(wrongType,hir),boundary);
  const wrongGraph=copy(make()),row=wrongGraph.contracts.find(row=>row.returnOrigins!==null);row.returnOrigins.normal=[row.returnOrigins.nodes.length];rebind(wrongGraph);
  assert.throws(()=>api.verifyCommonProgramPublication(wrongGraph,hir),boundary);
  for(const shape of [null,{kind:'union',label:'unknown-extra-type',members:3}]){
    const malformed=copy(make());malformed.scope.types.push({id:'sha256:'+'f'.repeat(64),label:'unknown-extra-type',shape});
    malformed.scope.types.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);rebind(malformed);
    assert.throws(()=>api.verifyCommonProgramPublication(malformed,hir),error=>boundary(error)&&error.code==='r03-common-program-publication-scope','unknown archive shapes fail at their own boundary before child traversal');
  }
  const fakeStorage=copy(make());fakeStorage.scope.storage.fields.push({actualTypes:[]});rebind(fakeStorage);
  assert.throws(()=>api.verifyCommonProgramPublication(fakeStorage,hir),error=>boundary(error)&&error.code==='r03-common-program-publication-storage-coverage');
});

test('a self-consistent fixed graph is not a certificate for the current body',()=>{
  const publication=copy(make()),row=publication.contracts.find(row=>row.returnOrigins!==null);row.returnOrigins.exits.normal=[];row.returnOrigins.normal=[];rebind(publication);
  assert.doesNotThrow(()=>api.verifyCommonProgramPublication(publication,hir),'metadata admission does not inspect the replaceable body');
  assert.throws(()=>api.analyzeCommonProgram(hir,publication),error=>boundary(error)&&error.code==='r03-common-program-return-origin-contract');
});

test('unrelated unresolved rows do not poison a selected closed scalar kernel pair',()=>{
  const extended=readFileSync(new URL('./testdata/common-counter-host/counter-extended.json',import.meta.url)),facts=factsApi.readCommonProgramFacts(extended),
    current=hirApi.buildCommonProgramHir(facts,{family:'tsfg.common-program-context-candidate',version:2,factsBytes:extended,expectedPackageId:facts.packageId},context),
    publication=api.createCommonProgramPublication(current),report=api.analyzeCommonProgram(current,publication),byName=new Map(current.functions.map(fn=>[fn.name,fn.id]));
  const targets=['left','right'].map(name=>byName.get(name)).sort();assert.ok(targets.every(Boolean));
  for(const target of targets)assert.equal(report.functions.find(row=>row.functionId===target).returnOriginStatus.status,'covered');
  assert.ok(report.functions.some(row=>row.returnOriginStatus.status==='open'));
  assert.deepEqual(api.verifyCommonKernelGroup(current,publication,{targets}).targets,targets);retainInteropFixture('counter-extended',current,publication);
});


test('real fixed Graph5 owner transfer preserves broader return permissions than the current body',async()=>{
  // Handwritten admitted-shape Source premises only; this is not a facts or
  // physical permission fixture. The independent fixed graph permits G even
  // though the current callee body merely returns its argument.
  const {commonEffects}=await import(pathToFileURL(root+'/compiler/common-program-effects.mjs').href),
    {commonReturnOriginSource}=await import(pathToFileURL(root+'/compiler/common-program-return-origin-source.mjs').href),
    {commonMeter}=await import(pathToFileURL(root+'/compiler/common-program-common.mjs').href),
    {signatureId}=await import(pathToFileURL(root+'/compiler/module-callable-common.mjs').href);
  const B='fixture:B',V='fixture:B/value',G='fixture:G',H='fixture:H',range={start:0,end:20},sourcePath='/fixed-graph-premise.ts',none={lexicalEnvironment:null,activationEnvironment:null},
    fn=(id,parameters,returnType,body)=>({id,name:id,kind:'source',sourceBinding:'raw:'+id,sourcePath,range,parameters,bindings:[],captures:[],returnType,body,
      ownerType:null,receiverBinding:null,lexicalParent:null,...none,signatureHash:signatureId({parameters:parameters.map(row=>row.type),returns:returnType})}),
    selected={kind:'bindingReference',binding:'pick/p',type:B,range},pick=fn('pick',[{id:'pick/p',type:B}],B,[{kind:'return',range,value:selected}]),
    call={kind:'call',callee:'pick',arguments:[{kind:'globalReference',global:H,type:B,range}],type:B,signature:{parameters:[B],returnType:B},range},
    caller=fn('caller',[],'void',[{kind:'expression',range,value:{kind:'fieldAssignment',operator:'=',type:'i32',range,
      target:{kind:'fieldTarget',property:V,type:'i32',receiver:call,range},value:{kind:'integerLiteral',type:'i32',token:'1',decimal:'1',range}}}]),
    unit={rootFile:sourcePath,types:[{id:B,kind:'reference',name:'B',methods:[],fields:[{id:V,sourceBinding:'raw:'+V,name:'value',type:'i32',readonly:false}]},
      {id:'i32',kind:'scalar',name:'i32'},{id:'void',kind:'void',name:'void'}],functions:[caller,pick],globals:[G,H].map(id=>({id,sourceBinding:'raw:'+id,type:B,writable:false})),
      environments:[],hostImports:[],hostContext:null,modules:[],closure:{roots:[],requiredRoots:[]},snapshot:{payload:{compatibilityWitnesses:[]}}},
    empty=()=>({format:{family:'tsfg.return-origin-graph-candidate',version:5},nodes:[],heaps:[{kind:'entry'}],controls:[{kind:'entry'}],calls:[],normal:[],language:[],exits:{normal:[{heap:0,control:0}],language:[]},accesses:[]}),
    upper=parameters=>({globals:{reads:[G],writes:[]},hostResources:{reads:[],writes:[]},captures:[],parameters:parameters.map((_,index)=>({index,read:false,write:false,structural:false})),
      facets:{allocation:false,managedReference:true,ehControl:false,mayThrow:false,await:false,lock:false,escape:true,unknownHost:false}}),
    allowed={...empty(),nodes:[{kind:'parameter',type:B,index:0},{kind:'global',type:B,id:G}],normal:[0,1]},
    transfer={parameters:[],returns:null,slotWrites:[]},records=new Map([
      ['pick',{upper:upper([B]),callables:transfer,returnOrigins:allowed}],['caller',{upper:upper([]),callables:transfer,returnOrigins:empty()}]]),
    legacy=commonEffects(unit,commonMeter(1000000)).derive(caller,new Map([...records].map(([id,row])=>[id,row.upper]))).upper;
  if(process.env.TSFG_PUB3_LEGACY_OWNER==='1'){assert.deepEqual(legacy.globals.writes,[G,H],'old fixed-effect consumer must retain all fixed return owners');return;}
  const source=commonReturnOriginSource(unit,commonMeter(1000000),null,null,null,records),body=source.derive(caller,null).upper;
  assert.deepEqual(legacy.globals.writes,[],'retained legacy path demonstrates the ignored unknown-result defect');
  assert.deepEqual(body.globals.writes,[G,H],'full fixed upper retains G and actual argument H, independent of the narrower current body');
});


test('explicit null can be harmless only with an independent complete scalar Source proof',async()=>{
  const extended=readFileSync(new URL('./testdata/common-counter-host/counter-extended.json',import.meta.url)),facts=factsApi.readCommonProgramFacts(extended),
    current=hirApi.buildCommonProgramHir(facts,{family:'tsfg.common-program-context-candidate',version:2,factsBytes:extended,expectedPackageId:facts.packageId},context),
    publication=copy(api.createCommonProgramPublication(current)),names=new Map(current.functions.map(fn=>[fn.name,fn.id])),targets=['left','right'].map(name=>names.get(name)).sort();
  for(const row of publication.contracts)if(targets.includes(row.functionId))row.returnOrigins=null;rebind(publication);
  const report=api.analyzeCommonProgram(current,publication);for(const id of targets)assert.equal(report.functions.find(row=>row.functionId===id).returnOriginStatus.status,'open');
  assert.deepEqual(api.verifyCommonKernelGroup(current,publication,{targets}).targets,targets,'scalar-only is a distinct Source premise, never a fabricated contained Graph');
});

test('a claimed empty upper cannot turn actual managed Source views into scalar-only evidence',async()=>{
  const {commonReturnOriginAvailability,commonReturnOriginScalarProof}=await import(pathToFileURL(root+'/compiler/common-program-return-origin-source.mjs').href),
    {commonProgramPhysical}=await import(pathToFileURL(root+'/compiler/common-program-physical.mjs').href),
    {commonMeter}=await import(pathToFileURL(root+'/compiler/common-program-common.mjs').href),
    publication=copy(make()),managed=hir.functions.find(fn=>fn.name==='managed');assert.ok(managed);
  const row=publication.contracts.find(row=>row.functionId===managed.id);row.upper.globals={reads:[],writes:[]};row.upper.captures=[];
  row.upper.parameters.forEach(p=>{p.read=false;p.write=false;p.structural=false;});for(const key in row.upper.facets)row.upper.facets[key]=false;rebind(publication);
  const records=new Map(publication.contracts.map(row=>[row.functionId,row])),physical=commonProgramPhysical(hir,records),spend=commonMeter(),
    availability=commonReturnOriginAvailability(hir,physical.model.callables,physical.model.methods,spend);
  assert.equal(commonReturnOriginScalarProof(managed.id,availability,records,spend,new Set()),false,'real array/ReadSpan/new/owner views independently exclude scalar-only');
  assert.throws(()=>api.analyzeCommonProgram(hir,publication),boundary,'current independent body obligations still cannot fit the false upper');
});


test('complete Counter v4 metadata survives cold read and the existing Core writer chain',async()=>{
  const {commonProgramCore}=await import(pathToFileURL(root+'/compiler/common-program-core.mjs').href),
    publication=make(),read=api.readCommonProgramPublication(Buffer.from(api.printCommonProgramPublication(publication,hir)),hir),
    core=commonProgramCore(hir,read,{targets:[]});
  assert.equal(core.proof.publishedDigest,publication.expectedDigest);assert.equal(core.proof.scopeDigest,publication.scopeDigest);
  assert.ok(core.text.includes('tsfg_program.program'));assert.ok(core.text.includes('tsfg_program.host_call'));
  assert.deepEqual(core.proof.targets,[]);assert.equal(core.borrowProof,null);
});

test('complete ReadSpan v4 publication preserves the existing physical, borrow and writer limits',async()=>{
  const {commonProgramCore}=await import(pathToFileURL(root+'/compiler/common-program-core.mjs').href),
    bytes=readFileSync(new URL('./testdata/common-readspan-closures/safe-lastuse.json',import.meta.url)),facts=factsApi.readCommonProgramFacts(bytes),
    current=hirApi.projectCommonProgram(facts),publication=api.createCommonProgramPublication(current),
    read=api.readCommonProgramPublication(Buffer.from(api.printCommonProgramPublication(publication,current)),current),core=commonProgramCore(current,read,{targets:[]});
  assert.equal(core.proof.publishedDigest,publication.expectedDigest);assert.ok(core.text.endsWith('\n'));assert.deepEqual(core.proof.targets,[]);retainInteropFixture('readspan-safe-lastuse',current,read);
});


test('value Source metadata explicitly retains missing fixed M12 capability as null',()=>{
  const bytes=readFileSync(new URL('./testdata/common-value-capture/local-const.json',import.meta.url)),facts=factsApi.readCommonProgramFacts(bytes),
    current=hirApi.projectCommonProgram(facts),publication=api.createCommonProgramPublication(current),read=api.verifyCommonProgramPublication(publication,current);
  assert.ok(current.types.some(type=>type.kind==='value'));assert.ok(read.contracts.some(row=>row.returnOrigins===null));
  assert.equal(read.scope.storage.fields.length,4);assert.equal(read.scope.storage.results.length,4);
  for(const name of ['Held','ReaderBox']){const type=current.types.find(type=>type.name===name);assert.equal(type.construction.kind,'explicit');
    assert.deepEqual(read.scope.storage.fields.find(row=>row.fieldId===type.fields[0].id),{fieldId:type.fields[0].id,actualTypes:[],unknown:true});
    assert.deepEqual(read.scope.storage.results.find(row=>row.construction===type.construction.id&&row.newTarget===type.id),{construction:type.construction.id,newTarget:type.id,actualTypes:[],unknown:true});}
  for(const name of ['Delta','Box']){const type=current.types.find(type=>type.name===name);
    assert.deepEqual(read.scope.storage.fields.find(row=>row.fieldId===type.fields[0].id),{fieldId:type.fields[0].id,actualTypes:[type.fields[0].type],unknown:false});}
  retainInteropFixture('value-local-const',current,read);
});


test('actual cold-admitted nonnull graph with false completion cannot fall through a null helper to scalar kernel permission',()=>{
  const bytes=readFileSync(new URL('./testdata/common-counter-host/counter-extended.json',import.meta.url)),facts=factsApi.readCommonProgramFacts(bytes),
    current=hirApi.buildCommonProgramHir(facts,{family:'tsfg.common-program-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId},context),
    publication=copy(api.createCommonProgramPublication(current)),byName=new Map(current.functions.map(fn=>[fn.name,fn])),left=byName.get('left'),right=byName.get('right');
  assert.ok(left&&right);assert.equal(left.parameters.length,1);assert.equal(right.parameters.length,1);assert.equal(left.parameters[0].type,right.parameters[0].type);
  const row=publication.contracts.find(row=>row.functionId===left.id);
  row.returnOrigins={format:{family:'tsfg.return-origin-graph-candidate',version:5},nodes:[{kind:'parameter',type:left.parameters[0].type,index:0}],
    heaps:[{kind:'entry'}],controls:[{kind:'entry'}],calls:[{functionId:right.id,arguments:[[0]],environment:null,callee:null,receiver:null,heap:0,control:0,site:'independent-permitted-null-target'}],
    normal:[],language:[],exits:{normal:[],language:[]},accesses:[]};
  publication.contracts.find(row=>row.functionId===right.id).returnOrigins=null;rebind(publication);
  api.verifyCommonProgramPublication(publication,current);
  assert.equal(api.analyzeCommonProgram(current,publication).functions.find(row=>row.functionId===left.id).returnOriginStatus.status,'open');
  assert.throws(()=>api.verifyCommonKernelGroup(current,publication,{targets:[left.id,right.id].sort()}),{code:'r03-common-program-kernel-return-origin-open'});
});
