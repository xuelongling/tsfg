// SPDX-License-Identifier: MIT
// Complete official Source pair; Source acceptance supplies no lifetime authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {commonProgramCore} from '../../compiler/common-program-core.mjs';
import {canonical} from '../../compiler/identity.mjs';
const directory=new URL('../fixtures/r03/common-self-held-storage/',import.meta.url),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const cases=[
  {name:'self-held-external-store-wrong-owner',bytes:250,source:'58512b18834f154eea2621ab2c45f4ab585dae20f61fb9fd5a05e65a72c31eaf',packet:'44b199e2e5a1b9fb5b78683a5bae1125373f1e53125b8dceddf32805440d406a',wrong:true},
  {name:'self-held-external-store-safe',bytes:248,source:'dc135f773266d35f2df916e412e816a6983c2057410d0b25d75b9139990a6bd3',packet:'d0440c17dd8e5f02e3e9e456cfe116bce415fd163a6d0ab750f3934616842989',wrong:false},
  {name:'self-held-external-store-mutable-owner',bytes:239,source:'25857ef7ecbc04fe1639a2348d61a86dbc99e6cfeab77e86ed24a8163fdd19d5',packet:'995afee78fe22177982a6fa7c392b383a0cc1524769c468236a19656816ca1b5',negative:true,mutable:true},
  {name:'self-held-external-store-owner-resize',bytes:270,source:'2f7c3b586abfee2593a2f16a7e79eeb60862207cc1a3c3feaf99899719b626ce',packet:'a6d25c63df84219bc369e7acca3315b2da7fcd7657ab038a57d17aaa89caede6',negative:true,resize:true}
];
function original(sample){
  const bytes=readFileSync(new URL(sample.name+'-package.json',directory)),packet=JSON.parse(bytes.toString()),p=packet.payload,
    requestBytes=readFileSync(new URL(sample.name+'-request.json',directory)),request=JSON.parse(requestBytes.toString()),
    sourceBytes=readFileSync(new URL(sample.name+'.source.txt',directory)),sourceText=sourceBytes.toString(),
    oracle=JSON.parse(readFileSync(new URL(sample.name+'-official-oracle.json',directory),'utf8'));
  assert.equal(hash(bytes),sample.packet);assert.equal(sourceBytes.length,sample.bytes);assert.equal(hash(sourceBytes),sample.source);
  assert.equal(packet.schemaHash,'sha256:6f6af231a779d6c8e55a4d0acde8fa6e5af5d7c7c2f5b54e6aa5487b34bedb78');
  assert.equal(request.schemaHash,packet.schemaHash);assert.equal(requestBytes.toString(),canonical(request)+'\n');
  assert.equal(oracle.Case,sample.name);assert.equal(oracle.SourceSHA,sample.source);assert.deepEqual(oracle.Diagnostics,[0,0,0,0]);
  assert.equal(p.files.length,2);const source=p.files.find(row=>row.path==='/src/main.ts');assert.ok(source);
  assert.equal(source.content,sourceText);assert.equal(source.sha256,sample.source);assert.equal(source.byteLength,sample.bytes);assert.equal(source.utf16Length,sourceText.length);
  assert.equal(request.input.files.find(row=>row.path==='/src/main.ts').content,sourceText);
  assert.equal(p.functions.length,1);assert.equal(p.modules.length,1);assert.equal(p.globals.length,0);
  assert.equal(p.modules[0].exports.length,1);assert.equal(p.modules[0].exports[0].name,'run');assert.equal(p.modules[0].initialization.length,0);
  assert.equal(p.closure.roots.length,2);assert.deepEqual(p.closure.requiredRoots,[]);
  assert.deepEqual(request.input.compilationClosure.requiredRoots,[]);
  const fn=p.functions[0],bindings=new Map([...fn.parameters,...fn.bindings].map(row=>[row.name,row])),types=new Map(p.types.map(row=>[row.id,row]));
  assert.equal(fn.id,oracle.RunID);assert.equal(fn.name,'run');assert.equal(fn.returnType,'void');assert.equal(fn.lexicalParent,null);
  assert.deepEqual(fn.declarationRange,oracle.RunRange);assert.deepEqual(fn.nameRange,oracle.RunNameRange);assert.equal(fn.parameters.length,1);assert.equal(fn.bindings.length,3);
  assert.deepEqual(fn.declarationScope,{start:0,end:sourceText.length});assert.deepEqual(fn.captures,[]);assert.equal(fn.body.length,sample.resize?5:4);
  for(const expected of Object.values(oracle.Bindings)){const actual=bindings.get(expected.Name);assert.ok(actual);assert.equal(actual.id,expected.ID);
    assert.deepEqual(actual.declarationRange,expected.DeclarationRange);assert.deepEqual(actual.nameRange,expected.NameRange);
    assert.equal(actual.lexicalOwner,fn.id);assert.equal(actual.writable,expected.Name==='out');}
  const application=p.closure.roots.find(row=>row.kind==='application'),initialization=p.closure.roots.find(row=>row.kind==='module-initialization');
  assert.ok(application&&initialization);assert.equal(application.name,'run');assert.equal(application.target,oracle.RunID);assert.deepEqual(application.range,oracle.RunRange);
  assert.equal(initialization.target,'/src/main.ts');assert.equal(initialization.name,'$moduleInit');assert.deepEqual(initialization.range,{start:0,end:sourceText.length});
  const holder=p.types.find(row=>row.name==='H');assert.ok(holder);assert.equal(holder.kind,'reference');assert.equal(holder.fields.length,2);
  assert.deepEqual(holder.declarationRange,oracle.ClassRange);assert.deepEqual(holder.nameRange,oracle.ClassNameRange);
  assert.deepEqual(holder.constructor.declarationRange,oracle.ConstructorRange);assert.equal(holder.constructor.parameters.length,2);assert.deepEqual(holder.constructor.body,[]);
  assert.equal(holder.construction.kind,'explicit');assert.deepEqual(holder.construction.initializationFields,oracle.Fields.map(field=>field.ID));
  for(const [index,expected]of oracle.Fields.entries()){const field=holder.fields.find(row=>row.id===expected.ID),parameter=holder.constructor.parameters[index];assert.ok(field);
    assert.equal(field.name,expected.Name);assert.equal(expected.Readonly,!(sample.mutable&&expected.Name==='owner'));assert.equal(expected.Public,true);assert.equal(field.readonly,expected.Readonly);assert.equal(field.access,'public');
    assert.equal(field.parameterBinding,expected.ParameterBinding);assert.equal(parameter.id,expected.ParameterBinding);assert.equal(parameter.declaredType,field.type);
    assert.deepEqual(parameter.declarationRange,expected.DeclarationRange);assert.deepEqual(parameter.nameRange,expected.NameRange);
    assert.deepEqual(field.origin,{source:'/src/main.ts',...expected.DeclarationRange});}
  const owner=holder.fields.find(row=>row.name==='owner'),span=holder.fields.find(row=>row.name==='span');
  assert.equal(types.get(owner.type).kind,'array');assert.equal(types.get(owner.type).elementType,'i32');assert.equal(types.get(span.type).kind,'readSpan');assert.equal(types.get(span.type).elementType,'i32');
  assert.equal(types.get(bindings.get('out').declaredType).kind,'array');assert.equal(types.get(bindings.get('out').declaredType).elementType,holder.id);
  assert.equal(bindings.get('a').declaredType,owner.type);assert.equal(bindings.get('r').declaredType,span.type);assert.equal(bindings.get('h').declaredType,holder.id);
  const [a,r,h]=fn.body,statement=fn.body.at(-1);assert.deepEqual([a.kind,r.kind,h.kind,statement.kind],['constDeclaration','constDeclaration','constDeclaration','expression']);
  assert.equal(a.binding,bindings.get('a').id);assert.equal(r.binding,bindings.get('r').id);assert.equal(h.binding,bindings.get('h').id);
  assert.equal(a.initializer.kind,'arrayLiteral');assert.equal(a.initializer.allocationSite,oracle.InitialAllocationID);assert.deepEqual(a.initializer.range,oracle.InitialArrayRange);
  assert.equal(a.initializer.elements.length,1);assert.equal(a.initializer.elements[0].decimal,'1');
  const view=r.initializer;assert.equal(view.kind,'call');assert.equal(view.callee,p.readSpanIntrinsic.id);assert.deepEqual(view.range,oracle.SpanCallRange);
  assert.equal(view.arguments.length,3);assert.equal(view.arguments[0].binding,a.binding);assert.equal(view.arguments[1].decimal,'0');assert.equal(view.arguments[2].decimal,'1');assert.equal(view.type,span.type);
  assert.equal(view.signature.sourcePath,oracle.SpanSignaturePath);assert.deepEqual(view.signature.declarationRange,oracle.SpanSignatureRange);
  const create=h.initializer;assert.equal(create.kind,'new');assert.equal(create.callee,holder.id);assert.deepEqual(create.range,oracle.ConstructorCallRange);
  assert.equal(create.arguments.length,2);assert.equal(create.arguments[1].binding,r.binding);assert.deepEqual(create.signature.declarationRange,oracle.ConstructorRange);
  const actualOwner=create.arguments[0];assert.deepEqual(actualOwner.range,oracle.OwnerArgumentRange);
  if(sample.wrong){assert.equal(oracle.OwnerForm,'independent-allocation');assert.notEqual(oracle.OwnerAllocationID,oracle.InitialAllocationID);
    assert.equal(actualOwner.kind,'arrayLiteral');assert.equal(actualOwner.allocationSite,oracle.OwnerAllocationID);assert.equal(actualOwner.elements.length,1);assert.equal(actualOwner.elements[0].decimal,'2');}
  else{assert.equal(oracle.OwnerForm,'same-original-a-Symbol');assert.equal(oracle.OwnerAllocationID,oracle.InitialAllocationID);assert.equal(actualOwner.kind,'bindingReference');assert.equal(actualOwner.binding,a.binding);}
  const store=statement.value;assert.equal(store.kind,'elementAssignment');assert.equal(store.operator,'=');assert.deepEqual(store.range,oracle.StoreRange);
  assert.equal(store.target.kind,'elementTarget');assert.equal(store.target.receiver.binding,bindings.get('out').id);assert.equal(store.target.index.decimal,'0');assert.equal(store.value.binding,h.binding);
  if(sample.resize){const resize=fn.body[3].value;assert.equal(resize.kind,'lengthAssignment');assert.equal(resize.operator,'=');assert.deepEqual(resize.range,oracle.StructuralRange);
    assert.equal(resize.target.kind,'lengthTarget');assert.equal(resize.target.receiver.kind,'fieldAccess');assert.equal(resize.target.receiver.property,owner.id);
    assert.equal(resize.target.receiver.receiver.binding,h.binding);assert.equal(resize.value.decimal,'0');assert.ok(create.range.end<resize.range.start&&resize.range.end<store.range.start);}
  assert.ok(a.initializer.range.end<view.range.start&&view.range.end<create.range.start&&create.range.end<store.range.start);
  const hir=projectCommonProgram(readCommonProgramFacts(bytes)),run=hir.functions.find(row=>row.sourceBinding===oracle.RunID);assert.ok(run);
  assert.ok(hir.closure.roots.some(row=>row.kind==='application'&&row.target===run.id));assert.equal(run.parameters.length,1);assert.equal(run.body.length,sample.resize?5:4);
  assert.deepEqual(run.body.map(row=>row.kind),['constDeclaration','constDeclaration','constDeclaration',...(sample.resize?['expression']:[]),'expression']);
  const publication=createCommonProgramPublication(hir),record=publication.contracts.find(row=>row.functionId===run.id);assert.ok(record);
  assert.ok(record.upper.parameters.some(row=>row.index===0&&row.write===true&&row.structural===true),'out store remains in fixed Published upper');
  console.log(JSON.stringify({case:sample.name,preconditions:'complete original Source/Symbol/readonly/owner/typed store and real application root',source:sample.source,run:run.id,store:oracle.StoreRange,targets:[]}));
  return {hir,publication,request:{targets:[]},run,oracle};
}
for(const sample of cases)test('complete self-held external Array storage '+sample.name,()=>{
  const {hir,publication,request,run,oracle}=original(sample);
  if(sample.wrong||sample.mutable||sample.resize){const range=sample.resize?oracle.StructuralRange:oracle.StoreRange;assert.throws(()=>commonProgramCore(hir,publication,request,{borrowProof:true}),error=>
    error instanceof Error&&'code'in error&&'functionId'in error&&'primary'in error&&typeof error.primary==='object'&&error.primary!==null&&'start'in error.primary&&'end'in error.primary&&
    error.code===(sample.resize?'r03-common-program-borrow-conflict':'r03-common-program-borrow-pending')&&error.functionId===run.id&&
    error.primary.start===range.start&&error.primary.end===range.end);return;}
  const core=commonProgramCore(hir,publication,request,{borrowProof:true}),proof=core.borrowProof;assert.ok(proof);
  assert.deepEqual(proof.request.targets,[]);assert.ok(proof.functions.some(row=>row.functionId===run.id&&row.sourceBinding===oracle.RunID));
  const definitions=proof.events.definitions.filter(row=>row.at.functionId===run.id&&row.at.name==='readspan');
  assert.ok(definitions.some(row=>row.at.source.start===oracle.SpanCallRange.start&&row.at.source.end===oracle.SpanCallRange.end&&row.at.activation.root===run.id&&row.at.activation.steps.length===0),'run actual root defines the original descriptor');
  assert.ok(proof.events.effects.some(row=>row.at.functionId===run.id&&row.at.name==='array_store'&&row.at.source.start===oracle.StoreRange.start&&row.at.source.end===oracle.StoreRange.end),'empty targets still observes the real out[0]=h effect');
  const output=process.env.TSFG_STORAGE_CORE_ROOT;
  if(output){mkdirSync(output,{recursive:true});for(const [name,bytes]of [['self-held-safe.mlir',core.text],['self-held-safe.owned.json',canonical({hir,publication,request})+'\n'],['self-held-safe.proof.json',canonical(proof)+'\n']])writeFileSync(new URL(name,new URL('file:///'+output+'/')),bytes,{flag:'wx'});}
});
