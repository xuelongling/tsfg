// SPDX-License-Identifier: MIT
import { presenceEncoding } from "./presence.mjs";
import { emitCoreSsaFunction, coreQuote as quote } from './core-ssa-emitter.mjs';

// Internal emitter seam. Each public lowering entry validates its own owned
// representation before providing this view. Source text, Snapshot references,
// registry defaults and implicit exchange identities never enter this module.
// view: {exchange:{version,bytecodeSchema},inputIdentity,source:{path,hash,length},
// target,functions:[typedFunction+symbol],moduleState?:{sources:[{path,hash,length}],
// modules,globals,hostImports,closure}}. Preserve input and attribute ordering.
export function emitScalarCore(view) {
  // Binding updates select new SSA definitions; each initializer/RHS is emitted
  // once in statement order. Reads reuse that definition, never reevaluate it.
  const verified = view;
  const strings = { input_identity: verified.inputIdentity, source_hash: verified.source.hash,
    source_path: verified.source.path,
    target: verified.target.target, triple: verified.target.triple, data_layout: verified.target.llvmDataLayout,
    bytecode_schema: view.exchange.bytecodeSchema };
  const attrs = [`tsfg_core.version = ${quote(view.exchange.version)}`, ...Object.entries(strings)
    .map(([key, item]) => `tsfg_core.${key} = ${quote(item)}`),
    `tsfg_core.source_length = ${verified.source.length} : i64`];
  const state=view.moduleState;
  const moduleMode=!!state;
  const emittedFunctions=moduleMode && view.functionSelection !== 'complete-original-universe'
    ? verified.functions.filter(fn=>state.closure.functions.includes(fn.id)) : verified.functions;
  const functionSymbol=fn=>fn.symbol;
  const dictionary=fields=>`{${Object.entries(fields).map(([name,value])=>`${name} = ${value}`).join(', ')}}`;
  const integer=value=>`${value} : i64`,array=values=>`[${values.join(', ')}]`;
  const sourceIndex=path=>state.sources.findIndex(source=>source.path===path);
  const emittedModules=(state?.modules??[]).filter(module=>state.closure.modules.includes(module.id));
  const emittedGlobals=(state?.globals??[]).filter(global=>emittedModules.some(module=>module.sourcePath===global.sourcePath));
  const usedHosts=new Set();
  const collectHosts=value=>{if(value&&typeof value==='object'){if(value.kind==='host')usedHosts.add(value.target);for(const nested of Object.values(value))collectHosts(nested);}};
  emittedFunctions.forEach(fn=>collectHosts(fn.body));
  const emittedHosts=(state?.hostImports??[]).filter(host=>usedHosts.has(host.id));
  if(moduleMode) {
    attrs.push(`tsfg_core.sources = ${array(state.sources.map(source=>dictionary({path:quote(source.path),hash:quote(source.hash),length:integer(source.length)})))}`);
    attrs.push(`tsfg_core.modules = ${array(emittedModules.map(module=>dictionary({id:quote(module.id),source:integer(sourceIndex(module.sourcePath)),
      initializer:integer(emittedFunctions.findIndex(fn=>fn.id===module.initializer)),dependencies:array(module.dependencies.map(path=>integer(emittedModules.findIndex(owner=>owner.sourcePath===path))))})))}`);
    attrs.push(`tsfg_core.globals = ${array(emittedGlobals.map(global=>dictionary({id:quote(global.id),source:integer(sourceIndex(global.sourcePath)),name:quote(global.name),
      binding_kind:quote(global.bindingKind),type:quote(global.type),writable:global.writable?'true':'false',start:integer(global.range.start),end:integer(global.range.end)})))}`);
    attrs.push(`tsfg_core.hosts = ${array(emittedHosts.map(host=>dictionary({id:quote(host.id),source:integer(sourceIndex(host.sourcePath)),name:quote(host.name),
      capability:integer(host.capabilityId),signature:quote(host.signatureHash),start:integer(host.range.start),end:integer(host.range.end)})))}`);
    attrs.push(`tsfg_core.roots = ${array(state.closure.roots.map(root=>dictionary({kind:quote(root.kind),source:integer(sourceIndex(root.sourcePath)),name:quote(root.name),
      function:integer(emittedFunctions.findIndex(fn=>fn.id===root.target))})))}`);
    attrs.push(`tsfg_core.initialization = ${array(state.closure.initialization.map(id=>integer(emittedFunctions.findIndex(fn=>fn.id===id))))}`);
  }
  const lowerFunction = fn => {
  const core = emitCoreSsaFunction(fn, { verified, emittedGlobals, emittedHosts, functionSymbol });
  const type = core.resultType, text = core.blocksText, coreTypeFor = core.coreType;
  const functionAttrs = `tsfg_core.function_id = ${quote(fn.id)}, tsfg_core.signature_hash = ${quote(fn.signatureHash)}, tsfg_core.type_id = ${quote(fn.returnType.id)}, tsfg_core.function_start = ${fn.range.start} : i64, tsfg_core.function_end = ${fn.range.end} : i64`
    +(fn.parameterInitializers !== undefined ? `, tsfg_core.parameter_presence = ${quote(presenceEncoding(fn.parameters))}` : "")
    +(moduleMode?`, tsfg_core.logical_name = ${quote(fn.name)}, tsfg_core.source_index = ${sourceIndex(fn.sourcePath)} : i64, tsfg_core.initializer = ${fn.kind==='module-initialization'?'true':'false'}`:'');
  return `  func.func @${quote(functionSymbol(fn))}(${core.entryParameters.map(p => `${p.name}: ${coreTypeFor(p.type)}`).join(", ")}) -> ${type} attributes {${functionAttrs}} {\n${text}\n  }`;
  };
  return `module attributes {${attrs.join(", ")}} {\n${emittedFunctions.map(lowerFunction).join("\n")}\n}\n`;
}
