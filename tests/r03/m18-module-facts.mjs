// SPDX-License-Identifier: MIT
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {prepareFrontendInput,materializeFrontendResponse} from '../../compiler/frontend-response.mjs';
import bytecode from '../../contracts/bytecode.schema.json' with {type:'json'};

// Test-owned facts, not a Source binary execution or an independent oracle.
const range=(start,end)=>({start,end});
/** @typedef {{kind:string,type:string,range:{start:number,end:number},[key:string]:unknown}} RawExpression */
/** @typedef {{kind:string,range:{start:number,end:number},expression:RawExpression}} ReturnStatement */
export async function moduleDefaultFacts({unrooted=false,globalWrite=false,workerRoot=false}={}) {
  const app="import { entry as target } from './worker'; export function entry():i32 { return target(); }";
  const worker=globalWrite?'export let count:i32=1; export function entry(x:i32=7):i32 { return count += (count = x); }'
    :'export function entry(x:i32=7):i32 { return x; }';
  const sourceRoot='/src',rootFile='/src/app.ts',declaration='/src/minimal-conversions-v5.d.ts';
  const input={sourceRoot,rootFile,config:{allowJs:false,noEmit:true,strict:true},
    declarations:{version:'minimal-conversions-v5',paths:[declaration]},target:{...bytecode.target,pointerBits:'64'},
    compilationClosure:{roots:[{kind:'application',sourcePath:rootFile,name:'entry'}],requiredRoots:[]},
    files:[{path:rootFile,content:app},{path:'/src/worker.ts',content:worker},
      {path:declaration,content:await readFile(new URL('../../compiler/minimal-conversions-v5.d.ts',import.meta.url),'utf8')}]};
  const unused='export let saved:i32=99; export function unused():i32 { return saved; }';
  if(workerRoot)input.compilationClosure.roots.push({kind:'host-export',sourcePath:'/src/worker.ts',name:'entry'});
  if(unrooted)input.files.push({path:'/src/unused.ts',content:unused});
  const prepared=await prepareFrontendInput(input);
  assert.equal(prepared.status,'ready');
  const parameter=worker.indexOf('x:'),seven=worker.indexOf('7'),read=worker.lastIndexOf('x;');
  const presence={undefined:true,null:false,optional:true,default:true,
    range:range(parameter,seven+1),annotation:range(parameter+2,seven-1)};
  const p={id:'p',kind:'parameter',name:'x',type:'i32',writable:true,sourcePath:'/src/worker.ts',range:range(parameter,parameter+1),presence};
  const appName=app.indexOf('entry()',app.indexOf('function')),workerName=worker.indexOf('entry');
  const appSymbol={id:'a',kind:'function',name:'entry',type:'i32',writable:false,sourcePath:rootFile,range:range(appName,appName+5)};
  const workerSymbol={id:'w',kind:'function',name:'entry',type:'i32',writable:false,sourcePath:'/src/worker.ts',range:range(workerName,workerName+5)};
  const call=app.indexOf('target()'),appStart=app.indexOf('export function');
  /** @type {ReturnStatement[]} */
  const appBody=[{kind:'return',range:range(app.indexOf('return'),app.lastIndexOf(';')+1),
    expression:{kind:'call',name:'target',target:'w',type:'i32',signature:{parameters:['i32'],returnType:'i32',presence:[presence]},arguments:[],range:range(call,call+8)}}];
  /** @type {ReturnStatement[]} */
  const workerBody=[{kind:'return',range:range(worker.indexOf('return'),read+2),
    expression:{kind:'reference',name:'x',symbol:'p',type:'i32',presenceFlow:{undefined:false,null:false},range:range(read,read+1)}}];
  const facts={status:'ok',inputs:input.files.map(file=>file.path).sort(),diagnostics:[],symbols:[appSymbol,workerSymbol,p],hostImports:[],
    functions:[{name:'entry',symbol:'a',sourcePath:rootFile,returnType:'i32',parameters:[],parameterInitializers:[],
      range:range(appStart,app.length),body:appBody},
    {name:'entry',symbol:'w',sourcePath:'/src/worker.ts',returnType:'i32',parameters:[p],
      parameterInitializers:[{kind:'integer',type:'i32',literal:{decimal:'7',token:'7'},range:range(seven,seven+1)}],
      range:range(worker.indexOf('export function'),worker.length),body:workerBody}],
    modules:[{sourcePath:rootFile,external:true,imports:[{kind:'import',specifier:'./worker',sourcePath:'/src/worker.ts',range:range(0,app.indexOf(';')+1),bindings:[{name:'target',target:'w',range:range(app.indexOf('target'),app.indexOf('target')+6)}]}],
      exports:[{name:'entry',target:'a',range:appSymbol.range}],globals:[],initialization:[]},
    {sourcePath:'/src/worker.ts',external:true,imports:[],exports:[{name:'entry',target:'w',range:workerSymbol.range}],globals:[],initialization:[]}]};
  if(globalWrite) {
    const at=worker.indexOf('count:'),one=worker.indexOf('=1')+1,lhs=worker.indexOf('count +='),inner=worker.indexOf('count ='),x=worker.lastIndexOf('x)'),end=x+2;
    const global={id:'g',kind:'global',bindingKind:'source',name:'count',type:'i32',writable:true,sourcePath:'/src/worker.ts',range:range(at,at+5)};
    const ref=(position)=>({kind:'reference',name:'count',symbol:'g',type:'i32',range:range(position,position+5)});
    facts.symbols.push(global);facts.modules[1].globals=['g'];
    facts.modules[1].exports.push({name:'count',target:'g',range:global.range});
    facts.modules[1].initialization=[{kind:'initialize',symbol:global,range:range(at,one+1),initializer:{kind:'integer',type:'i32',literal:{decimal:'1',token:'1'},range:range(one,one+1)}}];
    facts.functions[1].body=[{kind:'return',range:range(worker.indexOf('return'),end+1),expression:{kind:'write',type:'i32',operator:'+=',left:ref(lhs),range:range(lhs,end),
      right:{kind:'group',type:'i32',range:range(inner-1,end),operand:{kind:'write',type:'i32',operator:'=',left:ref(inner),right:{kind:'reference',name:'x',symbol:'p',type:'i32',presenceFlow:{undefined:false,null:false},range:range(x,x+1)},range:range(inner,x+1)}}}}];
  }
  if(unrooted) {
    const globalStart=unused.indexOf('saved:'),valueStart=unused.indexOf('99'),nameStart=unused.indexOf('unused()');
    const global={id:'g',kind:'global',bindingKind:'source',name:'saved',type:'i32',writable:true,sourcePath:'/src/unused.ts',range:range(globalStart,globalStart+5)};
    facts.symbols.push(global,{id:'u',kind:'function',name:'unused',type:'i32',writable:false,sourcePath:'/src/unused.ts',range:range(nameStart,nameStart+6)});
    facts.functions.push({name:'unused',symbol:'u',sourcePath:'/src/unused.ts',returnType:'i32',parameters:[],parameterInitializers:[],range:range(unused.indexOf('export function'),unused.length),
      body:[{kind:'return',range:range(unused.indexOf('return'),unused.lastIndexOf(';')+1),expression:{kind:'reference',name:'saved',symbol:'g',type:'i32',range:range(unused.lastIndexOf('saved'),unused.lastIndexOf('saved')+5)}}]});
    facts.modules.push({sourcePath:'/src/unused.ts',external:true,imports:[],exports:[{name:'saved',target:'g',range:global.range},{name:'unused',target:'u',range:range(nameStart,nameStart+6)}],globals:['g'],
      initialization:[{kind:'initialize',range:range(globalStart,valueStart+2),symbol:global,initializer:{kind:'integer',type:'i32',literal:{decimal:'99',token:'99'},range:range(valueStart,valueStart+2)}}]});
  }
  const result=materializeFrontendResponse(prepared,JSON.stringify(facts),{forkOid:'test-owned-module-facts',binarySha256:'sha256:'+'0'.repeat(64)});
  assert.equal(result.status,'ok',JSON.stringify(result));
  return {input,snapshot:result.snapshot};
}
