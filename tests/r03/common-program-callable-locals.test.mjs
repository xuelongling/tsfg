// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonTargets} from '../../compiler/common-program-targets.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {signatureId} from '../../compiler/module-callable-common.mjs';
import {readFileSync} from 'node:fs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {emitCommonProgramCore} from '../../compiler/common-program-core.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
for(const name of ['local-direct','local-const','local-reassignment','local-sibling-writer','local-ancestor','local-shadow'])test('complete official Source captures original callable local: '+name,()=>{
  const facts=readCommonProgramFacts(readFileSync(new URL('./testdata/common-callable-locals/'+name+'.json',import.meta.url))),hir=projectCommonProgram(facts),
    reader=hir.functions.find(f=>f.name==='childForwardReader'),capture=reader.captures[0],slot=hir.environments.flatMap(e=>e.slots).find(s=>s.binding===capture.binding),
    owner=hir.functions.find(f=>f.bindings.some(b=>b.id===capture.binding)),local=owner.bindings.find(b=>b.id===capture.binding),
    original=facts.payload.functions.flatMap(f=>f.bindings).find(b=>b.id===capture.binding);
  assert.equal(reader.captures.length,1);assert.equal(local.kind,'local');assert.equal(local.name,'selected');assert.equal(local.sourceBinding,original.id);
  assert.equal(slot.kind,'local');assert.equal(slot.type,local.type);assert.equal(slot.writable,['local-direct','local-reassignment','local-sibling-writer'].includes(name));
  assert.equal(owner.name,name==='local-shadow'?'forwardLayer':'relayReader');assert.equal(local.lexicalOwner,owner.id);
  const publication=createCommonProgramPublication(hir),request={targets:hir.closure.requiredRoots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()},core=emitCommonProgramCore(hir,publication,request);
  assert.match(core,/tsfg_program.invoke_indirect/);assert.match(core,/tsfg_program.env_load/);
  assert.match(core,/tsfg_program.env_store/);assert.equal(hir.hostContext,null);
});
test('a same-signature foreign local cannot replace the original captured binding in a cold packet',()=>{
  const packet=JSON.parse(readFileSync(new URL('./testdata/common-callable-locals/local-const.json',import.meta.url),'utf8')),
    reader=packet.payload.functions.find(f=>f.name==='childForwardReader'),foreign=packet.payload.functions.find(f=>f.name==='makeReaderBox').bindings.find(b=>b.name==='selected');
  reader.captures[0].binding=foreign.id;
  packet.packageId=sha256('tsfg.program-facts.package.v2\0'+packet.schemaHash+'\0'+canonical(packet.payload));
  assert.throws(()=>readCommonProgramFacts(Buffer.from(canonical(packet)+'\n')),e=>e instanceof Error&&'code' in e&&e.code==='r03-common-program-capture');
});
function capturedLocalModel(writer='none'){
  const scalar='scalar',callable='callable',range={start:0,end:1},signature={parameters:[],returnType:scalar},
    ref=id=>({kind:'functionReference',functionId:id,type:callable,range}),binding=id=>({kind:'bindingReference',binding:id,type:callable,range}),
    invoke=expression=>({kind:'indirectCall',expression,type:scalar,signature,arguments:[],range}),
    leaf=id=>({id,kind:'source',signatureHash:signatureId({parameters:[],returns:scalar}),parameters:[],bindings:[],captures:[],returnType:scalar,body:[]}),
    assignment={kind:'expression',value:{kind:'bindingAssignment',target:{kind:'bindingTarget',binding:'original',type:callable,range},value:ref('right'),type:callable,range}},
    reader={...leaf('reader'),lexicalParent:'factory',captures:[{binding:'original',read:true,write:false}],body:[{kind:'return',value:invoke(binding('original'))}]},
    sibling={...leaf('writer'),lexicalParent:'factory',captures:[{binding:'original',read:false,write:true}],body:[assignment]},
    factory={...leaf('factory'),signatureHash:signatureId({parameters:[],returns:callable}),bindings:[{id:'original',type:callable}],returnType:callable,
      body:[{kind:'constDeclaration',binding:'original',initializer:ref('left')},...(writer==='owner'?[assignment]:[]),{kind:'return',value:ref('reader')}]},
    root={...leaf('root'),body:[{kind:'expression',value:{kind:'call',callee:'factory',arguments:[],type:callable,range}}]},
    hir={types:[{id:scalar,kind:'scalar'},{id:callable,kind:'function',parameters:[],returnType:scalar}],functions:[leaf('left'),leaf('right'),factory,reader,...(writer==='sibling'?[sibling]:[]),root],globals:[],modules:[],closure:{roots:[{kind:'kernel',target:'root'}]},snapshot:{payload:{compatibilityWitnesses:[]}}};
  return {hir,range};
}
for(const writer of ['none','owner','sibling'])test('original captured local joins initializer and all '+writer+' writers',()=>{
  const {hir,range}=capturedLocalModel(writer),flow=commonTargets(hir,commonMeter());
  assert.deepEqual(flow.site('reader',range),{top:false,functions:writer==='none'?['left']:['left','right']});
});
test('equal function signatures do not alias different local bindings',()=>{
  const {hir,range}=capturedLocalModel('sibling');hir.functions.find(f=>f.id==='writer').body[0].value.target.binding='unrelated';
  hir.functions.find(f=>f.id==='factory').bindings.push({id:'unrelated',type:'callable'});
  assert.deepEqual(commonTargets(hir,commonMeter()).site('reader',range),{top:false,functions:['left']});
});
test('fixed transfer retains published incoming permission in a local cell',()=>{
  const {hir,range}=capturedLocalModel(),factory=hir.functions.find(f=>f.id==='factory');
  factory.parameters=[{id:'incoming',type:'callable'}];factory.body[0].initializer={kind:'bindingReference',binding:'incoming',type:'callable',range};
  hir.functions.find(f=>f.id==='root').body[0].value.arguments=[{kind:'functionReference',functionId:'left',type:'callable',range}];
  const bounds=new Map([...commonTargets(hir,commonMeter()).contracts].map(([id,callables])=>[id,{callables:structuredClone(callables)}]));
  bounds.get('factory').callables.parameters[0].allowed.functions.push('right');
  assert.deepEqual(commonTargets(hir,commonMeter(),bounds).site('reader',range),{top:false,functions:['left','right']});
});
test('a new sibling local writer cannot refresh a narrower published return upper',()=>{
  const original=capturedLocalModel(),reader=original.hir.functions.find(f=>f.id==='reader');
  reader.returnType='callable';reader.body[0].value={kind:'bindingReference',binding:'original',type:'callable',range:original.range};
  const bounds=new Map([...commonTargets(original.hir,commonMeter()).contracts].map(([id,callables])=>[id,{callables:structuredClone(callables)}])),changed=capturedLocalModel('sibling'),current=changed.hir.functions.find(f=>f.id==='reader');
  current.returnType='callable';current.body[0].value={kind:'bindingReference',binding:'original',type:'callable',range:changed.range};
  bounds.set('writer',{callables:{parameters:[],returns:null,slotWrites:[]}});
  assert.throws(()=>commonTargets(changed.hir,commonMeter(),bounds),e=>e instanceof Error&&'code' in e&&e.code==='r03-common-program-callable-contract'&&e.message.includes('return exceeds fixed callable upper'));
});
