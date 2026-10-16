// SPDX-License-Identifier: MIT
import { validateFrontendSnapshot, resolveType, resolveSymbol } from './frontend.mjs';
import { validateModuleFacts, sourceTrivia } from './module-facts.mjs';
import { verifyHir, KernelHostSemanticError, scalarOperations as operations } from './module-hir.mjs';
import { moduleIdentity, globalIdentity, defaultBindingIdentity, compilationClosure, initializerIdentity, hostIdentity } from './modules.mjs';
import { canonical, functionIdentity, signatureHash, i32TypeId, boolTypeId, scalarTypeIds, scalarName, sha256 } from './identity.mjs';
import registry from '../contracts/registry.json' with {type:'json'};
import bytecodeSchema from '../contracts/bytecode.schema.json' with {type:'json'};
import { floatNames } from './float.mjs';

export { verifyHir };
const contract = () => registry['tsfg.hir'];
const types = scalarTypeIds;
const floatType = id => floatNames.includes(scalarName(id));

export function buildHir(snapshot) {
  try { validateFrontendSnapshot(snapshot); }
  catch (error) { return { status: "error", diagnostics: [{ code: "r03-d-snapshot", ruleId: "r01-input-boundary", phase: "hir", message: error.message }] }; }
  const first = snapshot.functions[0], expression = first?.body?.find(item => item.expression)?.expression;
  const moduleFacts=snapshot.modules?validateModuleFacts(snapshot):undefined;
  if (!moduleFacts && snapshot.functions.length < 1 || snapshot.functions.length > 128 || snapshot.functions.some(fn => fn.parameters.length > 64
      || !Object.hasOwn(types, resolveType(snapshot, fn.returnTypeRef).scalar)
      || snapshot.capability !== "minimal-floats-v4" && (floatNames.includes(fn.returnType) || fn.parameters.some(p => floatNames.includes(p.type)))
      || fn.parameters.some(parameter => !types[parameter.type]) || fn.body.length < 1 || fn.body.length > 128)) {
    return { status: "error", diagnostics: [{ code: "r03-d-capability", ruleId: "r01-ts-baseline", phase: "hir",
      message: "current execution capability requires nominal integer/bool functions with direct calls, locals, structured control and returns",
      primary: { sourceId: snapshot.source.path, ...(expression?.range ?? first?.range ?? { start: 0, end: 0 }) } }] };
  }
  const globals=(snapshot.symbols.filter(symbol=>symbol.kind==='global')).map(symbol=>({id:symbol.bindingKind==='default-export-expression'
    ? defaultBindingIdentity(symbol.sourcePath,sha256(snapshot.sources.find(source=>source.path===symbol.sourcePath).content),symbol.type,symbol.range)
    : globalIdentity(symbol.sourcePath,symbol.name,symbol.type),
    sourcePath:symbol.sourcePath,name:symbol.name,bindingKind:symbol.bindingKind,type:types[symbol.type],writable:symbol.writable,range:symbol.range}));
  const globalBySymbol=new Map(snapshot.symbols.filter(symbol=>symbol.kind==='global').map((symbol,index)=>[symbol.id,globals[index]]));
  const hosts=(snapshot.hostImports??[]).map(host=>({id:hostIdentity(host.sourcePath,host.name),sourcePath:host.sourcePath,name:host.name,
    capabilityId:host.capabilityId,signatureHash:signatureHash(host.returnType,host.parameterTypes),parameterTypes:host.parameterTypes.map(type=>types[type]),returnType:types[host.returnType],range:host.range}));
  const hostBySymbol=new Map((snapshot.hostImports??[]).map((host,index)=>[host.symbol,hosts[index]]));
  const functions = new Map(snapshot.functions.map(fn => [fn.symbol.id, {
    id: functionIdentity(moduleFacts?fn.sourcePath:snapshot.source.path, fn.name, fn.returnType, fn.parameters.map(p => p.type)), name: fn.name,
    signatureHash: signatureHash(fn.returnType, fn.parameters.map(p => p.type)),
    returnType: { kind: "scalar", name: fn.returnType, id: types[fn.returnType] },
    parameters: fn.parameters.map((p,index) => ({id:`p${index}`,name:p.name,type:types[p.type],writable:true,range:p.range})),
    range: fn.range,
    ...(moduleFacts?{sourcePath:fn.sourcePath,kind:'source'}:{}),
  }]));
  const projectedFunctions = [];
  const initializers=(snapshot.modules??[]).map(module=>({sourcePath:module.sourcePath,name:'$moduleInit',kind:'module-initialization',parameters:[],body:module.initialization,
    range:{start:0,end:moduleFacts.sources.get(module.sourcePath).content.length}}));
  for (const fn of [...snapshot.functions,...initializers]) {
  const descriptor = fn.kind==='module-initialization'?{id:initializerIdentity(fn.sourcePath,sha256(moduleFacts.sources.get(fn.sourcePath).content)),name:'$moduleInit',kind:fn.kind,sourcePath:fn.sourcePath,
    signatureHash:signatureHash('i32',[]),returnType:{kind:'scalar',name:'i32',id:i32TypeId},parameters:[],range:fn.range}:functions.get(fn.symbol.id);
  const source=moduleFacts?.sources.get(fn.sourcePath)??snapshot.source;
  const bindings = new Map();
  fn.parameters.forEach((p,index) => bindings.set(p.id, descriptor.parameters[index]));
  const project = (value, parentRange) => {
    const type = types[resolveType(snapshot, value.typeRef).scalar];
    if (!type) throw new TypeError("unsupported expression type");
    let projectedRange = value.range;
    if (value.kind === "call" && parentRange && value.range.start < parentRange.start
        && sourceTrivia(source.content, value.range.start, parentRange.start).trim() === "") {
      projectedRange = { ...value.range, start: parentRange.start };
    }
    const common = { type, range: projectedRange };
    if (value.kind === "reference") {
      const symbol = resolveSymbol(snapshot, value.symbol), binding = bindings.get(symbol.id);
      const global=globalBySymbol.get(symbol.id);
      if(global)return {kind:'global',...common,global:global.id,name:value.name};
      if (!binding) throw new TypeError("local reference has no preceding owned declaration");
      return { kind: "reference", ...common, binding: binding.id };
    }
    if (value.kind === "call") {
      const symbol=resolveSymbol(snapshot,value.target),target = functions.get(symbol.id)??hostBySymbol.get(symbol.id);
      if (!target) throw new TypeError("call target is outside owned function closure");
      return {kind:hostBySymbol.has(symbol.id)?'host':"call",...common,target:target.id,signatureHash:target.signatureHash,
        ...(moduleFacts?{name:value.name}:{}),arguments:value.arguments.map(argument => project(argument, common.range))};
    }
    if (value.kind === "integer") return { kind: "constant", ...common, decimal: value.literal.decimal, token: value.literal.token };
    if (value.kind === "floating") return { kind: "floating", ...common, bits: value.float.bits, token: value.float.token };
    if (value.kind === "boolean") return { kind: "boolean", ...common, value: value.boolean };
    if (value.kind === "group") return { kind: "group", ...common, operand: project(value.operand, common.range) };
    if (value.kind === "unary" && ["+", "-", "~", "!"].includes(value.operator))
      return { kind: "unary", ...common, operator: value.operator, operand: project(value.operand, common.range) };
    if (value.kind === "binary" && Object.hasOwn(operations, value.operator)
        || value.kind === "shortCircuit" && ["&&", "||"].includes(value.operator))
      return { kind: value.kind, ...common, operator: value.operator, left: project(value.left, common.range), right: project(value.right, common.range) };
    throw new TypeError("unsupported checked expression capability");
  };
  let projected;
  const statements = items => (items ?? []).map(item => {
    if(item.kind==='initialize') {
      const global=globalBySymbol.get(item.symbol.id);
      if(!global||fn.kind!=='module-initialization')throw new TypeError('invalid module initialization ownership');
      return {kind:'initialize',global:global.id,range:item.range,value:project(item.initializer,item.range)};
    }
    if(item.kind==='expression')return {kind:'expression',range:item.range,value:project(item.expression,item.range)};
    if (item.kind === "variable") {
      const symbol = resolveSymbol(snapshot, item.symbol.ref), type = types[symbol.type];
      if (symbol.kind !== "local" || !type) throw new TypeError("unsupported local type");
      const initializer = item.initializer ? project(item.initializer, item.range) : null;
      const binding = { id: `l${bindings.size - fn.parameters.length}`, name: symbol.name, type, writable: symbol.writable, range: symbol.range };
      bindings.set(symbol.id, binding);
      return { kind: "local", range: item.range, binding, initializer };
    }
    if (item.kind === "assignment") return { kind: "assign", range: item.range, target: project(item.target, item.range), value: project(item.value, item.range) };
    if (item.kind === "block") return { kind: "block", range: item.range, body: statements(item.body) };
    if (item.kind === "while") return { kind: "while", range: item.range, condition: project(item.condition, item.range), body: statements(item.body) };
    if (item.kind === "if") return { kind: "if", range: item.range, condition: project(item.condition, item.range),
      thenBody: statements(item.thenBody), elseBody: statements(item.elseBody) };
    if (item.kind === "return") return { kind: "return", range: item.range, value: project(item.expression, item.range) };
    throw new TypeError("unsupported checked statement capability");
  });
  try { projected = statements(fn.body); } catch (error) {
    return { status: "error", diagnostics: [{ code: "r03-d-capability", ruleId: "r01-ts-baseline", phase: "hir", message: error.message,
      primary: { sourceId: snapshot.source.path, ...(expression?.range ?? fn.range) } }] };
  }
  projectedFunctions.push({...descriptor,body:projected});
  }
  const hir = {
    contractVersion: contract().semver, schemaHash: contract().schemaHash, inputIdentity: snapshot.inputIdentity,
    source: { ...snapshot.source, hash: sha256(snapshot.source.content) }, target: bytecodeSchema.target,
    functions: projectedFunctions,
  };
  if(moduleFacts) {
    const ownedId=id=>functions.get(id)?.id??globalBySymbol.get(id)?.id??hostBySymbol.get(id)?.id;
    hir.sources=[...moduleFacts.sources.values()].map(source=>({...source,hash:sha256(source.content)}));
    hir.globals=globals;hir.hostImports=hosts;
    hir.modules=snapshot.modules.map(module=>({id:moduleIdentity(module.sourcePath),sourcePath:module.sourcePath,
      dependencies:[...new Set(module.imports.map(imp=>imp.sourcePath))],initializer:initializerIdentity(module.sourcePath,sha256(moduleFacts.sources.get(module.sourcePath).content)),
      exports:module.exports.map(binding=>({name:binding.name,target:ownedId(binding.target)})),
      bindings:[...moduleFacts.views.get(module.sourcePath)].map(([name,id])=>({name,target:ownedId(id)}))}));
    try{hir.closure=compilationClosure({modules:hir.modules,functions:projectedFunctions,globals,configuration:snapshot.compilationClosure});}
    catch(error){return {status:'error',diagnostics:[{code:error.code??'r03-d-closure-dependency',ruleId:error.ruleId??'r01-compilation-closure',phase:'hir',message:error.message,primary:error.primary}]};}
  }
  try { return { status: "ok", hir: verifyHir(hir) }; }
  catch (error) {
    if (error instanceof KernelHostSemanticError) return { status: "error", diagnostics: [{
      code: error.code, ruleId: error.ruleId, phase: error.phase, message: error.message, primary: error.primary,
    }] };
    return { status: "error", diagnostics: [{ code: "r03-d-snapshot", ruleId: "r01-input-boundary", phase: "hir", message: error.message,
      primary: { sourceId: snapshot.source.path, ...(expression?.range ?? first?.range ?? {start:0,end:0}) } }] };
  }
}
export const printHir = hir => `${canonical(verifyHir(hir))}\n`;
export function readHir(bytes) {
  let text, value;
  try {
    // Preserve a leading BOM so JSON rejects its noncanonical wire bytes.
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    value = JSON.parse(text);
  } catch (error) {
    throw new TypeError("r03-hir-invalid: HIR must contain valid UTF-8 JSON", { cause: error });
  }
  const hir = verifyHir(value);
  if (text !== printHir(hir)) throw new TypeError("r03-hir-canonical: HIR must use its canonical serialization");
  return hir;
}

export function lowerHir(hir) {
  // Binding updates select new SSA definitions; each initializer/RHS is emitted
  // once in statement order. Reads reuse that definition, never reevaluate it.
  const verified = verifyHir(hir);
  const quote = text => JSON.stringify(text).replace(/\\u([0-9a-f]{4})/g, (_, hex) => {
    const code = Number.parseInt(hex, 16);
    return code < 128 ? `\\${hex.slice(2)}` : String.fromCharCode(code);
  });
  const strings = { input_identity: verified.inputIdentity, source_hash: verified.source.hash,
    source_path: verified.source.path,
    target: verified.target.target, triple: verified.target.triple, data_layout: verified.target.llvmDataLayout,
    bytecode_schema: registry["tsfg.bytecode"].schemaHash };
  const attrs = [`tsfg_core.version = ${quote(contract().semver)}`, ...Object.entries(strings)
    .map(([key, item]) => `tsfg_core.${key} = ${quote(item)}`),
    `tsfg_core.source_length = ${verified.source.content.length} : i64`];
  const moduleMode=!!verified.modules;
  const emittedFunctions=moduleMode?verified.functions.filter(fn=>verified.closure.functions.includes(fn.id)):verified.functions;
  const functionSymbol=fn=>moduleMode?`f${fn.id.slice(7)}`:fn.name;
  const dictionary=fields=>`{${Object.entries(fields).map(([name,value])=>`${name} = ${value}`).join(', ')}}`;
  const integer=value=>`${value} : i64`,array=values=>`[${values.join(', ')}]`;
  const sourceIndex=path=>verified.sources.findIndex(source=>source.path===path);
  const emittedModules=(verified.modules??[]).filter(module=>verified.closure.modules.includes(module.id));
  const emittedGlobals=(verified.globals??[]).filter(global=>emittedModules.some(module=>module.sourcePath===global.sourcePath));
  const usedHosts=new Set();
  const collectHosts=value=>{if(value&&typeof value==='object'){if(value.kind==='host')usedHosts.add(value.target);for(const nested of Object.values(value))collectHosts(nested);}};
  emittedFunctions.forEach(fn=>collectHosts(fn.body));
  const emittedHosts=(verified.hostImports??[]).filter(host=>usedHosts.has(host.id));
  if(moduleMode) {
    attrs.push(`tsfg_core.sources = ${array(verified.sources.map(source=>dictionary({path:quote(source.path),hash:quote(source.hash),length:integer(source.content.length)})))}`);
    attrs.push(`tsfg_core.modules = ${array(emittedModules.map(module=>dictionary({id:quote(module.id),source:integer(sourceIndex(module.sourcePath)),
      initializer:integer(emittedFunctions.findIndex(fn=>fn.id===module.initializer)),dependencies:array(module.dependencies.map(path=>integer(emittedModules.findIndex(owner=>owner.sourcePath===path))))})))}`);
    attrs.push(`tsfg_core.globals = ${array(emittedGlobals.map(global=>dictionary({id:quote(global.id),source:integer(sourceIndex(global.sourcePath)),name:quote(global.name),
      binding_kind:quote(global.bindingKind),type:quote(global.type),writable:global.writable?'true':'false',start:integer(global.range.start),end:integer(global.range.end)})))}`);
    attrs.push(`tsfg_core.hosts = ${array(emittedHosts.map(host=>dictionary({id:quote(host.id),source:integer(sourceIndex(host.sourcePath)),name:quote(host.name),
      capability:integer(host.capabilityId),signature:quote(host.signatureHash),start:integer(host.range.start),end:integer(host.range.end)})))}`);
    attrs.push(`tsfg_core.roots = ${array(verified.closure.roots.map(root=>dictionary({kind:quote(root.kind),source:integer(sourceIndex(root.sourcePath)),name:quote(root.name),
      function:integer(emittedFunctions.findIndex(fn=>fn.id===root.target))})))}`);
    attrs.push(`tsfg_core.initialization = ${array(verified.closure.initialization.map(id=>integer(emittedFunctions.findIndex(fn=>fn.id===id))))}`);
  }
  const lowerFunction = fn => {
  const blocks = [], bindingTypes = new Map();
  let valueIndex = 0, current, definitions = new Map(), declared = new Set();
  const coreType = type => type === i32TypeId ? "i32" : type === boolTypeId ? "i1" : floatType(type) ? scalarName(type) : `!tsfg_core.integer<${quote(scalarName(type))}>`;
  const newBlock = (parameterTypes = []) => {
    const block = { name: `bb${blocks.length}`, parameters: parameterTypes.map(type => ({ name: `%v${valueIndex++}`, type })), lines: [], terminated: false };
    blocks.push(block); return block;
  };
  const attrsFor = anchor => `tsfg_source.start = ${anchor.start} : i64, tsfg_source.end = ${anchor.end} : i64`;
  const edge = (block, values = []) => `^${block.name}${values.length ? `(${values.join(", ")} : ${block.parameters.map(p => coreType(p.type)).join(", ")})` : ""}`;
  const branch = (block, values, anchor) => {
    current.lines.push(`    cf.br ${edge(block, values)} {${attrsFor(anchor)}}`);
    current.terminated = true;
  };
  const conditional = (condition, left, right, anchor) => {
    current.lines.push(`    cf.cond_br ${condition}, ${edge(left)}, ${edge(right)} {${attrsFor(anchor)}}`);
    current.terminated = true;
  };
  const fuel = (event, anchor) => current.lines.push(`    "tsfg_core.fuel"() {event = ${event} : i32, ${attrsFor(anchor)}} : () -> ()`);
  current = newBlock(fn.parameters.map(parameter => parameter.type));
  fn.parameters.forEach((parameter,index) => {
    definitions.set(parameter.id,current.parameters[index].name); declared.add(parameter.id);
    bindingTypes.set(parameter.id,parameter.type);
  });
  if(fn.kind!=='module-initialization')fuel(1, fn.range);
  const emit = expression => {
    if (expression.kind === "reference") return definitions.get(expression.binding);
    if(expression.kind==='global') {
      const name=`%v${valueIndex++}`,index=emittedGlobals.findIndex(global=>global.id===expression.global);
      current.lines.push(`    ${name} = "tsfg_core.global_load"() {global = ${index} : i64, ${attrsFor(expression.range)}} : () -> ${coreType(expression.type)}`);
      return name;
    }
    if(expression.kind==='host') {
      const operands=expression.arguments.map(emit),name=`%v${valueIndex++}`,index=emittedHosts.findIndex(host=>host.id===expression.target);
      current.lines.push(`    ${name} = "tsfg_core.authorized_host"(${operands.join(', ')}) {host = ${index} : i64, ${attrsFor(expression.range)}} : (i32) -> i32`);
      return name;
    }
    if (expression.kind === "call") {
      const operands = expression.arguments.map(emit), target = verified.functions.find(fn => fn.id === expression.target);
      const name = `%v${valueIndex++}`;
      current.lines.push(`    ${name} = "func.call"(${operands.join(", ")}) {callee = @${quote(functionSymbol(target))}, tsfg_core.function_id = ${quote(target.id)}, tsfg_core.signature_hash = ${quote(target.signatureHash)}, ${attrsFor(expression.range)}} : (${expression.arguments.map(argument => coreType(argument.type)).join(", ")}) -> ${coreType(expression.type)}`);
      return name;
    }
    if (expression.kind === "group" || expression.kind === "unary" && expression.operator === "+" && !floatType(expression.type)) return emit(expression.operand);
    if (expression.kind === "shortCircuit") {
      const left = emit(expression.left);
      const rhs = newBlock(), shortcut = newBlock(), join = newBlock([boolTypeId]);
      conditional(left, expression.operator === "&&" ? rhs : shortcut, expression.operator === "&&" ? shortcut : rhs, expression.range);
      current = shortcut; branch(join, [left], expression.range);
      current = rhs; const right = emit(expression.right); branch(join, [right], expression.range);
      current = join; return join.parameters[0].name;
    }
    const operands = expression.kind === "binary" ? [emit(expression.left), emit(expression.right)]
      : expression.kind === "unary" ? [emit(expression.operand)] : [];
    const name = `%v${valueIndex++}`, type = coreType(expression.type);
    const constant = ["constant", "boolean", "floating"].includes(expression.kind);
    const op = constant ? "constant" : expression.kind === "binary" ? operations[expression.operator]
      : ({ "+": "pos", "-": "neg", "~": "not", "!": "bool_not" })[expression.operator];
    const valueAttr = expression.kind === "floating" ? `value = ${quote(expression.bits)}, ` : constant ? expression.kind === "constant" && expression.type !== i32TypeId
      ? `value = ${quote(expression.decimal)}, `
      : `value = ${expression.kind === "constant" ? expression.decimal : Number(expression.value)} : ${type}, ` : "";
    const operandTypes = expression.kind === "binary" ? [expression.left.type, expression.right.type]
      : expression.kind === "unary" ? [expression.operand.type] : [];
    current.lines.push(`    ${name} = "tsfg_core.${op}"(${operands.join(", ")}) {${valueAttr}${attrsFor(expression.range)}} : (${operandTypes.map(coreType).join(", ")}) -> ${type}`);
    return name;
  };
  const emitBody = statements => {
    for (const statement of statements) {
      if (!current) break;
      if (statement.kind === "local") {
        bindingTypes.set(statement.binding.id, statement.binding.type);
        declared.add(statement.binding.id);
        if (statement.initializer) definitions.set(statement.binding.id, emit(statement.initializer));
      } else if(statement.kind==='initialize'||statement.kind==='assign'&&statement.target.kind==='global') {
        const value=emit(statement.value),global=statement.kind==='initialize'?statement.global:statement.target.global;
        const descriptor=emittedGlobals.find(item=>item.id===global),index=emittedGlobals.indexOf(descriptor);
        current.lines.push(`    "tsfg_core.global_store"(${value}) {global = ${index} : i64, initialize = ${statement.kind==='initialize'?'true':'false'}, ${attrsFor(statement.range)}} : (${coreType(descriptor.type)}) -> ()`);
      } else if (statement.kind === "assign") definitions.set(statement.target.binding, emit(statement.value));
      else if(statement.kind==='expression')emit(statement.value);
      else if (statement.kind === "return") {
        const result = emit(statement.value), type = coreType(fn.returnType.id);
        current.lines.push(`    "func.return"(${result}) {${attrsFor(statement.range)}} : (${type}) -> ()`);
        current.terminated = true; current = null;
      } else if (statement.kind === "block") {
        const outer = new Set(declared);
        emitBody(statement.body);
        definitions = new Map([...definitions].filter(([id]) => outer.has(id)));
        declared = outer;
      } else if (statement.kind === "if") {
        const condition = emit(statement.condition), outer = new Map(definitions), outerDeclared = new Set(declared);
        const yes = newBlock(), no = newBlock();
        conditional(condition, yes, no, statement.condition.range);
        current = yes; definitions = new Map(outer); emitBody(statement.thenBody);
        const yesExit = current, yesDefinitions = new Map(definitions);
        current = no; definitions = new Map(outer); declared = new Set(outerDeclared); emitBody(statement.elseBody);
        const noExit = current, noDefinitions = new Map(definitions);
        const keys = [...outerDeclared].filter(id => (!yesExit || yesDefinitions.has(id)) && (!noExit || noDefinitions.has(id)));
        if (yesExit || noExit) {
          const join = newBlock(keys.map(id => bindingTypes.get(id)));
          if (yesExit) { current = yesExit; branch(join, keys.map(id => yesDefinitions.get(id)), statement.range); }
          if (noExit) { current = noExit; branch(join, keys.map(id => noDefinitions.get(id)), statement.range); }
          current = join; definitions = new Map(keys.map((id, index) => [id, join.parameters[index].name]));
        } else { current = null; definitions = outer; }
        declared = outerDeclared;
      } else if (statement.kind === "while") {
        const outer = new Map(definitions), outerDeclared = new Set(declared), keys = [...outer.keys()];
        const header = newBlock(keys.map(id => bindingTypes.get(id)));
        branch(header, keys.map(id => outer.get(id)), statement.condition.range);
        current = header; definitions = new Map(keys.map((id, index) => [id, header.parameters[index].name]));
        fuel(2, statement.condition.range);
        const condition = emit(statement.condition), incoming = new Map(definitions);
        const loop = newBlock(), exit = newBlock();
        conditional(condition, loop, exit, statement.condition.range);
        current = loop; definitions = new Map(incoming); emitBody(statement.body);
        if (current) branch(header, keys.map(id => definitions.get(id)), statement.condition.range);
        current = exit; definitions = incoming; declared = outerDeclared;
      }
    }
  };
  emitBody(fn.body);
  if(fn.kind==='module-initialization'&&current) {
    const name=`%v${valueIndex++}`;
    current.lines.push(`    ${name} = "tsfg_core.constant"() {value = 0 : i32, ${attrsFor(fn.range)}} : () -> i32`);
    current.lines.push(`    "func.return"(${name}) {${attrsFor(fn.range)}} : (i32) -> ()`);
    current.terminated=true;current=null;
  }
  if (current || blocks.some(block => !block.terminated)) throw new TypeError("r03-hir-cfg: reachable function fallthrough");
  const type = coreType(fn.returnType.id);
  const text = blocks.map((block, index) => `${index ? `  ^${block.name}${block.parameters.length ? `(${block.parameters.map(p => `${p.name}: ${coreType(p.type)}`).join(", ")})` : ""}:\n` : ""}${block.lines.join("\n")}`).join("\n");
  const functionAttrs = `tsfg_core.function_id = ${quote(fn.id)}, tsfg_core.signature_hash = ${quote(fn.signatureHash)}, tsfg_core.type_id = ${quote(fn.returnType.id)}, tsfg_core.function_start = ${fn.range.start} : i64, tsfg_core.function_end = ${fn.range.end} : i64`
    +(moduleMode?`, tsfg_core.logical_name = ${quote(fn.name)}, tsfg_core.source_index = ${sourceIndex(fn.sourcePath)} : i64, tsfg_core.initializer = ${fn.kind==='module-initialization'?'true':'false'}`:'');
  return `  func.func @${quote(functionSymbol(fn))}(${blocks[0].parameters.map(p => `${p.name}: ${coreType(p.type)}`).join(", ")}) -> ${type} attributes {${functionAttrs}} {\n${text}\n  }`;
  };
  return `module attributes {${attrs.join(", ")}} {\n${emittedFunctions.map(lowerFunction).join("\n")}\n}\n`;
}
