// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import { Readable } from 'node:stream';
import { materializeSource, readMlirPhysicalSource, MlirBuildError } from '../../eng/mlir-build-inputs.mjs';
import { selectMlirCommandRole, selectMlirBuildPhase, finishMlirPlanning } from '../../eng/mlir-command.mjs';
import { readMlirBuildTrace, executeMlirTarget } from '../../eng/mlir-build.mjs';
import { readCmakeTraceEvents } from '../../eng/mlir-cmake-evaluation.mjs';
import { readMlirDirectSourceSelection, mlirRoleConfiguration, assertMlirRoleCache,
  assertMlirRoleDependency, requireMlirSourceDependency } from '../../eng/mlir-static-closure.mjs';
import { readMlirLegalRegistration } from '../../eng/mlir-source-registration.mjs';
import { sourceGitEnvironment } from '../../eng/intake-ledger.mjs';
import { createMlirFixture } from './mlir-fixtures.mjs';

const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const traceStream = text => Readable.from([Buffer.from(text)]);
async function fixture() {
  const root = await createMlirFixture('direct-static-');
  const sourceRoot = path.join(root, 'upstream');
  await mkdir(path.join(sourceRoot, 'llvm'), { recursive: true });
  const git = process.env.TSFG_GIT;
  assert.ok(git, 'fixture Git must be explicit');
  const run = (args, input = undefined) => {
    const child = spawnSync(git, args, { cwd: sourceRoot, input, encoding: 'utf8',
      env: sourceGitEnvironment(), windowsHide: true });
    assert.ifError(child.error); assert.equal(child.status, 0, child.stderr);
    return child.stdout.trim();
  };
  run(['init', '--quiet']);
  const entries = [];
  for (const name of ['selected.cpp', 'unselected.cpp']) {
    const bytes = Buffer.from('// ordinary controlled fixture ' + name + '\n');
    await writeFile(path.join(sourceRoot, 'llvm', name), bytes);
    const blob = run(['hash-object', '-w', '--stdin'], bytes);
    entries.push({ projectId: 'llvm-project.git', repositoryRelativePath: 'llvm/' + name,
      normalizedMode: '100644', blob, sha256: hash(bytes) });
  }
  const llvm = run(['mktree'], entries.map(row => `100644 blob ${row.blob}\t${path.basename(row.repositoryRelativePath)}\n`).join(''));
  const tree = run(['mktree'], `040000 tree ${llvm}\tllvm\n`);
  return { root, git, identity: { sourceRoot, sourceCommit: tree, sourceTree: tree }, entries };
}

test('direct static materialization reads and copies only its exact qualified selection', async () => {
  const { root, git, identity, entries } = await fixture();
  const destination = path.join(root, 'staged');
  const selection = { sourceCommit: identity.sourceCommit, sourceTree: identity.sourceTree, entries: [entries[0]] };
  const result = await materializeSource(identity, git, destination, selection);
  assert.deepEqual(await readdir(path.join(destination, 'llvm')), ['selected.cpp'],
    'unselected ordinary source must never be copied by the static factory');
  assert.deepEqual(result.entries, [entries[0]]);
  assert.equal(hash(await readFile(path.join(destination, 'llvm/selected.cpp'))), entries[0].sha256);
});

test('unselected missing bodies cannot block or be read by selected source materialization', async () => {
  const { root, git, identity, entries } = await fixture();
  await rename(path.join(identity.sourceRoot, 'llvm/unselected.cpp'), path.join(root, 'unselected-original.cpp'));
  await materializeSource(identity, git, path.join(root, 'staged'), { ...identity, entries: [entries[0]] });
});

for (const damage of ['missing', 'sha', 'blob', 'mode', 'duplicate', 'escape', 'absolute', 'backslash', 'identity']) {
  test('selected source refuses ' + damage + ' before copying any input', async () => {
    const { root, git, identity, entries } = await fixture();
    const row = { ...entries[0] };
    const selection = { ...identity, entries: [row] };
    if (damage === 'missing') row.repositoryRelativePath = 'llvm/missing.cpp';
    if (damage === 'sha') row.sha256 = 'sha256:' + '0'.repeat(64);
    if (damage === 'blob') row.blob = '0'.repeat(40);
    if (damage === 'mode') row.normalizedMode = '100755';
    if (damage === 'duplicate') selection.entries.push({ ...row });
    if (damage === 'escape') row.repositoryRelativePath = 'llvm/../outside.cpp';
    if (damage === 'absolute') row.repositoryRelativePath = 'E:/outside.cpp';
    if (damage === 'backslash') row.repositoryRelativePath = 'llvm/dir\\escape.cpp';
    if (damage === 'identity') selection.sourceCommit = '0'.repeat(40);
    const destination = path.join(root, 'staged');
    await assert.rejects(materializeSource(identity, git, destination, selection), { issueCode: 'mlir-source-integrity' });
    assert.deepEqual(await readdir(root), ['upstream']);
  });
}

test('selected source refuses mutated bytes, source junctions and redirected output ancestors', async () => {
  for (const damage of ['bytes', 'source-parent', 'output-parent']) {
    const { root, git, identity, entries } = await fixture();
    const destination = path.join(root, 'staged');
    if (damage === 'bytes') await writeFile(path.join(identity.sourceRoot, 'llvm/selected.cpp'), 'changed fixture bytes');
    if (damage === 'source-parent') {
      await rename(path.join(identity.sourceRoot, 'llvm'), path.join(root, 'saved-llvm'));
      await symlink(path.join(root, 'saved-llvm'), path.join(identity.sourceRoot, 'llvm'), 'junction');
    }
    if (damage === 'output-parent') {
      await mkdir(path.join(root, 'saved-output'));
      await symlink(path.join(root, 'saved-output'), destination, 'junction');
    }
    await assert.rejects(materializeSource(identity, git, destination, { ...identity, entries: [entries[0]] }),
      { issueCode: 'mlir-source-integrity' });
    if (damage === 'output-parent') assert.deepEqual(await readdir(path.join(root, 'saved-output')), []);
  }
});

const staticRole = selectMlirCommandRole(new Map([['--core-command-role', 'static']]));
const nativeRole = selectMlirCommandRole(new Map());
test('static role excludes optional LLVM declarations and preserves required project and generator entries', () => {
  const sourceEntries = ['llvm/tools/llvm-config/CMakeLists.txt', 'llvm/tools/opt/CMakeLists.txt',
    'llvm/tools/mlir/CMakeLists.txt', 'llvm/tools/tsfg-core-ir/CMakeLists.txt',
    'llvm/utils/TableGen/CMakeLists.txt', 'mlir/tools/mlir-tblgen/CMakeLists.txt']
    .map(repositoryRelativePath => ({ repositoryRelativePath }));
  assert.deepEqual(mlirRoleConfiguration(staticRole, sourceEntries), [
    '-DTSFG_CORE_BUILD_ROLE=static', '-DLLVM_TARGETS_TO_BUILD=', '-DLLVM_EXPERIMENTAL_TARGETS_TO_BUILD=',
    '-DLLVM_INCLUDE_TOOLS=ON', '-DLLVM_INCLUDE_UTILS=OFF',
    '-DLLVM_TOOL_MLIR_BUILD=ON', '-DLLVM_TOOL_TSFG_CORE_IR_BUILD=ON',
    '-DLLVM_TOOL_LLVM_CONFIG_BUILD=OFF', '-DLLVM_TOOL_OPT_BUILD=OFF']);
  assert.deepEqual(mlirRoleConfiguration(nativeRole, sourceEntries), [
    '-DTSFG_CORE_BUILD_ROLE=native', '-DLLVM_TARGETS_TO_BUILD=X86', '-DLLVM_EXPERIMENTAL_TARGETS_TO_BUILD=']);
  const cache = 'TSFG_CORE_BUILD_ROLE:STRING=static\nLLVM_TARGETS_TO_BUILD:STRING=\nLLVM_EXPERIMENTAL_TARGETS_TO_BUILD:STRING=\n' +
    'LLVM_INCLUDE_TOOLS:BOOL=ON\nLLVM_INCLUDE_UTILS:BOOL=OFF\nLLVM_TOOL_MLIR_BUILD:BOOL=ON\n' +
    'LLVM_TOOL_TSFG_CORE_IR_BUILD:BOOL=ON\nLLVM_TOOL_LLVM_CONFIG_BUILD:BOOL=OFF\nLLVM_TOOL_OPT_BUILD:BOOL=OFF\n';
  assertMlirRoleCache(staticRole, cache, sourceEntries);
  for (const line of cache.trim().split('\n').slice(3)) {
    const changed = line.endsWith('=ON') ? line.replace('=ON', '=OFF') : line.replace('=OFF', '=ON');
    for (const bad of [cache.replace(line, changed), cache.replace(line + '\n', '')])
      assert.throws(() => assertMlirRoleCache(staticRole, bad, sourceEntries), { issueCode: 'mlir-source-integrity' });
  }
});

test('static role cache accepts defined CMake BOOL constants without loosening role strings', () => {
  // Real CMake emitted TRUE for both required project entries in ACTUAL04.
  const cache = 'TSFG_CORE_BUILD_ROLE:STRING=static\nLLVM_TARGETS_TO_BUILD:STRING=\n' +
    'LLVM_EXPERIMENTAL_TARGETS_TO_BUILD:STRING=\nLLVM_INCLUDE_TOOLS:BOOL=TRUE\n' +
    'LLVM_INCLUDE_UTILS:BOOL=FALSE\nLLVM_TOOL_MLIR_BUILD:BOOL=TRUE\nLLVM_TOOL_TSFG_CORE_IR_BUILD:BOOL=TRUE\n';
  for (const on of ['ON', 'TRUE', 'true', 'YES', 'Y', '1'])
    assert.doesNotThrow(() => assertMlirRoleCache(staticRole, cache.replaceAll('=TRUE', '=' + on)));
  for (const off of ['OFF', 'FALSE', 'false', 'NO', 'N', '0', 'IGNORE', 'NOTFOUND', 'dependency-NOTFOUND', ''])
    assert.doesNotThrow(() => assertMlirRoleCache(staticRole, cache.replace('=FALSE', '=' + off)));
  for (const [name, value] of [
    ['LLVM_INCLUDE_TOOLS', 'FALSE'], ['LLVM_TOOL_MLIR_BUILD', 'FALSE'],
    ['LLVM_TOOL_TSFG_CORE_IR_BUILD', '0'], ['LLVM_INCLUDE_UTILS', 'TRUE'],
    ['LLVM_TOOL_MLIR_BUILD', 'unknown'], ['LLVM_INCLUDE_UTILS', 'unknown'],
    ['LLVM_TOOL_MLIR_BUILD', 'TRUE;FALSE'], ['LLVM_TOOL_MLIR_BUILD', ' TRUE '],
  ]) {
    const bad = cache.replace(new RegExp('^' + name + ':BOOL=.*$', 'm'), name + ':BOOL=' + value);
    assert.throws(() => assertMlirRoleCache(staticRole, bad), { issueCode: 'mlir-source-integrity' });
  }
  for (const bad of [
    cache.replace('LLVM_INCLUDE_UTILS:BOOL=FALSE\n', ''),
    cache.replace('LLVM_TOOL_MLIR_BUILD:BOOL=TRUE\n', ''),
    cache.replace('TSFG_CORE_BUILD_ROLE:STRING=static', 'TSFG_CORE_BUILD_ROLE:STRING=TRUE'),
    cache.replace('LLVM_TARGETS_TO_BUILD:STRING=', 'LLVM_TARGETS_TO_BUILD:STRING=FALSE'),
    cache.replace('LLVM_TARGETS_TO_BUILD:STRING=', 'LLVM_TARGETS_TO_BUILD:STRING=X86'),
  ]) assert.throws(() => assertMlirRoleCache(staticRole, bad), { issueCode: 'mlir-source-integrity' });
});

test('static role uses no LLVM backend, native preserves X86, and cache drift fails closed', () => {
  assert.deepEqual(mlirRoleConfiguration(staticRole), ['-DTSFG_CORE_BUILD_ROLE=static',
    '-DLLVM_TARGETS_TO_BUILD=', '-DLLVM_EXPERIMENTAL_TARGETS_TO_BUILD=',
    '-DLLVM_INCLUDE_TOOLS=ON', '-DLLVM_INCLUDE_UTILS=OFF',
    '-DLLVM_TOOL_MLIR_BUILD=ON', '-DLLVM_TOOL_TSFG_CORE_IR_BUILD=ON']);
  assert.deepEqual(mlirRoleConfiguration(nativeRole), ['-DTSFG_CORE_BUILD_ROLE=native',
    '-DLLVM_TARGETS_TO_BUILD=X86', '-DLLVM_EXPERIMENTAL_TARGETS_TO_BUILD=']);
  const cache = 'TSFG_CORE_BUILD_ROLE:STRING=static\nLLVM_TARGETS_TO_BUILD:STRING=\nLLVM_EXPERIMENTAL_TARGETS_TO_BUILD:STRING=\n' +
    'LLVM_INCLUDE_TOOLS:BOOL=ON\nLLVM_INCLUDE_UTILS:BOOL=OFF\nLLVM_TOOL_MLIR_BUILD:BOOL=ON\nLLVM_TOOL_TSFG_CORE_IR_BUILD:BOOL=ON\n';
  assertMlirRoleCache(staticRole, cache);
  for (const bad of [cache.replace('STRING=\n', 'STRING=X86\n'), cache.replace('=static', '=native'),
    cache.replace('LLVM_EXPERIMENTAL_TARGETS_TO_BUILD:STRING=\n', '')])
    assert.throws(() => assertMlirRoleCache(staticRole, bad), { issueCode: 'mlir-source-integrity' });
});

test('real pinned registration selects no X86 bodies and cannot transfer source identity', async () => {
  const { lock } = await readMlirLegalRegistration('build');
  const identity = { sourceCommit: lock.sourceCommit, baseCommit: lock.baseCommit,
    sourceTree: '0'.repeat(40), inspectedFiles: [] };
  const result = await readMlirDirectSourceSelection(identity, staticRole);
  assert.ok(result.entries.length > 6000);
  assert.equal(result.entries.some(row => row.repositoryRelativePath.startsWith('llvm/lib/Target/X86/')), false);
  assert.ok(result.entries.some(row => row.repositoryRelativePath === 'llvm/lib/Analysis/AliasAnalysis.cpp'));
  assert.ok(result.entries.some(row => row.repositoryRelativePath === 'llvm/lib/Target/ARM/ARMCallingConv.td'));
  await assert.rejects(readMlirDirectSourceSelection({ ...identity, sourceCommit: '0'.repeat(40) }, staticRole),
    { issueCode: 'mlir-source-integrity' });
  assert.equal(await readMlirDirectSourceSelection(identity, nativeRole), null);
});

test('planned/final source and link admission rejects native and backend edges before a body read', async () => {
  const root = await createMlirFixture('static-edges-');
  const roots = { source: path.join(root, 'source'), product: path.join(root, 'product'), build: path.join(root, 'build') };
  const forbidden = [path.join(roots.source, 'llvm/lib/Target/X86/CMakeLists.txt'),
    path.join(roots.source, 'llvm/lib/Target/AArch64/AArch64TargetMachine.cpp'),
    path.join(roots.product, 'compiler/core-ir/native_cost.cpp'), path.join(roots.product, 'compiler/core-ir/aot-lowering.cpp'),
    path.join(roots.build, 'lib/LLVMX86Desc.lib'), path.join(roots.build, 'lib/LLVMCodeGen.lib'),
    path.join(roots.build, 'lib/LLVMLoongArchDesc.lib'), path.join(roots.build, 'compiler/core-ir/tsfg-core-ir.dir/main.cpp.obj')];
  for (const file of forbidden) {
    assert.throws(() => assertMlirRoleDependency(staticRole, file, roots), { issueCode: 'mlir-source-integrity' });
    assertMlirRoleDependency(nativeRole, file, roots);
  }
  for (const file of ['llvm/lib/Support/Process.cpp', 'llvm/lib/Target/ARM/ARMCallingConv.td'])
    assertMlirRoleDependency(staticRole, path.join(roots.source, file), roots);
  // The required mlir-tblgen generator links shared MVT/LLT types, not an emitter.
  for (const name of ['LLVMCodeGenTypes.lib', 'libLLVMCodeGenTypes.a'])
    assert.doesNotThrow(() => assertMlirRoleDependency(staticRole, path.join(roots.build, 'lib', name), roots));
  for (const file of [path.join(roots.build, 'lib/LLVMCodeGenTypesExtra.lib'),
    path.join(roots.build, 'lib/LLVMCodeGenTypes.dll'), path.join(roots.build, 'lib/LLVMCodeGenTypes.obj'),
    path.join(roots.build, 'other/LLVMCodeGenTypes.lib'), path.join(root, 'LLVMCodeGenTypes.lib'),
    path.join(roots.build, 'lib/LLVMSelectionDAG.lib'), path.join(roots.build, 'lib/LLVMAsmPrinter.lib'),
    path.join(roots.build, 'lib/LLVMGlobalISel.lib'), path.join(roots.build, 'lib/LLVMOrcJIT.lib')])
    assert.throws(() => assertMlirRoleDependency(staticRole, file, roots), { issueCode: 'mlir-source-integrity' });
  const physical = forbidden[0];
  const cmakeTrace = [{ file: physical, line: 1, cmd: 'cmake_language', args: ['EVAL','CODE','set(x y)'] },
    { file: physical + ':1:EVAL', line: 1, cmd: 'set', args: ['x','y'] }].map(row => JSON.stringify(row)).join('\n');
  await assert.rejects(readMlirBuildTrace({ cmakeTrace: traceStream(cmakeTrace), build: roots.build,
    inputRoots: [roots.source, roots.product], command: staticRole }), { issueCode: 'mlir-source-integrity' });
});

test('unknown ordinary source and EVAL dependencies report the exact gap before body access', async () => {
  const root = await createMlirFixture('static-missing-dependency-');
  const source = path.join(root, 'source'), build = path.join(root, 'build');
  const physical = path.join(source, 'llvm/configuration-unknown.cmake');
  const missing = error => error.issueCode === 'mlir-source-integrity' && error.sourceBodyRead === false &&
    JSON.stringify(error.missingPaths) === '["llvm/configuration-unknown.cmake"]';
  assert.throws(() => requireMlirSourceDependency(physical, source, new Map()), missing);
  const cmakeTrace = [{ file: physical, line: 1, cmd: 'cmake_language', args: ['EVAL','CODE','set(x y)'] },
    { file: physical + ':1:EVAL', line: 1, cmd: 'set', args: ['x','y'] }].map(row => JSON.stringify(row)).join('\n');
  await assert.rejects(readMlirBuildTrace({ cmakeTrace: traceStream(cmakeTrace), build, inputRoots: [source, path.join(root, 'product')],
    command: staticRole }), missing);
});

test('registered EVAL origin refuses an intermediate junction before reading its body', async t => {
  const root = await createMlirFixture('static-eval-redirect-');
  const source = path.join(root, 'source'), outside = path.join(root, 'outside');
  await mkdir(path.join(source, 'llvm'), { recursive: true });
  await mkdir(outside);
  const bytes = Buffer.from('cmake_language(EVAL CODE "set(x y)")\n');
  const physical = path.join(source, 'llvm/entry.cmake');
  await writeFile(physical, bytes);
  await writeFile(path.join(outside, 'entry.cmake'), bytes);
  await rename(path.join(source, 'llvm'), path.join(root, 'saved-llvm'));
  await symlink(outside, path.join(source, 'llvm'), 'junction');
  const reads = [];
  const original = fs.readFile;
  t.mock.method(fs, 'readFile', async function(file, ...args) {
    if (String(file) === physical) reads.push(String(file));
    return original.call(this, file, ...args);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const cmakeTrace = [{ file: physical, line: 1, cmd: 'cmake_language', args: ['EVAL','CODE','set(x y)'] },
    { file: physical + ':1:EVAL', line: 1, cmd: 'set', args: ['x','y'] }].map(row => JSON.stringify(row)).join('\n');
  const error = await readMlirBuildTrace({ cmakeTrace: traceStream(cmakeTrace), build: path.join(root, 'build'),
    inputRoots: [source, path.join(root, 'product')], command: staticRole,
    sourceEntries: [{ repositoryRelativePath: 'llvm/entry.cmake', sha256: hash(bytes) }] }).then(() => null, failure => failure);
  assert.deepEqual(reads, [], 'a registered lexical path must not open a junction-redirected body, even with identical bytes');
  assert.equal(error?.issueCode, 'mlir-source-integrity');
});

test('unknown static product EVAL origin refuses before reading its body', async t => {
  const root = await createMlirFixture('static-product-eval-unknown-');
  const source = path.join(root, 'source'), product = path.join(root, 'product');
  await mkdir(product);
  const physical = path.join(product, 'unknown.cmake');
  await writeFile(physical, 'cmake_language(EVAL CODE "set(x y)")\n');
  const reads = [], original = fs.readFile;
  t.mock.method(fs, 'readFile', async function(file, ...args) {
    if (String(file) === physical) reads.push(String(file));
    return original.call(this, file, ...args);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const cmakeTrace = [{ file: physical, line: 1, cmd: 'cmake_language', args: ['EVAL','CODE','set(x y)'] },
    { file: physical + ':1:EVAL', line: 1, cmd: 'set', args: ['x','y'] }].map(row => JSON.stringify(row)).join('\n');
  const error = await readMlirBuildTrace({ cmakeTrace: traceStream(cmakeTrace), build: path.join(root, 'build'),
    inputRoots: [source, product], command: staticRole }).then(() => null, failure => failure);
  assert.deepEqual(reads, [], 'a product directory does not admit an unknown EVAL body');
  assert.equal(error?.issueCode, 'mlir-source-integrity');
  assert.deepEqual(error?.missingPaths, ['unknown.cmake']);
});

test('static EVAL accepts exact ordinary source and product members and rejects changed bytes', async () => {
  const root = await createMlirFixture('static-eval-physical-positive-');
  const source = path.join(root, 'source'), product = path.join(root, 'product');
  const bytes = Buffer.from('cmake_language(EVAL CODE "set(x y)")\n');
  for (const [directory, relative] of [[source, 'llvm/entry.cmake'], [product, 'compiler/entry.cmake']]) {
    const physical = path.join(directory, relative);
    await mkdir(path.dirname(physical), { recursive: true });
    await writeFile(physical, bytes);
    const cmakeTrace = [{ file: physical, line: 1, cmd: 'cmake_language', args: ['EVAL','CODE','set(x y)'] },
      { file: physical + ':1:EVAL', line: 1, cmd: 'set', args: ['x','y'] }].map(row => JSON.stringify(row)).join('\n');
    const entry = { projectId: directory === source ? 'llvm-project.git' : 'tsfg', repositoryRelativePath: relative, sha256: hash(bytes) };
    const input = () => ({ cmakeTrace: traceStream(cmakeTrace), build: path.join(root, 'build'), inputRoots: [source, product], command: staticRole,
      sourceEntries: directory === source ? [entry] : [], productEntries: directory === product ? [entry] : [] });
    assert.deepEqual((await readMlirBuildTrace(input())).files, [physical]);
    await writeFile(physical, 'cmake_language(EVAL CODE "set(x changed)")\n');
    await assert.rejects(readMlirBuildTrace(input()), { issueCode: 'mlir-source-integrity' });
  }
});

test('registered static product EVAL refuses an intermediate junction before body access', async t => {
  const root = await createMlirFixture('static-product-eval-redirect-');
  const product = path.join(root, 'product'), outside = path.join(root, 'outside');
  await mkdir(path.join(product, 'compiler'), { recursive: true });
  await mkdir(outside);
  const bytes = Buffer.from('cmake_language(EVAL CODE "set(x y)")\n');
  const physical = path.join(product, 'compiler/entry.cmake');
  await writeFile(physical, bytes);
  await writeFile(path.join(outside, 'entry.cmake'), bytes);
  await rename(path.join(product, 'compiler'), path.join(root, 'saved-compiler'));
  await symlink(outside, path.join(product, 'compiler'), 'junction');
  const reads = [], original = fs.readFile;
  t.mock.method(fs, 'readFile', async function(file, ...args) {
    if (String(file) === physical) reads.push(String(file));
    return original.call(this, file, ...args);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const cmakeTrace = [{ file: physical, line: 1, cmd: 'cmake_language', args: ['EVAL','CODE','set(x y)'] },
    { file: physical + ':1:EVAL', line: 1, cmd: 'set', args: ['x','y'] }].map(row => JSON.stringify(row)).join('\n');
  await assert.rejects(readMlirBuildTrace({ cmakeTrace: traceStream(cmakeTrace), build: path.join(root, 'build'),
    inputRoots: [path.join(root, 'source'), product], command: staticRole,
    productEntries: [{ projectId: 'tsfg', repositoryRelativePath: 'compiler/entry.cmake', sha256: hash(bytes) }] }),
  { issueCode: 'mlir-source-integrity' });
  assert.deepEqual(reads, []);
});

test('physical source reader accepts ordinary registered bytes and rejects changed bytes', async () => {
  const root = await createMlirFixture('static-physical-positive-');
  const source = path.join(root, 'source');
  await mkdir(path.join(source, 'llvm'), { recursive: true });
  const absolute = path.join(source, 'llvm/input.cpp'), bytes = Buffer.from('// ordinary source fixture\n');
  await writeFile(absolute, bytes);
  const entry = { repositoryRelativePath: 'llvm/input.cpp', sha256: hash(bytes) };
  assert.deepEqual(await readMlirPhysicalSource(source, absolute, entry), bytes);
  await writeFile(absolute, '// changed ordinary fixture\n');
  await assert.rejects(readMlirPhysicalSource(source, absolute, entry), { issueCode: 'mlir-source-integrity' });
});

for (const damage of ['directory', 'final-junction', 'intermediate-junction', 'root-junction', 'escape', 'identity']) {
  test('physical source reader refuses ' + damage + ' before opening a body', async t => {
    const root = await createMlirFixture('static-physical-negative-');
    const source = path.join(root, 'source'), outside = path.join(root, 'outside');
    await mkdir(path.join(source, 'llvm'), { recursive: true });
    await mkdir(outside);
    const bytes = Buffer.from('// ordinary boundary fixture\n');
    const absolute = path.join(source, 'llvm/input.cpp');
    const entry = { repositoryRelativePath: 'llvm/input.cpp', sha256: hash(bytes) };
    if (damage === 'directory') await mkdir(absolute);
    if (damage === 'final-junction') await symlink(outside, absolute, 'junction');
    if (damage === 'intermediate-junction') {
      await rename(path.join(source, 'llvm'), path.join(root, 'saved-llvm'));
      await writeFile(path.join(outside, 'input.cpp'), bytes);
      await symlink(outside, path.join(source, 'llvm'), 'junction');
    }
    if (damage === 'root-junction') {
      await rename(source, path.join(root, 'saved-source'));
      await mkdir(path.join(outside, 'llvm'));
      await writeFile(path.join(outside, 'llvm/input.cpp'), bytes);
      await symlink(outside, source, 'junction');
    }
    if (damage === 'identity') entry.sha256 = '';
    const reads = [], original = fs.readFile;
    t.mock.method(fs, 'readFile', async function(file, ...args) {
      reads.push(String(file)); return original.call(this, file, ...args);
    });
    syncBuiltinESMExports();
    t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
    const requested = damage === 'escape' ? path.join(outside, 'input.cpp') : absolute;
    await assert.rejects(readMlirPhysicalSource(source, requested, entry), { issueCode: 'mlir-source-integrity' });
    assert.deepEqual(reads, []);
  });
}

test('static planning rejects unsupported roles, phases and SDK use before any intake body', async t => {
  const keys = ['TSFG_MLIR_SOURCE', 'TSFG_MLIR_SDK_ROOT', 'TSFG_MLIR_SDK_ARTIFACT_ROOT'];
  const prior = keys.map(key => process.env[key]);
  t.after(() => keys.forEach((key, index) => { if (prior[index] === undefined) delete process.env[key]; else process.env[key] = prior[index]; }));
  process.env.TSFG_MLIR_SOURCE = 'E:/phase-fixture-source-must-not-be-read';
  delete process.env.TSFG_MLIR_SDK_ROOT; delete process.env.TSFG_MLIR_SDK_ARTIFACT_ROOT;
  const reads = [], original = fs.readFile;
  t.mock.method(fs, 'readFile', async function(file, ...args) { reads.push(String(file)); return original.call(this, file, ...args); });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  for (const [role, phase, sdk] of [['native','plan',false], [undefined,'plan',false], ['static','configure',false],
    ['__proto__','plan',false], ['static','plan',true]]) {
    if (sdk) process.env.TSFG_MLIR_SDK_ROOT = 'E:/phase-fixture-sdk-must-not-be-read';
    const options = new Map([['--dev', true], ['--target', 'windows-x86_64-msvc'], ['--profile', 'debug'],
      ['--source-target', 'mlir-core'], ['--mlir-build-phase', phase]]);
    if (role) options.set('--core-command-role', role);
    await assert.rejects(executeMlirTarget({ options, runtime: undefined, tools: undefined, productRoot: 'E:/unused-phase-product',
      workspaceState: undefined, serialize: undefined, createIdentity: undefined, scopedToolchainDigest: undefined, verifyTools: undefined }),
    error => error instanceof MlirBuildError && error.issueCode === 'mlir-command-role');
  }
  assert.deepEqual(reads, []);
});

test('static planning phase cannot be attached to another build source target', () => {
  const options = new Map([['--target','windows-x86_64-msvc'],['--profile','debug'],['--out','E:/unused-phase-output'],
    ['--source-target','intake-ledger'],['--mlir-build-phase','plan']]);
  assert.throws(() => selectMlirBuildPhase(options, staticRole), error => error instanceof MlirBuildError && error.issueCode === 'mlir-command-role');
});

// Controlled postqualification data exercises the production stopping/result
// boundary. These fixtures are not CMake, compiler or dependency qualification.
async function planningFixture() {
  const stage = await createMlirFixture('static-planning-data-');
  return { phase: 'plan', command: staticRole, stage, trace: { qualification: 'data-only fixture; no tool result', files: [] },
    source: { sourceBuild: 'not-run' }, legal: {}, python: {}, productIdentity: { buildIdentity: { digest: 'fixture-only' } },
    workspaceState: { dirty: false }, serialize: JSON.stringify, verifyInputs: async () => {} };
}

test('static planning completion verifies inputs and writes only explicitly unbuilt plan evidence', async () => {
  const input = await planningFixture();
  let verifications = 0;
  input.verifyInputs = async () => { verifications++; };
  const result = await finishMlirPlanning(input);
  assert.equal(verifications, 1);
  assert.equal(result.status, 'planned'); assert.equal(result.sourceBuild, 'not-run');
  assert.equal(result.publishable, false); assert.equal(result.intakeComplete, false);
  assert.equal(result.planning.targetBuild, 'not-started');
  assert.equal(result.planning.finalDependencyClosure, 'not-qualified');
  for (const key of ['outputs','output','artifactManifest','buildInputSet','buildIdentity']) assert.equal(Object.hasOwn(result, key), false, key);
  assert.deepEqual(await readdir(input.stage), ['planned-input-trace.json']);
  assert.deepEqual(JSON.parse(await readFile(result.trace, 'utf8')), input.trace);
});

test('static planning completion cannot turn a failed recheck into planning success', async () => {
  const input = await planningFixture();
  input.verifyInputs = async () => { throw Object.assign(Error('controlled identity failure'), { issueCode: 'mlir-source-integrity' }); };
  await assert.rejects(finishMlirPlanning(input), { issueCode: 'mlir-source-integrity' });
  assert.deepEqual(await readdir(input.stage), []);
});

test('static planning completion preserves the native build continuation and rejects invalid stops', async () => {
  const input = await planningFixture();
  input.verifyInputs = async () => { assert.fail('the default full build must not run plan completion checks'); };
  assert.equal(await finishMlirPlanning({ ...input, command: nativeRole, phase: 'build' }), null);
  for (const change of [{ command: nativeRole }, { phase: 'unknown' }])
    await assert.rejects(finishMlirPlanning({ ...input, ...change }), { issueCode: 'mlir-command-role' });
  assert.deepEqual(await readdir(input.stage), []);
});

// The current dev main is the already verified generic49 command implementation.
test('native materialization retains its complete raw fixture without a static transformation policy',async()=>{
  const {root,git,identity,entries}=await fixture();
  const result=await materializeSource(identity,git,path.join(root,'native-staged'));
  assert.deepEqual(result.entries,entries);
});
test('dev generic main is an exact ordinary product dependency, not a native backend label',async()=>{
  const root=await createMlirFixture('static-generic-main-');
  const roots={source:path.join(root,'source'),product:path.join(root,'product'),build:path.join(root,'build')};
  assert.doesNotThrow(()=>assertMlirRoleDependency(staticRole,path.join(roots.product,'compiler/core-ir/main.cpp'),roots));
});

// Public CLI rejection is checked before any source or runtime intake can begin.
test('CLI Core role and phase errors preserve the production configuration category',async()=>{
  const root=await createMlirFixture('static-cli-role-'),env={SystemRoot:process.env.SystemRoot,ComSpec:process.env.ComSpec,
    PATH:process.env.PATH,HOME:root,USERPROFILE:root,APPDATA:root,LOCALAPPDATA:root,TEMP:root,TMP:root,TMPDIR:root,
    TZ:'UTC',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_DISABLE_COMPILE_CACHE:'1'};
  const controls=[['--core-command-role','__proto__'],['--core-command-role','native','--mlir-build-phase','plan'],
    ['--core-command-role','static','--mlir-build-phase','configure']];
  for(const [index,extra]of controls.entries()){
    const report=path.join(root,'report-'+index+'.json'),child=spawnSync(process.execPath,
      [fileURLToPath(new URL('../../eng/tsfg-build.mjs',import.meta.url)),'build','--dev','--target','windows-x86_64-msvc',
        '--profile','debug','--source-target','mlir-core','--out',path.join(root,'out-'+index),'--report',report,...extra],
      {env,encoding:'utf8',windowsHide:true,timeout:30000});
    assert.ifError(child.error);assert.equal(child.status,2,child.stderr);
    const result=JSON.parse(await readFile(report,'utf8'));assert.equal(result.error.category,'usage/configuration');
    assert.equal(result.error.issues[0].code,'mlir-configuration');
  }
  assert.deepEqual((await readdir(root)).sort(),['report-0.json','report-1.json','report-2.json']);
});


test('CMake trace parser preserves version headers and narrows consumed fields once',async()=>{
  const header={version:{major:1,minor:2}},event={file:'/src/CMakeLists.txt',cmd:'cmake_language',
    args:['EVAL','CODE','message("hi")'],line:7,time:0.5};
  const raw=[header,event].map(record=>JSON.stringify(record)).join('\n')+'\n',records=[];
  const stats=await readCmakeTraceEvents(traceStream(raw),record=>{records.push(record);});
  assert.deepEqual(records,[header,event]);assert.equal(stats.records,2);assert.equal(stats.sha256,hash(raw));
  for(const record of [null,[],7,{file:7},{cmd:7},{args:{}},{args:[7]},{line:'7'}]){
    const consumed=[];
    await assert.rejects(readCmakeTraceEvents(traceStream(JSON.stringify(record)+'\n'),event=>{consumed.push(event);}),
      {name:'TypeError',message:'CMake trace record has invalid consumed fields'});
    assert.deepEqual(consumed,[]);
  }
});
