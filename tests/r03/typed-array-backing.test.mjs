// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir} from '../../compiler/hir.mjs';
import {buildTypedLayouts} from '../../compiler/typed-layouts.mjs';
import {buildTypedArrayBacking,writeTypedArrayBacking} from '../../compiler/typed-array-backing.mjs';
import {canonical,scalarTypeIds,sha256} from '../../compiler/identity.mjs';
import {originId} from '../../compiler/typed-array-schema.mjs';
import {optionalArrayPublication} from './typed-array-publication-fixtures.mjs';
const output='E:/ws/pro_tsfg/.scratch/tsfg_r03/M25-formal-array-checks-20261022/array-backing-captures';
test('real Source narrow allocation has separate identity and actual U capacity through a wide alias',async()=>{
  const bytes=await readFile(new URL('./testdata/typed-array-entry/87d0326f6f0e3e1eb887a77b7eb207a938c3ca173f094f8cdb21f1820284a4ad-package.json',import.meta.url));
  assert.equal(bytes.length,9504);assert.equal(sha256(bytes),'sha256:042eee481c55e941ee47e8ebe284feff0d16621cf37f60c3615d3b247eb9d051');
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId},built=buildHir(facts,context);
  assert.equal(built.status,'ok');const hir=built.hir,plan=buildTypedArrayBacking(hir,context),row=plan.arrays[0];
  assert.equal(plan.arrays.length,1);assert.equal(row.elementType,scalarTypeIds.i32);
  assert.deepEqual(row.members,[scalarTypeIds.i32,sha256('tsfg.type\0undefined')].sort());assert.equal(row.views.length,2);
  assert.equal(buildTypedLayouts(hir,context).entries.find(entry=>entry.typeId===scalarTypeIds.i32).layout.byteSize,4);
  const run=hir.functions.find(fn=>fn.name==='run'),local=run.body.find(node=>node.kind==='local'&&node.binding.name==='copied');
  assert.equal(local.initializer.kind,'arrayReadChecked');assert.equal(local.initializer.type,scalarTypeIds.i32);
  const source=hir.sources.find(source=>source.path==='/src/main.ts').content;
  assert.equal(source.slice(local.initializer.range.start,local.initializer.range.end),'narrow[0]');
  await mkdir(output,{recursive:true});await writeFile(output+'/narrow.bin',writeTypedArrayBacking(hir,context));
  await writeFile(output+'/narrow.json',JSON.stringify(plan,null,2)+'\n');
});

const cases=[
  ['value','typed-array-source514/a1b88a8d66b51d72a357096721f03ac7d3f9523f954007248167ed50337371b2-package.json'],
  ['reference','typed-array-source514/9a54297c236e129e1e813e964bf3736c78af06bdb4eda7f1b107c9367308e348-package.json'],
  ['nested','typed-array-source514/9068b0b5e16dd0715dc9bc165c9d067a6594b1ce67d21d2477cbe5df560146de-package.json'],
  ['scalar','typed-array-source514/f49f1bcd5ed9c07068a8f15a805046fc71525361ec87af100d433ab8f520bc3a-package.json'],
  ['readonly','typed-array-actual-v8/d70e95378e645d194db0875bfa9de4bbe1e774bde2ffa5a2872ce21d1ef89969-package.json'],
  ['empty','typed-array-source514/8929c29478f722bf994902b3223c2e6c4aff1d65fce77899ab7fc982ca994eb1-package.json'],
];
test('actual Source value/reference/scalar variants, nested owners and readonly views use the same producer',async()=>{
  for(const [name,file] of cases) {
    const bytes=await readFile(new URL('./testdata/'+file,import.meta.url)),facts=readTypedArrayFacts(bytes),
      context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId},publication=optionalArrayPublication(facts),
      built=buildHir(facts,context,publication),options={publicationContext:publication};
    assert.equal(built.status,'ok',name);const plan=buildTypedArrayBacking(built.hir,context,options);assert.ok(plan.arrays.length,name);
    if(name==='empty')assert.ok(plan.arrays.some(row=>row.members.length===0));
    else assert.ok(plan.arrays.every(row=>row.members.length>0));
    await writeFile(output+'/'+name+'.bin',writeTypedArrayBacking(built.hir,context,options));
    await writeFile(output+'/'+name+'.json',JSON.stringify(plan,null,2)+'\n');
  }
});

test('an exported nested Array parameter publishes both caller backing rows',async()=>{
  const file=cases.find(([name])=>name==='nested')[1];
  const retained=await readFile(new URL('./testdata/'+file,import.meta.url));
  const packet=structuredClone(readTypedArrayFacts(retained)),payload=packet.payload,root=payload.rootFile;
  const donor=payload.functions[0],outerType=donor.bindings[1].declaredType;
  const innerType=payload.types.find(row=>row.id===outerType).elementType;
  const content='export function f(outer: i32[][]): i32 { return outer[0][0]; }\n';
  const range=(start,end)=>({start,end});
  const locate=(value,from=0)=>{const start=content.indexOf(value,from);assert.ok(start>=0,value);return range(start,start+value.length);};
  const nameRange=locate('outer'),annotationRange=locate('i32[][]'),declarationRange=range(0,content.length-1);
  const parameter={...donor.bindings[1],id:originId(root,nameRange),kind:'parameter',writable:true,
    nameRange,annotationRange,elementAnnotationRange:range(annotationRange.start,annotationRange.end-2),
    declarationRange:range(nameRange.start,annotationRange.end)};
  const use=locate('outer[0][0]'),receiver={kind:'bindingReference',binding:parameter.id,
    type:outerType,flowType:outerType,range:range(use.start,use.start+'outer'.length)};
  const checked=(receiver,type,end)=>({kind:'checkedElementAccess',type,flowType:type,receiver,
    range:range(use.start,end),index:{kind:'numericLiteral',type:'u32',flowType:'u32',token:'0',decimal:'0',range:range(end-2,end-1)}});
  const fn={...donor,declarationRange,returnAnnotationRange:locate('i32',annotationRange.end),
    id:sha256('tsfg.array-facts.function.v8\0'+canonical({sourcePath:root,declarationRange})),
    parameters:[parameter],bindings:[],body:[{kind:'return',range:locate('return outer[0][0];'),
      value:checked(checked(receiver,innerType,use.end-3),'i32',use.end)}]};
  payload.functions=[fn];payload.exports[0].functionId=fn.id;
  payload.entryCompatibilityRoots=[{functionId:fn.id,parameterBinding:parameter.id,
    origin:{source:root,...parameter.declarationRange},viewType:outerType,roots:[]}];
  Object.assign(payload.files.find(row=>row.path===root),{content,byteLength:Buffer.byteLength(content),
    utf16Length:content.length,sha256:sha256(content).slice(7)});
  const request={family:'tsfg.array-facts-request-candidate',version:packet.version,input:{
    sourceRoot:payload.sourceRoot,rootFile:root,files:payload.files.map(({path,content,sha256})=>({path,content,sha256})),
    declarations:payload.declarations,config:payload.config}};
  packet.requestId=sha256('tsfg.array-facts.request.v8\0'+canonical(request)+'\n');
  packet.packageId=sha256('tsfg.array-facts.package.v8\0'+packet.schemaHash+'\0'+canonical(payload));
  const bytes=Buffer.from(canonical(packet)+'\n'),facts=readTypedArrayFacts(bytes);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const built=buildHir(facts,context);assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const array=sha256('tsfg.type\0Array<i32>'),nested=sha256('tsfg.type\0Array<Array<i32>>');
  const rows=buildTypedArrayBacking(built.hir,context).arrays;
  assert.deepEqual(rows.map(({typeId,elementType,members})=>({typeId,elementType,members})),[
    {typeId:array,elementType:scalarTypeIds.i32,members:[scalarTypeIds.i32]},
    {typeId:nested,elementType:array,members:[array]},
  ].sort((left,right)=>left.typeId.localeCompare(right.typeId)));
});

test('exported Array parameters retain the directional view of a shared entry owner',async()=>{
  const donor='87d0326f6f0e3e1eb887a77b7eb207a938c3ca173f094f8cdb21f1820284a4ad-package.json';
  const retained=await readFile(new URL('./testdata/typed-array-entry/'+donor,import.meta.url));
  const packet=structuredClone(readTypedArrayFacts(retained)),payload=packet.payload,root=payload.rootFile,fn=payload.functions[0];
  const source='export function run(narrow: i32[], wide: (i32|undefined)[]): i32 { wide[0] = undefined; return narrow[0]; }\n';
  const range=(start,end)=>({start,end});
  const locate=(text,from=0)=>{const start=source.indexOf(text,from);assert.ok(start>=0,text);return range(start,start+text.length);};
  const [narrow,wide]=['i32[]','(i32|undefined)[]'].map((text,index)=>{
    const binding=fn.bindings[index],name=locate(binding.name),type=locate(text,name.end);
    return {...binding,id:originId(root,name),kind:'parameter',writable:true,nameRange:name,annotationRange:type,
      elementAnnotationRange:range(type.start,type.end-2),declarationRange:range(name.start,type.end)};
  });
  const element=(kind,binding,type,rangeValue)=>{
    const receiverRange=range(rangeValue.start,rangeValue.start+binding.name.length);
    return {kind,type,range:rangeValue,receiver:{kind:'bindingReference',binding:binding.id,type:binding.declaredType,
      flowType:binding.declaredType,range:receiverRange},
    index:{kind:'numericLiteral',type:'u32',flowType:'u32',token:'0',decimal:'0',range:range(rangeValue.end-2,rangeValue.end-1)}};
  };
  const store=locate('wide[0] = undefined'),target=locate('wide[0]'),rhs=locate('undefined',target.end),wideElement='union<i32,undefined>';
  fn.declarationRange=range(0,source.length-1);fn.returnAnnotationRange=locate('i32',wide.annotationRange.end);
  fn.id=sha256('tsfg.array-facts.function.v8\0'+canonical({sourcePath:root,declarationRange:fn.declarationRange}));
  fn.parameters=[narrow,wide];fn.bindings=[];fn.body=[
    {kind:'expression',range:range(store.start,store.end+1),value:{kind:'elementAssignment',type:wideElement,flowType:'undefined',
      range:store,target:element('elementTarget',wide,wideElement,target),operator:'=',operatorRange:locate('=',target.end),
      value:{kind:'undefinedLiteral',type:'undefined',flowType:'undefined',range:rhs}}},
    {kind:'return',range:locate('return narrow[0];'),value:{...element('checkedElementAccess',narrow,'i32',locate('narrow[0]')),flowType:'i32'}},
  ];
  payload.exports[0].functionId=fn.id;
  payload.entryCompatibilityRoots=[narrow,wide].sort((left,right)=>left.id<right.id?-1:1).map(binding=>({
    functionId:fn.id,parameterBinding:binding.id,origin:{source:root,...binding.declarationRange},viewType:binding.declaredType,roots:[]}));
  Object.assign(payload.files.find(row=>row.path===root),{content:source,byteLength:Buffer.byteLength(source),
    utf16Length:source.length,sha256:sha256(source).slice(7)});
  const request={family:'tsfg.array-facts-request-candidate',version:packet.version,input:{sourceRoot:payload.sourceRoot,rootFile:root,
    files:payload.files.map(({path,content,sha256})=>({path,content,sha256})),declarations:payload.declarations,config:payload.config}};
  packet.requestId=sha256('tsfg.array-facts.request.v8\0'+canonical(request)+'\n');
  packet.packageId=sha256('tsfg.array-facts.package.v8\0'+packet.schemaHash+'\0'+canonical(payload));
  const bytes=Buffer.from(canonical(packet)+'\n'),facts=readTypedArrayFacts(bytes);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const built=buildHir(facts,context);assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const narrowId=sha256('tsfg.type\0Array<i32>'),wideId=sha256('tsfg.type\0Array<Union<i32,undefined>>');
  const members=[scalarTypeIds.i32,sha256('tsfg.type\0undefined')].sort();
  const rows=buildTypedArrayBacking(built.hir,context).arrays;
  assert.deepEqual(rows.map(({typeId,members,views})=>({typeId,members,views})),[
    {typeId:narrowId,members,views:[narrowId,wideId].sort()},
    {typeId:wideId,members,views:[wideId]},
  ]);
});
