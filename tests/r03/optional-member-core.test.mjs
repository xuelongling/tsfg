// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {buildHir,verifyHir,printHir,readHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {buildTypedReferenceViews,writeTypedReferenceViews} from '../../compiler/typed-reference-views.mjs';
import {writeTypedFieldBacking} from '../../compiler/typed-field-backing.mjs';
import {typedReferenceAuthority} from '../../compiler/typed-reference-authority.mjs';
import {memberPresence,actualFieldResolver,undefinedMemberType} from '../../compiler/member-presence.mjs';
import {canonical,sha256,scalarTypeIds} from '../../compiler/identity.mjs';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import narrowCopy from './testdata/typed-array-entry/narrow-copy.json' with {type:'json'};
const bytes=await readFile(new URL('./testdata/optional-property-v1/source-package.json',import.meta.url));
const facts=JSON.parse(bytes.toString()),context={family:'tsfg.optional-property-facts-context-candidate',version:1,
  factsBytes:bytes,expectedPackageId:facts.packageId};
function actual(){const built=buildHir(facts,context);assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));return built.hir;}
test('complete actual selected optional HIR enters the ordinary producer without erasure',()=>{
  const hir=actual();assert.equal(hir.types.length,9);assert.equal(hir.functions.length,2);
  assert.equal(hir.types.filter(type=>type.construction).length,3);
  assert.deepEqual(verifyHir(hir,context),hir);
  assert.deepEqual(readHir(Buffer.from(printHir(hir,context)),context),hir);
  assert.throws(()=>verifyHir(hir));
  const plan=buildFiniteCoreDomains(hir,context).definition;
  assert.ok(plan.expressions.some(row=>row.kind==='propertyPresenceTest'));
  const missing=hir.types.find(type=>type.fields?.length===1&&type.fields[0].name==='tag');
  const views=buildTypedReferenceViews(hir,context),view=views.views.find(row=>row.actualType===missing.id);
  assert.equal(views.version,2);assert.equal(view.fields.filter(row=>row.missing).length,1);
  const read=plan.fields.find(row=>row.kind==='read');assert.ok(read.targets.some(row=>row.missing));
  const node=plan.nodes.find(row=>row.id===read.id);assert.deepEqual(node.pending,[]);
  const core=lowerFormalHir(hir,context);
  assert.match(core,/tsfg_core\.domain\.member_present/);
  assert.match(core,/missingOptionalProperties/);
  assert.match(core,/field_dispatch/);assert.match(core,/cf\.cond_br/);
  assert.equal(writeTypedReferenceViews(hir,context).subarray(0,8).toString(),'TSGVIEW2');
  assert.deepEqual(hir.compatibilityWitnesses.map(row=>row.missingOptionalProperties.length),[1,0]);
  assert.equal(sha256(Buffer.from(canonical(hir)+'\n')),'sha256:ddb62103bf9a21c766b781b1eebca627675822acf046d299e61096b6d13c4c6a');
});
test('controlled owned-catalogue seam distinguishes legitimate missing from unknown and re-resolves descendants',()=>{
  const hir=structuredClone(actual()),missing=hir.types.find(type=>type.fields?.length===1&&type.fields[0].name==='tag'),
    target=hir.types.find(type=>type.fields?.some(field=>field.propertyPresence?.optional)),field=target.fields.find(field=>field.name==='value');
  const child={...missing,id:sha256('20w controlled descendant'),base:missing.id,
    fields:[{...field,id:sha256('tsfg.field\0'+sha256('20w controlled descendant')+'\0value')}],methods:[]};
  hir.types.push(child);const authority=typedReferenceAuthority(hir),view=authority.views.get(child.id+'\0'+target.id);
  assert.equal(view.fields.find(pair=>pair.target===field.id).source,child.fields[0].id);
  assert.equal(view.fields.some(pair=>pair.missing),false,'base missing does not prove descendant absence');
  const types=new Map(hir.types.map(type=>[type.id,type])),unknown=actualFieldResolver(types,new Map(),new Map(),()=>{});
  assert.equal(unknown(missing.id,field.id,target.id),null,'lookup failure without witness is unknown');
  const noWitness=structuredClone(hir);noWitness.compatibilityWitnesses[0].missingOptionalProperties=[];
  assert.throws(()=>typedReferenceAuthority(noWitness),/invalid selected member view/);
  const wrongType=structuredClone(hir);wrongType.types.find(type=>type.id===target.id).fields.find(row=>row.id===field.id).propertyPresence.declaredType=undefinedMemberType;
  assert.throws(()=>typedReferenceAuthority(wrongType),/invalid member authority/);
  let count=0;const members=memberPresence(hir,()=>{if(++count>100000)throw Error('work');});
  assert.equal(members.compatible(undefinedMemberType,field.propertyPresence.declaredType),false,'read union is not explicit assignment permission');
});
// This controlled owned-catalogue seam exercises the production authority, not Source execution.
for(const relation of ['nominal','structural','unknown'])test('descendant reference field uses '+relation+' relation at the owned authority seam',()=>{
  const id=name=>sha256('20w descendant reference '+relation+'\0'+name),base=id('Base'),child=id('Child'),
    missing=id('Missing'),maybe=id('Maybe'),derived=id('Derived'),read=id('Base|undefined'),
    targetField=sha256('tsfg.field\0'+maybe+'\0value'),actualField=sha256('tsfg.field\0'+derived+'\0value');
  const reference=(id,fields=[])=>({id,kind:'reference',fields,methods:[]}),
    source=reference(child),target=reference(maybe,[{id:targetField,name:'value',type:read,
      propertyPresence:{optional:true,declaredType:base,questionTokenRange:{start:0,end:1}}}]),
    descendant={...reference(derived,[{id:actualField,name:'value',type:child,
      propertyPresence:{optional:false,declaredType:child,questionTokenRange:null}}]),base:missing},
    witness=(sourceType,targetType)=>({compatibility:{sourceType,targetType,assignable:true,members:[]},dependencies:[],missingOptionalProperties:[]});
  if(relation==='nominal')source.base=base;
  const absent=witness(missing,maybe);absent.missingOptionalProperties=[targetField];
  const owned={types:[{id:undefinedMemberType,kind:'undefined'},reference(base),source,reference(missing),target,descendant,
    {id:read,kind:'union',members:[base,undefinedMemberType]}],functions:[],compatibilityWitnesses:[absent]};
  if(relation==='structural')owned.compatibilityWitnesses.push(witness(child,base));
  const views=typedReferenceAuthority(owned).views;
  assert.deepEqual(views.get(missing+'\0'+maybe),{actualType:missing,targetType:maybe,fields:[{target:targetField,missing:true}],methods:[]});
  if(relation==='unknown')assert.equal(views.has(derived+'\0'+maybe),false,'unproved reference relation stays unresolved, never inherits absence');
  else assert.deepEqual(views.get(derived+'\0'+maybe),{actualType:derived,targetType:maybe,fields:[{source:actualField,target:targetField}],methods:[]});
});

test('shared finite transaction rejects exhausted/cancelled work without input mutation',()=>{
  const hir=actual(),before=canonical(hir);
  assert.throws(()=>buildFiniteCoreDomains(hir,context,{work:1}),/work limit/);
  assert.throws(()=>buildFiniteCoreDomains(hir,context,{cancelled:()=>true}),/cancelled/);
  assert.equal(canonical(hir),before);assert.ok(buildFiniteCoreDomains(hir,context).definition.fields.length);
});
test('actual Source narrow copy retains undefined while declared assignment remains static permission',async()=>{
  const bytes=await readFile(new URL('./testdata/typed-array-entry/'+narrowCopy.file,import.meta.url));
  assert.equal(sha256(bytes).slice(7),narrowCopy.sha256);assert.equal(bytes.length,narrowCopy.bytes);
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const built=buildHir(facts,context);assert.equal(built.status,'ok');const hir=built.hir,run=hir.functions.find(fn=>fn.name==='run'),
    local=run.body.find(row=>row.kind==='local'&&row.binding.name==='copied'),plan=buildFiniteCoreDomains(hir,context).definition;
  assert.equal(local.binding.type,scalarTypeIds.i32);
  const node=plan.carrierNodes.find(row=>row.id===run.id+'/binding/'+local.binding.id),domain=plan.domains.find(row=>row.id===node.domainId);
  assert.deepEqual(domain.actualTypes,[undefinedMemberType],'the actual preceding wider-view write stored undefined');
  const core=lowerFormalHir(hir,context),store=core.split('\n').filter(line=>line.includes('"tsfg_core.domain.field_store"')).at(-1);
  assert.ok(store,'the original legal assignment remains ordinary field_store');
  const operand=/field_store"\([^,]+, ([^)]+)\)/.exec(store)?.[1];assert.ok(operand);
  const view=core.split('\n').find(line=>line.trimStart().startsWith(operand+' ='));
  assert.ok(view.includes('"tsfg_core.domain.view"'));assert.ok(view.includes('view_type = "'+scalarTypeIds.i32+'"'));
  assert.ok(view.includes('!tsfg_core.domain<"'+domain.id+'">'),'the original actual undefined carrier is preserved');
});
if(process.env.TSFG_MEMBER_CAPTURE)test('capture actual complete selected production artifacts',async()=>{
  const hir=actual(),root=process.env.TSFG_MEMBER_CAPTURE;await mkdir(root,{recursive:true});
  await writeFile(root+'/views.bin',writeTypedReferenceViews(hir,context));
  await writeFile(root+'/fields.bin',writeTypedFieldBacking(hir,context));
  await writeFile(root+'/optional-member.mlir',lowerFormalHir(hir,context));
  await writeFile(root+'/owned-hir.json',printHir(hir,context));
});
