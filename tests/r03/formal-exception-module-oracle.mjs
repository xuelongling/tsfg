// SPDX-License-Identifier: MIT
// Shared independent full module graph: original null-target and new explicit-target Source inputs.
import {createHash} from 'node:crypto';
import {createExceptionOracle} from './exception-hir-v2-oracle.mjs';
const hash=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
const copy=value=>JSON.parse(JSON.stringify(value)),range=(start,end)=>({start,end});
const schema='sha256:fb37661820a43016639059f0b9e82275414da0de87d2320e5efdfe8423921ee5';
const appPath='/src/app.ts',workerPath='/src/worker.ts';
const app="import { probe } from \"./worker\"; export function entry(value: i32): bool { return probe(value); }";
const worker="/* 😀 */ export function probe(value: i32): bool { try { throw value; } catch (caught: unknown) { if (typeof caught === \"boolean\") { return caught; } throw caught; } finally { const copied: i32 = value; } } try { throw true; } catch (initCaught: unknown) { if (typeof initCaught === \"boolean\") { throw initCaught; } throw initCaught; } finally {}";
const appPresence=()=>({undefined:false,null:false,optional:false,default:false,range:range(56,66),annotation:range(63,66)});
const workerPresence=()=>({undefined:false,null:false,optional:false,default:false,range:range(31,41),annotation:range(38,41)});
export function expectedExceptionModule(snapshot,entity=createExceptionOracle().entity) {
  const i32=hash('tsfg.type\0i32'),bool=hash('tsfg.type\0bool'),unknown=entity('type',{kind:'unknown'});
  const appModule=entity('module',{source:{path:appPath,digest:hash(app)},external:true});
  const workerModule=entity('module',{source:{path:workerPath,digest:hash(worker)},external:true});
  const signature={parameters:[i32],returnType:bool},signatureHash=entity('signature',signature),callable=entity('type',{kind:'callable',...signature});
  const entry=entity('function',{module:appModule,parent:null,declaringScopePath:[],name:'entry',signatureHash,range:range(33,98)});
  const probe=entity('function',{module:workerModule,parent:null,declaringScopePath:[],name:'probe',signatureHash,range:range(0,206)});
  const tryPath=[{statement:0,slot:'try'}],catchPath=[{statement:0,slot:'catch'}],finallyPath=[{statement:0,slot:'finally'}];
  const thenPath=[...catchPath,{statement:0,slot:'then'}];
  const scopeOf=(ownerKind,owner,path)=>entity('scope',{ownerKind,owner,path});
  const appModuleScope=scopeOf('module',appModule,[]),workerModuleScope=scopeOf('module',workerModule,[]);
  const entryScope=scopeOf('function',entry,[]),probeScope=scopeOf('function',probe,[]);
  const probeTryScope=scopeOf('function',probe,tryPath),probeCatchScope=scopeOf('function',probe,catchPath);
  const probeThenScope=scopeOf('function',probe,thenPath),probeFinallyScope=scopeOf('function',probe,finallyPath);
  const initTryScope=scopeOf('module',workerModule,tryPath),initCatchScope=scopeOf('module',workerModule,catchPath);
  const initThenScope=scopeOf('module',workerModule,thenPath),initFinallyScope=scopeOf('module',workerModule,finallyPath);
  const appParameter=entity('binding',{ownerKind:'function',owner:entry,scopePath:[],role:'parameter',index:0});
  const workerParameter=entity('binding',{ownerKind:'function',owner:probe,scopePath:[],role:'parameter',index:0});
  const caught=entity('binding',{ownerKind:'function',owner:probe,scopePath:catchPath,role:'catch',index:0});
  const copied=entity('binding',{ownerKind:'function',owner:probe,scopePath:finallyPath,role:'local',index:0});
  const initCaught=entity('binding',{ownerKind:'module',owner:workerModule,scopePath:catchPath,role:'catch',index:0});
  /** @type {any[]} */ const types=[{kind:'scalar',id:i32,name:'i32'},{kind:'scalar',id:bool,name:'bool'},{kind:'unknown',id:unknown},
    {kind:'callable',id:callable,...signature}].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const call={kind:'directCall',name:'probe',type:bool,target:probe,range:range(82,95),
    arguments:[{kind:'bindingRead',type:i32,binding:appParameter,range:range(89,94),presenceFlow:null}],
    signature:{ownerKind:'function',owner:probe,type:callable,presence:[workerPresence()],returnPresence:null}};
  const guard={kind:'typeTest',type:bool,operator:'===',range:range(102,129),
    operand:{kind:'bindingRead',type:unknown,binding:caught,range:range(108,115),presenceFlow:null},
    tag:'boolean',typeofRange:range(102,115),tagRange:range(119,129),order:'typeof-first'};
  const attempt={kind:'try',range:range(50,204),
    tryRegion:{kind:'region',role:'try',scope:probeTryScope,parentScope:probeScope,path:copy(tryPath),range:range(54,71),bindings:[],
      body:[{kind:'throw',range:range(56,69),value:{kind:'bindingRead',type:i32,binding:workerParameter,range:range(62,68),presenceFlow:null}}]},
    catchClause:{range:range(71,165),binding:caught,declarationRange:range(79,94),annotationRange:range(86,94),
      region:{kind:'region',role:'catch',scope:probeCatchScope,parentScope:probeScope,path:copy(catchPath),range:range(95,165),
        bindings:[{id:caught,name:'caught',role:'catch',type:unknown,writable:true,range:range(79,85),presence:null}],body:[
          {kind:'if',range:range(98,149),condition:guard,thenRegion:{kind:'region',role:'then',scope:probeThenScope,parentScope:probeCatchScope,
            path:copy(thenPath),range:range(130,149),bindings:[],body:[{kind:'return',range:range(132,147),
              value:{kind:'bindingRead',type:bool,binding:caught,range:range(139,146),presenceFlow:null}}]},elseRegion:null},
          {kind:'throw',range:range(149,163),value:{kind:'bindingRead',type:unknown,binding:caught,range:range(155,162),presenceFlow:null}}]}},
    finallyRegion:{kind:'region',role:'finally',scope:probeFinallyScope,parentScope:probeScope,path:copy(finallyPath),range:range(173,204),
      bindings:[{id:copied,name:'copied',role:'local',type:i32,writable:false,range:range(181,188),presence:null}],body:[
        {kind:'local',range:range(181,201),binding:copied,initializer:{kind:'bindingRead',type:i32,binding:workerParameter,range:range(195,201),presenceFlow:null}}]}};
  const initGuard={kind:'typeTest',type:bool,operator:'===',range:range(261,292),
    operand:{kind:'bindingRead',type:unknown,binding:initCaught,range:range(267,278),presenceFlow:null},
    tag:'boolean',typeofRange:range(261,278),tagRange:range(282,292),order:'typeof-first'};
  const initialization={kind:'try',range:range(206,346),
    tryRegion:{kind:'region',role:'try',scope:initTryScope,parentScope:workerModuleScope,path:copy(tryPath),range:range(210,226),bindings:[],
      body:[{kind:'throw',range:range(212,224),value:{kind:'boolean',type:bool,value:true,range:range(218,223)}}]},
    catchClause:{range:range(226,335),binding:initCaught,declarationRange:range(234,253),annotationRange:range(245,253),
      region:{kind:'region',role:'catch',scope:initCatchScope,parentScope:workerModuleScope,path:copy(catchPath),range:range(254,335),
        bindings:[{id:initCaught,name:'initCaught',role:'catch',type:unknown,writable:true,range:range(234,244),presence:null}],body:[
          {kind:'if',range:range(257,315),condition:initGuard,thenRegion:{kind:'region',role:'then',scope:initThenScope,parentScope:initCatchScope,
            path:copy(thenPath),range:range(293,315),bindings:[],body:[{kind:'throw',range:range(295,313),
              value:{kind:'bindingRead',type:bool,binding:initCaught,range:range(301,312),presenceFlow:null}}]},elseRegion:null},
          {kind:'throw',range:range(315,333),value:{kind:'bindingRead',type:unknown,binding:initCaught,range:range(321,332),presenceFlow:null}}]}},
    finallyRegion:{kind:'region',role:'finally',scope:initFinallyScope,parentScope:workerModuleScope,path:copy(finallyPath),range:range(343,346),bindings:[],body:[]}};
  return {format:{family:'tsfg.exception-hir-candidate',version:2,schemaHash:schema},snapshot:copy(snapshot),inputIdentity:snapshot.inputIdentity,
    sources:[{path:appPath,content:app,hash:hash(app),length:98,positionUnit:'utf16'},
      {path:workerPath,content:worker,hash:hash(worker),length:346,positionUnit:'utf16'}],target:copy(snapshot.target),types,functions:[
      {id:entry,module:appModule,sourcePath:appPath,name:'entry',nameRange:range(49,55),range:range(33,98),type:callable,signatureHash,
        lexicalParent:null,declaringScope:appModuleScope,parameters:[appParameter],parameterInitializers:[null],captures:null,returnPresence:null,
        body:{kind:'region',role:'function',scope:entryScope,parentScope:null,path:[],range:range(33,98),
          bindings:[{id:appParameter,name:'value',role:'parameter',type:i32,writable:true,range:range(56,61),presence:appPresence()}],
          body:[{kind:'return',range:range(75,96),value:call}]}},
      {id:probe,module:workerModule,sourcePath:workerPath,name:'probe',nameRange:range(24,30),range:range(0,206),type:callable,signatureHash,
        lexicalParent:null,declaringScope:workerModuleScope,parameters:[workerParameter],parameterInitializers:[null],captures:null,returnPresence:null,
        body:{kind:'region',role:'function',scope:probeScope,parentScope:null,path:[],range:range(0,206),
          bindings:[{id:workerParameter,name:'value',role:'parameter',type:i32,writable:true,range:range(31,36),presence:workerPresence()}],body:[attempt]}}],
    modules:[{id:appModule,sourcePath:appPath,external:true,functions:[entry],aggregateTypes:[],globals:[],
      imports:[{specifier:'./worker',sourcePath:workerPath,module:workerModule,range:range(0,33),bindings:[{name:'probe',target:probe,range:range(9,14)}]}],
      initialization:{kind:'region',role:'module',scope:appModuleScope,parentScope:null,path:[],range:range(0,98),bindings:[],body:[]},
      closure:{roots:[{kind:'application',sourcePath:appPath,name:'entry',target:entry}],requiredRoots:[]},coverage:null},
      {id:workerModule,sourcePath:workerPath,external:true,functions:[probe],aggregateTypes:[],globals:[],imports:[],
        initialization:{kind:'region',role:'module',scope:workerModuleScope,parentScope:null,path:[],range:range(0,346),bindings:[],body:[initialization]},
        closure:{roots:[],requiredRoots:[]},coverage:null}],
    exports:[{module:appModule,sourcePath:appPath,external:true,bindings:[{name:'entry',target:entry,sourcePath:appPath,range:range(33,98),definition:range(49,55)}]},
      {module:workerModule,sourcePath:workerPath,external:true,bindings:[{name:'probe',target:probe,sourcePath:workerPath,range:range(0,206),definition:range(24,30)}]}]};
}
