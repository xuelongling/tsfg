// SPDX-License-Identifier: MIT
import { canonical, sha256 } from './identity.mjs';
import { referenceEnvironmentDigest } from './reference-provenance.mjs';
import schema from '../contracts/core-reference-candidate.schema.json' with { type: 'json' };

export const referenceCoreFormat = Object.freeze({ family: schema.family, version: schema.version,
  schemaHash: sha256(canonical(schema)) });
export function referenceCoreFailure(message, origin) {
  throw Object.assign(new TypeError('reference-core-capability: ' + message),
    { code: 'reference-core-capability', ...(origin ? { origin } : {}) });
}
const digest = (domain, ...parts) => sha256(domain + '\0' + parts.join('\0'));
const anchorParts = origin => [origin.source, String(origin.start), String(origin.end)];
const signature = (parameters, result) => digest('tsfg.core-reference.signature.v1', '(' + parameters.join(',') + ')->' + result);

/** Internal per-lowering identity/table model. All local IDs are map keys only;
 * emitted identities bind allocation provenance, declarations and real types.
 * The caller supplies independently verified, owned reference HIR.
 */
export function referenceCoreModel(hir) {
  if (hir.format.semanticProfile !== schema.semanticProfile) referenceCoreFailure('semantic profile differs from Core reference candidate');
  const classes = new Map(hir.classes.map(item => [item.id, item]));
  const types = new Map(hir.types.map(item => [item.id, item]));
  const access = new Map(hir.classes.map(item => [item.id, digest('tsfg.core-reference.access.v1', item.runtimeKey)]));
  const sourceIndex = path => hir.sources.findIndex(source => source.path === path);
  const classOf = id => {
    const type = types.get(id), item = classes.get(type?.declaration);
    if (!item || !['class-instance','class-this','class-this-view'].includes(type.kind))
      return referenceCoreFailure('type is not an owned object access view');
    return item;
  };
  const type = id => {
    const value = types.get(id);
    if (!value) return referenceCoreFailure('value type is outside the owned closure');
    if (['class-instance','class-this','class-this-view'].includes(value.kind)) return 'ref:' + access.get(classOf(id).id);
    if (value.kind === 'number') return 'f64';
    if (value.kind === 'boolean') return 'bool';
    if (value.kind === 'void') return 'none';
    if (value.kind === 'scalar' && ['i32','f32'].includes(value.scalar)) return value.scalar;
    return referenceCoreFailure('unresolved numeric literal has no execution scalar');
  };
  const mlirType = value => value.startsWith('ref:') ? '!tsfg_core.ref<' + JSON.stringify(value.slice(4)) + '>'
    : value === 'bool' ? 'i1' : value;
  const member = new Map(), fields = new Map(), methods = new Map(), callables = new Map();
  for (const owner of hir.classes) {
    for (const [kind, items] of [['field', owner.fields], ['method', owner.methods]]) for (const item of items) {
      const key = digest('tsfg.core-reference.member.v1', owner.runtimeKey, kind, ...anchorParts(item.origin), item.name);
      member.set(item.symbol, key);
      if (kind === 'field') fields.set(item.symbol, { owner, item, key });
      else methods.set(item.id, { owner, item, key });
    }
  }
  for (const owner of hir.classes) for (const item of [owner.constructor, ...owner.methods]) {
    const constructor = item === owner.constructor, kind = constructor ? 'constructor' : 'method';
    const parameters = ['ref:' + access.get(owner.id), ...item.signature.parameters.map(parameter => type(parameter.type))];
    const result = constructor ? 'none' : type(item.signature.return), hash = signature(parameters, result);
    const key = digest('tsfg.core-reference.callable.v1', owner.runtimeKey, kind, ...anchorParts(item.origin), hash);
    const descriptor = { key, signature: hash, name: constructor ? 'constructor' : item.name, kind,
      owner: owner.runtimeKey, access: item.access, source: sourceIndex(item.origin.source), start: item.origin.start, end: item.origin.end,
      parameters, result, member: constructor ? '' : member.get(item.symbol),
      override: item.overrideTarget ? methods.get(item.overrideTarget)?.key ?? '' : '',
      phase: constructor ? item.initializationPhase : '',
      initialization: constructor ? owner.fields.map(field => member.get(field.symbol)) : [] };
    callables.set(item.id, { owner, item, descriptor, symbol: 'r' + key.slice(7) });
  }
  const views = [], viewsByKey = new Map();
  const view = value => {
    const payload = { source: type(value.sourceType), target: type(value.targetType),
      members: value.members.map(pair => ({ source: member.get(pair.source), target: member.get(pair.target) })) };
    if (payload.members.some(pair => !pair.source || !pair.target)) referenceCoreFailure('view member is outside owned closure', value.origin);
    const key = digest('tsfg.core-reference.view.v1', canonical(payload));
    if (!viewsByKey.has(key)) {
      viewsByKey.set(key, views.length); views.push({ key, ...payload });
    }
    return viewsByKey.get(key);
  };
  const classTables = hir.classes.map(owner => ({ key: owner.runtimeKey, name: owner.name,
    source: sourceIndex(owner.origin.source), start: owner.origin.start, end: owner.origin.end,
    base: owner.base ? classes.get(owner.base).runtimeKey : '', access: access.get(owner.id),
    fields: owner.fields.map(field => ({ key: member.get(field.symbol), name: field.name, type: type(field.type),
      source: sourceIndex(field.origin.source), start: field.origin.start, end: field.origin.end,
      readonly: field.readonly, access: field.access, ordinal: field.ordinal, has_initializer: field.initializer !== null })),
    constructor: callables.get(owner.constructor.id).descriptor,
    methods: owner.methods.map(method => callables.get(method.id).descriptor) }));
  const environmentPreimage = { profile: hir.format.semanticProfile, scope: hir.context.scope, sources: hir.sources, options: hir.options };
  const metadata = () => ({ family: referenceCoreFormat.family, version: referenceCoreFormat.version,
    schema: referenceCoreFormat.schemaHash, profile: hir.format.semanticProfile, scope: hir.context.scope,
    input: hir.context.factsDigest, environment: referenceEnvironmentDigest({ semanticProfile: hir.format.semanticProfile,
      scope: hir.context.scope, sources: hir.sources, options: hir.options }), environment_preimage: canonical(environmentPreimage),
    sources: hir.sources.map(source => ({ path: source.path, hash: source.sha256, length: source.utf16Length,
      declaration: source.declaration, surrogates: source.surrogateStarts })),
    types: hir.classes.map(owner => ({ key: access.get(owner.id), class_key: owner.runtimeKey })), classes: classTables, views });
  return { hir, classes, access, classOf, type, mlirType, fields, methods, member, callables, view, metadata };
}
