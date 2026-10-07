// SPDX-License-Identifier: MIT
import {canonical,functionIdentity,signatureHash,scalarTypeIds,scalarName,sha256} from './identity.mjs';
import {moduleIdentity,globalIdentity,compilationClosure} from './modules.mjs';

const exact=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)
  && Object.keys(value).sort().join(',')===[...names].sort().join(',');
const anchor=(range,source)=>exact(range,['start','end'])&&Number.isSafeInteger(range.start)
  && Number.isSafeInteger(range.end)&&range.start>=0&&range.start<range.end&&range.end<=source.content.length;
export const initializerIdentity=sourcePath=>functionIdentity(sourcePath,'$moduleInit','i32',[]);
export const hostIdentity=(sourcePath,name)=>sha256(`tsfg.host\0${sourcePath}\0${name}\0${signatureHash('i32',['i32'])}`);

/** Independently verify module ownership before body verification or pruning. */
export function verifyModuleHir(hir,fail) {
  const sources=new Map(),modules=new Map(),globals=new Map(),hosts=new Map(),definitions=new Map();
  for(const source of hir.sources??[]) {
    if(!exact(source,['path','content','hash'])||typeof source.path!=='string'||!source.path.startsWith('/')
      ||!source.path.endsWith('.ts')||/[\\:\0]/.test(source.path)||source.path.slice(1).split('/').some(p=>!p||p==='.'||p==='..')
      ||typeof source.content!=='string'||!source.content.isWellFormed()||source.hash!==sha256(source.content)||sources.has(source.path))fail();
    sources.set(source.path,source);
  }
  if(!sources.size||canonical(sources.get(hir.source.path))!==canonical(hir.source))fail();
  for(const module of hir.modules??[]) {
    if(!exact(module,['id','sourcePath','dependencies','initializer','exports','bindings'])
      ||module.id!==moduleIdentity(module.sourcePath)||!sources.has(module.sourcePath)||module.sourcePath.endsWith('.d.ts')
      ||modules.has(module.sourcePath)||module.initializer!==initializerIdentity(module.sourcePath)
      ||!Array.isArray(module.dependencies)||new Set(module.dependencies).size!==module.dependencies.length
      ||!Array.isArray(module.exports)||!Array.isArray(module.bindings))fail();
    modules.set(module.sourcePath,module);
  }
  if(modules.size!==[...sources.keys()].filter(p=>!p.endsWith('.d.ts')).length)fail();
  for(const global of hir.globals??[]) {
    if(!exact(global,['id','sourcePath','name','type','writable','range'])||!modules.has(global.sourcePath)
      ||typeof global.name!=='string'||!global.name||global.id!==globalIdentity(global.sourcePath,global.name,scalarName(global.type))
      ||!Object.values(scalarTypeIds).includes(global.type)||typeof global.writable!=='boolean'
      ||!anchor(global.range,sources.get(global.sourcePath))||globals.has(global.id))fail();
    globals.set(global.id,global);definitions.set(global.id,global);
  }
  for(const host of hir.hostImports??[]) {
    if(!exact(host,['id','sourcePath','name','capabilityId','signatureHash','parameterTypes','returnType','range'])
      ||!sources.has(host.sourcePath)||!host.sourcePath.endsWith('.d.ts')||typeof host.name!=='string'||!host.name
      ||host.id!==hostIdentity(host.sourcePath,host.name)||host.capabilityId!==31
      ||host.signatureHash!==signatureHash('i32',['i32'])||canonical(host.parameterTypes)!==canonical([scalarTypeIds.i32])
      ||host.returnType!==scalarTypeIds.i32||!anchor(host.range,sources.get(host.sourcePath))||hosts.has(host.id))fail();
    hosts.set(host.id,host);definitions.set(host.id,host);
  }
  const association=new Map();
  for(const fn of hir.functions) {
    if(!modules.has(fn.sourcePath)||!['source','module-initialization'].includes(fn.kind))fail();
    if(fn.kind==='module-initialization') {
      const module=modules.get(fn.sourcePath);
      if(fn.id!==module.initializer||fn.name!=='$moduleInit'||fn.returnType?.id!==scalarTypeIds.i32
        ||fn.parameters.length||association.has(fn.sourcePath)||fn.range.start!==0
        ||fn.range.end!==sources.get(fn.sourcePath).content.length)fail();
      association.set(fn.sourcePath,fn.id);
    }else if(fn.name==='$moduleInit')fail();
    definitions.set(fn.id,fn);
  }
  if(association.size!==modules.size)fail();
  const views=new Map();
  for(const module of modules.values()) {
    if(module.dependencies.some(p=>!modules.has(p)))fail();
    const exports=new Set(),visible=new Map();
    for(const binding of module.exports) {
      if(!exact(binding,['name','target'])||typeof binding.name!=='string'||!binding.name||exports.has(binding.name)
        ||!definitions.has(binding.target)||hosts.has(binding.target)||definitions.get(binding.target).kind==='module-initialization')fail();
      exports.add(binding.name);
    }
    for(const binding of module.bindings) {
      if(!exact(binding,['name','target'])||typeof binding.name!=='string'||!binding.name||visible.has(binding.name)
        ||!definitions.has(binding.target)||definitions.get(binding.target).kind==='module-initialization')fail();
      visible.set(binding.name,binding.target);
    }
    views.set(module.sourcePath,visible);
  }
  const expected=compilationClosure({modules:hir.modules,functions:hir.functions,globals:hir.globals,configuration:{roots:hir.closure.roots.map(({kind,sourcePath,name})=>({kind,sourcePath,name})),requiredRoots:hir.closure.requiredRoots}});
  if(canonical(expected)!==canonical(hir.closure))fail();
  return {sources,modules,globals,hosts,views};
}
