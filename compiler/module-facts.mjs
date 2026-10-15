// SPDX-License-Identifier: MIT
import path from "node:path";
import { canonical } from "./identity.mjs";
import { normalizeClosure } from "./modules.mjs";

const exact = (value,names) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join(",") === [...names].sort().join(",");
const fail = () => { throw new TypeError("r03-module-facts: owned module/source/binding facts differ"); };
const trivia = text => text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n\u2028\u2029]*/g," ");

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
        || typeof module.external !== "boolean" || !Array.isArray(module.imports) || !Array.isArray(module.globals)
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
      const logical = path.posix.normalize(path.posix.join(path.posix.dirname(module.sourcePath),imp.specifier));
      const candidates=[logical,`${logical}.ts`,`${logical}/index.ts`,logical.replace(/\.js$/, ".ts")];
      if (!candidates.includes(imp.sourcePath)) fail();
      for (const binding of imp.bindings) {
        const symbol=symbols.get(binding.target);
        if (!exact(binding,["name","target","range"]) || !symbol
            || visible.has(binding.name) && visible.get(binding.name)!==binding.target
            || !["function","global"].includes(symbol.kind)
            || ![...exports.get(imp.sourcePath).values()].includes(binding.target)
            || !validRange(binding.range,source)
            || !binding.name.includes(".") && (binding.range.start<imp.range.start || binding.range.end>imp.range.end)
            || binding.name.includes(".") && !/^[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*\s*\.\s*[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*$/u.test(trivia(binding.name))
            || source.slice(binding.range.start,binding.range.end).trim()!==binding.name) fail();
        if (binding.name.includes(".")) {
          const [namespace,member]=trivia(binding.name).split(".").map(part=>part.trim());
          const prefix=anchor.slice(0,anchor.indexOf("from"));
          if (prefix.match(/\*\s+as\s+([^\s,{}]+)\s*$/)?.[1]!==namespace
              || exports.get(imp.sourcePath).get(member)!==binding.target) fail();
        } else {
          const prefix=trivia(source.slice(imp.range.start,binding.range.start));
          const imported=prefix.match(/(?:\{|,)\s*([^\s{},]+)\s+as\s*$/)?.[1]
            ?? (prefix.includes("{") ? binding.name : "default");
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
