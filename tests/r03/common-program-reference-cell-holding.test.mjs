// SPDX-License-Identifier: MIT
// Normalized typed actual-flow regression; this is not an official Source package.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ownedEnvironmentModel} from './common-program-owned-environment-models.mjs';
import {analyzeCommonGraphs} from '../../compiler/common-program-actual.mjs';
import {commonClosureHolding} from '../../compiler/common-program-borrow-observations.mjs';

for(const mode of ['mutable-field','readonly-field','managed-element','mutable-value','readonly-value'])test('reference-writing closure '+mode+' Parcel owner holding',()=>{
  const readonly=['readonly-field','readonly-value','managed-element'].includes(mode),inline=mode.endsWith('-value');
  const {program,records}=ownedEnvironmentModel(),{model,plans}=program,
    factory=plans.find(p=>p.owner.id==='entry'),reader=plans.find(p=>p.owner.id==='target'),
    layout=model.environments.get('unit:Environment'),slot=layout.slots.find(s=>s.type==='unit:Array'),
    scalar=model.types.get('unit:Array').elementType,range={start:250,end:260},
    body=factory.entry,instructions=body.instructions,
    env=instructions.find(op=>op.name==='tsfg_program.env_alloc'),
    original=instructions.find(op=>op.name==='tsfg_program.array_create'),
    closure=instructions.find(op=>op.name==='tsfg_program.make_closure'),
    value=op=>({name:op.result,type:op.view});
  assert.equal(slot.writable,true);assert.equal(reader.owner.lexicalEnvironment,layout.id);
  assert.equal(model.types.get(scalar).kind,'scalar');
  assert.equal([...model.environments.values()].flatMap(e=>e.slots).filter(s=>s.key===slot.key).length,1);
  const upper=records.get('target').upper;
  Object.assign(upper,{hostResources:{reads:[],writes:[]},parameters:[],
    facets:{unknownHost:false,escape:false,await:false,lock:false},
    captures:[{slot:slot.key,read:false,write:true,structural:false},
      {slot:layout.slots.find(s=>s.type==='unit:Span').key,read:true,write:false,structural:false}]});
  const prefix={...reader.entry,instructions:[],terminated:false},
    replacementNumber=reader.graph.emit(prefix,'constant',[],scalar,{decimal:'2',token:'2'},range),
    replacement=reader.graph.emit(prefix,'array_create',[replacementNumber],'unit:Array',{allocation:'reader-replacement'},range);
  reader.graph.emit(prefix,'env_store',[{...reader.entry.parameters[0]},replacement],null,
    {layout:layout.id,binding:slot.binding,key:slot.key},range);
  reader.entry.instructions.unshift(...prefix.instructions);
  assert.equal(prefix.instructions.at(-1).name,'tsfg_program.env_store');
  assert.equal(reader.entry.instructions.findIndex(op=>op.name==='tsfg_program.env_store')<
    reader.entry.instructions.findIndex(op=>op.name==='tsfg_program.array_read'),true);
  const policy=commonClosureHolding({model,objects:new Map(),records,closedTarget:()=>true});
  assert.equal(policy.permitsCode('target'),true);
  assert.equal(policy.hasReferenceWrites({pairs:new Map([['target',{functionId:'target',environment:'e'}]])}),true);
  const ownerArray={id:'unit:OwnerArray',kind:'array',elementType:'unit:Array'};
  if(mode==='managed-element'){model.types.set(ownerArray.id,ownerArray);model.hir.types.push(ownerArray);}
  const fields=[{id:'Parcel/reader',sourceBinding:'Parcel/reader',name:'reader',type:'unit:Callable',readonly:true},
    {id:'Parcel/owner',sourceBinding:'Parcel/owner',name:'owner',type:mode==='managed-element'?ownerArray.id:'unit:Array',readonly}],
    parcel={id:'unit:Parcel',kind:inline?'value':'reference',fields,methods:[]};
  model.types.set(parcel.id,parcel);model.hir.types.push(parcel);
  for(const field of fields){model.fields.set(field.id,field);model.bindings.set(field.sourceBinding,{id:field.sourceBinding,type:field.type,role:'field'});}
  instructions.pop();body.terminated=false;factory.owner.returnType=parcel.id;factory.returnType=parcel.id;
  const carrier=factory.graph.emit(body,inline?'construct_value':'allocate_reference',[],parcel.id,{type:parcel.id,construction:'parcel'},range);
  factory.graph.emit(body,'field_store',[carrier,value(closure)],null,{field:fields[0].id,initialize:true},range);
  const owner=mode==='managed-element'?factory.graph.emit(body,'array_create',[value(original)],ownerArray.id,{allocation:'owner-array'},range):value(original);
  factory.graph.emit(body,'field_store',[carrier,owner],null,{field:fields[1].id,initialize:true},range);
  const returned=inline?factory.graph.emit(body,'value_copy',[carrier],parcel.id,{type:parcel.id},range):carrier;
  factory.graph.terminal(body,'func.return',[returned],[],{},{start:260,end:270});
  // The caller may replace mutable Parcel.owner, or an element of its readonly
  // Array holder; value copies share the reader Env/Array, not their field cells.
  // The reader then replaces its Array Cell before consuming r.
  if(mode==='readonly-field'||mode==='readonly-value')analyzeCommonGraphs(program,records);
  else assert.throws(()=>analyzeCommonGraphs(program,records),error=>error instanceof Error&&
    error.code==='r03-common-program-borrow-pending'&&error.functionId==='entry'&&error.primary.start===260);
});
