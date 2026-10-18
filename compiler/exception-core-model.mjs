// SPDX-License-Identifier: MIT
import { verifyExceptionHir } from './exception-hir.mjs';
import { exceptionSourceGrammar } from './exception-source-grammar.mjs';
import { canonical, own, sha256, i32TypeId, descriptor, limits, check, failure,
  hirBudget, payloadTypeId } from './exception-core-common.mjs';

// This adapter selects a whole verified program. It does not crop HIR, recheck
// TypeScript, select fixtures or let saved custody stand in for cold validation.
export function exceptionCoreModel(input) {
  const hir = verifyExceptionHir(input); hirBudget(hir);
  const cap = (condition, message) => check(condition, 'capability', message);
  cap(hir.sources.length === 1 && hir.functions.length === 1 && hir.modules.length === 1, 'Core requires one source/module/function');
  const source = hir.sources[0], fn = hir.functions[0], module = hir.modules[0], identity = hir.snapshot.identityInput;
  cap(hir.target !== null && hir.target.target === 'windows-x86_64-msvc', 'Core target/profile is not implemented');
  cap(identity.declarations?.version === descriptor.sourceHir.primaryDeclarations.version
    && identity.declarations.paths.length === 1 && identity.files.length === 2 && identity.rootFile === source.path
    && !Object.hasOwn(identity, 'compilationClosure'), 'Core declaration/profile shape is not implemented');
  const declarationPath = (identity.sourceRoot === '/' ? '' : identity.sourceRoot) + '/' + descriptor.sourceHir.primaryDeclarations.fileName;
  const declaration = identity.files.find(file => file.path === declarationPath);
  cap(identity.declarations.paths[0] === declarationPath && declaration
    && Buffer.byteLength(declaration.content) === descriptor.sourceHir.primaryDeclarations.bytes
    && sha256(declaration.content) === descriptor.sourceHir.primaryDeclarations.sha256, 'Core primary declarations differ');
  check(source.length <= limits.sourceUTF16Units && Buffer.byteLength(source.content) <= limits.sourceUTF8Bytes, 'limit', 'Core source exceeds policy');
  let grammar;
  try { grammar = exceptionSourceGrammar(source, limits.sourceTokens); }
  catch (error) { failure(error.code?.endsWith('-limit') ? 'limit' : 'capability', 'Core source token budget or spelling is not implemented'); }
  const tokenEnds = new Map();
  for (let index = 0; index < grammar.length; index++) {
    const token = grammar.at(index); tokenEnds.set(token.end, token);
    if (/^[A-Za-z_$]/.test(token.text) || token.text.startsWith('\\') || token.text.charCodeAt(0) > 127)
      cap(/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(token.text), 'Core identifier spelling is not implemented');
  }
  const spelling = (name, range) => {
    const token = tokenEnds.get(range.end);
    cap(token && token.start >= range.start && token.text === name
      && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(token.text), 'Core requires original ASCII identifier spelling');
  };
  spelling(fn.name, fn.nameRange);
  cap(fn.lexicalParent === null && fn.captures === null && fn.returnPresence === null, 'Core function metadata is not implemented');
  const signature = hir.types.find(type => type.id === fn.type);
  cap(signature?.kind === 'callable' && signature.returnType === i32TypeId
    && signature.parameters.length >= 1 && signature.parameters.every(type => type === i32TypeId), 'Core requires required i32 parameters/result');
  check(fn.parameters.length <= limits.sourceParameters, 'limit', 'Core source parameter budget exceeded');
  cap(fn.parameterInitializers === null || fn.parameterInitializers.every(value => value === null), 'Core parameter initializer is not implemented');
  cap(module.external && module.sourcePath === source.path && module.functions.length === 1 && module.functions[0] === fn.id
    && module.aggregateTypes.length === 0 && module.imports.length === 0 && module.globals.length === 0
    && module.initialization === null && module.closure === null && module.coverage === null, 'Core module relationships are not implemented');
  const exports = hir.exports[0];
  cap(hir.exports.length === 1 && exports.sourcePath === source.path && exports.external
    && exports.bindings.length === 1 && exports.bindings[0].name === fn.name && exports.bindings[0].target === fn.id,
  'Core requires one direct same-source function export');
  const allowedTypes = new Set([i32TypeId, fn.type]);
  let regions = 0, statements = 0, bindings = 0, tries = 0, packs = 0, carrierArguments = 1, continuations = 0, work = grammar.length;
  const step = () => check(++work <= limits.structuralWork, 'limit', 'Core selection work exceeded');
  const limit = (count, maximum, label) => check(count <= maximum, 'limit', 'Core ' + label + ' budget exceeded');
  const bind = binding => {
    step(); limit(++bindings, limits.sourceBindings, 'binding'); spelling(binding.name, binding.range);
    cap(binding.presence === null || ['undefined','null','optional','default'].every(key => binding.presence[key] === false), 'Core binding presence is not implemented');
  };
  const read = (value, environment) => {
    step(); cap(value?.kind === 'bindingRead' && value.presenceFlow === null, 'Core expression is not implemented');
    const binding = environment.get(value.binding); cap(binding && binding.type === value.type, 'Core read is outside its declaration scope/type');
    cap(value.type === i32TypeId || hir.types.find(type => type.id === value.type)?.kind === 'unknown', 'Core read type is not implemented');
    spelling(binding.name, value.range); return { ...value, kind: 'reference' };
  };
  function region(raw, inherited, normal, depth = 1) {
    step(); limit(++regions, limits.sourceRegions, 'region'); limit(depth, limits.regionNesting, 'region nesting');
    limit(bindings + raw.bindings.length, limits.sourceBindings, 'binding');
    const environment = new Map(inherited), declarations = new Map(raw.bindings.map(binding => [binding.id, binding]));
    for (const binding of raw.bindings) bind(binding);
    if (raw.role === 'function') for (const id of fn.parameters) {
      const parameter = declarations.get(id);
      cap(parameter?.role === 'parameter' && parameter.type === i32TypeId && parameter.presence !== null, 'Core parameter declaration differs');
      environment.set(id, parameter);
    }
    if (raw.role === 'catch') {
      carrierArguments++;
      const caught = raw.bindings.filter(binding => binding.role === 'catch');
      cap(caught.length <= 1, 'Core catch header differs');
      for (const binding of caught) {
        cap(hir.types.find(type => type.id === binding.type)?.kind === 'unknown' && binding.presence === null, 'Core catch must be unknown');
        allowedTypes.add(binding.type); environment.set(binding.id, binding);
      }
    }
    if (raw.role === 'finally') carrierArguments++;
    const body = []; let terminal = false;
    for (let position = 0; position < raw.body.length; position++) {
      step(); limit(++statements, limits.sourceStatements, 'statement'); cap(!terminal, 'Core does not implement unreachable statement tails');
      const item = raw.body[position];
      if (item.kind === 'local') {
        const binding = declarations.get(item.binding), initializer = read(item.initializer, environment);
        cap(binding?.role === 'local' && binding.type === i32TypeId && initializer.type === i32TypeId, 'Core local must be an initialized i32 reference alias');
        environment.set(binding.id, binding); body.push({ ...item, binding, initializer });
      } else if (item.kind === 'throw') {
        cap(!normal, 'Core abrupt finally is not implemented'); const value = read(item.value, environment);
        if (value.type === i32TypeId) packs++;
        body.push({ ...item, value }); terminal = true;
      } else if (item.kind === 'block') {
        if (normal) { carrierArguments += 2; continuations++; }
        body.push({ ...item, region: region(item.region, environment, normal, depth + 1) }); terminal = !normal;
      } else if (item.kind === 'try') {
        cap(!normal && tries === 0, 'Core supports at most one non-finally try'); tries++;
        const tryRegion = region(item.tryRegion, environment, false, depth + 1);
        const catchClause = item.catchClause === null ? null : { ...item.catchClause,
          region: region(item.catchClause.region, environment, false, depth + 1) };
        const finallyRegion = item.finallyRegion === null ? null : region(item.finallyRegion, environment, true, depth + 1);
        body.push({ ...item, tryRegion, catchClause, finallyRegion }); terminal = true;
      } else cap(false, 'Core statement is not implemented: ' + item.kind);
    }
    cap(normal || terminal, 'Core requires terminal throw outside a normally completing finally');
    cap([...declarations.values()].every(binding => environment.has(binding.id)), 'Core declaration has no reached initialization');
    return { ...raw, body };
  }
  const root = region(fn.body, new Map(), false);
  cap(hir.types.every(type => allowedTypes.has(type.id)), 'Core whole-program type closure is not implemented');
  limit(regions + continuations + 1, limits.coreBlocks, 'block');
  limit(regions + continuations, limits.coreEdges, 'edge');
  limit(fn.parameters.length + packs + carrierArguments, limits.coreValues, 'value');
  limit(2 + packs + regions + continuations, limits.coreInstructions, 'operation');
  const view = own({ ...fn, region: root, body: root.body,
    parameters: fn.parameters.map(id => root.bindings.find(binding => binding.id === id)), returnType: { id: i32TypeId } });
  const hirText = canonical(hir) + '\n', { snapshot, ...semantic } = hir;
  return { hir, source, fn, view, hirText, semanticHirHash: sha256(canonical(semantic)),
    policy: own({ carrierType: payloadTypeId, packOperation: 'tsfg_exception.pack', escapeOperation: 'tsfg_exception.propagate',
      packAttributes: 'payload_type = "' + i32TypeId + '"' }) };
}
