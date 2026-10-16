// SPDX-License-Identifier: MIT
import { i32TypeId, boolTypeId, scalarName } from './identity.mjs';
import { scalarOperations as operations } from './module-hir.mjs';
import { floatNames } from './float.mjs';

const floatType = id => floatNames.includes(scalarName(id));

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
  const quote = text => JSON.stringify(text).replace(/\\u([0-9a-f]{4})/g, (_, hex) => {
    const code = Number.parseInt(hex, 16);
    return code < 128 ? `\\${hex.slice(2)}` : String.fromCharCode(code);
  });
  const strings = { input_identity: verified.inputIdentity, source_hash: verified.source.hash,
    source_path: verified.source.path,
    target: verified.target.target, triple: verified.target.triple, data_layout: verified.target.llvmDataLayout,
    bytecode_schema: view.exchange.bytecodeSchema };
  const attrs = [`tsfg_core.version = ${quote(view.exchange.version)}`, ...Object.entries(strings)
    .map(([key, item]) => `tsfg_core.${key} = ${quote(item)}`),
    `tsfg_core.source_length = ${verified.source.length} : i64`];
  const state=view.moduleState;
  const moduleMode=!!state;
  const emittedFunctions=moduleMode?verified.functions.filter(fn=>state.closure.functions.includes(fn.id)):verified.functions;
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
