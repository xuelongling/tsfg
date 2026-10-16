// SPDX-License-Identifier: MIT
import { array, record, integer, text, hash, check, same, sha256, referenceProfile,
  bindingFor, budget, readJson, referenceLimits } from './reference-common.mjs';
import { verifyReferenceForwarding } from './reference-forwarding.mjs';
import { verifyReferenceHierarchy } from './reference-hierarchy.mjs';
import { verifyReferenceBodies } from './reference-facts-body.mjs';
import { verifyReferenceTypes, scalarValueType, referenceValueType } from './reference-types.mjs';
import { referenceEnvironmentDigest, referenceAllocationKey } from './reference-provenance.mjs';
const strictKeys = ['noImplicitAny','noImplicitThis','strictBindCallApply','strictBuiltinIteratorReturn',
  'strictFunctionTypes','strictNullChecks','strictPropertyInitialization','useUnknownInCatchVariables'];
function configuration(options) {
  record(options, ['effectiveStrict','module','officialOptions','officialOptionsSha256','target','useDefineForClassFields']);
  record(options.effectiveStrict, strictKeys);
  check(strictKeys.every(key => options.effectiveStrict[key] === true), 'identity');
  check(options.target === 99 && options.module === 99 && typeof options.useDefineForClassFields === 'boolean', 'identity');
  text(options.officialOptions, 1048576); hash(options.officialOptionsSha256);
  check(sha256(options.officialOptions) === options.officialOptionsSha256, 'identity');
  // Embedded JSON is a separate allocation/recursion boundary: bound syntax,
  // depth, tokens and duplicate keys before parsing or canonical traversal.
  const raw = readJson(Buffer.from(options.officialOptions, 'utf8'), { bytes: referenceLimits.stringBytes });
  check(raw && typeof raw === 'object' && !Array.isArray(raw) && raw.strict === true && raw.noEmit === true
    && raw.noLib === true && raw.target === options.target && raw.module === options.module
    && !raw.noCheck && !raw.allowJs && !raw.skipLibCheck && !raw.skipDefaultLibCheck
    && strictKeys.every(key => raw[key] === undefined || raw[key] === true), 'identity');
}
export function verifyReferenceGraph(graph, binding) {
  budget(graph); budget(binding);
  record(graph, ['classes','options','scope','semanticProfile','sources','symbols','types']);
  record(binding, ['scope','semanticProfile','sources','options']);
  text(graph.scope, 256); check(graph.semanticProfile === referenceProfile, 'profile');
  check(same(bindingFor(graph), binding), 'binding'); configuration(graph.options);
  const sources = new Map();
  for (const source of array(graph.sources, 16)) {
    record(source, ['declaration','path','sha256','surrogateStarts','utf16Length']);
    text(source.path); hash(source.sha256); integer(source.utf16Length);
    check(source.path.startsWith('/') && !source.path.includes('\\')
      && source.path.slice(1).split('/').every(part => part && part !== '.' && part !== '..')
      && source.path.endsWith('.ts') && typeof source.declaration === 'boolean'
      && source.declaration === source.path.endsWith('.d.ts') && !sources.has(source.path), 'origin');
    let previous = -2;
    for (const start of array(source.surrogateStarts, 524288)) {
      integer(start); check(start >= previous + 2 && start + 1 < source.utf16Length, 'origin'); previous = start;
    }
    sources.set(source.path, source);
  }
  check([...sources.values()].filter(source => !source.declaration).length === 1, 'origin');
  check(graph.sources.every((source, i) => !i || graph.sources[i-1].path < source.path), 'origin');
  const origin = (anchor, parent) => {
    record(anchor, ['source','start','end']); integer(anchor.start); integer(anchor.end);
    const source = sources.get(anchor.source);
    check(source && !source.declaration && anchor.start < anchor.end && anchor.end <= source.utf16Length
      && !source.surrogateStarts.some(start => anchor.start === start + 1 || anchor.end === start + 1)
      && (!parent || anchor.source === parent.source && anchor.start >= parent.start && anchor.end <= parent.end), 'origin');
  };
  const types = new Map(), symbols = new Map(), classes = new Map(), fields = new Map(), methods = new Map();
  for (const type of array(graph.types)) {
    record(type, ['declaration','id','kind','literal','nominal','scalar','target','thisArgument']); text(type.id);
    check(!types.has(type.id), 'closure'); types.set(type.id, type);
  }
  const { primitives, leaves } = verifyReferenceTypes(types, sources);
  const environmentDigest = referenceEnvironmentDigest(graph);
  for (const symbol of array(graph.symbols)) {
    record(symbol, ['declaration','id','kind','name','type']); text(symbol.id); text(symbol.name);
    check(!symbols.has(symbol.id) && types.has(symbol.type), 'closure'); origin(symbol.declaration); symbols.set(symbol.id, symbol);
  }
  const consumedTypes = new Set(), consumedSymbols = new Set(), typeUses = new Set();
  const valueType = (id, allowVoid = false) => {
    const type = types.get(id); check(type, 'closure');
    check(scalarValueType(type) || referenceValueType(type) || allowVoid && type.kind === 'void',
      'unsupported', 'owned value slot has an unsupported type role'); typeUses.add(id);
  };
  const useType = (id, kind, declaration = '') => {
    const type = types.get(id); check(type && type.kind === kind && type.declaration === declaration
      && type.target === '' && type.thisArgument === '', 'closure'); consumedTypes.add(id);
  };
  for (const [kind, id] of primitives) useType(id, kind);
  const useSymbol = (id, kind, name, type, parent) => {
    const symbol = symbols.get(id);
    check(symbol && !consumedSymbols.has(id) && symbol.kind === kind && symbol.name === name && symbol.type === type, 'closure');
    origin(symbol.declaration, parent); consumedSymbols.add(id);
  };
  const signature = (value, owner, parent, inherited = false) => {
    record(value, ['parameters','return']); valueType(value.return, true);
    const parameters = new Map();
    for (const [index, parameter] of array(value.parameters, 4096).entries()) {
      record(parameter, ['inheritedFrom','origin','symbol','type']);
      origin(parameter.origin, inherited ? undefined : parent);
      check(inherited ? typeof parameter.inheritedFrom === 'string' && parameter.inheritedFrom.length > 0
        : parameter.inheritedFrom === '', 'forwarding');
      check(parameter.symbol === owner + '.p' + index && types.has(parameter.type), 'closure'); valueType(parameter.type);
      const symbol = symbols.get(parameter.symbol);
      useSymbol(parameter.symbol, inherited ? 'implicit-parameter' : 'parameter', symbol?.name, parameter.type, parameter.origin);
      parameters.set(parameter.symbol, parameter);
    }
    return parameters;
  };
  check(array(graph.classes, 4096).length > 0, 'closure');
  for (const [classIndex, item] of graph.classes.entries()) {
    record(item, ['base','constructor','constructorType','fields','id','instanceType','methods','name','origin','runtimeKey','symbol','thisType']);
    check(item.id === 'c' + (classIndex + 1) && !classes.has(item.id), 'closure'); text(item.name); origin(item.origin);
    check(typeof item.base === 'string', 'inheritance');
    useType(item.instanceType, 'class-instance', item.id); useType(item.constructorType, 'class-constructor', item.id);
    useType(item.thisType, 'class-this', item.id); useSymbol(item.symbol, 'class', item.name, item.constructorType, item.origin);
    hash(item.runtimeKey);
    check(item.runtimeKey === referenceAllocationKey(environmentDigest, item.origin), 'identity');
    classes.set(item.id, item);
    for (const [ordinal, field] of array(item.fields, 4096).entries()) {
      record(field, ['access','definiteAssertion','id','initializer','initializerCompatibility','name','ordinal','origin','readonly','symbol','type']);
      check(field.id === item.id + '.f' + ordinal && field.ordinal === ordinal && !fields.has(field.symbol)
        && types.has(field.type) && ['public','private','protected'].includes(field.access)
        && typeof field.readonly === 'boolean' && typeof field.definiteAssertion === 'boolean', 'closure');
      valueType(field.type); origin(field.origin, item.origin); useSymbol(field.symbol, 'field', field.name, field.type, field.origin);
      fields.set(field.symbol, { ...field, owner: item.id });
    }
    const constructor = item.constructor;
    record(constructor, ['body','id','implicitForward','initializationFields','initializationPhase','kind','origin','signature','superCall']);
    record(constructor.signature, ['parameters','return']); array(constructor.body);
    origin(constructor.origin, item.origin);
    const derived = item.base !== '';
    check(constructor.id === item.id + '.ctor' && ['explicit','implicit-base','implicit-derived'].includes(constructor.kind)
      && constructor.initializationPhase === (derived ? 'after-successful-super' : 'before-body')
      && (derived ? constructor.kind === 'implicit-derived' ? constructor.superCall === '' && constructor.body.length === 0
        : constructor.kind === 'explicit' && /^e[1-9][0-9]*$/.test(constructor.superCall)
        : constructor.kind !== 'implicit-derived' && constructor.superCall === '')
      && same(constructor.initializationFields, item.fields.map(field => field.id))
      && constructor.signature.return === item.instanceType, 'initialization');
    // Parameter maps belong to verifier state, never to the owned DTO.
    const constructorParameters = signature(constructor.signature, constructor.id, constructor.origin, constructor.kind === 'implicit-derived');
    check(constructor.kind !== 'implicit-base' || !constructorParameters.size && !constructor.body.length, 'initialization');
    for (const [index, method] of array(item.methods, 4096).entries()) {
      record(method, ['access','body','id','name','origin','overrideTarget','signature','symbol']);
      check(method.id === item.id + '.m' + index && !methods.has(method.id)
        && ['public','private','protected'].includes(method.access) && typeof method.overrideTarget === 'string', 'closure');
      origin(method.origin, item.origin); const symbol = symbols.get(method.symbol);
      useType(symbol?.type, 'method-function', method.id); useSymbol(method.symbol, 'method', method.name, symbol.type, method.origin);
      methods.set(method.id, { ...method, owner: item.id, parameters: signature(method.signature, method.id, method.origin) });
    }
    classes.set(item.id, { ...item, constructorParameters });
  }
  const state = { graph, sources, types, symbols, classes, fields, methods, origin, typeUses };
  const views = verifyReferenceHierarchy(state);
  verifyReferenceForwarding(state);
  views.forEach(id => consumedTypes.add(id));
  check(consumedSymbols.size === symbols.size, 'closure');
  verifyReferenceBodies(state);
  for (const id of leaves) if (typeUses.has(id)) consumedTypes.add(id);
  check(consumedTypes.size === types.size, 'closure');
  check(views.every(id => typeUses.has(id)), 'closure');
  return graph;
}
