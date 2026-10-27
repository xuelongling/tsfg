// SPDX-License-Identifier: MIT
import path from 'node:path';
import {canonical} from './identity.mjs';
import {sourceLexicalTokens} from './conversions.mjs';

// The owned program fixes ESNext/Bundler, noLib, noEmit, strict and allowJs=false.
// Reproduce only relative lookup over its complete normalized in-memory file
// universe, including declaration-file obstruction. No filesystem/npm lookup,
// type checking, package.json interpretation or producer execution occurs here.
export function relativeModuleSource(from,specifier,files) {
  if(typeof specifier!=='string'||!/^\.{1,2}(?:\/|$)/.test(specifier))return undefined;
  const logical=path.posix.normalize(path.posix.join(path.posix.dirname(from),specifier)),candidates=[];
  const add=base=>candidates.push(base+'.ts',base+'.d.ts');
  if(!specifier.endsWith('/')) {
    const ext=logical.match(/(?:\.d\.(?:ts|mts|cts)|\.[^/.]+)$/)?.[0];
    if(ext) {
      const base=logical.slice(0,-ext.length);
      if(['.ts','.d.ts','.js','.tsx','.jsx'].includes(ext))add(base);
      else if(!['.mts','.d.mts','.mjs','.cts','.d.cts','.cjs'].includes(ext))candidates.push(base+'.d'+ext+'.ts');
    }
    add(logical);
  }
  add(path.posix.join(logical,'index'));
  return candidates.find(candidate=>files.has(candidate));
}

const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const mapEqual=(left,right)=>left.size===right.size&&[...left].every(([key,value])=>right.get(key)===value);
const punct=(token,value)=>token?.kind==='punctuation'&&token.value===value;
const name=(token,value)=>token?.kind==='name'&&token.value===value;

/** Rebuild all source declarations and runtime module bindings before pruning.
 * Body syntax/types remain the shared scalar validator's responsibility. These
 * spans partition the source, rather than treating an entire initializer range
 * as authority to hide declarations. The persisted official edges select no
 * names: their source spelling, range and fixed relative resolution are checked.
 */
export function verifyModuleSources(hir,{sources,modules,globals,hosts},fail) {
  const records=new Map(),claimedFunctions=new Set(),claimedGlobals=new Set(),claimedStatements=new Set();
  const files=new Map(hir.inputScope.files.map(file=>[file.path,file]));
  const add=(map,key,value)=>{if(map.has(key)&&map.get(key)!==value)fail();map.set(key,value);};
  for(const module of modules.values()) {
    const source=sources.get(module.sourcePath).content,tokens=sourceLexicalTokens(source);
    if(!tokens||!Array.isArray(module.imports))fail();
    const functions=hir.functions.filter(fn=>fn.sourcePath===module.sourcePath&&fn.kind==='source');
    const ownGlobals=[...globals.values()].filter(global=>global.sourcePath===module.sourcePath);
    const initializer=hir.functions.find(fn=>fn.id===module.initializer),body=initializer?.body;
    if(!Array.isArray(body))fail();
    const own=new Map(),direct=new Map(),edges=[],localExports=[],stars=[],forward=[];
    let index=0;
    const take=value=>{if(!punct(tokens[index],value))fail();return tokens[index++];};
    const named=()=>{const token=tokens[index++];if(token?.kind!=='name')fail();return token;};
    const spelling=token=>source.slice(token.start,token.end);
    const atEnd=end=>{while(index<tokens.length&&tokens[index].end<=end)index++;
      if(tokens[index-1]?.end!==end||tokens[index]?.start<end)fail();};
    const balanced=(open,close)=>{
      take(open);let depth=1,last;
      while(index<tokens.length&&depth){last=tokens[index++];if(punct(last,open))depth++;if(punct(last,close))depth--;}
      if(depth)fail();return last;
    };
    const edge=(kind,start,specifier,bindings,namespace)=>{
      if(specifier?.kind!=='text')fail();
      const end=punct(tokens[index],';')?tokens[index++].end:specifier.end;
      const sourcePath=relativeModuleSource(module.sourcePath,specifier.value,files);
      if(!sourcePath||!modules.has(sourcePath))fail();
      const persisted=module.imports[edges.length];
      if(!exact(persisted,['kind','specifier','sourcePath','range'])||persisted.kind!==kind
        ||persisted.specifier!==specifier.value||persisted.sourcePath!==sourcePath
        ||!exact(persisted.range,['start','end'])||persisted.range.end!==end
        ||!Number.isSafeInteger(persisted.range.start)||persisted.range.start<0||persisted.range.start>start
        ||sourceLexicalTokens(source.slice(persisted.range.start,start))?.length!==0)fail();
      const value={sourcePath,bindings,namespace};edges.push(value);return value;
    };
    const list=()=>{
      const items=[];take('{');
      while(!punct(tokens[index],'}')) {
        let typeOnly=false;
        if(name(tokens[index],'type')&&tokens[index+1]?.kind==='name'&&!name(tokens[index+1],'as')){typeOnly=true;index++;}
        const imported=tokens[index++];if(!['name','text'].includes(imported?.kind))fail();
        let local=imported;if(name(tokens[index],'as')){index++;local=tokens[index++];if(!['name','text'].includes(local?.kind))fail();}
        items.push({imported:imported.value,local:local.value,raw:spelling(local),typeOnly});
        if(!punct(tokens[index],','))break;index++;
      }
      take('}');return items;
    };
    while(index<tokens.length) {
      if(punct(tokens[index],';')){index++;continue;}
      const start=tokens[index].start;
      let exported=false,defaulted=false;
      if(name(tokens[index],'export')){exported=true;index++;if(name(tokens[index],'default')){defaulted=true;index++;}}
      if(name(tokens[index],'function')) {
        index++;const binding=tokens[index]?.kind==='name'?tokens[index++]:undefined;
        if(!binding&&!defaulted)fail();
        balanced('(',')');
        while(index<tokens.length&&!punct(tokens[index],'{'))index++;
        const close=balanced('{','}'),owned=functions.filter(fn=>fn.name===(binding?.value??'default')&&fn.range.end===close.end
          &&fn.range.start<=start&&sourceLexicalTokens(source.slice(fn.range.start,start))?.length===0);
        if(owned.length!==1||claimedFunctions.has(owned[0].id))fail();
        const fn=owned[0];claimedFunctions.add(fn.id);add(own,fn.name,fn.id);
        if(exported)add(direct,defaulted?'default':fn.name,fn.id);
      } else if(name(tokens[index],'const')||name(tokens[index],'let')) {
        if(defaulted)fail();const writable=name(tokens[index++],'let');
        while(true) {
          const binding=named(),owned=ownGlobals.filter(global=>global.bindingKind==='source'
            &&global.name===binding.value&&global.range.start<=binding.start&&global.range.end===binding.end
            &&sourceLexicalTokens(source.slice(global.range.start,binding.start))?.length===0);
          if(owned.length!==1||owned[0].writable!==writable||claimedGlobals.has(owned[0].id))fail();
          const global=owned[0],statement=body.find(item=>item.kind==='initialize'&&item.global===global.id);
          if(!statement?.value?.range||statement.range.start>binding.start)fail();
          claimedGlobals.add(global.id);claimedStatements.add(statement);add(own,global.name,global.id);
          if(exported)add(direct,global.name,global.id);
          atEnd(statement.value.range.end);
          if(!punct(tokens[index],','))break;index++;
        }
        if(punct(tokens[index],';'))index++;
      } else if(defaulted) {
        const generated=ownGlobals.filter(global=>global.bindingKind==='default-export-expression');
        if(generated.length!==1||claimedGlobals.has(generated[0].id))fail();
        const global=generated[0],statement=body.find(item=>item.kind==='initialize'&&item.global===global.id);
        if(!statement?.value?.range||statement.value.range.start>tokens[index]?.start
          ||sourceLexicalTokens(source.slice(statement.value.range.start,tokens[index].start))?.length!==0)fail();
        claimedGlobals.add(global.id);claimedStatements.add(statement);add(direct,'default',global.id);
        atEnd(statement.value.range.end);if(punct(tokens[index],';'))index++;
      } else if(!exported&&name(tokens[index],'import')) {
        index++;let typeOnly=false,namespace,bindings=[];
        if(name(tokens[index],'type')&&!name(tokens[index+1],'from')&&!punct(tokens[index+1],',')){typeOnly=true;index++;}
        if(tokens[index]?.kind!=='text') {
          if(tokens[index]?.kind==='name') {
            const binding=named();bindings.push({imported:'default',local:binding.value,raw:spelling(binding),typeOnly:false});
            if(punct(tokens[index],','))index++;
          }
          if(punct(tokens[index],'*')){index++;if(!name(tokens[index++],'as'))fail();namespace=named().value;}
          else if(punct(tokens[index],'{'))bindings.push(...list());
          if(!name(tokens[index++],'from'))fail();
        }
        const specifier=tokens[index++];
        if(typeOnly||bindings.length&&bindings.every(binding=>binding.typeOnly)) {
          if(specifier?.kind!=='text')fail();if(punct(tokens[index],';'))index++;
        } else edge('import',start,specifier,bindings.filter(binding=>!binding.typeOnly),namespace);
      } else if(exported&&(punct(tokens[index],'{')||punct(tokens[index],'*')||name(tokens[index],'type'))) {
        let typeOnly=false,star=false,namespace=false,items=[];
        if(name(tokens[index],'type')){typeOnly=true;index++;}
        if(punct(tokens[index],'*')) {
          index++;star=true;
          if(name(tokens[index],'as')){index++;named();namespace=true;}
        } else items=list();
        if(name(tokens[index],'from')) {
          index++;const specifier=tokens[index++];
          if(typeOnly||items.length&&items.every(item=>item.typeOnly)) {
            if(specifier?.kind!=='text')fail();if(punct(tokens[index],';'))index++;
          } else {
            const target=edge('export',start,specifier,[]);
            if(star&&!namespace)stars.push(target);
            else if(!namespace)forward.push(...items.filter(item=>!item.typeOnly).map(item=>({...item,edge:target})));
          }
        } else {
          if(star)fail();if(!typeOnly)localExports.push(...items.filter(item=>!item.typeOnly));
          if(punct(tokens[index],';'))index++;
        }
      } else {
        if(exported)fail();
        const statement=body.find(item=>item.kind!=='initialize'&&!claimedStatements.has(item)
          &&item.range.start<=start&&sourceLexicalTokens(source.slice(item.range.start,start))?.length===0);
        if(!statement?.range||statement.range.end<=start)fail();
        claimedStatements.add(statement);atEnd(statement.range.end);
      }
    }
    if(functions.some(fn=>!claimedFunctions.has(fn.id))||ownGlobals.some(global=>!claimedGlobals.has(global.id))
      ||body.some(statement=>!claimedStatements.has(statement))||module.imports.length!==edges.length
      ||canonical(module.dependencies)!==canonical([...new Set(edges.map(edge=>edge.sourcePath))]))fail();
    records.set(module.sourcePath,{source,tokens,module,own,direct,edges,localExports,stars,forward});
  }
  // Fixed-point export construction starts from actual declarations, not claimed
  // HIR exports; cycles cannot manufacture a self-supporting invented binding.
  const exports=new Map([...records].map(([key,record])=>[key,new Map(record.direct)]));
  const hostNames=new Map();for(const host of hosts.values()) {
    if(hostNames.has(host.name))fail();hostNames.set(host.name,host.id);
    const source=sources.get(host.sourcePath).content,tokens=sourceLexicalTokens(source),at=tokens?.findIndex(token=>token.start>=host.range.start
      &&token.end===host.range.end&&sourceLexicalTokens(source.slice(host.range.start,token.start))?.length===0);
    if(at===undefined||at<1||!name(tokens[at],host.name)||!name(tokens[at-1],'function')||!punct(tokens[at+1],'('))fail();
  }
  const baseView=record=>{
    const visible=new Map(hostNames);
    for(const other of records.values())if(record===other||!record.module.external&&!other.module.external)
      for(const [key,value]of other.own)add(visible,key,value);
    return visible;
  };
  const importView=(record,visible,complete)=>{
    for(const edge of record.edges) {
      const target=exports.get(edge.sourcePath);
      for(const binding of edge.bindings) {
        const id=target.get(binding.imported);
        if(id===undefined){if(complete)fail();continue;}add(visible,binding.raw,id);
      }
      if(edge.namespace)for(let index=0;index<record.tokens.length-2;index++) {
        const [base,dot,member]=record.tokens.slice(index,index+3);
        if(!name(base,edge.namespace)||!punct(dot,'.')||member?.kind!=='name')continue;
        const id=target.get(member.value);if(id===undefined){if(complete)fail();continue;}
        add(visible,record.source.slice(base.start,member.end),id);
      }
    }
    return visible;
  };
  const exportedLocal=(record,visible,binding)=>{
    if(visible.has(binding.imported))return visible.get(binding.imported);
    for(const edge of record.edges)for(const alias of edge.bindings)
      if(alias.local===binding.imported)return visible.get(alias.raw);
  };
  const limit=hir.functions.length+globals.size+records.size+1;
  for(let round=0;round<limit;round++) {
    let changed=false;
    for(const [key,record]of records) {
      const table=new Map(record.direct),visible=importView(record,baseView(record),false),explicit=new Map(table),ambiguous=new Set();
      for(const binding of record.localExports) {
        const id=exportedLocal(record,visible,binding);if(id!==undefined)add(explicit,binding.local,id);
      }
      for(const binding of record.forward) {
        const id=exports.get(binding.edge.sourcePath).get(binding.imported);if(id!==undefined)add(explicit,binding.local,id);
      }
      for(const star of record.stars)for(const [name,id]of exports.get(star.sourcePath)) {
        if(name==='default'||explicit.has(name)||ambiguous.has(name))continue;
        if(table.has(name)&&table.get(name)!==id){table.delete(name);ambiguous.add(name);}else table.set(name,id);
      }
      for(const [name,id]of explicit)table.set(name,id);
      if(!mapEqual(exports.get(key),table)){exports.set(key,table);changed=true;}
    }
    if(!changed)break;if(round===limit-1)fail();
  }
  for(const [key,record]of records) {
    const visible=importView(record,baseView(record),true);
    if(record.localExports.some(binding=>exportedLocal(record,visible,binding)===undefined)
      ||record.forward.some(binding=>!exports.get(binding.edge.sourcePath).has(binding.imported))
      ||!mapEqual(exports.get(key),new Map(record.module.exports.map(binding=>[binding.name,binding.target])))
      ||!mapEqual(visible,new Map(record.module.bindings.map(binding=>[binding.name,binding.target]))))fail();
  }
}
