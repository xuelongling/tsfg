// SPDX-License-Identifier: MIT
import { check, record, same, sha256, declarationDigests, wireLimits } from './exception-common.mjs';
import { exceptionIdentifierName } from './exception-identifiers.mjs';

// Only already digest-validated ambient DTS is scanned here. These pinned
// profiles contain unique-symbol consts and bodyless function declarations.
function ambientValues(content) {
  const values = new Map();
  for (const occurrence of content.matchAll(/\bdeclare\b/g)) {
    const tail = content.slice(occurrence.index);
    const constant = /^declare\s+const\s+([$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*)\s*:\s*unique\s+symbol\s*;/u.exec(tail);
    const fn = /^declare\s+function\s+([$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*)(?:<[^;{}\r\n]+>)?\([^;{}\r\n]*\)\s*:\s*[^;{}\r\n]+;/u.exec(tail);
    const declaration = constant ?? fn;
    check(declaration, 'capability', 'pinned aggregate DTS value grammar is not implemented');
    const name = exceptionIdentifierName(declaration[1]);
    check(!values.has(name), 'input', 'duplicate pinned ambient value declaration');
    values.set(name, constant ? 'const' : 'function');
    check(values.size <= wireLimits.symbols, 'limit');
  }
  return values;
}
// Type declarations share a script class's type namespace, but not a function's
// value namespace. Scan only the already digest-validated pinned DTS grammar.
function ambientTypes(content) {
  const types = new Map();
  const declarations = /^(type|interface)\s+([$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*)(?:<([^>\r\n]+)>)?\s*(=|\{)/gmu;
  for (const declaration of content.matchAll(declarations)) {
    check((declaration[1] === 'type') === (declaration[4] === '='), 'capability', 'pinned DTS type declaration grammar is not implemented');
    const name = exceptionIdentifierName(declaration[2]);
    const parameters = declaration[3] === undefined ? [] : declaration[3].split(',').map(parameter => exceptionIdentifierName(parameter.trim()));
    check(parameters.length <= wireLimits.parameters && new Set(parameters).size === parameters.length, 'capability', 'pinned DTS type parameter grammar is not implemented');
    check(!types.has(name), 'input', 'duplicate pinned ambient type declaration');
    types.set(name, { kind: declaration[1] === 'type' ? 'alias' : 'interface', arity: parameters.length });
    check(types.size <= wireLimits.symbols, 'limit');
  }
  return types;
}
export function prepareExceptionAggregateInput(input, supplied) {
  if (!Object.hasOwn(input.declarations, 'markerProfile')) return null;
  check(input.declarations.version === 'minimal-conversions-v5', 'input', 'aggregate markers require the actual conversion declaration profile');
  const marker = input.declarations.markerProfile;
  record(marker, ['version','path','sha256','contextName','contextArity','mode','entries']);
  const primary = input.sourceRoot + '/minimal-conversions-v5.d.ts';
  const markerPath = input.sourceRoot + '/minimal-aggregates-v1.d.ts';
  const expected = { version: 'minimal-aggregates-v1', path: markerPath,
    sha256: declarationDigests['minimal-aggregates-v1.d.ts'], contextName: 'ClassDecoratorContext', contextArity: 1,
    mode: 'standard', entries: [{ name: 'tsfgValue', category: 'value' }, { name: 'tsfgComponent', category: 'component' }] };
  check(same(marker, expected) && same(input.config, { strict: true, noEmit: true, allowJs: false, decoratorMode: 'standard' }), 'input');
  check(same(input.declarations.paths, [primary, markerPath]) && supplied.length === 3, 'input', 'complete aggregate declaration closure differs');
  const primaryFile = supplied.find(file => file.path === primary), markerFile = supplied.find(file => file.path === markerPath);
  check(primaryFile && markerFile && sha256(primaryFile.content) === declarationDigests['minimal-conversions-v5.d.ts']
    && sha256(markerFile.content) === marker.sha256, 'identity', 'aggregate declaration bytes differ');
  const globals = ambientValues(primaryFile.content);
  for (const [name, kind] of ambientValues(markerFile.content)) {
    check(!globals.has(name), 'input', 'duplicate primary/marker ambient value'); globals.set(name, kind);
  }
  const typeBindings = ambientTypes(primaryFile.content);
  for (const [name, binding] of ambientTypes(markerFile.content)) {
    check(!typeBindings.has(name), 'input', 'duplicate primary/marker ambient type'); typeBindings.set(name, binding);
  }
  const markers = new Map();
  for (const entry of marker.entries) {
    const literal = 'declare function ' + entry.name + '<C>(target: C, context: ClassDecoratorContext<C>): void;';
    const start = markerFile.content.indexOf(literal);
    check(start >= 0 && markerFile.content.indexOf(literal, start + 1) < 0, 'identity', 'actual pinned marker declaration is not unique');
    const origin = { declarationPath: markerPath, declarationRange: { start, end: start + literal.length },
      declarationSha256: marker.sha256, entryId: sha256('tsfg.marker\0' + marker.version + '\0' + entry.category + '\0' + marker.sha256),
      version: marker.version, contextName: marker.contextName, contextArity: marker.contextArity, mode: marker.mode };
    markers.set(entry.category, { name: entry.name, origin });
  }
  return { paths: [primary, markerPath], globals, typeBindings, markers };
}
