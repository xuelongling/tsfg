// SPDX-License-Identifier: MIT
// Leaves produce SSA values. Locations are selected exactly once, before RHS;
// assertions preserve payloads and arithmetic checks follow both evaluations.
import {sha256,i32TypeId,boolTypeId} from './identity.mjs';
import {commonCheck as check} from './common-program-common.mjs';
import {commonCollections} from './common-program-budget.mjs';
const undefinedId=sha256('tsfg.type\0undefined'),nullId=sha256('tsfg.type\0null');
export function commonProgramValues(model,graph,state,invoke,indirect,constructionAction) {
  const {types,bindings}=model,collections=commonCollections(model.spend);let currentReceiver=null;
  const op=(name,args,type,properties,range)=>graph.emit(state.current,name,args,type,properties,range);
  const terminal=(name,args,targets,properties,range)=>graph.terminal(state.current,name,args,targets,properties,range);
  const copy=(value,type,range)=>value?op('value_copy',[value],type,{type},range):value;
  const view=(value,type,range)=>value.type===type?value:op('view',[value],type,{target:type},range);
  const pack=(value,range)=>op('pack',[value],model.payload,{type:value.type},range);
  const receiver=(owner,range)=>{
    if(owner.kind==='construction-body')return constructionAction('receiver_get',[state.receiver],owner.ownerType,{owner:owner.ownerType},range);
    check(state.cells.has(owner.receiverBinding),'scope');return op('load',[state.cells.get(owner.receiverBinding)],owner.ownerType,{binding:owner.receiverBinding},range);
  };
  function environment(layout,range){
    model.spend(state.environments.size);for(const [id,value]of state.environments){let current=id,selected=value;const seen=new Set();while(current){model.spend();check(!seen.has(current),'environment');seen.add(current);if(current===layout)return selected;const parent=model.environments.get(current)?.parent;if(!parent)break;selected=op('env_parent',[selected],'env:'+parent,{layout:parent},range);current=parent;}}
    check(false,'environment','lexical environment not in current activation');
  }
  function location(target) {
    model.spend();if(target.kind==='parentheses')return location(target.expression);
    if(target.kind==='bindingTarget'&&model.slots.has(target.binding)){const slot=model.slots.get(target.binding);return {kind:'environment',environment:environment(slot.layout,target.range),slot,type:target.type};}
    if(target.kind==='bindingTarget') {const cell=state.cells.get(target.binding);check(cell,'scope');return {kind:'binding',cell,binding:target.binding,type:target.type};}
    if(target.kind==='globalTarget')return {kind:'global',global:target.global,binding:target.binding,type:target.type};
    if(target.kind==='fieldTarget')return {kind:'field',receiver:expression(target.receiver),field:target.property,type:target.type};
    if(target.kind==='elementTarget')return {kind:'element',receiver:expression(target.receiver),index:expression(target.index),type:target.type};
    if(target.kind==='lengthTarget')return {kind:'length',receiver:expression(target.receiver),type:target.type};
    check(false,'capability','unsupported owned location '+target.kind);
  }
  function load(target,range) {
    if(target.kind==='environment')return op('env_load',[target.environment],target.type,{layout:target.slot.layout,binding:target.slot.binding,key:target.slot.key},range);
    if(target.kind==='binding')return op('load',[target.cell],bindings.get(target.binding).type,{binding:target.binding},range);
    if(target.kind==='global')return op('global_load',[],target.type,{global:target.global},range);
    if(target.kind==='field')return op('field_load',[target.receiver],target.type,{field:target.field},range);
    if(target.kind==='element')return op('array_read',[target.receiver,target.index],target.type,{element:target.type},range);
    return op('array_length',[target.receiver],target.type,{},range);
  }
  function write(target,value,range,initialize=false,shouldCopy=true) {
    const selected=shouldCopy?copy(value,target.type,range):value;
    if(target.kind==='environment')op(initialize?'env_init':'env_store',[target.environment,selected],null,{layout:target.slot.layout,binding:target.slot.binding,key:target.slot.key},range);
    else if(target.kind==='binding')op('store',[target.cell,selected],null,{binding:target.binding,initialize},range);
    else if(target.kind==='global')op('global_store',[selected],null,{global:target.global,initialize},range);
    else if(target.kind==='field')op('field_store',[target.receiver,selected],null,{field:target.field,initialize},range);
    else if(target.kind==='element')op('array_store',[target.receiver,target.index,selected],null,{element:target.type},range);
    else op('array_resize',[target.receiver,selected],null,{},range);
    return value;
  }
  const store=(target,value,range,initialize=false,shouldCopy=true)=>write(location({...target,range}),value,range,initialize,shouldCopy);
  function shortCircuit(left,operator,right,type,range) {
    const rhs=graph.newBlock(),short=graph.newBlock(),joined=graph.newBlock([type]),saved=collections.map(state.cells);
    if(operator==='??') {
      const nullCheck=graph.newBlock(),isUndefined=op('strict_equal',[left,op('undefined',[],undefinedId,{},range)],boolTypeId,{operator:'==='},range);
      graph.conditional(state.current,isUndefined,rhs,nullCheck,range);state.current=nullCheck;
      const isNull=op('strict_equal',[left,op('null',[],nullId,{},range)],boolTypeId,{operator:'==='},range);
      graph.conditional(state.current,isNull,rhs,short,range);
    }else graph.conditional(state.current,left,operator==='&&'?rhs:short,operator==='&&'?short:rhs,range);
    state.current=short;graph.branch(state.current,joined,[left],range);
    state.current=rhs;state.cells=collections.map(saved);const value=right();graph.branch(state.current,joined,[value],range);
    state.current=joined;state.cells=saved;return {...joined.parameters[0]};
  }
  function scalar(kind,operator,args,type,range) {
    return op(['===','!=='].includes(operator)?'strict_equal':kind,args,type,{operator},range);
  }
  function initializeOwn(type,value,args,range,frame) {
    const before=currentReceiver;currentReceiver=value;
    let phase=op('initialize_begin',[frame,value],'initialization:'+type.id,{owner:type.id},range);
    try {
      for(const fieldId of type.construction.initializationFields) {
        model.spend();const field=model.fields.get(fieldId);check(field,'identity');let initial;
        if(field.parameterBinding){const index=type.construction.parameters.findIndex(p=>p.symbol===field.parameterBinding);check(index>=0&&args[index],'identity');initial=args[index];}
        else initial=field.initializer?expression(field.initializer):op('undefined',[],undefinedId,{},field.origin);
        phase=op('initialize_field',[phase,value,copy(initial,field.type,field.origin)],'initialization:'+type.id,{owner:type.id,field:field.id},field.origin);
      }
    } finally {currentReceiver=before;}
    op('initialize_end',[phase,value],null,{owner:type.id},range);
  }
  function enterConstructor(type,frame,args,range) {
    if(type.base)return;
    const allocated=op('receiver_allocate',[frame],type.id,{owner:type.id},range);
    const value=constructionAction('receiver_bind',[frame,allocated],type.id,{owner:type.id},range);
    initializeOwn(type,value,args,range,frame);
  }
  function completeConstructor(value,range,onThrow) {
    const owner=graph.owner;
    return constructionAction('receiver_result',[state.receiver,...(value?[value]:[])],owner.ownerType,{owner:owner.ownerType},range,onThrow);
  }
  function construct(type,frame,args,range) {
    model.spend();check(type.construction,'identity');
    if(type.construction.functionId) {
      const fn=model.functions.get(type.construction.functionId);return invoke({type:type.id,range},[frame,...args],fn);
    }
    if(type.base){
      const child=op('receiver_child',[frame],'receiver:'+type.base,{owner:type.base},range);
      const result=construct(types.get(type.base),child,args,range);
      const value=constructionAction('receiver_bind',[frame,result],type.id,{owner:type.id},range);
      initializeOwn(type,value,args,range,frame);
    }else enterConstructor(type,frame,args,range);
    return constructionAction('receiver_result',[frame],type.id,{owner:type.id},range);
  }
  function expression(e) {
    model.spend();check(e&&types.has(e.type),'type');const type=types.get(e.type);
    if(e.kind==='parentheses')return view(expression(e.expression),e.type,e.range);
    if(e.kind==='as')return op('assert',[expression(e.expression)],e.type,{operator:'as',annotationRange:e.annotationRange,operatorRange:e.operatorRange},e.range);
    if(e.kind==='nonNull')return op('view',[expression(e.expression)],e.type,{target:e.type},e.range);
    if(e.kind==='thisReference')return currentReceiver?view(currentReceiver,e.type,e.range):receiver(graph.owner,e.range);
    if(e.kind==='functionReference'){const fn=model.functions.get(e.functionId);check(fn,'identity');const env=fn.lexicalEnvironment?environment(fn.lexicalEnvironment,e.range):null;return op('make_closure',env?[env]:[],e.type,{function_id:fn.id,signature_hash:fn.signatureHash,environment_layout:fn.lexicalEnvironment},e.range);}
    if(e.kind==='indirectCall'){const callee=expression(e.expression),args=[];for(const [i,arg]of e.arguments.entries())args.push(copy(expression(arg),e.signature.parameters[i],arg.range));return indirect(e,callee,args)??op('undefined',[],undefinedId,{},e.range);}
    if(e.kind==='bindingReference'&&model.slots.has(e.binding))return view(load(location({...e,kind:'bindingTarget'}),e.range),e.type,e.range);
    if(e.kind==='bindingReference'){const cell=state.cells.get(e.binding);check(cell,'scope');return view(op('load',[cell],bindings.get(e.binding).type,{binding:e.binding},e.range),e.type,e.range);}
    if(e.kind==='globalReference')return view(op('global_load',[],model.globals.get(e.global).type,{global:e.global},e.range),e.type,e.range);
    if(e.kind==='numericLiteral')return op(e.bits?'floating':'constant',[],e.type,e.bits?{token:e.token,bits:e.bits}:{token:e.token,decimal:e.decimal},e.range);
    if(e.kind==='booleanLiteral')return op('boolean',[],e.type,{value:e.token==='true'},e.range);
    if(e.kind==='stringLiteral')return op('string',[],e.type,{codeUnits:e.codeUnits},e.range);
    if(e.kind==='undefinedLiteral'||e.kind==='nullLiteral')return op(e.kind==='undefinedLiteral'?'undefined':'null',[],e.type,{},e.range);
    if(e.kind==='unary')return scalar('unary',e.operator,[expression(e.expression)],e.type,e.range);
    if(e.kind==='binary'||e.kind==='stringConcat') {
      const left=expression(e.left),operator=e.operator??'+';
      if(['&&','||','??'].includes(operator))return shortCircuit(left,operator,()=>expression(e.right),e.type,e.range);
      return scalar('binary',operator,[left,expression(e.right)],e.type,e.range);
    }
    if(['bindingAssignment','fieldAssignment','elementAssignment','elementCompoundAssignment','lengthAssignment','bindingUpdate','fieldUpdate','elementUpdate'].includes(e.kind)) {
      const target=location(e.target),update=e.kind.endsWith('Update'),compound=e.operator!=='=';
      const left=compound?load(target,e.target.range):null;
      if(['&&=','||=','??='].includes(e.operator))return shortCircuit(left,e.operator.slice(0,-1),()=>write(target,expression(e.value),e.range),e.type,e.range);
      const right=update?op('constant',[],e.type,{token:'1',decimal:'1'},e.range):expression(e.value);
      const result=compound?scalar('binary',update?(e.operator==='++'?'+':'-'):e.operator.slice(0,-1),[left,right],e.type,e.range):right;
      write(target,result,e.range);return update&&!e.prefix?left:result;
    }
    if(e.kind==='arrayLiteral')return op('array_create',e.elements.map(child=>copy(expression(child),child.type,child.range)),e.type,{allocation:e.allocationSite},e.range);
    if(e.kind==='checkedElementAccess')return op('array_read',[expression(e.receiver),expression(e.index)],e.type,{element:e.type},e.range);
    if(e.kind==='arrayLength'||e.kind==='readSpanLength')return op(e.kind==='arrayLength'?'array_length':'readspan_length',[expression(e.receiver)],e.type,{},e.range);
    if(e.kind==='fieldAccess')return op('field_load',[expression(e.receiver)],e.type,{field:e.property},e.range);
    if(e.kind==='hostCall'){const host=model.hosts.get(e.callee);check(host,'host');
      const args=e.arguments.map(arg=>expression(arg));return op('host_call',args,e.type,{host_id:host.id,signature_hash:host.signatureHash,contract_hash:model.hir.hostContext.contract.digest},e.range);}
    if(e.kind==='call') {
      const args=[];if(e.receiver)args.push(expression(e.receiver));
      for(const [index,arg]of e.arguments.entries())args.push(copy(expression(arg),e.signature.parameters[index],arg.range));
      if(e.callee==='intrinsic:readSpan')return op('readspan',args,e.type,{},e.range);
      const fn=model.functions.get(e.callee),value=invoke(e,args,fn);
      return value??op('undefined',[],undefinedId,{},e.range);
    }
    if(e.kind==='new') {
      const args=e.arguments.map((arg,index)=>copy(expression(arg),e.signature.parameters[index],arg.range));
      const frame=op('receiver_create',[],'receiver:'+type.id,{owner:type.id,new_target:type.id,construction:e.construction},e.range);
      return construct(type,frame,args,e.range);
    }
    if(e.kind==='superConstruct') {
      const fn=graph.owner,args=e.arguments.map((arg,index)=>copy(expression(arg),e.signature.parameters[index],arg.range));
      const child=op('receiver_child',[state.receiver],'receiver:'+e.callee,{owner:e.callee},e.range);
      const result=construct(types.get(e.callee),child,args,e.range);
      const value=constructionAction('receiver_bind',[state.receiver,result],fn.ownerType,{owner:fn.ownerType},e.range);
      initializeOwn(types.get(fn.ownerType),value,fn.parameters.map(p=>load(location({kind:'bindingTarget',binding:p.id,type:p.type,range:e.range}),e.range)),e.range,state.receiver);
      return view(value,e.type,e.range);
    }
    check(false,'capability','common expression has no complete SSA lowering: '+e.kind);
  }
  return {expression,environment,op,copy,view,pack,receiver,store,location,load,write,enterConstructor,completeConstructor};
}
