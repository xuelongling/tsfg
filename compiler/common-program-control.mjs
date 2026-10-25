// SPDX-License-Identifier: MIT
// Pending completion is explicit control. Finally receives already-evaluated
// values; its abrupt completion replaces the pending one. Traps never route here.
import {createCommonGraph} from './common-program-plan.mjs';
import {commonProgramValues} from './common-program-values.mjs';
import {commonCheck as check} from './common-program-common.mjs';
import {commonCollections} from './common-program-budget.mjs';

export function planCommonFunction(model,owner) {
  const collections=commonCollections(model.spend);
  const graph=createCommonGraph(model,owner),params=[...(owner.ownerType?[{id:owner.receiverBinding,type:owner.ownerType}]:[]),...owner.parameters];
  check(params.length<=model.limits.parameters,'limit');const entry=graph.newBlock(params.map(p=>p.type));
  const state={current:entry,cells:new Map()},tasks=[];let clones=0;
  const terminator=(name,args,targets,properties,range)=>graph.terminal(state.current,name,args,targets,properties,range);
  const route=(target,args,completion,handler,range)=>terminator('route',args,[target],{completion,handler},range);
  const outer={returned:(value,range)=>terminator('func.return',value?[value]:[],[],{},range),
    thrown:(value,range)=>terminator('return_throw',[value],[],{},range)};
  let handlers=outer;
  const isVoid=id=>id==='void'||model.types.get(id)?.kind==='void';
  const invoke=(expression,args,callee)=>{
    check(callee,'identity','complete actual callee missing');
    const normal=graph.newBlock(isVoid(callee.returnType)?[]:[expression.type]),exceptional=graph.newBlock([model.payload]);
    const saved=collections.map(state.cells),active=handlers;
    terminator('invoke',args,[normal,exceptional],{function_id:callee.id,signature_hash:callee.signatureHash},expression.range);
    tasks.push(()=>{state.current=exceptional;state.cells=collections.map(saved);handlers=active;active.thrown({...exceptional.parameters[0]},expression.range);});
    state.current=normal;return normal.parameters[0]?{...normal.parameters[0]}:null;
  };
  const values=commonProgramValues(model,graph,state,invoke);
  function region(rows,active,onNormal,path,initial=[]) {
    model.spend();const inherited=collections.map(state.cells),previous=handlers;handlers=active;
    for(const [binding,value]of initial) {
      const b=model.bindings.get(binding);check(b,'identity');const cell=values.op('cell',[],model.cell(binding),{binding},b.range);state.cells.set(binding,cell);
      values.store({kind:'bindingTarget',binding,type:b.type},value,b.range,true,false);
    }
    for(const [index,statement]of rows.entries()) {
      model.spend();if(state.current.terminated)break;const at=[...path,index];
      if(['constDeclaration','letDeclaration'].includes(statement.kind)) {
        const b=model.bindings.get(statement.binding),value=values.expression(statement.initializer);
        const cell=values.op('cell',[],model.cell(b.id),{binding:b.id},statement.range);state.cells.set(b.id,cell);
        values.store({kind:'bindingTarget',binding:b.id,type:b.type},value,statement.range,true);
      }else if(statement.kind==='initialize') {
        values.store({kind:'globalTarget',global:statement.global,binding:statement.binding,type:model.bindings.get(statement.binding).type},
          values.expression(statement.initializer),statement.range,true);
      }else if(statement.kind==='expression')values.expression(statement.value);
      else if(statement.kind==='return') {
        const value=statement.value?values.expression(statement.value):owner.kind==='construction-body'?values.receiver(owner,statement.range):null;
        active.returned(value&&!isVoid(owner.returnType)?values.copy(value,owner.returnType,statement.range):null,statement.range);
      }else if(statement.kind==='throw')active.thrown(values.pack(values.expression(statement.value),statement.range),statement.range);
      else if(statement.kind==='block')region(statement.body,active,()=>{},at);
      else if(statement.kind==='if')conditional(statement,active,at);
      else if(statement.kind==='while')loop(statement,active,at);
      else if(statement.kind==='try')attempt(statement,active,at);
      else check(false,'capability','common statement has no complete SSA lowering: '+statement.kind);
    }
    if(!state.current.terminated)onNormal();state.cells=inherited;handlers=previous;
  }
  function conditional(statement,active,path) {
    const condition=values.expression(statement.condition),yes=graph.newBlock(),no=graph.newBlock(),joined=graph.newBlock(),cells=collections.map(state.cells);
    graph.conditional(state.current,condition,yes,no,statement.condition.range);
    const finish=()=>graph.branch(state.current,joined,[],statement.range);
    state.current=yes;state.cells=collections.map(cells);region(statement.then,active,finish,[...path,'then']);
    state.current=no;state.cells=collections.map(cells);region(statement.else,active,finish,[...path,'else']);state.cells=cells;
    if(joined.incoming)state.current=joined;else graph.blocks.splice(graph.blocks.indexOf(joined),1);
  }
  function loop(statement,active,path) {
    const header=graph.newBlock(),body=graph.newBlock(),after=graph.newBlock(),cells=collections.map(state.cells);
    graph.branch(state.current,header,[],statement.range);state.current=header;values.op('fuel',[],null,{event:2},statement.condition.range);
    const condition=values.expression(statement.condition);graph.conditional(state.current,condition,body,after,statement.condition.range);
    state.current=body;state.cells=collections.map(cells);region(statement.body,active,()=>graph.branch(state.current,header,[],statement.range),[...path,'body']);
    state.current=after;state.cells=cells;
    if(statement.condition.kind==='booleanLiteral'&&statement.condition.token==='true')terminator('unreachable',[],[],{},statement.range);
  }
  function attempt(statement,active,path) {
    const handler=owner.id+'/'+path.join('/'),after=graph.newBlock(),caught=statement.catchClause?graph.newBlock([model.payload]):null,cells=collections.map(state.cells);
    values.op('enter_handler',[],null,{handler,hasCatch:Boolean(caught),hasFinally:Boolean(statement.finallyBlock)},statement.range);
    const finish=(kind,value,range)=>{
      const resume=pending=>kind==='normal'?graph.branch(state.current,after,[],statement.range):kind==='return'?active.returned(pending,range):active.thrown(pending,range);
      if(!statement.finallyBlock){resume(value);return;}
      check(++clones<=256,'limit');const final=graph.newBlock(value?[value.type]:[]);route(final,value?[value]:[],kind,handler,range);
      state.current=final;state.cells=collections.map(cells);values.op('finally_enter',[],null,{handler,completion:kind},statement.finallyBlock.range);
      region(statement.finallyBlock.body,active,()=>resume(value?{...final.parameters[0]}:null),[...path,'finally']);
    };
    const attempted={returned:(value,range)=>finish('return',value,range),thrown:(value,range)=>caught?route(caught,[value],'throw',handler,range):finish('throw',value,range)};
    region(statement.tryBlock.body,attempted,()=>finish('normal',null,statement.range),[...path,'try']);
    if(caught){state.current=caught;state.cells=collections.map(cells);const c=statement.catchClause;
      if(c.binding){const cell=values.op('catch_bind',[{...caught.parameters[0]}],model.cell(c.binding.id),{binding:c.binding.id},c.binding.range);state.cells.set(c.binding.id,cell);}
      region(c.block.body,{returned:(value,range)=>finish('return',value,range),thrown:(value,range)=>finish('throw',value,range)},
        ()=>finish('normal',null,statement.range),[...path,'catch']);}
    state.cells=cells;if(after.incoming)state.current=after;else graph.blocks.splice(graph.blocks.indexOf(after),1);
  }
  if(owner.kind!=='module-initializer')values.op('fuel',[],null,{event:1},owner.range);
  const initial=params.map((p,index)=>[p.id,{...entry.parameters[index]}]);
  region(owner.body,outer,()=>{
    if(owner.kind==='construction-body')outer.returned(values.receiver(owner,owner.range),owner.range);
    else {check(owner.returnType==='void'||model.types.get(owner.returnType)?.kind==='void','capability','unproved successful function fallthrough');outer.returned(null,owner.range);}
  },['body'],initial);
  while(tasks.length){model.spend();tasks.shift()();}
  return {owner,graph,entry,parameters:params,returnType:owner.returnType};
}
