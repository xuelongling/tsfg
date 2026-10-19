// SPDX-License-Identifier: MIT
import {check,capability,canonical,same,sha256,format,valueType,functionType,expressionType,typeId,signatureId,functionId,compare,budget} from './module-callable-common.mjs';
import {validateModuleFacts} from './module-facts.mjs';
import {moduleIdentity,globalIdentity,initializerIdentity} from './modules.mjs';
export function projectModuleCallable(snapshot){
  const input=snapshot.request.input,raw=snapshot.package.payload.facts;
  const sources=input.files.map(f=>({path:f.path,content:f.content,hash:sha256(f.content)}));
  const byPath=new Map(sources.map(s=>[s.path,s]));
  const ownership=validateModuleFacts({identityInput:input,inputs:input.files,sources:input.files.map(({path,content})=>({path,content})),symbols:raw.symbols,modules:raw.modules,hostImports:[],compilationClosure:input.compilationClosure});
  const ids=new Map(),pool=new Map(),descriptors=new Map();
  function intern(t){
    const id=typeId(t);if(!pool.has(id)){
      check(pool.size<256,'limit');
      const row=typeof t==='string'?{id,kind:'scalar',name:t}:{id,kind:'function',parameters:t.parameters.map(intern),returnType:intern(t.returns)};
      check(pool.size<256,'limit');pool.set(id,row);descriptors.set(id,t);
    }return id;
  }
  for(const fn of raw.functions)ids.set(fn.symbol,functionId(fn.sourcePath,fn.name,functionType(fn)));
  const globals=raw.symbols.filter(s=>s.kind==='global').map(s=>{
    const id=globalIdentity(s.sourcePath,s.name,s.type);ids.set(s.id,id);
    return {id,sourcePath:s.sourcePath,name:s.name,bindingKind:'source',type:intern(s.type),writable:s.writable,range:s.range};
  }).sort((a,b)=>compare(a.id,b.id));
  const globalSymbols=new Set(raw.symbols.filter(s=>s.kind==='global').map(s=>s.id));
  function compatible(left,right){if(left===right)return;if(pool.get(left)?.kind==='function'&&pool.get(right)?.kind==='function')capability();check(false,'source');}
  function projectFunction(fn,initialization=false){
    const localIds=new Map(fn.parameters.map((p,i)=>[p.id,'p'+i]));let nextLocal=0;
    function collect(items){for(const s of items){if(s.kind==='variable')localIds.set(s.symbol.id,'l'+nextLocal++);for(const key of ['body','thenBody','elseBody'])if(s[key])collect(s[key]);}}
    collect(fn.body);
    const binding=p=>({id:localIds.get(p.id),name:p.name,type:intern(valueType(p.type,p.signature)),writable:p.writable,range:p.range});
    function expression(v){
      const common={kind:v.kind,type:intern(expressionType(v)),range:v.range};
      if(v.kind==='reference')return globalSymbols.has(v.symbol)?{...common,kind:'global',global:ids.get(v.symbol),name:v.name}:{...common,binding:localIds.get(v.symbol)};
      if(v.kind==='functionReference')return {...common,target:ids.get(v.target),name:v.name};
      if(v.kind==='call'||v.kind==='indirectCall'){
        const sig=valueType('function',v.signature),args=v.arguments.map(expression);
        args.forEach((a,i)=>compatible(a.type,intern(sig.parameters[i])));
        const callee=v.kind==='indirectCall'?expression(v.callee):null;
        if(callee)compatible(callee.type,intern(sig));
        return {...common,...(callee?{callee}:{target:ids.get(v.target),name:v.name}),signature:intern(sig),signatureHash:signatureId(sig),arguments:args};
      }
      if(v.kind==='integer')return {...common,kind:'constant',...v.literal};
      if(v.kind==='boolean')return {...common,value:v.boolean};
      return {...common,...(v.operator?{operator:v.operator}:{}),...Object.fromEntries(['left','right','operand'].filter(k=>v[k]).map(k=>[k,expression(v[k])]))};
    }
    function statement(s){
      const c={kind:s.kind,range:s.range};
      if(s.kind==='initialize'){const value=expression(s.initializer);compatible(value.type,intern(s.symbol.type));return {...c,global:ids.get(s.symbol.id),value};}
      if(s.kind==='variable'){const b=binding(s.symbol),initializer=expression(s.initializer);compatible(b.type,initializer.type);return {...c,kind:'local',binding:b,initializer};}
      if(s.kind==='assignment'){const target=expression(s.target),value=expression(s.value);compatible(target.type,value.type);return {...c,kind:'assign',target,value};}
      if(s.kind==='return'||s.kind==='expression'){const value=expression(s.expression);if(s.kind==='return')compatible(value.type,intern(valueType(fn.returnType,fn.returnSignature)));return {...c,value};}
      return {...c,...(s.condition?{condition:expression(s.condition)}:{}),...Object.fromEntries(['body','thenBody','elseBody'].filter(k=>s[k]||s.kind==='block'&&k==='body'||s.kind==='while'&&k==='body'||s.kind==='if'&&['thenBody','elseBody'].includes(k)).map(k=>[k,(s[k]??[]).map(statement)]))};
    }
    const type=functionType(fn),source=byPath.get(fn.sourcePath);
    return {id:initialization?initializerIdentity(fn.sourcePath,source.hash):ids.get(fn.symbol),sourcePath:fn.sourcePath,kind:initialization?'module-initialization':'source',name:fn.name,signature:intern(type),signatureHash:signatureId(type),returnType:intern(type.returns),parameters:fn.parameters.map(binding),range:fn.range,definitionRange:initialization?fn.range:raw.symbols.find(s=>s.id===fn.symbol).range,body:fn.body.map(statement)};
  }
  const functions=raw.functions.map(f=>projectFunction(f));
  for(const m of raw.modules)functions.push(projectFunction({sourcePath:m.sourcePath,name:'$moduleInit',parameters:[],returnType:'i32',body:m.initialization,range:{start:0,end:byPath.get(m.sourcePath).content.length}},true));
  functions.sort((a,b)=>compare(a.id,b.id));
  const visible=entries=>entries.map(({name,target})=>({name,target:ids.get(target)})).sort((a,b)=>compare(a.name,b.name));
  const modules=raw.modules.map(m=>({id:moduleIdentity(m.sourcePath),sourcePath:m.sourcePath,dependencies:[...new Set(m.imports.map(i=>i.sourcePath))],initializer:initializerIdentity(m.sourcePath,byPath.get(m.sourcePath).hash),exports:visible(m.exports),bindings:visible([...ownership.views.get(m.sourcePath)].map(([name,target])=>({name,target})))})).sort((a,b)=>compare(a.sourcePath,b.sourcePath));
  const byFunction=new Map(functions.map(f=>[f.id,f])),byModule=new Map(modules.map(m=>[m.sourcePath,m]));
  const roots=input.compilationClosure.roots.map(r=>{
    const m=byModule.get(r.sourcePath),target=r.kind==='module-initialization'?m.initializer:m.exports.find(e=>e.name===r.name)?.target??functions.find(f=>f.sourcePath===r.sourcePath&&f.name===r.name)?.id;
    check(byFunction.has(target),'identity');return {...r,target};
  });
  const retained=new Set(),moduleSet=new Set(),pending=roots.map(r=>r.target);
  function retainModule(p){if(moduleSet.has(p))return;moduleSet.add(p);const m=byModule.get(p);pending.push(m.initializer);m.dependencies.forEach(retainModule);}
  function visit(v){if(!v||typeof v!=='object')return;if(v.kind==='call'||v.kind==='functionReference')pending.push(v.target);if(v.kind==='global'||v.kind==='initialize')retainModule(globals.find(g=>g.id===(v.global)).sourcePath);Object.values(v).forEach(x=>{if(Array.isArray(x))x.forEach(visit);else if(x&&typeof x==='object')visit(x);});}
  roots.forEach(r=>retainModule(r.sourcePath));
  while(pending.length){const id=pending.pop();if(retained.has(id))continue;const f=byFunction.get(id);check(f,'identity');retained.add(id);retainModule(f.sourcePath);visit(f.body);}
  // Complete consumed module initialization is kept independently of source call roots.
  modules.forEach(m=>retainModule(m.sourcePath));
  while(pending.length){const id=pending.pop();if(retained.has(id))continue;const f=byFunction.get(id);retained.add(id);visit(f.body);}
  const initialization=[],seen=new Set();
  function initialize(p){if(seen.has(p))return;seen.add(p);const m=byModule.get(p);m.dependencies.forEach(initialize);initialization.push(m.initializer);}
  roots.forEach(r=>initialize(r.sourcePath));modules.forEach(m=>initialize(m.sourcePath));
  const closure={roots,requiredRoots:input.compilationClosure.requiredRoots,modules:[...moduleSet].map(p=>byModule.get(p).id).sort(compare),functions:[...retained].sort(compare),initialization};
  const hir={format:format('tsfg.module-callable-hir-candidate'),snapshot,inputIdentity:snapshot.inputIdentity,source:byPath.get(input.rootFile),sources,target:input.target,types:[...pool.values()].sort((a,b)=>compare(a.id,b.id)),modules,globals,hostImports:[],functions,closure};
  budget(hir);return hir;
}
