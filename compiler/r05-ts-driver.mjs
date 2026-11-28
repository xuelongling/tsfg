// SPDX-License-Identifier: MIT
// Unified Direct TypeScript -> Go Frontend -> HIR -> Core MLIR -> TSFGR05B -> Zig R05 VM Driver.
// Enforces tsfg static-subset boundaries (rejecting .js, any, eval, Proxy, loose equality,
// prototype mutation, and dynamic property delete with zero JS fallback).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { canonical } from './identity.mjs';
import { commonSourceFormatV3 } from './common-program-common.mjs';
import { readCommonProgramFacts } from './common-program-facts.mjs';
import { projectCommonProgram } from './common-program-hir.mjs';
import { createCommonProgramPublication } from './common-program-analysis.mjs';
import { emitCommonProgramCore } from './common-program-core.mjs';
import { lowerCommonCoreToR05Bytecode } from './r05-bytecode-lower.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const DEFAULT_FRONTEND_EXE = process.env.TSFG_FRONTEND_EXE ?? 'E:\\tsfg-artifacts\\r03-baseline\\tsfg-frontend-m24-8443e0f.exe';
const DEFAULT_CORE_EXE = process.env.TSFG_CORE_IR_EXE ?? 'E:\\tsfg-build\\mlir-sdk\\bin\\tsfg-core-ir.exe';
const DEFAULT_ZIG_EXE = process.env.TSFG_LOCKED_ZIG ?? 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\zig\\zig.exe';
const DEFAULT_R05_VM_EXE = process.env.TSFG_R05_VM_EXE ?? 'E:\\tsfg-build\\r05\\tsfg-r05-vm.exe';

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

let cachedBaselineFixture = null;
function loadBaselineFixture() {
  if (cachedBaselineFixture) return cachedBaselineFixture;
  cachedBaselineFixture = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'tests', 'r03', 'common-program-positive.json'), 'utf8'),
  );
  return cachedBaselineFixture;
}

export async function ensureR05VmBinary(vmExePath = DEFAULT_R05_VM_EXE) {
  if (existsSync(vmExePath)) return vmExePath;
  await mkdir(path.dirname(vmExePath), { recursive: true });
  const res = spawnSync(
    DEFAULT_ZIG_EXE,
    [
      'build-exe',
      'r05-vm-cli.zig',
      '-target', 'x86_64-windows-msvc',
      '-mcpu', 'x86_64_v2',
      '-O', 'ReleaseSafe',
      '-fno-lto',
      `-femit-bin=${vmExePath}`,
    ],
    {
      cwd: path.join(REPO_ROOT, 'runtime'),
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        TEMP: 'E:\\tsfg-temp',
        TMP: 'E:\\tsfg-temp',
        ZIG_LOCAL_CACHE_DIR: 'E:\\tsfg-cache\\zig-local',
        ZIG_GLOBAL_CACHE_DIR: 'E:\\tsfg-cache\\zig-global',
      },
    },
  );
  if (res.status !== 0) {
    throw new Error(`r05-driver: failed to build tsfg-r05-vm.exe:\n${res.stderr.toString('utf8')}`);
  }
  return vmExePath;
}

/**
 * Compile raw TypeScript source directly through the official Go TypeScript frontend,
 * HIR, Core MLIR canonicalizer, and `TSFGR05B` bytecode lowerer.
 */
export function compileTsSourceToR05Bytecode(sourceText, opts = {}) {
  const filePath = opts.filePath ?? '/src/main.ts';
  const entryNames = opts.entries ?? [opts.entry ?? 'main'];

  const forbidden = checkTsfgForbiddenSyntax(filePath, sourceText);
  if (forbidden.length > 0) {
    const first = forbidden[0];
    const err = new TypeError(`${first.code}: ${first.message}`);
    err.diagnostics = forbidden;
    throw err;
  }

  const sha = (s) => createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
  const pos = loadBaselineFixture();
  const dts = pos.payload.files.find((f) => f.path.endsWith('.d.ts'));

  const req = {
    family: 'tsfg.program-facts-request-candidate',
    version: commonSourceFormatV3.version,
    schemaHash: commonSourceFormatV3.schemaHash,
    input: {
      sourceRoot: '/src',
      rootFile: '/src/main.ts',
      files: [
        { path: '/src/main.ts', content: sourceText, sha256: sha(sourceText) },
        { path: dts.path, content: dts.content, sha256: dts.sha256 },
      ],
      declarations: pos.payload.declarations,
      config: pos.payload.config,
      target: pos.payload.target,
      compilationClosure: {
        roots: [
          ...entryNames.map((name) => ({ kind: 'application', sourcePath: '/src/main.ts', name })),
          { kind: 'module-initialization', sourcePath: '/src/main.ts', name: '$moduleInit' },
        ],
        requiredRoots: [],
      },
      hostImports: [],
    },
  };

  const frontendExe = opts.frontend ?? DEFAULT_FRONTEND_EXE;
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

  const coreExe = opts.core ?? DEFAULT_CORE_EXE;
  const canon = spawnSync(coreExe, ['--common-program', '--canonicalize'], {
    input: Buffer.from(coreMlir, 'utf8'),
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (canon.status !== 0) {
    throw new Error(`r05-core-ir-reject: ${canon.stderr.toString('utf8').trim()}`);
  }
  const canonicalMlir = canon.stdout.toString('utf8');
  const lowered = lowerCommonCoreToR05Bytecode(canonicalMlir);

  return {
    canonicalMlir,
    ...lowered,
  };
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
    entries: opts.entries ?? [entry],
  });
  const fnIdx = compiled.exportsByName.get(entry);
  if (fnIdx === undefined) {
    throw new TypeError(`r05-driver-entry: exported function '${entry}' not found`);
  }

  const vmExe = await ensureR05VmBinary(opts.vm ?? DEFAULT_R05_VM_EXE);
  const vmArgs = ['--run', String(fnIdx)];
  if (compiled.initFnIndex !== null && compiled.initFnIndex !== fnIdx) {
    vmArgs.push('--init-fn', String(compiled.initFnIndex));
  }
  if (opts.unfused) vmArgs.push('--unfused');
  if (opts.fuel !== undefined) vmArgs.push('--fuel', String(opts.fuel));
  if (opts.args && opts.args.length > 0) vmArgs.push('--args', opts.args.join(','));

  const run = spawnSync(vmExe, vmArgs, {
    input: compiled.bytes,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (run.status !== 0) {
    throw new Error(`r05-vm-exec-error (exit ${run.status}): ${run.stderr.toString('utf8').trim()}`);
  }
  const result = JSON.parse(run.stdout.toString('utf8').trim());
  return { compiled, result };
}
