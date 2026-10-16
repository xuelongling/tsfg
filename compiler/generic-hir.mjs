// SPDX-License-Identifier: MIT
import { canonical, own, sha256, scalarTypeIds, functionIdentity, signatureHash } from './identity.mjs';
import { decodeGenericPackage, genericDefinitionKey, genericPackageFormat, genericPackageLimits } from './generic-package.mjs';
import { checkGenericJsonValueBudget } from './generic-json.mjs';
import { readGenericJson } from './generic-json.mjs';
import { emitScalarCore } from './scalar-core-emitter.mjs';
import { genericInstanceKey, genericPackageContext, validateGenericInstanceResult } from './generic-instance.mjs';
import bytecodeSchema from '../contracts/bytecode.schema.json' with { type: 'json' };
import registry from '../contracts/registry.json' with { type: 'json' };

// Explicit candidate owned HIR family; scalar SSA uses the same Core exchange.
// Source result validation is structural correspondence, never Source admission.
export const genericHirFormat = own({ family: 'tsfg.generic-concrete-hir-candidate', version: 1,
  linkageAlgorithm: 'tsfg.generic-linkage.v1', semanticProfile: 'tsfg-owned-scalar-generics-host-v1' });
const fail = category => { throw Object.assign(new TypeError(
  'generic-hir-' + category + ': invalid concrete candidate HIR'), { code: 'generic-hir-' + category }); };
const check = (value, category = 'schema') => { if (!value) fail(category); };
const same = (a, b) => canonical(a) === canonical(b);
const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const hash = value => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
const record = (value, keys) => check(value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(','));
const scalar = type => type === scalarTypeIds.bool ? 'bool' : type === scalarTypeIds.f64 ? 'f64' : undefined;
const array = (value, maximum, minimum = 0) => {
  check(Array.isArray(value)); check(value.length >= minimum && value.length <= maximum, 'limit');
  return value;
};
function budget(value) {
  try { checkGenericJsonValueBudget(value); }
  catch (error) { fail(error.code === 'generic-package-limit' ? 'limit' : 'schema'); }
}
/** Generated linkage lives in this candidate namespace; source names have no reserved prefix. */
export function genericLinkageName(instanceKey) {
  check(digest(instanceKey), 'identity');
  return '__tsfg_generic_v1_' + instanceKey;
}
const inputIdentity = (context, roots, target, source) => sha256('tsfg:generic-concrete-hir-input:v1\n'
  + canonical({ context, roots, target, source }));
const type = name => ({ kind: 'scalar', name, id: scalarTypeIds[name] });

/** Official result DTO -> independent concrete HIR. Original function text is unnecessary. */
export function buildGenericHir(packageBytes, result, requests) {
  const pkg = decodeGenericPackage(packageBytes);
  const checked = validateGenericInstanceResult(packageBytes, result, requests);
  const context = genericPackageContext(pkg), definitions = new Map(pkg.payload.definitions.map(def => [def.key, def]));
  const descriptors = new Map(checked.instances.map(instance => {
    const linkageName = genericLinkageName(instance.key);
    return [instance.key, { id: functionIdentity(pkg.payload.source.path, linkageName, instance.returnType,
      instance.parameters.map(parameter => parameter.type)), signatureHash: signatureHash(instance.returnType,
      instance.parameters.map(parameter => parameter.type)) }];
  }));
  const functions = checked.instances.map(instance => {
    const project = expression => expression.kind === 'parameter'
      ? { kind: 'reference', type: scalarTypeIds[expression.type], binding: 'p' + expression.parameter, range: expression.origin }
      : { kind: 'call', type: scalarTypeIds[expression.type], target: descriptors.get(expression.callee).id,
        signatureHash: descriptors.get(expression.callee).signatureHash, arguments: expression.arguments.map(project), range: expression.origin };
    const value = project(instance.body);
    return { ...descriptors.get(instance.key), instanceKey: instance.key, definition: instance.definition,
      typeArguments: instance.typeArguments, name: definitions.get(instance.definition).name,
      linkageName: genericLinkageName(instance.key), range: instance.origin, returnType: type(instance.returnType),
      parameters: instance.parameters.map((parameter, index) => ({ id: 'p' + index, name: parameter.name,
        type: scalarTypeIds[parameter.type], writable: true, range: parameter.origin })),
      // The package owns an expression anchor, not a return-keyword anchor.
      // This implicit return deliberately uses that original expression origin.
      body: [{ kind: 'return', range: value.range, value }] };
  });
  const roots = checked.roots.map(key => descriptors.get(key).id);
  const hir = { format: genericHirFormat, context, source: pkg.payload.source, target: bytecodeSchema.target,
    inputIdentity: inputIdentity(context, checked.roots, bytecodeSchema.target, pkg.payload.source), functions,
    closure: { roots, functions: functions.map(fn => fn.id).sort() } };
  return verifyGenericHir(hir);
}

/** Cold validation of concrete facts; does not assert original source token spellings. */
export function verifyGenericHir(hir) {
  budget(hir);
  record(hir, ['format', 'context', 'source', 'target', 'inputIdentity', 'functions', 'closure']);
  check(same(hir.format, genericHirFormat) && same(hir.target, bytecodeSchema.target), 'identity');
  record(hir.context, ['packageId', 'scope', 'semanticProfile']);
  check(hash(hir.context.packageId) && typeof hir.context.scope === 'string' && hir.context.scope.length > 0
    && Buffer.byteLength(hir.context.scope) <= 256 && hir.context.semanticProfile === genericPackageFormat.semanticProfile, 'identity');
  const source = hir.source;
  record(source, ['path', 'digest', 'length', 'positionUnit', 'surrogateStarts']);
  check(typeof source.path === 'string' && Buffer.byteLength(source.path) <= 4096 && source.path.startsWith('/')
    && source.path.endsWith('.ts') && !source.path.endsWith('.d.ts') && !source.path.includes('\\')
    && source.path.slice(1).split('/').every(part => part && part !== '.' && part !== '..')
    && digest(source.digest) && Number.isSafeInteger(source.length) && source.length >= 1
    && source.length <= genericPackageLimits.sourceUTF16 && source.positionUnit === 'utf16', 'origin');
  array(source.surrogateStarts, Math.floor(source.length / 2));
  let previousSurrogate = -2;
  for (const start of source.surrogateStarts) {
    check(Number.isSafeInteger(start) && !Object.is(start, -0) && start >= previousSurrogate + 2
      && start >= 0 && start <= source.length - 2, 'origin'); previousSurrogate = start;
  }
  const interiors = new Set(source.surrogateStarts.map(start => start + 1));
  const range = (anchor, parent) => {
    record(anchor, ['start', 'end']);
    check(Number.isSafeInteger(anchor.start) && Number.isSafeInteger(anchor.end)
      && !Object.is(anchor.start, -0) && !Object.is(anchor.end, -0)
      && anchor.start >= parent.start && anchor.start < anchor.end && anchor.end <= parent.end
      && !interiors.has(anchor.start) && !interiors.has(anchor.end), 'origin');
  };
  array(hir.functions, 512, 1);
  const functions = new Map();
  let previous = '';
  for (const fn of hir.functions) {
    record(fn, ['id', 'instanceKey', 'definition', 'typeArguments', 'name', 'linkageName', 'signatureHash',
      'range', 'returnType', 'parameters', 'body']);
    check(digest(fn.instanceKey) && digest(fn.definition) && fn.instanceKey > previous
      && !functions.has(fn.id), 'identity'); previous = fn.instanceKey;
    check(typeof fn.name === 'string' && fn.name.length > 0, 'schema');
    range(fn.range, { start: 0, end: source.length });
    check(fn.definition === genericDefinitionKey({ name: fn.name, origin: fn.range },
      { scope: hir.context.scope, source }), 'identity');
    check(fn.instanceKey === genericInstanceKey(hir.context, fn.definition, fn.typeArguments)
      && fn.linkageName === genericLinkageName(fn.instanceKey), 'identity');
    record(fn.returnType, ['kind', 'name', 'id']);
    check(['bool', 'f64'].includes(fn.returnType.name) && same(fn.returnType, type(fn.returnType.name)), 'type');
    array(fn.parameters, genericPackageLimits.parameters);
    const names = new Set();
    fn.parameters.forEach((parameter, index) => {
      record(parameter, ['id', 'name', 'type', 'writable', 'range']);
      check(parameter.id === 'p' + index && typeof parameter.name === 'string' && parameter.name.length > 0
        && !names.has(parameter.name) && parameter.writable === true && scalar(parameter.type), 'type');
      names.add(parameter.name); range(parameter.range, fn.range);
    });
    const parameterNames = fn.parameters.map(parameter => scalar(parameter.type));
    check(fn.signatureHash === signatureHash(fn.returnType.name, parameterNames)
      && fn.id === functionIdentity(source.path, fn.linkageName, fn.returnType.name, parameterNames), 'identity');
    functions.set(fn.id, fn);
  }
  let total = 0;
  const edges = new Map();
  for (const fn of hir.functions) {
    let count = 0;
    const targets = [];
    // Owned anchors are individually contained by the definition; leading trivia
    // can put an argument outside its parent call anchor. Never move the origin.
    const expression = (value, depth = 0) => {
      check(depth <= genericPackageLimits.expressionDepth && ++count <= genericPackageLimits.expressionsPerDefinition
        && ++total <= genericPackageLimits.expressionsTotal, 'limit');
      check(scalar(value?.type), 'type'); range(value.range, fn.range);
      if (value.kind === 'reference') {
        record(value, ['kind', 'type', 'binding', 'range']);
        const parameter = fn.parameters.find(item => item.id === value.binding);
        check(parameter && value.type === parameter.type, 'reference');
      } else {
        record(value, ['kind', 'type', 'target', 'signatureHash', 'arguments', 'range']);
        const callee = functions.get(value.target);
        check(value.kind === 'call' && callee && value.signatureHash === callee.signatureHash
          && value.type === callee.returnType.id, 'reference');
        array(value.arguments, genericPackageLimits.parameters);
        check(value.arguments.length === callee.parameters.length, 'type');
        targets.push(value.target);
        value.arguments.forEach((argument, index) => {
          expression(argument, depth + 1); check(argument.type === callee.parameters[index].type, 'type');
        });
      }
    };
    array(fn.body, 1, 1);
    const statement = fn.body[0];
    record(statement, ['kind', 'range', 'value']);
    check(statement.kind === 'return' && same(statement.range, statement.value?.range), 'origin');
    range(statement.range, fn.range); expression(statement.value);
    check(statement.value.type === fn.returnType.id, 'type');
    edges.set(fn.id, targets);
  }
  record(hir.closure, ['roots', 'functions']);
  array(hir.closure.roots, 256, 1); array(hir.closure.functions, 512, 1);
  const reachable = new Set(), pending = [...hir.closure.roots];
  while (pending.length) {
    const id = pending.pop(); check(functions.has(id), 'closure');
    if (reachable.has(id)) continue;
    reachable.add(id); pending.push(...edges.get(id));
  }
  check(reachable.size === functions.size && same(hir.closure.functions, [...reachable].sort()), 'closure');
  const instanceRoots = hir.closure.roots.map(id => functions.get(id).instanceKey);
  check(hir.inputIdentity === inputIdentity(hir.context, instanceRoots, hir.target, hir.source), 'identity');
  return own(hir);
}
export function printGenericHir(hir) {
  const text = canonical(verifyGenericHir(hir));
  check(Buffer.byteLength(text, 'utf8') + 1 <= genericPackageLimits.bytes, 'limit');
  return text + '\n';
}
export function readGenericHir(bytes) {
  let input;
  try { input = readGenericJson(bytes); }
  catch (error) {
    if (error.code === 'generic-package-limit') fail('limit');
    if (error.code === 'generic-package-canonical') fail('canonical');
    if (error.code === 'generic-package-schema') fail('schema');
    fail('input');
  }
  const hir = verifyGenericHir(input.value);
  check(input.text === printGenericHir(hir), 'canonical');
  return hir;
}

// The owned generic HIR keeps its own cold verifier and candidate provenance.
// Its concrete scalars cross exactly the ordinary HIR's Core/R04 exchange.
export const genericCoreFormat = own({ version: registry['tsfg.hir'].semver,
  bytecodeSchema: registry['tsfg.bytecode'].schemaHash });
export function lowerGenericHir(hir) {
  const verified = verifyGenericHir(hir);
  return emitScalarCore({ exchange: genericCoreFormat, inputIdentity: verified.inputIdentity,
    source: { path: verified.source.path, hash: 'sha256:' + verified.source.digest, length: verified.source.length },
    target: verified.target, functions: verified.functions.map(fn => ({ ...fn, symbol: fn.linkageName })) });
}
