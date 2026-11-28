// SPDX-License-Identifier: MIT
// Unified Windows x64 AOT Compiler Driver:
//   Real `.ts` (single-file or multi-file)
//   -> Go TypeScript Frontend -> HIR -> C++ MLIR Core IR (`--canonicalize` / `--optimize`)
//   -> `lowerCommonCoreToLlvm` (strict IEEE float, lossless UTF-16 strings, fixed-width numerics, moving GC)
//   -> `clang-cl` (`/Od` debug or `/O2` release, `-march=x86-64-v2 -mtune=generic -mno-avx -fno-lto -fno-fast-math`, `/Zi`)
//   -> `lld-link` (`/DEBUG:FULL /PDB:... /PDBALTPATH:%_PDB%`)
//   -> Standalone Windows x64 `.exe` + `.pdb` OR native `.dll` + `.pdb`!
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { compileTsSourceToR05Bytecode } from './r05-ts-driver.mjs';
import { lowerCommonCoreToLlvm } from './common-aot-llvm.mjs';
import {
  REPO_ROOT,
  resolveClangClExe,
  resolveCommonEngineLib,
  resolveLldLinkExe,
  resolveTempDir,
  resolveWindowsSdkPaths,
  resolveZigCacheEnv,
  resolveZigExe,
} from './tsfg-paths.mjs';

/**
 * Ensure `tsfg_common_engine.lib` exists and is fresher than `runtime/common-execution-engine.zig`.
 */
export async function ensureCommonEngineLib(overridePath = undefined, opts = {}) {
  const targetLib = resolveCommonEngineLib(overridePath);
  const srcPath = path.join(REPO_ROOT, 'runtime', 'common-execution-engine.zig');
  let needsBuild = Boolean(opts.forceRebuild) || !existsSync(targetLib);
  if (!needsBuild && existsSync(srcPath)) {
    try {
      if (statSync(srcPath).mtimeMs > statSync(targetLib).mtimeMs) {
        needsBuild = true;
      }
    } catch {
      needsBuild = true;
    }
  }
  if (!needsBuild) return targetLib;

  const zigExe = resolveZigExe(opts.zig);
  await mkdir(path.dirname(targetLib), { recursive: true });
  const res = spawnSync(
    zigExe,
    [
      'build-lib',
      'common-execution-engine.zig',
      '-target', 'x86_64-windows-msvc',
      '-mcpu', 'x86_64_v2',
      '-O', 'ReleaseSafe',
      '-fno-lto',
      `-femit-bin=${targetLib}`,
    ],
    {
      cwd: path.join(REPO_ROOT, 'runtime'),
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      env: resolveZigCacheEnv(),
    },
  );
  if (res.status !== 0) {
    throw new Error(`tsfg-aot: failed to build tsfg_common_engine.lib:\n${res.stderr.toString('utf8')}`);
  }
  return targetLib;
}

const C_ENGINE_EXTERNS = `#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

extern void *tsfg_eng_create(void);
extern void tsfg_eng_destroy(void *);
extern void tsfg_eng_reset(void *, uint64_t, uint32_t);
extern uint32_t tsfg_eng_trap(const void *);
extern int32_t tsfg_eng_has_exc(const void *);
extern uint16_t tsfg_eng_take_exc_tag(const void *);
extern uint64_t tsfg_eng_take_exc_payload(void *);
extern uint32_t tsfg_eng_str_len(void *, uint64_t);
extern uint16_t tsfg_eng_str_get_u16(const void *, uint64_t, uint32_t);
extern void aot_cmn_bootstrap(void *);
`;

function generateExeHarnessC(lowered, defaultEntry) {
  const decls = [];
  const cases = [];

  for (const [name, info] of Object.entries(lowered.exports)) {
    const params = ['void *', 'uint16_t *', 'uint64_t *'];
    const callArgs = ['e', '&ot', '&op'];
    for (let i = 0; i < info.paramCount; i++) {
      params.push('uint16_t', 'uint64_t');
      callArgs.push(`arg_tags[${i}]`, `arg_pays[${i}]`);
    }
    decls.push(`extern void ${info.sym}(${params.join(', ')});`);
    const safeName = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    cases.push(`  if (strcmp(entry_name, "${safeName}") == 0) {
    matched = 1;
    ${info.sym}(${callArgs.join(', ')});
  }`);
  }

  return `${C_ENGINE_EXTERNS}
${decls.join('\n')}

static void parse_arg_token(const char *tok, uint16_t *out_tag, uint64_t *out_pay) {
  if (strcmp(tok, "undefined") == 0) { *out_tag = 0; *out_pay = 0; return; }
  if (strcmp(tok, "null") == 0) { *out_tag = 1; *out_pay = 0; return; }
  if (strcmp(tok, "true") == 0) { *out_tag = 2; *out_pay = 1; return; }
  if (strcmp(tok, "false") == 0) { *out_tag = 2; *out_pay = 0; return; }
  if (strncmp(tok, "f64:", 4) == 0) {
    double d = strtod(tok + 4, NULL);
    uint64_t bits = 0;
    memcpy(&bits, &d, sizeof(bits));
    *out_tag = 4; *out_pay = bits; return;
  }
  if (strncmp(tok, "f32:", 4) == 0) {
    float f = (float)strtod(tok + 4, NULL);
    uint32_t bits = 0;
    memcpy(&bits, &f, sizeof(bits));
    *out_tag = 13; *out_pay = (uint64_t)bits; return;
  }
  if (strncmp(tok, "i64:", 4) == 0) {
    long long v = strtoll(tok + 4, NULL, 10);
    *out_tag = 10; *out_pay = (uint64_t)v; return;
  }
  if (strncmp(tok, "u32:", 4) == 0) {
    unsigned long v = strtoul(tok + 4, NULL, 10);
    *out_tag = 11; *out_pay = (uint64_t)(uint32_t)v; return;
  }
  long v = strtol(tok, NULL, 10);
  *out_tag = 3;
  *out_pay = (uint64_t)(uint32_t)(int32_t)v;
}

int main(int argc, char **argv) {
  const char *entry_name = "${defaultEntry.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}";
  const char *args_csv = NULL;
  uint64_t fuel = 100000;
  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--entry") == 0 && i + 1 < argc) {
      entry_name = argv[++i];
    } else if (strcmp(argv[i], "--args") == 0 && i + 1 < argc) {
      args_csv = argv[++i];
    } else if (strcmp(argv[i], "--fuel") == 0 && i + 1 < argc) {
      fuel = strtoull(argv[++i], NULL, 10);
    }
  }

  uint16_t arg_tags[32];
  uint64_t arg_pays[32];
  for (int i = 0; i < 32; i++) { arg_tags[i] = 0; arg_pays[i] = 0; }
  if (args_csv != NULL && args_csv[0] != '\\0') {
    char buf[4096];
    strncpy(buf, args_csv, sizeof(buf) - 1);
    buf[sizeof(buf) - 1] = '\\0';
    int idx = 0;
    char *p = buf;
    while (p && *p && idx < 32) {
      char *comma = strchr(p, ',');
      if (comma) *comma = '\\0';
      parse_arg_token(p, &arg_tags[idx], &arg_pays[idx]);
      idx++;
      p = comma ? (comma + 1) : NULL;
    }
  }

  void *e = tsfg_eng_create();
  if (!e) {
    fprintf(stderr, "tsfg-aot: failed to create runtime engine\\n");
    return 11;
  }
  tsfg_eng_reset(e, fuel, 64);
  aot_cmn_bootstrap(e);
  if (tsfg_eng_trap(e) != 0) {
    printf("{\\"status\\":\\"trap\\",\\"trap\\":%u}\\n", tsfg_eng_trap(e));
    tsfg_eng_destroy(e);
    return 0;
  }
  if (tsfg_eng_has_exc(e) != 0) {
    uint16_t et = tsfg_eng_take_exc_tag(e);
    uint64_t ep = tsfg_eng_take_exc_payload(e);
    printf("{\\"status\\":\\"managed_exception\\",\\"tag\\":%u,\\"i32\\":%d}\\n", (unsigned)et, (int32_t)(uint32_t)ep);
    tsfg_eng_destroy(e);
    return 0;
  }

  uint16_t ot = 0;
  uint64_t op = 0;
  int matched = 0;
${cases.join(' else ')}
  if (!matched) {
    fprintf(stderr, "tsfg-aot: exported function '%s' not found\\n", entry_name);
    tsfg_eng_destroy(e);
    return 2;
  }

  uint32_t tr = tsfg_eng_trap(e);
  if (tr != 0) {
    printf("{\\"status\\":\\"trap\\",\\"trap\\":%u}\\n", tr);
  } else if (tsfg_eng_has_exc(e) != 0) {
    uint16_t et = tsfg_eng_take_exc_tag(e);
    uint64_t ep = tsfg_eng_take_exc_payload(e);
    printf("{\\"status\\":\\"managed_exception\\",\\"tag\\":%u,\\"i32\\":%d}\\n", (unsigned)et, (int32_t)(uint32_t)ep);
  } else {
    printf("{\\"status\\":\\"ok\\",\\"tag\\":%u,\\"i32\\":%d,\\"i64\\":%lld,\\"u32\\":%u,\\"f64Bits\\":\\"%016llx\\"",
      (unsigned)ot,
      (int32_t)(uint32_t)op,
      (long long)(int64_t)op,
      (unsigned)(uint32_t)op,
      (unsigned long long)op);
    if (ot == 9) {
      uint32_t slen = tsfg_eng_str_len(e, op);
      printf(",\\"stringLen\\":%u,\\"stringUnits\\":[", slen);
      for (uint32_t si = 0; si < slen; si++) {
        if (si > 0) printf(",");
        printf("%u", (unsigned)tsfg_eng_str_get_u16(e, op, si));
      }
      printf("]");
    }
    printf("}\\n");
  }
  tsfg_eng_destroy(e);
  return 0;
}
`;
}

function generateDllHarnessC(lowered) {
  const decls = [];
  const wrappers = [];
  for (const [name, info] of Object.entries(lowered.exports)) {
    const safeSym = name.replace(/[^a-zA-Z0-9_]/g, '_');
    const params = ['void *', 'uint16_t *', 'uint64_t *'];
    const cParams = ['void *e'];
    const callArgs = ['e', '&ot', '&op'];
    for (let i = 0; i < info.paramCount; i++) {
      params.push('uint16_t', 'uint64_t');
      cParams.push(`int32_t a${i}`);
      callArgs.push('3', `(uint64_t)(uint32_t)a${i}`);
    }
    decls.push(`extern void ${info.sym}(${params.join(', ')});`);
    wrappers.push(`__declspec(dllexport) int32_t tsfg_aot_call_${safeSym}(${cParams.join(', ')}) {
  uint16_t ot = 0;
  uint64_t op = 0;
  ${info.sym}(${callArgs.join(', ')});
  return (int32_t)(uint32_t)op;
}`);
  }
  return `${C_ENGINE_EXTERNS}
${decls.join('\n')}

__declspec(dllexport) void *tsfg_aot_create(void) {
  void *e = tsfg_eng_create();
  if (e) {
    tsfg_eng_reset(e, 100000, 64);
    aot_cmn_bootstrap(e);
  }
  return e;
}
__declspec(dllexport) void tsfg_aot_destroy(void *e) { tsfg_eng_destroy(e); }
__declspec(dllexport) uint32_t tsfg_aot_trap(const void *e) { return tsfg_eng_trap(e); }
${wrappers.join('\n')}
`;
}

/**
 * Compile TypeScript source (single or multi-file) all the way to a native Windows x64
 * `.exe` + `.pdb` OR `.dll` + `.pdb` through the unified frontend + Core MLIR + LLVM pipeline.
 */
export async function compileTsToWindowsAot(input, opts = {}) {
  const isFile = Boolean(opts.isFile);
  const filePath = isFile ? input : (opts.filePath ?? '/src/main.ts');
  const sourceText = isFile ? await readFile(input, 'utf8') : input;
  const entry = opts.entry ?? 'main';
  const entries = opts.entries ?? [entry];
  const mode = opts.mode ?? 'exe'; // 'exe' | 'dll'
  const profile = opts.profile ?? (opts.optLevel === 'O0' ? 'debug' : 'release');
  const emitPdb = opts.emitPdb !== false;

  const compiled = compileTsSourceToR05Bytecode(sourceText, {
    ...opts,
    filePath,
    resolveImports: isFile ? (opts.resolveImports ?? true) : false,
    entries,
    optimize: opts.optimize ?? (profile === 'release'),
  });

  const lowered = lowerCommonCoreToLlvm(compiled.canonicalMlir);
  const libPath = await ensureCommonEngineLib(opts.engineLib, opts);
  const winSdk = resolveWindowsSdkPaths();
  if (!winSdk) {
    throw new Error('tsfg-aot: could not locate MSVC/Windows SDK headers and libs in active toolchain closure');
  }

  const hashTag = createHash('sha256')
    .update(`${mode}:${profile}:${entries.join(',')}:${lowered.llvmIr}`)
    .digest('hex')
    .slice(0, 12);
  const workDir = opts.outDir ?? path.join(resolveTempDir('tsfg-aot'), `${opts.tag ?? 'app'}_${hashTag}`);
  await mkdir(workDir, { recursive: true });

  const baseName = opts.tag ?? path.basename(filePath, path.extname(filePath)).replace(/[^a-zA-Z0-9_-]/g, '_');
  const llPath = path.join(workDir, `${baseName}.ll`);
  const irObjPath = path.join(workDir, `${baseName}_ir.obj`);
  const drvCPath = path.join(workDir, `${baseName}_entry.c`);
  const drvObjPath = path.join(workDir, `${baseName}_entry.obj`);
  const outPath = opts.outPath ?? path.join(workDir, `${baseName}.${mode}`);
  const pdbPath = opts.pdbPath ?? outPath.replace(/\.(exe|dll)$/i, '.pdb');
  await mkdir(path.dirname(outPath), { recursive: true });

  await writeFile(llPath, lowered.llvmIr, 'utf8');
  const harnessC = mode === 'dll'
    ? generateDllHarnessC(lowered)
    : generateExeHarnessC(lowered, entry);
  await writeFile(drvCPath, harnessC, 'utf8');

  const clangCl = resolveClangClExe(opts.clangCl);
  const lldLink = resolveLldLinkExe(opts.lldLink);
  const optFlag = profile === 'debug' ? '/Od' : '/O2';
  const strictArchFlags = [
    '/clang:-march=x86-64-v2',
    '/clang:-mtune=generic',
    '/clang:-mno-avx',
    '/clang:-fno-lto',
    '/clang:-fno-fast-math',
  ];
  const irDebugFlags = emitPdb ? ['/Z7'] : [];
  const cDebugFlags = emitPdb ? ['/Z7'] : [];

  const ccIr = spawnSync(
    clangCl,
    ['/c', optFlag, ...strictArchFlags, ...irDebugFlags, '-x', 'ir', llPath, `/Fo${irObjPath}`],
    { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
  );
  if (ccIr.status !== 0) {
    throw new Error(`tsfg-aot clang-cl IR failed:\n${ccIr.stderr.toString('utf8')}`);
  }

  const ccDrv = spawnSync(
    clangCl,
    [
      '/c', optFlag, '/MT', ...strictArchFlags, ...cDebugFlags,
      `/I${winSdk.msvcInc}`, `/I${winSdk.ucrtInc}`, `/I${winSdk.umInc}`, `/I${winSdk.sharedInc}`,
      drvCPath, `/Fo${drvObjPath}`,
    ],
    { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
  );
  if (ccDrv.status !== 0) {
    throw new Error(`tsfg-aot clang-cl entry failed:\n${ccDrv.stderr.toString('utf8')}`);
  }

  const linkArgs = [
    ...(mode === 'dll' ? ['/DLL'] : []),
    '/MACHINE:X64',
    `/OUT:${outPath}`,
    ...(emitPdb ? ['/DEBUG:FULL', `/PDB:${pdbPath}`, '/PDBALTPATH:%_PDB%'] : []),
    `/LIBPATH:${winSdk.msvcLib}`,
    `/LIBPATH:${winSdk.ucrtLib}`,
    `/LIBPATH:${winSdk.umLib}`,
    drvObjPath,
    irObjPath,
    libPath,
    ...(winSdk.builtinsLib ? [winSdk.builtinsLib] : []),
    'libcmt.lib',
    'libvcruntime.lib',
    'libucrt.lib',
    'kernel32.lib',
    'ntdll.lib',
  ];
  const ld = spawnSync(lldLink, linkArgs, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (ld.status !== 0) {
    throw new Error(`tsfg-aot lld-link failed:\n${ld.stderr.toString('utf8')}`);
  }

  return {
    mode,
    profile,
    outPath,
    exePath: mode === 'exe' ? outPath : null,
    dllPath: mode === 'dll' ? outPath : null,
    pdbPath: emitPdb && existsSync(pdbPath) ? pdbPath : null,
    llPath,
    exports: lowered.exports,
    compiled,
  };
}

/**
 * Compile TypeScript to a standalone Windows x64 `.exe` + `.pdb` and execute it directly.
 */
export async function runTsOnWindowsAot(input, opts = {}) {
  const entry = opts.entry ?? 'main';
  const artifact = await compileTsToWindowsAot(input, { ...opts, mode: 'exe', entry });
  const runArgs = ['--entry', entry];
  if (opts.args && opts.args.length > 0) runArgs.push('--args', opts.args.join(','));
  if (opts.fuel !== undefined) runArgs.push('--fuel', String(opts.fuel));

  const run = spawnSync(artifact.exePath, runArgs, {
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (run.status !== 0) {
    throw new Error(`tsfg-aot exe failed (exit ${run.status}): ${run.stderr.toString('utf8').trim()}`);
  }
  const result = JSON.parse(run.stdout.toString('utf8').trim());
  return { artifact, result };
}
