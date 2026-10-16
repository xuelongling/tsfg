// SPDX-License-Identifier: MIT
import { canonical, own, sha256 } from './identity.mjs';
import { decodeGenericPackage, genericPackageFormat, genericPackageLimits } from './generic-package.mjs';
import { checkGenericJsonBudget } from './generic-package-shape.mjs';

// Candidate in-memory Source result boundary. Scalar substitution below validates
// only finite owned-shape correspondence,
// not official TS semantics or the identity/admission of a Source executable.
const fail = category => { throw Object.assign(new TypeError(
  'generic-instance-' + category + ': invalid concrete Source result'), { code: 'generic-instance-' + category }); };
const check = (value, category = 'schema') => { if (!value) fail(category); };
const same = (a, b) => canonical(a) === canonical(b);
const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const record = (value, keys) => check(value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(','));
const array = (value, maximum, minimum = 0) => {
  check(Array.isArray(value)); check(value.length >= minimum && value.length <= maximum, 'limit');
  return value;
};
function budget(value) {
  try { checkGenericJsonBudget(value); }
  catch (error) { fail(error.code === 'generic-package-limit' ? 'limit' : 'schema'); }
}
function argumentsOf(values) {
  return array(values, genericPackageLimits.typeParameters, 1).map(value => {
    record(value, ['kind', 'parameter']);
    check(['boolean', 'number'].includes(value.kind) && value.parameter === 0 && !Object.is(value.parameter, -0));
    return value;
  });
}
export function genericInstanceKey(context, definition, typeArguments) {
  budget({ context, definition, typeArguments });
  record(context, ['packageId', 'scope', 'semanticProfile']);
  check(typeof context.packageId === 'string' && /^sha256:[0-9a-f]{64}$/.test(context.packageId)
    && typeof context.scope === 'string' && context.scope.length > 0 && Buffer.byteLength(context.scope) <= 256
    && context.semanticProfile === genericPackageFormat.semanticProfile && digest(definition), 'identity');
  argumentsOf(typeArguments);
  return sha256('tsfg:generic-instance:v1\n' + canonical({ definition,
    graphDigest: context.packageId.slice(7), scope: context.scope,
    semanticProfile: context.semanticProfile, typeArguments })).slice(7);
}
export const genericPackageContext = pkg => ({ packageId: pkg.packageId, scope: pkg.payload.scope,
  semanticProfile: pkg.payload.semanticProfile });

/** Exact Source DTO -> owned checked facts, still a candidate rather than admission. */
export function validateGenericInstanceResult(packageBytes, input, requests) {
  const pkg = decodeGenericPackage(packageBytes);
  budget(input); budget(requests);
  record(input, ['packageId', 'semanticProfile', 'roots', 'instances']);
  const context = genericPackageContext(pkg), definitions = new Map(pkg.payload.definitions.map(def => [def.key, def]));
  check(input.packageId === pkg.packageId && input.semanticProfile === context.semanticProfile, 'identity');
  array(input.roots, 256, 1); array(requests, 256, 1); array(input.instances, 512, 1);
  check(input.roots.length === requests.length, 'root');
  requests.forEach((request, index) => {
    record(request, ['definition', 'typeArguments']);
    const definition = definitions.get(request.definition);
    check(definition?.exported, 'root');
    argumentsOf(request.typeArguments);
    check(request.typeArguments.length === definition.typeParameters.length, 'reference');
    check(input.roots[index] === genericInstanceKey(context, request.definition, request.typeArguments), 'root');
  });
  const instances = new Map();
  let previous = '';
  for (const instance of input.instances) {
    record(instance, ['key', 'definition', 'typeArguments', 'origin', 'parameters', 'returnType', 'body']);
    const definition = definitions.get(instance.definition);
    check(definition && digest(instance.key) && instance.key > previous, 'identity');
    previous = instance.key;
    argumentsOf(instance.typeArguments);
    check(instance.typeArguments.length === definition.typeParameters.length, 'reference');
    check(instance.key === genericInstanceKey(context, instance.definition, instance.typeArguments), 'identity');
    check(same(instance.origin, definition.origin), 'origin');
    array(instance.parameters, genericPackageLimits.parameters);
    check(instance.parameters.length === definition.parameters.length, 'reference');
    instances.set(instance.key, instance);
  }
  const substitute = (type, args) => type.kind === 'parameter' ? args[type.parameter] : type;
  const scalar = type => type.kind === 'boolean' ? 'bool' : 'f64';
  let total = 0;
  for (const instance of input.instances) {
    const definition = definitions.get(instance.definition), args = instance.typeArguments;
    const concrete = type => scalar(substitute(type, args));
    check(instance.returnType === concrete(definition.returnType), 'type');
    instance.parameters.forEach((parameter, index) => {
      record(parameter, ['name', 'type', 'origin']);
      const original = definition.parameters[index];
      check(parameter.name === original.name && same(parameter.origin, original.origin), 'origin');
      check(parameter.type === concrete(original.type), 'type');
    });
    let count = 0;
    const expression = (value, original, depth = 0) => {
      check(depth <= genericPackageLimits.expressionDepth && ++count <= genericPackageLimits.expressionsPerDefinition
        && ++total <= genericPackageLimits.expressionsTotal, 'limit');
      record(value, ['kind', 'type', 'parameter', 'callee', 'arguments', 'origin']);
      check(value.kind === original.kind && same(value.origin, original.origin), 'origin');
      array(value.arguments, genericPackageLimits.parameters);
      check(Number.isSafeInteger(value.parameter) && value.parameter >= 0 && !Object.is(value.parameter, -0));
      if (original.kind === 'parameter') {
        check(value.parameter === original.parameter && value.callee === '' && value.arguments.length === 0, 'reference');
        check(value.type === instance.parameters[value.parameter]?.type, 'type');
      } else {
        check(value.parameter === 0 && value.arguments.length === original.arguments.length, 'reference');
        const typeArguments = original.typeArguments.map(type => substitute(type, args));
        const key = genericInstanceKey(context, original.definition, typeArguments), callee = instances.get(key);
        check(value.callee === key && callee?.definition === original.definition, 'reference');
        check(value.type === callee.returnType && value.arguments.length === callee.parameters.length, 'type');
        value.arguments.forEach((argument, index) => {
          expression(argument, original.arguments[index], depth + 1);
          check(argument.type === callee.parameters[index].type, 'type');
        });
      }
    };
    expression(instance.body, definition.body);
    check(instance.body.type === instance.returnType, 'type');
  }
  const reachable = new Set(), pending = [...input.roots];
  while (pending.length) {
    const key = pending.pop();
    if (reachable.has(key)) continue;
    const instance = instances.get(key); check(instance, 'reference'); reachable.add(key);
    const visit = value => {
      if (value.kind === 'call') pending.push(value.callee);
      value.arguments.forEach(visit);
    };
    visit(instance.body);
  }
  check(reachable.size === instances.size, 'closure');
  return own(input);
}
