// SPDX-License-Identifier: MIT
// Private abstract-graph/layout units. These are not Source-produced facts and
// carry no Source, Core, Runtime or execution qualification.
import {i32TypeId,scalarTypeIds,sha256} from '../../compiler/identity.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {createCommonGraph} from '../../compiler/common-program-plan.mjs';
import {commonAbstract} from '../../compiler/common-program-abstract.mjs';
const u=sha256('tsfg.type\0undefined'),box=sha256('unit:Box'),value=sha256('unit:Value'),nested=sha256('unit:Nested');
const range={start:0,end:1};
const field=(owner,name,type)=>({id:owner+'/'+name,sourceBinding:owner+'/'+name,type,name,owner});
export function commonFactoryModel(kind='reference',callInLoop=false) {
  const leaf=field(kind==='reference'?box:value,'n',i32TypeId),inner=field(nested,'inner',value);
  const rows=[{id:i32TypeId,kind:'scalar',name:'i32'},{id:u,kind:'undefined'},
    {id:box,kind:'reference',fields:kind==='reference'?[leaf]:[]},{id:value,kind:'value',fields:kind!=='reference'?[leaf]:[]},
    {id:nested,kind:'value',fields:[inner]}];
  const resultType=kind==='nested'?nested:kind==='reference'?box:value,bindings=new Map(),fields=new Map();
  for(const type of rows)for(const f of type.fields??[]){fields.set(f.id,f);bindings.set(f.sourceBinding,{id:f.sourceBinding,type:f.type,role:'field'});}
  const model={types:new Map(rows.map(t=>[t.id,t])),spend:commonMeter(1000000),payload:'payload:unit',fields,bindings,globals:new Map(),
    limits:{registersPerFunction:4096,blocksPerFunction:256,instructionsPerFunction:8192},
    hir:{types:rows,globals:[],snapshot:{payload:{compatibilityWitnesses:[]}},closure:{roots:[{kind:'application',target:'entry'}]}}};
  const plans=[],owners=new Map();
  function plan(id,returnType,parameterTypes=[]) {
    const parameters=parameterTypes.map((type,i)=>({id:id+'/p'+i,type}));for(const p of parameters)bindings.set(p.id,{...p,role:'parameter'});
    const owner={id,returnType,sourcePath:'/unit-model.ts'},graph=createCommonGraph(model,owner),entry=graph.newBlock(parameterTypes),p={owner,graph,entry,parameters,returnType};
    plans.push(p);owners.set(id,owner);return p;
  }
  const emit=(p,b,name,args,type,props={})=>p.graph.emit(b,name,args,type,props,range);
  const ret=(p,b,v)=>p.graph.terminal(b,'func.return',[v],[],{},range);
  function call(p,b,target,arg) {
    const normal=p.graph.newBlock([resultType]),thrown=p.graph.newBlock([model.payload]);
    p.graph.terminal(b,'invoke',[arg],[normal,thrown],{function_id:target,signature_hash:'unit'},range);
    p.graph.terminal(thrown,'return_throw',[{...thrown.parameters[0]}],[],{},range);return {block:normal,value:{...normal.parameters[0]}};
  }
  const make=plan('make',resultType,[i32TypeId]);let object=emit(make,make.entry,kind==='reference'?'allocate_reference':'construct_value',[],kind==='reference'?box:value,{type:kind==='reference'?box:value,construction:'unit'});
  emit(make,make.entry,'field_store',[object,{...make.entry.parameters[0]}],null,{field:leaf.id,initialize:false});
  if(kind==='nested'){
    const outer=emit(make,make.entry,'construct_value',[],nested,{type:nested,construction:'unit'});
    emit(make,make.entry,'field_store',[outer,emit(make,make.entry,'value_copy',[object],value,{type:value})],null,{field:inner.id,initialize:true});object=outer;
  }
  ret(make,make.entry,kind==='reference'?object:emit(make,make.entry,'value_copy',[object],resultType,{type:resultType}));
  const wrap=plan('wrap',resultType,[i32TypeId]),wrapped=call(wrap,wrap.entry,'make',{...wrap.entry.parameters[0]});ret(wrap,wrapped.block,wrapped.value);
  const entry=plan('entry',i32TypeId),absence=emit(entry,entry.entry,'undefined',[],u),view=emit(entry,entry.entry,'assert',[absence],i32TypeId,{operator:'as'});
  const first=call(entry,entry.entry,'wrap',view);let block=first.block,loop=null;
  if(callInLoop){loop=entry.graph.newBlock();entry.graph.branch(block,loop,[],range);block=loop;}
  const one=emit(entry,block,'constant',[],i32TypeId,{decimal:'1',token:'1'}),second=call(entry,block,'wrap',one);block=second.block;
  let old=first.value;if(kind==='nested')old=emit(entry,block,'field_load',[old],value,{field:inner.id});
  const loaded=emit(entry,block,'field_load',[old],i32TypeId,{field:leaf.id}),result=emit(entry,block,'binary',[loaded,one],i32TypeId,{operator:'+'});
  if(loop)entry.graph.branch(block,loop,[],range);
  else ret(entry,block,result);
  model.functions=owners;return {program:{model,plans},entryId:entry.owner.id,loaded:loaded.name};
}
export function commonReferenceBodyModel(count,scalar=false) {
  const root=sha256('unit:Leaf'),base=sha256('unit:Base'),wide=sha256('unit:Wide'),union=sha256('unit:Leaf/U'),fieldType=scalar?scalarTypeIds.i64:union;
  const fields=Array.from({length:count},(_,i)=>field(i<count/2?base:wide,'f'+i,fieldType));
  const types=[{id:i32TypeId,kind:'scalar',name:'i32'},{id:scalarTypeIds.i64,kind:'scalar',name:'i64'},{id:u,kind:'undefined'},
    {id:root,kind:'reference',fields:[]},{id:union,kind:'union',members:[root,u]},
    {id:base,kind:'reference',fields:fields.filter(f=>f.owner===base)},{id:wide,kind:'reference',base,fields:fields.filter(f=>f.owner===wide)}];
  const model={types:new Map(types.map(t=>[t.id,t])),bindings:new Map(fields.map(f=>[f.sourceBinding,{id:f.sourceBinding,type:f.type,role:'field'}])),
    spend:commonMeter(1000000),payload:'payload:unit',hir:{types}},a=commonAbstract(model),seeds=new Map();
  for(const f of fields){const v=a.empty();for(const id of scalar?[fieldType]:[root,u])v.tags.add(id);seeds.set(f.sourceBinding,v);}
  return {program:{model,plans:[]},values:{abstract:a,fieldSeeds:seeds,globalSeeds:new Map(),elementSeeds:new Map(),capacity:{observed:new Map(),contexts:new Map()}},wide};
}
