// SPDX-License-Identifier: MIT
import { budget, check, record, array, same, canonical, own, sha256, origin, snapshotFormat, readJson, valueType, capturedDeclarationProfiles } from './closure-common.mjs';
import path from 'node:path';
import bytecodeSchema from '../contracts/bytecode.schema.json' with { type: 'json' };
import { verifyClosureFacts, expressionType } from './closure-facts.mjs';
export const closureSnapshotIdentity = (inputIdentity, sourceOrigin) => sha256(canonical({ format: snapshotFormat, inputIdentity, sourceOrigin }));
export function matchesClosureSnapshot(snapshot) {
  try { return same(snapshot?.format, snapshotFormat) && snapshot.snapshotId === closureSnapshotIdentity(snapshot.inputIdentity, origin(snapshot.sourceOrigin)); }
  catch { return false; }
}
/** One owned candidate projection behind the shared Frontend response core. */
export function ownClosureSnapshot(prepared, output, sourceOrigin, responseText) {
  const { inputIdentity, identityInput, ownedInput, files, rootFile, declarationVersion, declarationPaths, seen } = prepared;
  record(output, ['status','inputs','functions','symbols']); check(output.status === 'ok', 'schema');
  check(Array.isArray(output.inputs) && new Set(output.inputs).size === output.inputs.length && same(output.inputs, [...output.inputs].sort())
    && output.inputs.includes(rootFile) && declarationPaths.every(name => output.inputs.includes(name)) && output.inputs.every(name => seen.has(name)), 'input');
  check(!ownedInput.compilationClosure, 'capability', 'module closure input is not implemented for this candidate');
  const sourceFile = files.find(file => file.path === rootFile), source = { path: rootFile, content: sourceFile.content };
  verifyClosureFacts(source, output.functions, output.symbols);
  const snapshotId = closureSnapshotIdentity(inputIdentity, sourceOrigin), nodes = [], types = [], ref = id => ({ snapshotId, id });
  const typeRef = type => {
    let entry = types.find(item => same(item.descriptor, type));
    if (!entry) { entry = { id: 't' + types.length, descriptor: type }; types.push(entry); }
    return ref(entry.id);
  };
  const node = (value, kind) => { const id = 'n' + nodes.length; nodes.push({ id, kind, range: value.range }); return ref(id); };
  const symbols = output.symbols.map(symbol => ({ ...structuredClone(symbol), ref: ref(symbol.id),
    ...(symbol.lexicalOwner ? { lexicalOwner: ref(symbol.lexicalOwner) } : {}),
    typeRef: typeRef(symbol.kind === 'function' ? valueType(symbol.type, output.functions.find(fn => fn.symbol === symbol.id).returnSignature) : valueType(symbol.type, symbol.signature)) }));
  const byId = new Map(symbols.map(symbol => [symbol.id, symbol]));
  function expression(value) {
    const result = { ...structuredClone(value), node: node(value, value.kind), typeRef: typeRef(expressionType(value)) };
    if (value.symbol) result.symbol = ref(value.symbol);
    if (value.target) result.target = ref(value.target);
    for (const key of ['callee','left','right','operand']) if (value[key]) result[key] = expression(value[key]);
    if (value.arguments) result.arguments = value.arguments.map(expression);
    return result;
  }
  function statement(value) {
    const result = { ...structuredClone(value), node: node(value, value.kind) };
    if (value.symbol) result.symbol = structuredClone(byId.get(value.symbol.id));
    for (const key of ['expression','initializer','condition','target','value']) if (value[key]) result[key] = expression(value[key]);
    for (const key of ['body','thenBody','elseBody']) if (value[key]) result[key] = value[key].map(statement);
    return result;
  }
  const functions = output.functions.map(fn => {
    const result = { ...structuredClone(fn), symbol: ref(fn.symbol), node: node(fn, 'function'), returnTypeRef: typeRef(valueType(fn.returnType, fn.returnSignature)),
      parameters: fn.parameters.map(p => ({ ...structuredClone(byId.get(p.id)), node: node(p, 'parameter') })), body: fn.body.map(statement) };
    if (fn.lexicalParent) result.lexicalParent = ref(fn.lexicalParent);
    if (fn.captures) result.captures = fn.captures.map(c => ({ ...c, symbol: ref(c.symbol) }));
    return result;
  });
  const inputs = output.inputs.map(path => ({ path, sha256: sha256(files.find(file => file.path === path).content),
    kind: path === rootFile ? 'source' : declarationPaths.includes(path) ? 'declaration-root' : 'declaration-dependency' }));
  return { status: 'ok', snapshot: own({ format: snapshotFormat, sourceOrigin, snapshotId, inputIdentity, identityInput,
    capability: declarationVersion, source, inputs, functions, symbols, nodes, types, diagnostics: [],
    capture: { request: prepared.captureRequest, response: responseText } }) };
}

function checkCapturedInput(input) {
  record(input, ['sourceRoot','rootFile','files','declarations','config','target']);
  record(input.declarations, ['version','paths']);
  check(same(input.config, { strict: true, noEmit: true, allowJs: false })
    && same(input.target, { ...bytecodeSchema.target, pointerBits: '64' }), 'input');
  check(typeof input.sourceRoot === 'string' && input.sourceRoot.startsWith('/') && path.posix.normalize(input.sourceRoot) === input.sourceRoot, 'input');
  check(typeof input.rootFile === 'string' && input.rootFile.endsWith('.ts') && !input.rootFile.endsWith('.d.ts'), 'input');
  const files = array(input.files), names = new Set(); check(files.length > 0, 'input');
  for (const file of files) {
    record(file, ['path','content'], ['sha256']);
    check(typeof file.path === 'string' && file.path.startsWith(input.sourceRoot + '/') && path.posix.normalize(file.path) === file.path
      && (file.path === input.rootFile || file.path.endsWith('.d.ts')) && typeof file.content === 'string' && !names.has(file.path), 'input');
    if (file.sha256 !== undefined) check(file.sha256 === sha256(file.content), 'identity'); names.add(file.path);
  }
  check(names.has(input.rootFile) && Object.hasOwn(capturedDeclarationProfiles, input.declarations.version), 'input');
  const roots = array(input.declarations.paths); check(roots.length > 0 && roots[0] === input.sourceRoot + '/' + input.declarations.version + '.d.ts'
    && new Set(roots).size === roots.length && roots.every(name => names.has(name) && name.endsWith('.d.ts')), 'input');
  check(sha256(files.find(file => file.path === roots[0]).content) === capturedDeclarationProfiles[input.declarations.version], 'identity');
}

export function closureSnapshotFacts(snapshot) {
  budget(snapshot); check(matchesClosureSnapshot(snapshot), 'identity');
  record(snapshot, ['format','sourceOrigin','snapshotId','inputIdentity','identityInput','capability','source','inputs','functions','symbols','nodes','types','diagnostics','capture']);
  record(snapshot.capture, ['request','response']);
  check(typeof snapshot.capture.request === 'string' && typeof snapshot.capture.response === 'string', 'input');
  check(sha256(snapshot.capture.request) === snapshot.sourceOrigin.requestSha256 && sha256(snapshot.capture.response) === snapshot.sourceOrigin.responseSha256, 'identity');
  const request = readJson(Buffer.from(snapshot.capture.request)).value, output = readJson(Buffer.from(snapshot.capture.response)).value;
  checkCapturedInput(request);
  const identityInput = { ...request, files: array(request.files).map(file => ({ path: file.path, content: file.content })).sort((a,b) => Buffer.from(a.path).compare(Buffer.from(b.path))) };
  check(same(identityInput, snapshot.identityInput) && sha256(canonical(identityInput)) === snapshot.inputIdentity, 'identity');
  const source = { path: request.rootFile, content: request.files.find(file => file.path === request.rootFile)?.content };
  record(output, ['status','inputs','functions','symbols']); check(output.status === 'ok', 'schema');
  const facts = verifyClosureFacts(source, output.functions, output.symbols);
  const prepared = { inputIdentity: snapshot.inputIdentity, identityInput, ownedInput: request, files: request.files, rootFile: request.rootFile,
    declarationVersion: request.declarations.version, declarationPaths: request.declarations.paths, seen: new Set(request.files.map(file => file.path)), captureRequest: snapshot.capture.request };
  const projected = ownClosureSnapshot(prepared, output, snapshot.sourceOrigin, snapshot.capture.response).snapshot;
  check(same(snapshot, projected), 'snapshot');
  return { ...facts, source, functions: output.functions, symbols: output.symbols, request };
}
export function verifyClosureSnapshot(snapshot) {
  const facts = closureSnapshotFacts(snapshot); let calls = 0;
  const visit = value => { if (!value || typeof value !== 'object') return; if (['call','indirectCall'].includes(value.kind)) calls++;
    for (const child of Object.values(value)) if (Array.isArray(child)) child.forEach(visit); else visit(child); };
  facts.functions.forEach(fn => visit(fn.body));
  return own({ snapshotId: snapshot.snapshotId, functions: facts.functions.length, calls });
}
