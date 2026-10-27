// SPDX-License-Identifier: MIT
// Official packets prove static acceptance; normalized models independently
// check code bounds. Neither grants an environment instance or execution result.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {emitCommonProgramCore} from '../../compiler/common-program-core.mjs';
import {commonTargets} from '../../compiler/common-program-targets.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {signatureId} from '../../compiler/module-callable-common.mjs';
for(const name of ['callable-readonly','callable-reassignment','callable-ancestor-forward','callable-shadow-local'])test('complete Source incoming callable capture: '+name,()=>{
  const facts=readCommonProgramFacts(readFileSync(new URL('./testdata/common-callable-parameters/'+name+'.json',import.meta.url))),hir=projectCommonProgram(facts),
    factory=hir.functions.find(f=>f.name==='relayReader'),parameter=factory.parameters.find(p=>p.name==='reader'),
    original=facts.payload.functions.find(f=>f.name==='relayReader').parameters.find(p=>p.name==='reader');
  assert.equal(parameter.id,original.id);assert.equal(parameter.sourceBinding,original.id);assert.equal(parameter.lexicalOwner,factory.id);
  const captured=hir.functions.flatMap(f=>f.captures).filter(c=>c.binding===parameter.id),slots=hir.environments.flatMap(e=>e.slots).filter(s=>s.binding===parameter.id);
  if(name==='callable-shadow-local'){assert.equal(captured.length,0);assert.equal(slots.length,0);}
  else{assert.equal(captured.length,1);assert.equal(captured[0].write,name==='callable-reassignment');assert.equal(slots.length,1);assert.equal(slots[0].kind,'parameter');assert.equal(slots[0].type,parameter.type);}
  const publication=createCommonProgramPublication(hir),request={targets:hir.closure.requiredRoots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()},
    core=emitCommonProgramCore(hir,publication,request);assert.match(core,/tsfg_program.invoke_indirect/);assert.match(core,/tsfg_program.env_load/);
});
function capturedParameterModel(write=false){
  const scalar='scalar',callable='callable',range={start:0,end:1},signature={parameters:[],returnType:scalar},
    ref=id=>({kind:'functionReference',functionId:id,type:callable,range}),binding=id=>({kind:'bindingReference',binding:id,type:callable,range}),
    invoke=expression=>({kind:'indirectCall',expression,type:scalar,signature,arguments:[],range}),
    leaf=id=>({id,kind:'source',signatureHash:signatureId({parameters:[],returns:scalar}),parameters:[],bindings:[],returnType:scalar,body:[]}),
    assignment={kind:'expression',value:{kind:'bindingAssignment',target:{kind:'bindingTarget',binding:'original',type:callable,range},value:ref('right'),type:callable,range}},
    reader={...leaf('reader'),lexicalParent:'factory',captures:[{binding:'original',read:true,write}],body:[...(write?[assignment]:[]),{kind:'return',value:invoke(binding('original'))}]},
    factory={...leaf('factory'),signatureHash:signatureId({parameters:[callable],returns:callable}),parameters:[{id:'original',type:callable}],returnType:callable,body:[{kind:'return',value:ref('reader')}]},
    root={...leaf('root'),bindings:[{id:'selected',type:callable}],body:[{kind:'constDeclaration',binding:'selected',initializer:{kind:'call',callee:'factory',arguments:[ref('left')],type:callable,range}},{kind:'return',value:invoke(binding('selected'))}]},
    hir={types:[{id:scalar,kind:'scalar'},{id:callable,kind:'function',parameters:[],returnType:scalar}],functions:[leaf('left'),leaf('right'),factory,reader,root],globals:[],modules:[],closure:{roots:[{kind:'kernel',target:'root'}]},snapshot:{payload:{compatibilityWitnesses:[]}}};
  return {hir,range};
}
const fixed=flow=>new Map([...flow.contracts].map(([id,callables])=>[id,{callables:structuredClone(callables)}]));
test('captured original parameter inherits its incoming code upper',()=>{
  const {hir,range}=capturedParameterModel(),flow=commonTargets(hir,commonMeter());assert.deepEqual(flow.site('reader',range),{top:false,functions:['left']});
});
test('all verified writes join the shared parameter upper across lexical readers',()=>{
  const {hir,range}=capturedParameterModel(true),flow=commonTargets(hir,commonMeter());
  assert.deepEqual(flow.contracts.get('factory').parameters[0].allowed,{top:false,functions:['left','right']});
  assert.deepEqual(flow.site('reader',range),{top:false,functions:['left','right']});
});
test('new current capture writer cannot refresh a narrower published parameter bound',()=>{
  const original=capturedParameterModel(),records=fixed(commonTargets(original.hir,commonMeter())),changed=capturedParameterModel(true);
  assert.throws(()=>commonTargets(changed.hir,commonMeter(),records),e=>e instanceof Error&&'code' in e&&e.code==='r03-common-program-callable-contract');
});
test('fixed broader parameter permission wins over the selected incoming argument',()=>{
  const {hir,range}=capturedParameterModel(),records=fixed(commonTargets(hir,commonMeter()));records.get('factory').callables.parameters[0].allowed.functions.push('right');
  assert.deepEqual(commonTargets(hir,commonMeter(),records).site('reader',range),{top:false,functions:['left','right']});
});
test('external incoming callable remains TOP through its captured original binding',()=>{
  const {hir,range}=capturedParameterModel();hir.closure.roots.push({kind:'kernel',target:'factory'});
  assert.equal(commonTargets(hir,commonMeter()).site('reader',range).top,true);
});
