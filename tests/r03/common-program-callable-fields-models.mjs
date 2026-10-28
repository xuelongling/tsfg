// SPDX-License-Identifier: MIT
// Isolated code-target controls. These are not Source packets or execution proof.
import {signatureId} from '../../compiler/module-callable-common.mjs';
export const range={start:10,end:20};
export function callableFieldsModel(mode='constructor'){
  const scalar='scalar',callable='callable',holder='holder',property='holder/reader',signature={parameters:[],returnType:scalar};
  const ref=id=>({kind:'functionReference',functionId:id,type:callable,range});
  const local=(binding,type)=>({kind:'bindingReference',binding,type,range});
  const leaf=id=>({id,sourceBinding:id,kind:'source',signatureHash:signatureId({parameters:[],returns:scalar}),parameters:[],bindings:[],captures:[],returnType:scalar,body:[]});
  /** @type {{id:string,sourceBinding:string,type:string,name:string,parameterBinding?:string,initializer?:any}} */
  const field={id:property,sourceBinding:property,type:callable,name:'reader',parameterBinding:'reader'};
  const type={id:holder,sourceType:holder,kind:'reference',fields:[field],methods:[],construction:{functionId:'ctor',parameters:[{symbol:'reader',type:callable}],initializationFields:[property]}};
  const ctor={...leaf('ctor'),kind:'construction-body',ownerType:holder,parameters:[{id:'reader',type:callable}],returnType:holder};
  const make=id=>({kind:'new',type:holder,callee:holder,arguments:[ref(id)],range});
  /** @type {any} */ const read={kind:'fieldAccess',property,type:callable,receiver:local('box',holder),range};
  const call={kind:'indirectCall',expression:read,type:scalar,signature,arguments:[],range};
  /** @type {any} */ const root={...leaf('root'),body:[{kind:'constDeclaration',binding:'box',initializer:make('left')},{kind:'expression',value:call}]};
  const writer={...leaf('writer'),body:/** @type {any[]} */([{kind:'expression',value:make('right')}])};
  /** @type {any} */ const hir={types:[{id:scalar,kind:'scalar'},{id:callable,kind:'function',...signature},type],functions:[leaf('left'),leaf('right'),leaf('unrelated'),ctor,root,writer],globals:[],modules:[],closure:{roots:[{kind:'application',target:'root'}]},snapshot:{payload:{compatibilityWitnesses:[]}}};
  const assignment=value=>({kind:'expression',value:{kind:'fieldAssignment',operator:'=',type:callable,target:{kind:'fieldTarget',property,type:callable,receiver:local('other',holder),range},value,range}});
  if(mode==='assignment'){writer.body=[assignment(ref('right'))];}
  if(mode==='initializer'){delete field.parameterBinding;field.initializer=ref('left');type.construction.parameters=[];ctor.parameters=[];root.body[0].initializer.arguments=[];writer.body=[];}
  if(mode==='unknown-writer'){writer.parameters=[{id:'incoming',type:callable}];writer.body=[assignment(local('incoming',callable))];hir.closure.roots.push({kind:'application',target:'writer'});}
  if(mode==='external'){root.parameters=[{id:'incoming',type:holder}];}
  if(mode==='host'){root.parameters=[{id:'host',type:callable}];root.body.splice(1,0,{kind:'expression',value:{kind:'indirectCall',expression:local('host',callable),type:scalar,signature,arguments:[local('box',holder)],range:{start:1,end:2}}});}
  if(mode==='array'){hir.types.push({id:'array',kind:'array',elementType:holder});root.body[0].initializer={kind:'checkedElementAccess',receiver:local('items','array'),index:{kind:'numericLiteral',type:scalar,range},type:holder,range};}
  if(mode==='unknown-assertion'){hir.types.push({id:'unknown',kind:'unknown'});root.body[0].initializer={kind:'as',expression:local('opaque','unknown'),type:holder,range};}
  if(mode==='scalar-assertion')root.body[0].initializer={kind:'as',expression:{kind:'numericLiteral',type:scalar,range},type:holder,range};
  if(mode==='inherited'){hir.types.push({...type,id:'derived',sourceType:'derived',base:holder,fields:[],construction:{...type.construction,functionId:null,initializationFields:[]}});root.body[0].initializer.type='derived';}
  if(mode==='permission-host'){hir.functions.push({...leaf('sink'),parameters:[{id:'box',type:holder}]});root.body.splice(1,0,{kind:'expression',value:{kind:'call',callee:'sink',type:scalar,arguments:[local('box',holder)],range:{start:1,end:2}}});}
  if(mode.startsWith('erased-')){
    hir.types.push({id:'unknown',kind:'unknown'});
    if(mode==='erased-view')root.body.splice(1,0,{kind:'expression',value:{kind:'as',expression:local('box',holder),type:'unknown',range}});
    if(mode==='erased-binding'){root.bindings=[{id:'opaque',type:'unknown'}];root.body.splice(1,0,{kind:'constDeclaration',binding:'opaque',initializer:local('box',holder)});}
    if(mode==='erased-parameter'){
      hir.functions.push({...leaf('sink'),parameters:[{id:'opaque',type:'unknown'}]});root.body.splice(1,0,{kind:'expression',value:{kind:'call',callee:'sink',type:scalar,arguments:[local('box',holder)],range}});
    }
    if(mode==='erased-return')writer.body=[{kind:'return',value:make('right'),range}],writer.returnType='unknown';
    if(mode==='erased-storage'){const opaque={id:'holder/opaque',sourceBinding:'holder/opaque',type:'unknown',name:'opaque'};type.fields.push(opaque);root.body.splice(1,0,{kind:'expression',value:{kind:'fieldAssignment',operator:'=',type:'unknown',target:{kind:'fieldTarget',property:opaque.id,type:'unknown',receiver:local('box',holder),range},value:local('box',holder),range}});}
  }
  if(mode==='alias'||mode==='unproved-alias'||mode==='unproved-view'){
    const target={...field,id:'view/reader',sourceBinding:'view/reader'};delete target.parameterBinding;
    hir.types.push({id:'view',sourceType:'view',kind:'reference',fields:[target],methods:[]});read.property=target.id;read.receiver.type='view';
    if(mode==='alias'){hir.snapshot.payload.compatibilityWitnesses.push({compatibility:{sourceType:holder,targetType:'view',members:[{source:property,target:target.id}]}});read.receiver={kind:'as',type:'view',expression:local('box',holder),compatibilityRoots:[{sourceType:holder,targetType:'view'}],range};}
    if(mode==='unproved-view'){target.initializer=ref('right');hir.types.at(-1).construction={functionId:null,parameters:[],initializationFields:[target.id]};writer.body=[{kind:'expression',value:{kind:'new',type:'view',callee:'view',arguments:[],range}}];read.receiver={kind:'as',type:'view',expression:local('box',holder),range};}
  }
  return {hir,root,writer,ctor,field,property,ref,range,expected:mode==='initializer'?['left']:['left','right']};
}
