// SPDX-License-Identifier: MIT
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { MlirBuildError } from './mlir-build-inputs.mjs';
import { readMlirLegalRegistration } from './mlir-source-registration.mjs';
import { readMlirStagedSourcePolicy, mlirStagedSourceDescriptor } from './mlir-source-legal.mjs';

const reject = message => { throw new MlirBuildError(message, 'mlir-source-integrity'); };
const within = (root, file) => {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const nativeProduct = /(?:^|\/)(?:aot[^/]*|main|native_cost)\.cpp$/i;
const backendLibrary = /(?:^|\/)(?:lib)?LLVM(?:AArch64|AMDGPU|ARC|ARM|AVR|BPF|CSKY|DirectX|Hexagon|Lanai|LoongArch|M68k|Mips|MSP430|NVPTX|PowerPC|RISCV|Sparc|SPIRV|SystemZ|VE|WebAssembly|X86|XCore|Xtensa|CodeGen|AsmPrinter|SelectionDAG|GlobalISel|ExecutionEngine|MCJIT|Orc|JITLink|RuntimeDyld)[^/]*\.(?:lib|a|obj|o|dll)$/i;
// TargetParser's registered shared generators consume these TableGen families
// even without selecting a code generator. This is source selection only: the
// actual planned and compiler-discovered dependencies must still reconcile.
export function isStaticCoreSourcePath(name) {
  const backend = /^llvm\/lib\/Target\/([^/]+)\//.exec(name);
  return !backend || (/^(AArch64|ARM|PowerPC|RISCV)$/.test(backend[1]) && name.endsWith('.td'));
}

/** A finite candidate, not a claim that CMake or link dependencies are closed.
 * Only the existing pinned registrations supply upstream body identities.
 * Nothing enumerated from the Git tree can extend this selection.
 */
export async function readMlirDirectSourceSelection(identity, command) {
  if (command.role !== 'static') return null;
  const build = await readMlirLegalRegistration('build');
  const file = await readMlirLegalRegistration('file');
  const notices = JSON.parse(await readFile(new URL('./mlir-source-notices.lock.json', import.meta.url), 'utf8'));
  for (const lock of [build.lock, file.lock, notices]) {
    if (lock.baseCommit !== identity.baseCommit || lock.sourceCommit !== identity.sourceCommit)
      reject('Static source registration has another immutable source identity');
  }
  if (build.lock.role !== 'compiler-side-M01') reject('Static source registration has another source role');
  const stagedPolicy = await readMlirStagedSourcePolicy(identity);
  const selected = new Map();
  for (const row of [...build.lock.files, ...build.lock.licenseMaterials, ...file.lock.files,
    ...notices.files, ...identity.inspectedFiles]) {
    if (!isStaticCoreSourcePath(row.path)) continue;
    const entry = { repositoryRelativePath: row.path, blob: row.blob, sha256: row.sha256 };
    const stagedTransform = mlirStagedSourceDescriptor(stagedPolicy, row.path);
    if (stagedTransform) Object.assign(entry, { stagedTransform });
    const prior = selected.get(row.path);
    if (prior && (prior.blob !== entry.blob || prior.sha256 !== entry.sha256))
      reject('Conflicting static source registration: ' + row.path);
    selected.set(row.path, entry);
  }
  return { sourceCommit: identity.sourceCommit, sourceTree: identity.sourceTree,
    registrationLockSha256: build.sha256, fileApprovalLockSha256: file.sha256,
    qualification: 'finite registered candidate; actual configuration and link closure remain unproven',
    entries: [...selected.values()].sort((a, b) => Buffer.from(a.repositoryRelativePath).compare(Buffer.from(b.repositoryRelativePath))) };
}

/** Explicit build responsibilities over the unchanged complete Core language. */
export function mlirRoleConfiguration(command, sdk = null, sourceEntries = []) {
  const configuration = [`-DTSFG_CORE_BUILD_ROLE=${command.role}`, ...(sdk ? [] : [
    `-DLLVM_TARGETS_TO_BUILD=${command.native ? 'X86' : ''}`, '-DLLVM_EXPERIMENTAL_TARGETS_TO_BUILD='])];
  if (command.role !== 'static' || sdk) return configuration;
  // LLVM's tools directory also admits MLIR and the external Core project.
  // Keep that entry point, but disable its optional per-tool subdirectories.
  const required = new Set(['MLIR', 'TSFG_CORE_IR']);
  const tools = new Set(sourceEntries.flatMap(entry => {
    const directory = /^llvm\/tools\/([^/]+)\/CMakeLists\.txt$/.exec(entry.repositoryRelativePath);
    const name = directory?.[1].replaceAll('-', '_').toUpperCase();
    return name && !required.has(name) ? [name] : [];
  }));
  return [...configuration, '-DLLVM_INCLUDE_TOOLS=ON', '-DLLVM_INCLUDE_UTILS=OFF',
    '-DLLVM_TOOL_MLIR_BUILD=ON', '-DLLVM_TOOL_TSFG_CORE_IR_BUILD=ON',
    ...[...tools].sort().map(name => `-DLLVM_TOOL_${name}_BUILD=OFF`)];
}

export function assertMlirRoleCache(command, cache, sourceEntries = []) {
  const value = name => cache.match(new RegExp(`^${name}:[^=\\r\\n]+=([^\\r\\n]*)`, 'm'))?.[1];
  if (value('TSFG_CORE_BUILD_ROLE') !== command.role) reject('Configured Core build role differs from its identity');
  if (command.role !== 'static') return;
  for (const flag of mlirRoleConfiguration(command, null, sourceEntries).slice(1)) {
    const separator = flag.indexOf('='), name = flag.slice(2, separator), expected = flag.slice(separator + 1);
    const key = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (value(key) !== expected) reject('Static configuration selected or omitted a required role setting: ' + name);
  }
}

/** Runs before a dependency body (including a CMake EVAL origin) is read. */
export function assertMlirRoleDependency(command, absolute, { source, product, build }) {
  if (command?.role !== 'static') return;
  const name = absolute.replaceAll('\\', '/');
  if (within(source, absolute) && !isStaticCoreSourcePath(path.relative(source, absolute).replaceAll('\\', '/')))
    reject('Static dependency selected an unqualified LLVM backend: ' + name);
  if (within(product, absolute) && nativeProduct.test(path.relative(product, absolute).replaceAll('\\', '/')))
    reject('Static dependency selected a native product implementation: ' + name);
  if (backendLibrary.test(name) ||
      (within(build, absolute) && /(?:^|\/)(?:lib\/Target\/(?!CMake)|[^/]*tsfg-core-ir(?:\.dir|\.exe|\.pdb))/.test(name)))
    reject('Static dependency selected a native/backend build artifact: ' + name);
}

/** Shared planned/final/EVAL admission. A missing source identity fails before
 * the caller opens its body; the precise local gap survives in diagnostics.
 */
export function requireMlirSourceDependency(absolute, source, inventory) {
  const relative = path.relative(source, absolute).replaceAll('\\', '/');
  const entry = within(source, absolute) ? inventory.get(relative.toLowerCase()) : null;
  if (!entry) throw Object.assign(new MlirBuildError('Unregistered source dependency: ' + relative,
    'mlir-source-integrity'), { missingPaths: [relative], sourceBodyRead: false });
  return entry;
}
