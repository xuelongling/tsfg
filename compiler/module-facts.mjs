// SPDX-License-Identifier: MIT
import { canonical, signatureHash, scalarTypeIds, scalarName, sha256 } from "./identity.mjs";
import { normalizeClosure, moduleIdentity, globalIdentity, defaultBindingIdentity, compilationClosure, initializerIdentity, hostIdentity } from "./modules.mjs";
import {sourceIsExternal} from './conversions.mjs';
import {relativeModuleSource,verifyModuleSources} from './module-hir-source.mjs';

export function skipCallTrivia(source) {
  let index = 0;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index++;
    } else if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      if (end === -1) return -1;
      index = end + 2;
    } else if (source.startsWith("//", index)) {
      index += 2;
      while (index < source.length && !/[\r\n\u2028\u2029]/.test(source[index])) index++;
    } else {
      return index;
    }
  }
  return index;
}

export function hasCallArgumentList(source) {
  const index = skipCallTrivia(source);
  return index >= 0 && source[index] === "(";
}

// Compare an already officially checked identifier's source spelling with
// its decoded owned name. This reads original spans, never upstream AST data.
export function identifierName(spelling) {
  const trivia = "(?:\\s|/\\*(?:(?!\\*/)[\\s\\S])*\\*/|//[^\\r\\n\\u2028\\u2029]*)";
  spelling = spelling.replace(new RegExp(`^${trivia}*`), "")
    .replace(new RegExp(`${trivia}*$`), "");
  const name = spelling.replace(/\\u(?:\{([0-9a-fA-F]{1,6})\}|([0-9a-fA-F]{4}))/g,
    (_, point, unit) => String.fromCodePoint(Number.parseInt(point ?? unit, 16)));
  if (!/^[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*$/u.test(name))
    throw new TypeError("invalid source identifier spelling");
  return name;
}

// Only the officially resolved namespace member shape is admitted. This guard
// checks spelling; it neither resolves symbols nor admits arbitrary properties.
export function staticBindingName(spelling) {
  const parts=spelling.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n\u2028\u2029]*/g, " ").split(".");
  if (parts.length < 1 || parts.length > 2) throw new TypeError("invalid static binding spelling");
  return parts.map(identifierName).join(".");
}

const exact = (value,names) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join(",") === [...names].sort().join(",");
const fail = () => { throw new TypeError("r03-module-facts: owned module/source/binding facts differ"); };
const trivia = text => text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n\u2028\u2029]*/g," ");

// This decoder validates untrusted module facts and preserves their error domain.
// The official-source spelling helpers above accept different escape spellings
// and errors; keep both until their callers share those contracts.
// Decode only a bounded original identifier span; never resolve/check source.
function identifier(spelling) {
  const text=trivia(spelling).trim(),characters=[];
  for(let index=0;index<text.length;) {
    if(text[index]!=="\\") {
      const point=text.codePointAt(index);characters.push(String.fromCodePoint(point));
      index+=point>0xffff?2:1;continue;
    }
    if(text[index+1]!=="u") fail();
    index+=2;
    if(text[index]==="{") {
      let point=0,digits=0;index++;
      while(index<text.length && text[index]!=="}") {
        if(!/[0-9a-fA-F]/.test(text[index])) fail();
        point=point*16+Number.parseInt(text[index++],16);digits++;
        if(point>0x10ffff) fail();
      }
      if(!digits || text[index++]!=="}") fail();
      characters.push(String.fromCodePoint(point));
    } else {
      const digits=text.slice(index,index+4);
      if(!/^[0-9a-fA-F]{4}$/.test(digits)) fail();
      characters.push(String.fromCharCode(Number.parseInt(digits,16)));index+=4;
    }
  }
  const name=characters.join("");
  if(!/^[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*$/u.test(name)) fail();
  return name;
}

/** Validate persisted module provenance before any closure pruning. */
export function validateModuleFacts(snapshot) {
  const claim = snapshot.identityInput;
  if (!claim.compilationClosure || canonical(normalizeClosure(claim.compilationClosure)) !== canonical(snapshot.compilationClosure)
      || !Array.isArray(snapshot.sources) || !Array.isArray(snapshot.modules) || !Array.isArray(snapshot.hostImports)) fail();
  const sources = new Map(), modules = new Map(), symbols = new Map(snapshot.symbols.map(symbol=>[symbol.id,symbol]));
  const inputSources = claim.files.filter(file=>snapshot.inputs.some(input=>input.path===file.path));
  if (canonical(snapshot.sources) !== canonical(inputSources.map(file=>({path:file.path,content:file.content})))) fail();
  for (const source of snapshot.sources) {
    if (!exact(source,["path","content"]) || sources.has(source.path)) fail();
    sources.set(source.path,source);
  }
  for (const module of snapshot.modules) {
    if (!exact(module,["sourcePath","external","imports","exports","globals","initialization"])
        || !sources.has(module.sourcePath) || module.sourcePath.endsWith(".d.ts") || modules.has(module.sourcePath)
        || typeof module.external !== "boolean" || sourceIsExternal(sources.get(module.sourcePath).content)!==module.external
        || !Array.isArray(module.imports) || !Array.isArray(module.globals)
        || !Array.isArray(module.exports) || !Array.isArray(module.initialization)
        || new Set(module.globals).size !== module.globals.length) fail();
    modules.set(module.sourcePath,module);
  }
  if (modules.size !== inputSources.filter(file=>!file.path.endsWith(".d.ts")).length) fail();
  const hostNames = new Map(), configured = claim.hostImports ?? [];
  if (configured.length !== snapshot.hostImports.length) fail();
  for (const host of snapshot.hostImports) {
    if (!exact(host,["sourcePath","name","capabilityId","parameterTypes","returnType","symbol","range"])
        || host.capabilityId !== 31 || host.returnType !== "i32" || canonical(host.parameterTypes) !== '["i32"]'
        || !sources.has(host.sourcePath) || !host.sourcePath.endsWith(".d.ts") || hostNames.has(host.name)) fail();
    const declared = configured.find(item=>item.sourcePath===host.sourcePath && item.name===host.name);
    const symbol = symbols.get(host.symbol);
    if (!declared || !exact(declared,["sourcePath","name","capabilityId","parameterTypes","returnType"])
        || canonical(declared) !== canonical(Object.fromEntries(Object.keys(declared).map(key=>[key,host[key]])))
        || symbol?.kind !== "host-function" || symbol.sourcePath !== host.sourcePath || symbol.name !== host.name
        || symbol.type !== "i32" || canonical(symbol.range) !== canonical(host.range)) fail();
    hostNames.set(host.name,host.symbol);
  }
  const validRange = (range,source) => exact(range,["start","end"])
    && Number.isSafeInteger(range.start) && Number.isSafeInteger(range.end)
    && range.start >= 0 && range.start < range.end && range.end <= source.length;
  const reachable = (from,to,seen=new Set()) => {
    if (from===to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return modules.get(from)?.imports.some(edge=>reachable(edge.sourcePath,to,seen)) ?? false;
  };
  const exports = new Map();
  for (const module of snapshot.modules) {
    const table=new Map(), source=sources.get(module.sourcePath).content;
    for (const binding of module.exports) {
      const symbol=symbols.get(binding.target);
      if (!exact(binding,["name","target","range"]) || typeof binding.name!=="string"
          || !binding.name || table.has(binding.name) || !validRange(binding.range,source)
          || !symbol || !["function","global"].includes(symbol.kind)
          || !reachable(module.sourcePath,symbol.sourcePath)) fail();
      table.set(binding.name,binding.target);
    }
    if (!module.external && table.size) fail();
    exports.set(module.sourcePath,table);
  }
  const views = new Map();
  for (const module of snapshot.modules) {
    const visible = new Map(hostNames), source = sources.get(module.sourcePath).content;
    const generated = snapshot.symbols.filter(symbol=>symbol.kind==='global' && symbol.sourcePath===module.sourcePath
      && symbol.bindingKind==='default-export-expression');
    if (generated.length > 1) fail();
    for (const symbol of snapshot.symbols.filter(symbol=>symbol.kind==='global' && symbol.sourcePath===module.sourcePath)) {
      if (!['source','default-export-expression'].includes(symbol.bindingKind)) fail();
      if (symbol.bindingKind==='default-export-expression') {
        const statement=module.initialization.find(item=>item.kind==='initialize' && item.symbol?.id===symbol.id);
        const initializer=statement?.initializer;
        if (symbol.writable || exports.get(module.sourcePath).get('default')!==symbol.id || !statement
            || statement.symbol.bindingKind!==symbol.bindingKind || statement.symbol.type!==symbol.type
            || statement.symbol.name!==symbol.name || statement.symbol.writable!==symbol.writable
            || canonical(statement.symbol.range)!==canonical(symbol.range) || !validRange(symbol.range,source)
            || !validRange(statement.range,source) || !validRange(initializer?.range,source)
            || trivia(source.slice(statement.range.start,initializer.range.start)).replace(/\s/g,'')!=='exportdefault'
            || symbol.range.start<initializer.range.start || symbol.range.end!==initializer.range.end) fail();
      }
    }
    for (const symbol of snapshot.symbols) {
      const owner = modules.get(symbol.sourcePath);
      if (["function","global"].includes(symbol.kind)
          && symbol.bindingKind!=='default-export-expression'
          && (symbol.sourcePath===module.sourcePath || !module.external && owner && !owner.external)) {
        if (visible.has(symbol.name)) fail();
        visible.set(symbol.name,symbol.id);
      }
    }
    let previous = 0;
    for (const imp of module.imports) {
      if (!exact(imp,["kind","specifier","sourcePath","range","bindings"]) || !Array.isArray(imp.bindings)
          || !["import","export"].includes(imp.kind) || !modules.has(imp.sourcePath)
          || !validRange(imp.range,source) || imp.range.start < previous
          || typeof imp.specifier !== "string" || !imp.specifier.startsWith(".")
          || imp.kind==="export" && imp.bindings.length) fail();
      previous=imp.range.end;
      // This guards the admitted subset's original string/source association;
      // the official frontend remains the only module resolver/checker.
      const anchor = trivia(source.slice(imp.range.start,imp.range.end)).trim();
      const quoted = anchor.match(/(?:from\s*)?(['"])([^'"\r\n]+)\1\s*;?$/);
      if (!new RegExp(`^${imp.kind}\\b`).test(anchor) || quoted?.[2] !== imp.specifier) fail();
      if (relativeModuleSource(module.sourcePath,imp.specifier,new Map(claim.files.map(file=>[file.path,file])))!==imp.sourcePath) fail();
      for (const binding of imp.bindings) {
        const symbol=symbols.get(binding.target);
        if (!exact(binding,["name","target","range"]) || typeof binding.name!=="string" || !binding.name || !symbol
            || visible.has(binding.name) && visible.get(binding.name)!==binding.target
            || !["function","global"].includes(symbol.kind)
            || ![...exports.get(imp.sourcePath).values()].includes(binding.target)
            || !validRange(binding.range,source)
            || source.slice(binding.range.start,binding.range.end).trim()!==binding.name) fail();
        const parts=trivia(binding.name).split(".");
        if(parts.length>2) fail();
        const names=parts.map(identifier);
        if (names.length===1 && (binding.range.start<imp.range.start || binding.range.end>imp.range.end)) fail();
        if (names.length===2) {
          const [namespace,member]=names;
          const prefix=anchor.slice(0,quoted.index);
          const declared=prefix.match(/^import\s*\*\s*as\s+([\s\S]+?)\s*$/)?.[1];
          if (declared===undefined || identifier(declared)!==namespace
              || exports.get(imp.sourcePath).get(member)!==binding.target) fail();
        } else {
          const prefix=trivia(source.slice(imp.range.start,binding.range.start));
          const alias=prefix.match(/(?:\{|,)\s*((?:\\u\{[^}]*\}|[^\s{},])+)\s+as\s*$/)?.[1];
          if(/\bas\s*$/.test(prefix) && alias===undefined) fail();
          const imported=alias===undefined ? (prefix.includes("{") ? names[0] : "default") : identifier(alias);
          if (exports.get(imp.sourcePath).get(imported)!==binding.target) fail();
        }
        visible.set(binding.name,binding.target);
      }
    }
    const globals=snapshot.symbols.filter(symbol=>symbol.kind==="global"&&symbol.sourcePath===module.sourcePath).map(symbol=>symbol.id);
    if (canonical(globals)!==canonical(module.globals)) fail();
    const initialized=module.initialization.filter(statement=>statement.kind==="initialize").map(statement=>statement.symbol?.id);
    if (canonical(initialized)!==canonical(globals)) fail();
    views.set(module.sourcePath,visible);
  }
  return {sources,modules,views,exports};
}

// Preserve comment width for source anchors shared by HIR validation and projection.
// The decoder-only trivia helper above intentionally performs token comparison.
export const sourceTrivia = (source, start, end) => source.slice(start, end)
  .replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n\u2028\u2029]*/g, comment => " ".repeat(comment.length));

const anchor=(range,source)=>exact(range,['start','end'])&&Number.isSafeInteger(range.start)
  && Number.isSafeInteger(range.end)&&range.start>=0&&range.start<range.end&&range.end<=source.content.length;

/** Independently verify module ownership before body verification or pruning. */
export function verifyModuleHir(hir,fail) {
  const sources=new Map(),modules=new Map(),globals=new Map(),hosts=new Map(),definitions=new Map();
  const scope=hir.inputScope;
  if(!scope?.compilationClosure || canonical(normalizeClosure(scope.compilationClosure))!==canonical({
    roots:hir.closure.roots.map(({kind,sourcePath,name})=>({kind,sourcePath,name})),requiredRoots:hir.closure.requiredRoots}))fail();
  for(const source of hir.sources??[]) {
    if(!exact(source,['path','content','hash'])||typeof source.path!=='string'||!source.path.startsWith('/')
      ||!source.path.endsWith('.ts')||/[\\:\0]/.test(source.path)||source.path.slice(1).split('/').some(p=>!p||p==='.'||p==='..')
      ||typeof source.content!=='string'||!source.content.isWellFormed()||source.hash!==sha256(source.content)||sources.has(source.path)
      ||scope.files.find(file=>file.path===source.path)?.content!==source.content)fail();
    sources.set(source.path,source);
  }
  if(!sources.size||canonical(sources.get(hir.source.path))!==canonical(hir.source))fail();
  for(const module of hir.modules??[]) {
    if(!exact(module,['id','sourcePath','external','imports','dependencies','initializer','exports','bindings'])
      ||module.id!==moduleIdentity(module.sourcePath)||!sources.has(module.sourcePath)||module.sourcePath.endsWith('.d.ts')
      ||modules.has(module.sourcePath)||module.initializer!==initializerIdentity(module.sourcePath,sources.get(module.sourcePath)?.hash)
      ||typeof module.external!=='boolean'||sourceIsExternal(sources.get(module.sourcePath).content)!==module.external
      ||!Array.isArray(module.imports)||!Array.isArray(module.dependencies)||new Set(module.dependencies).size!==module.dependencies.length
      ||!Array.isArray(module.exports)||!Array.isArray(module.bindings))fail();
    modules.set(module.sourcePath,module);
  }
  if(modules.size!==[...sources.keys()].filter(p=>!p.endsWith('.d.ts')).length)fail();
  if(scope.files.some(file=>!file.path.endsWith('.d.ts')&&!modules.has(file.path)))fail();
  for(const global of hir.globals??[]) {
    if(!exact(global,['id','sourcePath','name','bindingKind','type','writable','range'])||!modules.has(global.sourcePath)
      ||typeof global.name!=='string'||!global.name||!['source','default-export-expression'].includes(global.bindingKind)
      ||!anchor(global.range,sources.get(global.sourcePath))
      ||global.id!==(global.bindingKind==='default-export-expression'
        ? defaultBindingIdentity(global.sourcePath,sources.get(global.sourcePath).hash,scalarName(global.type),global.range)
        : globalIdentity(global.sourcePath,global.name,scalarName(global.type)))
      ||!Object.values(scalarTypeIds).includes(global.type)||typeof global.writable!=='boolean'
      ||!anchor(global.range,sources.get(global.sourcePath))||globals.has(global.id))fail();
    globals.set(global.id,global);definitions.set(global.id,global);
  }
  for(const module of modules.values()) {
    const generated=[...globals.values()].filter(global=>global.sourcePath===module.sourcePath && global.bindingKind==='default-export-expression');
    if(generated.length>1 || generated.some(global=>global.writable
      ||!module.exports.some(binding=>binding.name==='default' && binding.target===global.id)))fail();
  }
  for(const host of hir.hostImports??[]) {
    const configured=(scope.hostImports??[]).find(row=>row.sourcePath===host.sourcePath && row.name===host.name);
    if(!exact(host,['id','sourcePath','name','capabilityId','signatureHash','parameterTypes','returnType','range'])
      ||!sources.has(host.sourcePath)||!host.sourcePath.endsWith('.d.ts')||typeof host.name!=='string'||!host.name
      ||host.id!==hostIdentity(host.sourcePath,host.name)||host.capabilityId!==31
      ||host.signatureHash!==signatureHash('i32',['i32'])||canonical(host.parameterTypes)!==canonical([scalarTypeIds.i32])
      ||host.returnType!==scalarTypeIds.i32||!anchor(host.range,sources.get(host.sourcePath))||hosts.has(host.id)
      ||!configured||configured.capabilityId!==host.capabilityId||configured.returnType!=='i32'||canonical(configured.parameterTypes)!=='["i32"]')fail();
    hosts.set(host.id,host);definitions.set(host.id,host);
  }
  if(hosts.size!==(scope.hostImports??[]).length)fail();
  const association=new Map();
  for(const fn of hir.functions) {
    if(!modules.has(fn.sourcePath)||!['source','module-initialization'].includes(fn.kind))fail();
    if(fn.kind==='module-initialization') {
      const module=modules.get(fn.sourcePath);
      if(fn.id!==module.initializer||fn.name!=='$moduleInit'||fn.returnType?.id!==scalarTypeIds.i32
        ||fn.parameters.length||association.has(fn.sourcePath)||fn.range.start!==0
        ||fn.range.end!==sources.get(fn.sourcePath).content.length)fail();
      association.set(fn.sourcePath,fn.id);
    }
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
  verifyModuleSources(hir,{sources,modules,globals,hosts},fail);
  const expected=compilationClosure({modules:hir.modules,functions:hir.functions,globals:hir.globals,configuration:{roots:hir.closure.roots.map(({kind,sourcePath,name})=>({kind,sourcePath,name})),requiredRoots:hir.closure.requiredRoots}});
  if(canonical(expected)!==canonical(hir.closure))fail();
  return {sources,modules,globals,hosts,views};
}
