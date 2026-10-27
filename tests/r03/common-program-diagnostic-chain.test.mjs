// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {buildCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication,analyzeCommonProgram,verifyCommonKernelGroup} from '../../compiler/common-program-analysis.mjs';
import {commonIdentity} from '../../compiler/common-program-identities.mjs';
import {commonProgramCore} from '../../compiler/common-program-core.mjs';
import {canonical} from '../../compiler/identity.mjs';
import {coreQuote} from '../../compiler/mlir-strings.mjs';
const bytes=readFileSync(new URL('./testdata/common-counter-host/counter-extended.json',import.meta.url)),facts=readCommonProgramFacts(bytes),
  host=JSON.parse(readFileSync(new URL('./testdata/common-counter-host/host-context.json',import.meta.url),'utf8')),
  hir=buildCommonProgramHir(facts,{family:'tsfg.common-program-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId},host),
  publication=createCommonProgramPublication(hir),byName=new Map(hir.functions.map(fn=>[fn.name,fn])),
  targets=names=>names.map(name=>byName.get(name).id).sort();
const expandedBytes=readFileSync(new URL('./testdata/common-diagnostic-chain/cycle-unknown-facts.json',import.meta.url)),expandedFacts=readCommonProgramFacts(expandedBytes),
  expandedHir=buildCommonProgramHir(expandedFacts,{family:'tsfg.common-program-context-candidate',version:2,factsBytes:expandedBytes,expectedPackageId:expandedFacts.packageId},host),
  expandedPublication=createCommonProgramPublication(expandedHir),expandedByName=new Map(expandedHir.functions.map(fn=>[fn.name,fn]));
/** @returns {import('../../compiler/common-program-diagnostics.mjs').KernelCallChain} */
function expandedDiagnostic(name){let chain;
  assert.throws(()=>verifyCommonKernelGroup(expandedHir,expandedPublication,{targets:[expandedByName.get(name).id,expandedByName.get('right').id].sort()}),error=>{
    assert.ok(error instanceof Error&&'callChain' in error);chain=error.callChain;return true;
  });return chain;
}
test('real cross-module Host rejection explains root, call edges and actual operation',()=>{
  const root=byName.get('cross'),relay=byName.get('relay');
  assert.throws(()=>verifyCommonKernelGroup(hir,publication,{targets:targets(['cross','right'])}),error=>{
    assert.ok(error instanceof Error&&'code' in error&&error.code==='r03-common-program-kernel-host');
    assert.ok('callChain' in error,'the real reject must explain its cross-call provenance');
    const chain=/** @type {import('../../compiler/common-program-diagnostics.mjs').KernelCallChain} */(error.callChain);assert.equal(chain.version,1);assert.equal(chain.root.functionId,root.id);
    assert.deepEqual(chain.root.source,{sourceId:root.sourcePath,...root.range});
    assert.equal(chain.edges.length,1);assert.equal(chain.edges[0].caller,root.id);assert.equal(chain.edges[0].callee,relay.id);
    assert.deepEqual(chain.edges[0].source,{sourceId:'/src/main.ts',...root.body[0].value.range});
    assert.equal(chain.origin.kind,'operation');assert.equal(chain.origin.functionId,relay.id);assert.equal(chain.origin.operation,'hostCall');
    assert.deepEqual(chain.origin.source,{sourceId:'/src/relay.ts',...relay.body[0].value.range});return true;
  });
});
/** @returns {import('../../compiler/common-program-diagnostics.mjs').KernelCallChain} */
const diagnostic=(name,fixed=publication)=>{
  let chain;assert.throws(()=>verifyCommonKernelGroup(hir,fixed,{targets:targets([name,'right'])}),error=>{
    assert.ok(error instanceof Error&&'callChain' in error);chain=error.callChain;return true;
  });return chain;
};
test('direct Host endpoint is the ambient original operation, not an invented callee',()=>{
  const direct=byName.get('direct'),chain=diagnostic('direct');assert.equal(chain.edges.length,0);assert.equal(chain.origin.kind,'operation');
  assert.equal(chain.origin.functionId,direct.id);assert.equal(chain.origin.operation,'hostCall');
  assert.deepEqual(chain.origin.source,{sourceId:direct.sourcePath,...direct.body[0].value.range});
  const source=hir.sources.find(row=>row.path===direct.sourcePath).content;assert.equal(source.slice(chain.origin.source.start,chain.origin.source.end),'record(value)');
});
test('finite indirect chain retains chosen call anchor and actual relay target',()=>{
  const caller=byName.get('finiteIndirect'),relay=byName.get('relay'),chain=diagnostic('finiteIndirect');
  assert.equal(chain.edges.length,1);assert.equal(chain.edges[0].kind,'indirectCall');assert.equal(chain.edges[0].callee,relay.id);
  assert.deepEqual(chain.edges[0].source,{sourceId:caller.sourcePath,...caller.body[1].value.range});
  assert.equal(hir.sources.find(row=>row.path===caller.sourcePath).content.slice(chain.edges[0].source.start,chain.edges[0].source.end),'chosen(value)');
  assert.equal(chain.origin.functionId,relay.id);assert.equal(chain.origin.operation,'hostCall');
});
test('multiple real entry paths choose one deterministic path without module initializer edges',()=>{
  const first=expandedDiagnostic('entry');assert.deepEqual(expandedDiagnostic('entry'),first);assert.equal(first.edges.length,1);
  assert.ok(['relay','direct'].some(name=>expandedByName.get(name).id===first.edges[0].callee));assert.equal(first.origin.operation,'hostCall');
});
test('managed kernel rejection identifies the actual array allocation',()=>{
  const managed=expandedByName.get('managed'),chain=expandedDiagnostic('managed');assert.deepEqual(chain.reason,{kind:'facet',facet:'allocation'});
  assert.equal(chain.origin.kind,'operation');assert.equal(chain.origin.operation,'arrayLiteral');
  assert.deepEqual(chain.origin.source,{sourceId:managed.sourcePath,...managed.body[0].initializer.range});
});
test('real cyclic call graph terminates its deterministic chain at cycleB Host operation',()=>{
  const chain=expandedDiagnostic('cycleA'),left=expandedByName.get('cycleA'),right=expandedByName.get('cycleB');
  assert.equal(chain.edges.length,1);assert.equal(chain.edges[0].caller,left.id);assert.equal(chain.edges[0].callee,right.id);assert.equal(chain.origin.functionId,right.id);assert.equal(chain.origin.operation,'hostCall');
  assert.deepEqual(chain.edges[0].source,{sourceId:left.sourcePath,...left.body[0].value.range});
});
test('unknown incoming callable preserves uncertainty without inventing a concrete target',()=>{
  const chain=expandedDiagnostic('unknownIncoming'),fn=expandedByName.get('unknownIncoming');
  assert.equal(chain.root.functionId,fn.id);assert.deepEqual(chain.edges,[]);
  assert.deepEqual(chain.reason,{kind:'facet',facet:'managedReference'});
  assert.deepEqual(chain.origin,{kind:'function',functionId:fn.id,source:{sourceId:fn.sourcePath,...fn.range},operation:'derivedManagedReference'});
});
const tool=process.env.TSFG_COMMON_DIAGNOSTIC_CORE,output=process.env.TSFG_COMMON_DIAGNOSTIC_OUTPUT,children=[];
const controlledBytes=readFileSync(new URL('./testdata/common-callable-parameters/callable-readonly.json',import.meta.url)),controlledFacts=readCommonProgramFacts(controlledBytes),
  controlledHir=buildCommonProgramHir(controlledFacts,{family:'tsfg.common-program-context-candidate',version:2,factsBytes:controlledBytes,expectedPackageId:controlledFacts.packageId}),
  controlledPublication=createCommonProgramPublication(controlledHir),controlledAnalysis=analyzeCommonProgram(controlledHir,controlledPublication),controlledByName=new Map(controlledHir.functions.map(fn=>[fn.name,fn])),
  controlledRequest={targets:['left','right'].map(name=>controlledByName.get(name).id).sort()};
const fixedFacetCases=['await','lock'].map(facet=>{
  const caller=controlledByName.get('left'),callee=controlledByName.get('leafLeft'),original=controlledPublication.contracts.find(row=>row.functionId===callee.id),fixed=structuredClone(controlledPublication),contract=fixed.contracts.find(row=>row.functionId===callee.id);
  const widened=new Set([callee.id]);let changed=true;
  while(changed){changed=false;for(const row of controlledAnalysis.functions)if(!widened.has(row.functionId)&&row.dependencies.some(edge=>widened.has(edge.functionId))){widened.add(row.functionId);changed=true;}}
  for(const id of widened){const row=fixed.contracts.find(row=>row.functionId===id);row.upper.facets[facet]=true;const {digest,...body}=row;row.digest=commonIdentity('published-contract',body);}
  fixed.expectedDigest=commonIdentity('publication',{scopeDigest:fixed.scopeDigest,contracts:fixed.contracts});
  return {facet,caller,callee,original,fixed,contract,widened:[...widened].sort(),request:controlledRequest,
    expected:{version:/** @type {1} */(1),root:{functionId:caller.id,source:{sourceId:caller.sourcePath,...caller.range}},reason:{kind:/** @type {'facet'} */('facet'),facet},
      edges:[{caller:caller.id,callee:callee.id,kind:'indirectCall',source:{sourceId:caller.sourcePath,...caller.body[1].value.range}}],
      origin:{kind:/** @type {'fixed-upper'} */('fixed-upper'),functionId:callee.id,source:{sourceId:callee.sourcePath,...callee.range},contractDigest:contract.digest}}};
});
for(const row of fixedFacetCases)test('pure complete program rejects its fixed '+row.facet+' upper',()=>{
  const originalDigest=row.original.digest,analysis=analyzeCommonProgram(controlledHir,row.fixed),current=analysis.functions.find(fn=>fn.functionId===row.callee.id);
  assert.equal(current.derived.facets[row.facet],false);assert.equal(row.original.upper.facets[row.facet],false);assert.equal(row.original.digest,originalDigest);
  assert.equal(analysis.functions.find(fn=>fn.functionId===row.caller.id).derived.facets[row.facet],false);
  assert.equal(analysis.contracts.find(contract=>contract.functionId===row.callee.id).digest,row.contract.digest);assert.notEqual(row.contract.digest,originalDigest);
  assert.throws(()=>verifyCommonKernelGroup(controlledHir,row.fixed,row.request),error=>{
    assert.ok(error instanceof Error&&'code' in error&&'ruleId' in error&&'phase' in error&&'primary' in error&&'callChain' in error);
    assert.equal(error.code,'r03-common-program-kernel-capability');assert.equal(error.ruleId,'r01-input-boundary');assert.equal(error.phase,'hir');
    assert.deepEqual(error.primary,{sourceId:row.caller.sourcePath,...row.caller.range});assert.deepEqual(error.callChain,row.expected);return true;
  });
  if(output){mkdirSync(output,{recursive:true});writeFileSync(output+'/fixed-'+row.facet+'-node-control.json',canonical({facet:row.facet,originalContract:row.original,currentDerived:current.derived,
    currentCallerDerived:analysis.functions.find(fn=>fn.functionId===row.caller.id).derived,widened:row.widened,originalPublication:controlledPublication,
    fixedPublication:row.fixed,fixedContract:row.contract,expectedDigest:row.fixed.expectedDigest,callChain:row.expected})+'\n');}
});
test('unwidened complete callable program accepts the identical kernel request',()=>{
  const proof=verifyCommonKernelGroup(controlledHir,controlledPublication,controlledRequest);assert.deepEqual(proof.targets,controlledRequest.targets);
  assert.equal(proof.publishedDigest,controlledPublication.expectedDigest);assert.equal(proof.accesses.length,2);
  for(const facet of ['await','lock'])for(const name of ['left','leafLeft'])assert.equal(controlledAnalysis.functions.find(fn=>fn.functionId===controlledByName.get(name).id).derived.facets[facet],false);
});
test('independent unwidened complete callable program accepts the identical kernel request',{skip:!tool||!output},()=>{
  const input=commonProgramCore(controlledHir,controlledPublication,controlledRequest).text,child=spawnSync(tool,['--common-program','--canonicalize'],{input,windowsHide:true,maxBuffer:8388608,timeout:60000});
  mkdirSync(output,{recursive:true});const prefix=output+'/unwidened';writeFileSync(prefix+'-input.mlir',input);writeFileSync(prefix+'-stdout.raw',child.stdout??Buffer.alloc(0));writeFileSync(prefix+'-stderr.raw',child.stderr??Buffer.alloc(0));
  for(const [name,value]of Object.entries({hir:controlledHir,publication:controlledPublication,request:controlledRequest}))writeFileSync(prefix+'-'+name+'.json',canonical(value)+'\n');
  children.push({name:'unwidened',pid:child.pid,status:child.status,error:child.error?.message??null});writeFileSync(output+'/children.json',JSON.stringify(children,null,2)+'\n');
  assert.ifError(child.error);assert.equal(child.status,0);assert.ok(child.stdout.length>0);assert.equal(child.stderr.length,0);
});
/** @type {{name:string,hir:typeof hir,fixed:typeof publication,request:{targets:string[]},expected:()=>import('../../compiler/common-program-diagnostics.mjs').KernelCallChain}[]} */
const staticCases=['direct','cross','finiteIndirect'].map(name=>({name,hir,fixed:publication,request:{targets:targets([name,'right'])},expected:()=>diagnostic(name)}));
for(const kind of ['host-resource','facet']){
  const {broad,row}=widen(upper=>kind==='facet'?upper.facets.allocation=true:upper.hostResources={reads:['runtime.counter.events'],writes:[]}),right=byName.get('right');
  staticCases.push({name:'fixed-'+kind,hir,fixed:broad,request:{targets:targets(['left','right'])},expected:()=>({version:1,root:{functionId:right.id,source:{sourceId:right.sourcePath,...right.range}},
    reason:kind==='facet'?{kind:'facet',facet:'allocation'}:{kind:'host-resource',resource:'runtime.counter.events',access:'read'},edges:[],origin:{kind:'fixed-upper',functionId:right.id,source:{sourceId:right.sourcePath,...right.range},contractDigest:row.digest}})});
}
for(const name of ['entry','managed','cycleA','unknownIncoming'])staticCases.push({name,hir:expandedHir,fixed:expandedPublication,
  request:{targets:[expandedByName.get(name).id,expandedByName.get('right').id].sort()},expected:()=>expandedDiagnostic(name)});
for(const row of fixedFacetCases)staticCases.push({name:'fixed-'+row.facet,hir:controlledHir,fixed:row.fixed,request:row.request,expected:()=>row.expected});
for(const row of staticCases)test('independent actual Core rejection carries the same chain: '+row.name,{skip:!tool||!output},()=>{
  const model=row.hir??hir,ordinary=commonProgramCore(model,row.fixed,{targets:[]}).text,needle='request = '+coreQuote(canonical({targets:[]})),input=ordinary.replace(needle,'request = '+coreQuote(canonical(row.request)));assert.notEqual(input,ordinary);
  const child=spawnSync(tool,['--common-program','--canonicalize'],{input,windowsHide:true,maxBuffer:8388608,timeout:60000});
  mkdirSync(output,{recursive:true});const prefix=output+'/'+row.name;writeFileSync(prefix+'-input.mlir',input);writeFileSync(prefix+'-stdout.raw',child.stdout??Buffer.alloc(0));writeFileSync(prefix+'-stderr.raw',child.stderr??Buffer.alloc(0));
  children.push({name:row.name,pid:child.pid,status:child.status,error:child.error?.message??null});writeFileSync(output+'/children.json',JSON.stringify(children,null,2)+'\n');
  assert.ifError(child.error);assert.equal(child.status,3);assert.equal(child.stdout.length,0);
  const match=child.stderr.toString('utf8').match(/; callChain=(\{[^\n]*\}) \(/);assert.ok(match,'independent real reject must carry its call chain');
  if(row.name==='fixed-await'||row.name==='fixed-lock'){
    assert.ok(child.stderr.toString('utf8').includes('[core-ir-common-kernel]'));
    const root=row.expected().root;assert.ok(child.stderr.toString('utf8').includes('('+root.source.sourceId+':'+root.source.start+':'+root.source.end+')'));
  }
  assert.deepEqual(JSON.parse(match[1]),row.expected());
});
function widen(mutate){
  const broad=structuredClone(publication),row=broad.contracts.find(row=>row.functionId===byName.get('right').id);mutate(row.upper);
  const {digest,...body}=row;row.digest=commonIdentity('published-contract',body);broad.expectedDigest=commonIdentity('publication',{scopeDigest:broad.scopeDigest,contracts:broad.contracts});return {broad,row};
}
for(const kind of ['host-resource','facet'])test('pure body remains rejected solely by its fixed '+kind+' upper',()=>{
  const right=byName.get('right'),{broad,row}=widen(upper=>kind==='facet'?upper.facets.allocation=true:upper.hostResources={reads:['runtime.counter.events'],writes:[]});
  /** @type {import('../../compiler/common-program-diagnostics.mjs').KernelCallChain|undefined} */
  let chain;assert.throws(()=>verifyCommonKernelGroup(hir,broad,{targets:targets(['left','right'])}),error=>{
    assert.ok(error instanceof Error&&'callChain' in error);chain=/** @type {import('../../compiler/common-program-diagnostics.mjs').KernelCallChain} */(error.callChain);return true;
  });assert.ok(chain);assert.equal(chain.root.functionId,right.id);assert.deepEqual(chain.edges,[]);
  assert.deepEqual(chain.origin,{kind:'fixed-upper',functionId:right.id,source:{sourceId:right.sourcePath,...right.range},contractDigest:row.digest});
});
test('wrong callee, Source anchor and fixed contract identity reject before issuing a chain',()=>{
  const mutations=[changed=>{changed.functions.find(fn=>fn.name==='cross').body[0].value.callee=byName.get('right').id;},
    changed=>{changed.functions.find(fn=>fn.name==='cross').body[0].value.range.start++;}];
  for(const mutate of mutations){const changed=structuredClone(hir);mutate(changed);assert.throws(()=>verifyCommonKernelGroup(changed,publication,{targets:targets(['cross','right'])}));}
  const changed=structuredClone(publication);changed.contracts.find(row=>row.functionId===byName.get('right').id).upper.facets.allocation=true;
  assert.throws(()=>verifyCommonKernelGroup(hir,changed,{targets:targets(['left','right'])}),{code:'r03-common-program-publication-identity'});
  assert.equal(verifyCommonKernelGroup(hir,publication,{targets:targets(['left','right'])}).accesses.length,2);
});
test('actual compiler CLI preserves the typed cross-call diagnostic',{skip:!tool||!output},()=>{
  mkdirSync(output,{recursive:true});const prefix=output+'/cli',request={targets:targets(['cross','right'])};
  for(const [name,value]of Object.entries({hir,publication,request}))writeFileSync(prefix+'-'+name+'.json',canonical(value)+'\n');
  const child=spawnSync(process.execPath,[fileURLToPath(new URL('../../tooling/tsfgc.mjs',import.meta.url)),
    '--input',prefix+'-hir.json','--publication',prefix+'-publication.json','--kernel-request',prefix+'-request.json','--core',tool,'--emit','borrow-proof'],
    {windowsHide:true,maxBuffer:8388608,timeout:60000});
  writeFileSync(prefix+'-stdout.raw',child.stdout??Buffer.alloc(0));writeFileSync(prefix+'-stderr.raw',child.stderr??Buffer.alloc(0));
  children.push({name:'actual-node-cli',pid:child.pid,status:child.status,error:child.error?.message??null});writeFileSync(output+'/children.json',JSON.stringify(children,null,2)+'\n');
  assert.ifError(child.error);assert.equal(child.status,2);assert.equal(child.stdout.length,0);
  const match=child.stderr.toString('utf8').match(/; callChain=(\{[^\n]*\})/);assert.ok(match);assert.deepEqual(JSON.parse(match[1]),diagnostic('cross'));
});
