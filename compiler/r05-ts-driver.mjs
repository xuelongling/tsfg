// SPDX-License-Identifier: MIT
// Unified Direct TypeScript -> Go Frontend -> HIR -> Core MLIR -> TSFGR05B -> Zig R05 VM Driver.
// Supports single-file AND multi-file TypeScript modules (with deterministic relative import
// resolution and embedded official tsfg prelude — zero runtime dependency on test fixtures or
// hardcoded drive letters). Enforces tsfg static-subset boundaries with zero JS fallback.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { canonical } from './identity.mjs';
import { commonSourceFormatV3 } from './common-program-common.mjs';
import { readCommonProgramFacts } from './common-program-facts.mjs';
import { projectCommonProgram } from './common-program-hir.mjs';
import { createCommonProgramPublication } from './common-program-analysis.mjs';
import { emitCommonProgramCore } from './common-program-core.mjs';
import { lowerCommonCoreToR05Bytecode } from './r05-bytecode-lower.mjs';
import {
  TSFG_FRONTEND_CONFIG,
  TSFG_FRONTEND_DECLARATIONS,
  TSFG_FRONTEND_TARGET,
  TSFG_PRELUDE_DTS,
  TSFG_PRELUDE_SHA256,
  TSFG_PRELUDE_VIRTUAL_PATH,
} from './stdlib/tsfg-prelude.mjs';
import {
  REPO_ROOT,
  resolveCoreIrExe,
  resolveFrontendExe,
  resolveR05VmExe,
  resolveZigCacheEnv,
  resolveZigExe,
} from './tsfg-paths.mjs';

const FORBIDDEN_TS_RULES = [
  { code: 'r01-forbid-any', re: /:\s*any\b|\bas\s+any\b|<any>/, msg: '`any` type is forbidden in tsfg' },
  { code: 'r01-forbid-eval', re: /\beval\s*\(|new\s+Function\s*\(/, msg: 'dynamic `eval`/`Function` is forbidden in tsfg' },
  { code: 'r01-forbid-proxy', re: /\bnew\s+Proxy\s*\(/, msg: '`Proxy` is forbidden in tsfg' },
  { code: 'r01-forbid-proto', re: /\b__proto__\b|Object\.setPrototypeOf\s*\(/, msg: 'prototype mutation is forbidden in tsfg' },
  { code: 'r01-forbid-delete', re: /\bdelete\s+[A-Za-z_$][\w$.[\]]*/, msg: 'dynamic property deletion is forbidden in tsfg' },
  { code: 'r01-forbid-loose-eq', re: /[^=!<>]==[^=]|[^!]!=[^=]/, msg: 'loose equality (`==`/`!=`) is forbidden in tsfg; use `===`/`!==`' },
  { code: 'r01-forbid-js-import', re: /from\s+['"][^'"]+\.(?:m?js|cjs)['"]/, msg: 'JS module imports are forbidden in tsfg' },
];

export function checkTsfgForbiddenSyntax(filePath, sourceText) {
  if (/\.(?:m?js|cjs)$/i.test(filePath)) {
    return [{ code: 'r01-forbid-js-file', message: `JS input file '${filePath}' is forbidden in tsfg` }];
  }
  const stripped = sourceText.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const diags = [];
  for (const rule of FORBIDDEN_TS_RULES) {
    if (rule.re.test(stripped)) {
      diags.push({ code: rule.code, message: rule.msg });
    }
  }
  return diags;
}

/**
 * Normalize tsfg architecture marker aliases (`@value` / `@component`) to the Go frontend's
 * recognized standard class decorators (`@tsfgValue` / `@tsfgComponent`) outside comments/strings
 * while preserving exact line count and UTF-16 anchor structure when possible.
 */
function normalizeTsfgMarkers(sourceText) {
  return sourceText
    .replace(/(^|\s)@value\b/gm, '$1@tsfgValue')
    .replace(/(^|\s)@component\b/gm, '$1@tsfgComponent');
}

/**
 * Discover relative `.ts` imports transitively from a root `.ts` file on disk
 * so multi-module TypeScript projects compile cleanly through the Go TypeScript frontend.
 */
export function collectTsModuleGraphFromDisk(rootAbsPath, projectRoot = path.dirname(rootAbsPath)) {
  const normRoot = path.resolve(projectRoot);
  const visited = new Map(); // virtualPath -> { virtualPath, absPath, content }
  const importOrder = [];

  const toVirtual = (absPath) => {
    const rel = path.relative(normRoot, absPath).replaceAll('\\', '/');
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new TypeError(`r05-module-escape: imported module '${absPath}' escapes project root '${normRoot}'`);
    }
    return `/src/${rel}`;
  };

  const resolveImport = (fromAbs, spec) => {
    if (/\.(?:m?js|cjs)$/i.test(spec)) {
      throw new TypeError(`r01-forbid-js-import: JS module import '${spec}' is forbidden in tsfg`);
    }
    if (!spec.startsWith('./') && !spec.startsWith('../')) return null;
    const base = path.resolve(path.dirname(fromAbs), spec);
    const candidates = spec.endsWith('.ts')
      ? [base]
      : [`${base}.ts`, path.join(base, 'index.ts')];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
    throw new TypeError(`r05-module-not-found: cannot resolve import '${spec}' from '${fromAbs}'`);
  };

  const visit = (absPath) => {
    const resolved = path.resolve(absPath);
    const vpath = toVirtual(resolved);
    if (visited.has(vpath)) return;
    const content = readFileSync(resolved, 'utf8');
    visited.set(vpath, { virtualPath: vpath, absPath: resolved, content });

    const stripped = content.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const re = /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(stripped)) !== null) {
      const targetAbs = resolveImport(resolved, m[1]);
      if (targetAbs) visit(targetAbs);
    }
    importOrder.push(vpath);
  };

  visit(rootAbsPath);
  return {
    rootVirtualPath: toVirtual(path.resolve(rootAbsPath)),
    files: [...visited.values()],
    importOrder,
  };
}

export async function ensureR05VmBinary(vmExePath = undefined, opts = {}) {
  const targetExe = resolveR05VmExe(vmExePath);
  if (existsSync(targetExe) && !opts.forceRebuild) return targetExe;
  const zigExe = resolveZigExe(opts.zig);
  await mkdir(path.dirname(targetExe), { recursive: true });
  const res = spawnSync(
    zigExe,
    [
      'build-exe',
      'r05-vm-cli.zig',
      '-target', 'x86_64-windows-msvc',
      '-mcpu', 'x86_64_v2',
      '-O', 'ReleaseSafe',
      '-fno-lto',
      `-femit-bin=${targetExe}`,
    ],
    {
      cwd: path.join(REPO_ROOT, 'runtime'),
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      env: resolveZigCacheEnv(),
    },
  );
  if (res.status !== 0) {
    throw new Error(`r05-driver: failed to build tsfg-r05-vm.exe:\n${res.stderr.toString('utf8')}`);
  }
  return targetExe;
}

/**
 * Compile one or more TypeScript files through the official Go TypeScript frontend,
 * HIR, C++ MLIR canonicalizer (`tsfg-core-ir.exe`), and `TSFGR05B` bytecode lowerer.
 *
 * Accepts either:
 *   - `files`: `Array<{ path: '/src/...', content: string }>` (multi-file modules!)
 *   - or via `compileTsSourceToR05Bytecode(sourceText, opts)` for single-file calls.
 */
export function compileTsFilesToCoreAndR05(files, opts = {}) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new TypeError('r05-driver: at least one TypeScript source file is required');
  }
  const rootFile = opts.rootFile ?? files[0].path;
  const entryNames = opts.entries ?? [opts.entry ?? 'main'];

  const sha = (s) => createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
  const normalizedFiles = [];
  for (const f of files) {
    const forbidden = checkTsfgForbiddenSyntax(f.path, f.content);
    if (forbidden.length > 0) {
      const first = forbidden[0];
      const err = new TypeError(`${first.code}: ${first.message}`);
      err.diagnostics = forbidden;
      throw err;
    }
    const content = normalizeTsfgMarkers(f.content);
    normalizedFiles.push({
      path: f.path.startsWith('/src/') ? f.path : `/src/${f.path.replace(/^\/+/, '')}`,
      content,
      sha256: sha(content),
    });
  }

  // Always include the embedded official prelude `.d.ts` (zero dependency on tests/r03 fixtures)
  if (!normalizedFiles.some((f) => f.path === TSFG_PRELUDE_VIRTUAL_PATH)) {
    normalizedFiles.push({
      path: TSFG_PRELUDE_VIRTUAL_PATH,
      content: TSFG_PRELUDE_DTS,
      sha256: TSFG_PRELUDE_SHA256,
    });
  }
  normalizedFiles.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const tsModules = normalizedFiles.filter((f) => f.path.endsWith('.ts') && !f.path.endsWith('.d.ts'));
  const sortedEntries = [...new Set(entryNames)].sort();
  const req = {
    family: 'tsfg.program-facts-request-candidate',
    version: commonSourceFormatV3.version,
    schemaHash: commonSourceFormatV3.schemaHash,
    input: {
      sourceRoot: '/src',
      rootFile,
      files: normalizedFiles,
      declarations: TSFG_FRONTEND_DECLARATIONS,
      config: TSFG_FRONTEND_CONFIG,
      target: TSFG_FRONTEND_TARGET,
      compilationClosure: {
        roots: [
          ...sortedEntries.map((name) => ({ kind: 'application', sourcePath: rootFile, name })),
          ...tsModules.map((m) => ({ kind: 'module-initialization', sourcePath: m.path, name: '$moduleInit' })),
        ],
        requiredRoots: [],
      },
      hostImports: opts.hostImports ?? [],
    },
  };

  const frontendExe = resolveFrontendExe(opts.frontend);
  const fe = spawnSync(frontendExe, ['--program-facts-io-v3'], {
    input: Buffer.from(canonical(req) + '\n', 'utf8'),
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (fe.status !== 0) {
    throw new Error(`r05-frontend-reject: ${fe.stderr.toString('utf8').trim() || fe.stdout.toString('utf8').trim()}`);
  }

  const facts = readCommonProgramFacts(fe.stdout);
  const hir = projectCommonProgram(facts);
  const pub = createCommonProgramPublication(hir);
  const coreMlir = emitCommonProgramCore(hir, pub, { targets: [] });

  const coreExe = resolveCoreIrExe(opts.core);
  const coreFlags = ['--common-program', opts.optimize ? '--optimize' : '--canonicalize'];
  const canon = spawnSync(coreExe, coreFlags, {
    input: Buffer.from(coreMlir, 'utf8'),
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (canon.status !== 0) {
    throw new Error(`r05-core-ir-reject: ${canon.stderr.toString('utf8').trim()}`);
  }
  const canonicalMlir = canon.stdout.toString('utf8');
  const lowered = lowerCommonCoreToR05Bytecode(canonicalMlir, {
    moduleId: opts.moduleId,
    abiHash: opts.abiHash,
    staticSchemaHash: opts.staticSchemaHash,
    codeVersion: opts.codeVersion,
  });

  return {
    facts,
    hir,
    publication: pub,
    coreMlir,
    canonicalMlir,
    ...lowered,
  };
}

/**
 * Compile raw TypeScript source directly through the official Go TypeScript frontend,
 * HIR, Core MLIR canonicalizer, and `TSFGR05B` bytecode lowerer.
 */
export function compileTsSourceToR05Bytecode(sourceText, opts = {}) {
  const filePath = opts.filePath ?? '/src/main.ts';
  if (/\.(?:m?js|cjs)$/i.test(filePath)) {
    const err = new TypeError(`r01-forbid-js-file: JS input file '${filePath}' is forbidden in tsfg`);
    err.diagnostics = [{ code: 'r01-forbid-js-file', message: err.message }];
    throw err;
  }

  if (opts.additionalFiles && opts.additionalFiles.length > 0) {
    const rootVirtual = '/src/main.ts';
    return compileTsFilesToCoreAndR05(
      [{ path: rootVirtual, content: sourceText }, ...opts.additionalFiles],
      { ...opts, rootFile: rootVirtual },
    );
  }

  // If compiling from an existing file on disk with relative imports, collect its module graph!
  if (opts.resolveImports && filePath && existsSync(filePath)) {
    const graph = collectTsModuleGraphFromDisk(filePath, opts.projectRoot ?? path.dirname(filePath));
    return compileTsFilesToCoreAndR05(
      graph.files.map((f) => ({ path: f.virtualPath, content: f.content })),
      { ...opts, rootFile: graph.rootVirtualPath },
    );
  }

  return compileTsFilesToCoreAndR05(
    [{ path: '/src/main.ts', content: sourceText }],
    { ...opts, rootFile: '/src/main.ts' },
  );
}

/**
 * Compile a `.ts` file or source string and execute an exported function on the Zig R05 VM (`tsfg-r05-vm.exe`).
 */
export async function runTsOnR05ZigVm(input, opts = {}) {
  const isFile = Boolean(opts.isFile);
  const filePath = isFile ? input : (opts.filePath ?? '/src/main.ts');
  const sourceText = isFile ? await readFile(input, 'utf8') : input;
  const entry = opts.entry ?? 'main';

  const compiled = compileTsSourceToR05Bytecode(sourceText, {
    ...opts,
    filePath,
    resolveImports: isFile ? (opts.resolveImports ?? true) : false,
    entries: opts.entries ?? [entry],
  });
  const fnIdx = compiled.exportsByName.get(entry);
  if (fnIdx === undefined) {
    throw new TypeError(`r05-driver-entry: exported function '${entry}' not found`);
  }

  const vmExe = await ensureR05VmBinary(opts.vm);
  const vmArgs = ['--run', String(fnIdx)];
  if (compiled.initFnIndices && compiled.initFnIndices.length > 0) {
    const filteredInits = compiled.initFnIndices.filter((i) => i !== fnIdx);
    if (filteredInits.length > 0) {
      vmArgs.push('--init-fns', filteredInits.join(','));
    }
  } else if (compiled.initFnIndex !== null && compiled.initFnIndex !== fnIdx) {
    vmArgs.push('--init-fn', String(compiled.initFnIndex));
  }
  if (opts.unfused) vmArgs.push('--unfused');
  if (opts.fuel !== undefined) vmArgs.push('--fuel', String(opts.fuel));
  if (opts.args && opts.args.length > 0) vmArgs.push('--args', opts.args.join(','));
  if (opts.breakpointPc !== undefined) vmArgs.push('--breakpoint-pc', String(opts.breakpointPc));
  if (opts.breakpointOffset !== undefined) vmArgs.push('--breakpoint-offset', String(opts.breakpointOffset));
  if (opts.debugStep) vmArgs.push('--debug-step');
  if (opts.profileTrace) vmArgs.push('--profile-trace');

  const run = spawnSync(vmExe, vmArgs, {
    input: compiled.bytes,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (run.status !== 0) {
    throw new Error(`r05-vm-exec-error (exit ${run.status}): ${run.stderr.toString('utf8').trim()}`);
  }
  const result = JSON.parse(run.stdout.toString('utf8').trim());
  if (typeof opts.profileTrace === 'string' && result.trace) {
    await writeFile(opts.profileTrace, JSON.stringify(result.trace, null, 2), 'utf8');
  }
  return { compiled, result };
}
