// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateModuleFacts} from '../../compiler/module-facts.mjs';

// Synthetic validator inputs only: these are not official frontend facts or
// evidence that a source request was checked or executed.
const escape=hex=>'\\u'+hex;
function fixture({mode='namespace',namespace='state',accessNamespace=namespace,
  member='count',imported='count',local='value',exportName='count'}={}){
 const statePath='/src/state.ts',appPath='/src/app.ts';
 const state='export let '+exportName+':i32=1; export let other:i32=2;';
 const header=mode==='namespace'?'import * as '+namespace+' from "./state";'
  :mode==='named'?'import { '+imported+' as '+local+' } from "./state";'
   :mode==='shorthand'?'import { '+local+' } from "./state";'
    :'import '+local+' from "./state";';
 const binding=mode==='namespace'?accessNamespace+'.'+member:local;
 const app=header+' export function entry():i32{return '+binding+';}';
 const span=(source,text,from=0)=>{const start=source.indexOf(text,from);
  assert.ok(start>=0);return{start,end:start+text.length};};
 const target='count-id',other='other-id';
 const symbols=[{id:target,kind:'global',name:exportName,sourcePath:statePath,
  bindingKind:'source',range:span(state,exportName),type:'i32',writable:true},
 {id:other,kind:'global',name:'other',sourcePath:statePath,
  bindingKind:'source',range:span(state,'other'),type:'i32',writable:true}];
 const range=mode==='namespace'?span(app,binding,header.length):span(header,local);
 const closure={roots:[{kind:'module-initialization',sourcePath:appPath,name:'$moduleInit'}],requiredRoots:[]};
 const files=[{path:statePath,content:state},{path:appPath,content:app}];
 const snapshot={identityInput:{files,compilationClosure:closure,hostImports:[]},
  compilationClosure:closure,inputs:files.map(({path})=>({path})),sources:files,
  hostImports:[],symbols,modules:[
   {sourcePath:statePath,external:true,imports:[],exports:[
    {name:mode==='default'?'default':exportName,target,range:symbols[0].range},
    {name:'other',target:other,range:symbols[1].range}],globals:[target,other],
   initialization:symbols.map(symbol=>({kind:'initialize',symbol}))},
   {sourcePath:appPath,external:true,imports:[{kind:'import',specifier:'./state',
    sourcePath:statePath,range:{start:0,end:header.length},
    bindings:[{name:binding,target,range}]}],exports:[],globals:[],initialization:[]}]};
 return{snapshot,binding,target,appPath,imp:snapshot.modules[1].imports[0]};
}
for(const [name,options]of /** @type {[string, Parameters<typeof fixture>[0]][]} */ ([
 ['escaped namespace member',{member:escape('0063')+'ount'}],
 ['braced namespace member',{member:escape('{63}')+'ount'}],
 ['escaped namespace declaration',{namespace:escape('0073')+'tate',accessNamespace:'state'}],
 ['escaped namespace reference',{accessNamespace:escape('{73}')+'tate'}],
 ['namespace containing from',{namespace:'fromState'}],
 ['trivia between namespace tokens',{member:'/*keep*/'+escape('0063')+'ount'}],
 ['comment dots before the namespace separator',{accessNamespace:'state/* . */',member:escape('0063')+'ount'}],
 ['actual Unicode member',{member:'café',exportName:'café'}],
 ['escaped Unicode continuation',{member:'caf'+escape('00e9'),exportName:'café'}],
 ['astral Unicode member',{member:escape('{10400}')+'value',exportName:String.fromCodePoint(0x10400)+'value'}],
 ['escaped dollar identifier',{member:escape('0024')+'count',exportName:'$count'}],
 ['escaped imported alias',{mode:'named',imported:escape('0063')+'ount'}],
 ['braced imported and local aliases',{mode:'named',imported:escape('{63}')+'ount',local:escape('0076')+'alue'}],
 ['escaped shorthand import',{mode:'shorthand',local:escape('0063')+'ount'}],
 ['escaped default local alias',{mode:'default',local:escape('0076')+'alue'}],
])){
 test('preserves raw spelling and resolves decoded '+name,()=>{
  const x=fixture(options),view=validateModuleFacts(x.snapshot);
  assert.equal(view.views.get(x.appPath).get(x.binding),x.target);
  assert.equal(x.snapshot.sources[1].content.slice(x.imp.bindings[0].range.start,
   x.imp.bindings[0].range.end),x.binding);
 });
}
for(const spelling of [
 '\\x63ount',escape('00G1')+'ount',escape('{}')+'ount',
 escape('{110000}')+'ount',escape('{d800}')+'ount',escape('002e')+'ount',
 escape('0030')+'ount','co/*split*/unt','co unt','count.extra',
]){
 test('rejects malformed namespace identifier '+spelling,()=>{
  assert.throws(()=>validateModuleFacts(fixture({member:spelling}).snapshot),/r03-module-facts/);
 });
}
test('rejects a decoded member bound to another exported target',()=>{
 const x=fixture({member:escape('0063')+'ount'});x.imp.bindings[0].target='other-id';
 assert.throws(()=>validateModuleFacts(x.snapshot),/r03-module-facts/);
});
test('rejects a different namespace even when the member target exists',()=>{
 const x=fixture({namespace:'otherState',accessNamespace:'state'});
 assert.throws(()=>validateModuleFacts(x.snapshot),/r03-module-facts/);
});
test('rejects replacing the original escaped binding spelling with a decoded name',()=>{
 const x=fixture({member:escape('0063')+'ount'});x.imp.bindings[0].name='state.count';
 assert.throws(()=>validateModuleFacts(x.snapshot),/r03-module-facts/);
});
test('rejects out-of-source and shifted original ranges',()=>{
 for(const mode of ['overflow','shift']){
  const x=fixture({member:escape('0063')+'ount'}),range=x.imp.bindings[0].range;
  if(mode==='overflow')range.end=x.snapshot.sources[1].content.length+1;else range.start++;
  assert.throws(()=>validateModuleFacts(x.snapshot),/r03-module-facts/);
 }
});
test('rejects an escaped imported alias with the wrong decoded target',()=>{
 const x=fixture({mode:'named',imported:escape('006f')+'ther'});
 assert.throws(()=>validateModuleFacts(x.snapshot),/r03-module-facts/);
});
test('rejects malformed and internally split imported aliases',()=>{
 for(const imported of [escape('{63')+'ount','co/*split*/unt',escape('{110000}')+'ount']){
  const x=fixture({mode:'named',imported,local:'count'});
  assert.throws(()=>validateModuleFacts(x.snapshot),/r03-module-facts/);
 }
});
test('rejects a named import range moved into a body span with a comment dot',()=>{
 const x=fixture({mode:'shorthand',local:'count'}),raw='count/* . */';
 const file=x.snapshot.sources[1];
 file.content=file.content.replace('return count;','return '+raw+';');
 const start=file.content.indexOf(raw,x.imp.range.end);
 assert.ok(start>=x.imp.range.end);
 x.imp.bindings[0].name=raw;
 x.imp.bindings[0].range={start,end:start+raw.length};
 assert.throws(()=>validateModuleFacts(x.snapshot),/r03-module-facts/);
});
