// SPDX-License-Identifier: MIT
import {createHash} from 'node:crypto';
import {createExceptionOracle} from './exception-hir-v2-oracle.mjs';
const hash=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
const copy=value=>JSON.parse(JSON.stringify(value)),range=(start,end)=>({start,end});
// Complete handwritten expectations for the two Source21g programs. This is
// not a recursive Source-to-HIR projector: every region, expression and anchor
// below is fixed independently of Product output and of the old v1 graphs.
export function expectedExceptionControl(name,snapshot){
  const entity=createExceptionOracle().entity,source=snapshot.sources[0],path=source.path;
  const i32=hash('tsfg.type\0i32'),bool=hash('tsfg.type\0bool'),types=[];
  const add=record=>{const id=record.kind==='scalar'?hash('tsfg.type\0'+record.name):entity('type',record);types.push({id,...record});return id;};
  add({kind:'scalar',name:'i32'});
  const module=entity('module',{source:{path,digest:source.hash},external:true});
  const moduleScope=entity('scope',{ownerKind:'module',owner:module,path:[]});
  const signature=parameters=>({parameters,returnType:i32});
  const callable=parameters=>add({kind:'callable',...signature(parameters)});
  function fn(name,nameRange,span,parameters,type){
    const signatureHash=entity('signature',signature(parameters));
    const id=entity('function',{module,parent:null,declaringScopePath:[],name,signatureHash,range:span});
    return {id,module,sourcePath:path,name,nameRange,range:span,type,signatureHash,lexicalParent:null,
      declaringScope:moduleScope,parameters:[],parameterInitializers:parameters.map(()=>null),captures:null,returnPresence:null};
  }
  const scope=(owner,path)=>entity('scope',{ownerKind:'function',owner:owner.id,path});
  const region=(owner,path,role,span,parent,bindings=[],body=[])=>({kind:'region',role,scope:scope(owner,path),parentScope:parent,path,range:span,bindings,body});
  function binding(owner,path,role,index,name,type,writable,span,presence=null){
    return {id:entity('binding',{ownerKind:'function',owner:owner.id,scopePath:path,role,index}),name,role,type,writable,range:span,presence};
  }
  const presence=(start,end,annotation)=>({undefined:false,null:false,optional:false,default:false,range:range(start,end),annotation});
  const read=(binding,span)=>({kind:'bindingRead',type:binding.type,range:span,binding:binding.id,presenceFlow:null});
  let functions;
  if(name==='while-finally'){
    add({kind:'scalar',name:'bool'});const type=callable([bool,i32]),f=fn('loop',range(22,27),range(0,158),[bool,i32],type);
    const root=scope(f,[]),loopPath=[{statement:1,slot:'loop'}],loop=scope(f,loopPath);
    const tryPath=[...loopPath,{statement:0,slot:'try'}],finalPath=[...loopPath,{statement:0,slot:'finally'}];
    const again=binding(f,[],'parameter',0,'again',bool,true,range(28,33),presence(28,38,range(34,38)));
    const value=binding(f,[],'parameter',1,'value',i32,true,range(39,44),presence(39,48,range(45,48)));
    const pending=binding(f,[],'local',0,'pending',bool,true,range(57,65));
    const copied=binding(f,finalPath,'local',0,'copied',i32,false,range(124,131));
    const attempted=region(f,tryPath,'try',range(95,111),loop,[],[{kind:'assign',range:range(96,110),
      target:{kind:'bindingTarget',type:bool,range:range(96,103),binding:pending.id},
      value:{kind:'boolean',type:bool,range:range(104,109),value:false}}]);
    const finalized=region(f,finalPath,'finally',range(118,143),loop,[copied],
      [{kind:'local',range:range(124,141),binding:copied.id,initializer:read(value,range(136,141))}]);
    const body=region(f,loopPath,'loop',range(91,144),root,[],[{kind:'try',range:range(92,143),
      tryRegion:attempted,catchClause:null,finallyRegion:finalized}]);
    f.parameters=[again.id,value.id];f.body=region(f,[],'function',f.range,null,[again,value,pending],
      [{kind:'local',range:range(57,76),binding:pending.id,initializer:read(again,range(71,76))},
        {kind:'while',range:range(77,144),condition:read(pending,range(83,90)),bodyRegion:body},
        {kind:'return',range:range(144,157),value:read(value,range(150,156))}]);functions=[f];
  }else if(name==='literal-true-while'){
    add({kind:'scalar',name:'bool'});const type=callable([i32]),f=fn('forever',range(22,30),range(0,72),[i32],type);
    const value=binding(f,[],'parameter',0,'value',i32,true,range(31,36),presence(31,40,range(37,40)));
    const path=[{statement:0,slot:'loop'}];f.parameters=[value.id];
    const body=region(f,path,'loop',range(57,71),scope(f,[]),[],[{kind:'throw',range:range(58,70),value:read(value,range(63,69))}]);
    f.body=region(f,[],'function',f.range,null,[value],[{kind:'while',range:range(46,71),
      condition:{kind:'boolean',type:bool,range:range(52,56),value:true},bodyRegion:body}]);functions=[f];
  }else if(name==='finally-overrides'){
    const type2=callable([i32,i32]),type3=callable([i32,i32,i32]);
    const first=fn('override',range(22,31),range(0,109),[i32,i32],type2),second=fn('nested',range(126,133),range(109,246),[i32,i32,i32],type3);
    const params=(f,specs)=>specs.map(([name,start,end,annotation,index])=>
      binding(f,[],'parameter',index,name,i32,true,range(start,end),presence(start,annotation+3,range(annotation,annotation+3))));
    const [value,replacement]=params(first,[['value',32,37,38,0],['replacement',42,53,54,1]]);
    const tryPath=[{statement:0,slot:'try'}],finalPath=[{statement:0,slot:'finally'}];
    const abrupt=(kind,b,span,readRange)=>({kind,range:span,value:read(b,readRange)});
    first.parameters=[value.id,replacement.id];first.body=region(first,[],'function',first.range,null,[value,replacement],
      [{kind:'try',range:range(63,108),catchClause:null,
        tryRegion:region(first,tryPath,'try',range(66,81),scope(first,[]),[],[abrupt('return',value,range(67,80),range(73,79))]),
        finallyRegion:region(first,finalPath,'finally',range(88,108),scope(first,[]),[],[abrupt('throw',replacement,range(89,107),range(94,106))])}]);
    const [v,r,last]=params(second,[['value',134,139,140,0],['replacement',144,155,156,1],['last',160,164,165,2]]);
    const innerTry=[...tryPath,{statement:0,slot:'try'}],innerFinal=[...tryPath,{statement:0,slot:'finally'}];
    const inner={kind:'try',range:range(178,223),catchClause:null,
      tryRegion:region(second,innerTry,'try',range(181,196),scope(second,tryPath),[],[abrupt('return',v,range(182,195),range(188,194))]),
      finallyRegion:region(second,innerFinal,'finally',range(203,223),scope(second,tryPath),[],[abrupt('throw',r,range(204,222),range(209,221))])};
    second.parameters=[v.id,r.id,last.id];second.body=region(second,[],'function',second.range,null,[v,r,last],
      [{kind:'try',range:range(174,245),catchClause:null,
        tryRegion:region(second,tryPath,'try',range(177,224),scope(second,[]),[],[inner]),
        finallyRegion:region(second,finalPath,'finally',range(231,245),scope(second,[]),[],[abrupt('return',last,range(232,244),range(238,243))])}]);functions=[first,second];
  }else{
    if(name!=='indirect-current-rethrow')throw Error('unknown fixed control');
    const type=callable([i32]),unknown=add({kind:'unknown'});
    const fail=fn('fail',range(15,20),range(0,49),[i32],type),entry=fn('entry',range(66,72),range(49,182),[i32],type);
    const first=binding(fail,[],'parameter',0,'value',i32,true,range(21,26),presence(21,30,range(27,30)));
    fail.parameters=[first.id];fail.body=region(fail,[],'function',fail.range,null,[first],
      [{kind:'throw',range:range(36,48),value:read(first,range(41,47))}]);
    const value=binding(entry,[],'parameter',0,'value',i32,true,range(73,78),presence(73,82,range(79,82)));
    const selected=binding(entry,[],'local',0,'selected',type,false,range(93,102));
    const root=scope(entry,[]),tryPath=[{statement:1,slot:'try'}],catchPath=[{statement:1,slot:'catch'}];
    const caught=binding(entry,catchPath,'catch',0,'caught',unknown,true,range(159,165));
    const attempted=region(entry,tryPath,'try',range(128,153),root,[],[{kind:'return',range:range(129,152),
      value:{kind:'indirectCall',type:i32,range:range(135,151),callee:read(selected,range(135,144)),
        signature:{ownerKind:'callableType',owner:type,type},arguments:[read(value,range(145,150))]}}]);
    const handled=region(entry,catchPath,'catch',range(166,181),root,[caught],
      [{kind:'throw',range:range(167,180),value:read(caught,range(172,179))}]);
    entry.parameters=[value.id];entry.body=region(entry,[],'function',entry.range,null,[value,selected],
      [{kind:'local',range:range(93,124),binding:selected.id,initializer:{kind:'functionReference',type,range:range(120,124),target:fail.id,
        signature:{ownerKind:'function',owner:fail.id,type}}},
        {kind:'try',range:range(125,181),tryRegion:attempted,catchClause:{range:range(153,181),binding:caught.id,
          declarationRange:range(159,165),annotationRange:null,region:handled},finallyRegion:null}]);functions=[fail,entry];
  }
  const exported=name==='finally-overrides'?[...functions].sort((a,b)=>a.name<b.name?-1:1):[functions.at(-1)];
  return {format:{family:'tsfg.exception-hir-candidate',version:2,schemaHash:'sha256:fb37661820a43016639059f0b9e82275414da0de87d2320e5efdfe8423921ee5'},
    snapshot:copy(snapshot),inputIdentity:snapshot.inputIdentity,sources:copy(snapshot.sources),target:copy(snapshot.target),
    types:types.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0),functions,
    modules:[{id:module,sourcePath:path,external:true,functions:functions.map(f=>f.id),aggregateTypes:[],globals:[],imports:[],initialization:null,closure:null,coverage:null}],
    exports:[{module,sourcePath:path,external:true,bindings:exported.map(f=>({name:f.name,target:f.id,sourcePath:path,definition:f.nameRange,range:f.range}))}]};
}
