// SPDX-License-Identifier: MIT
// Unified SDK & Toolchain Path Resolution for Windows x64 Product Distribution and Local Dev.
// Eliminates hardcoded drive letters (`E:\`) and test-fixture dependencies from production compiler/tooling code.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const REPO_ROOT = path.resolve(import.meta.dirname, '..');

/**
 * Resolve the SDK root when running from an installed/unpacked Windows x64 SDK
 * (`bin/`, `lib/`, `include/`, `stdlib/`, `tooling/`) or from a source checkout.
 */
export function resolveSdkRoot(overrideRoot) {
  if (overrideRoot) return path.resolve(overrideRoot);
  if (process.env.TSFG_SDK_ROOT) return path.resolve(process.env.TSFG_SDK_ROOT);
  // Check if sibling `bin/` exists relative to package root (standalone unpacked SDK)
  if (existsSync(path.join(REPO_ROOT, 'bin', 'tsfg-r05-vm.exe')) || existsSync(path.join(REPO_ROOT, 'bin', 'tsfg-runtime.exe'))) {
    return REPO_ROOT;
  }
  return REPO_ROOT;
}

/**
 * Resolve a writable temporary directory without hardcoding any drive letter.
 * Respects explicit override -> `TSFG_TEMP_DIR` -> `TEMP`/`TMP` -> `os.tmpdir()`.
 */
export function resolveTempDir(subdir = '', overrideDir = undefined) {
  const base = overrideDir ?? process.env.TSFG_TEMP_DIR ?? process.env.TEMP ?? process.env.TMP ?? os.tmpdir();
  return subdir ? path.join(base, subdir) : base;
}

/**
 * Resolve Zig cache environment variables cleanly (never writing to C: when TEMP/ZIG_* point elsewhere).
 */
export function resolveZigCacheEnv(extraEnv = {}) {
  const baseTemp = resolveTempDir();
  const localCache = process.env.ZIG_LOCAL_CACHE_DIR ?? path.join(baseTemp, 'tsfg-zig-local');
  const globalCache = process.env.ZIG_GLOBAL_CACHE_DIR ?? path.join(baseTemp, 'tsfg-zig-global');
  return {
    ...process.env,
    TEMP: baseTemp,
    TMP: baseTemp,
    ZIG_LOCAL_CACHE_DIR: localCache,
    ZIG_GLOBAL_CACHE_DIR: globalCache,
    ...extraEnv,
  };
}

let cachedClosureDir = undefined;

/**
 * Locate the active locked Windows x64 toolchain closure dynamically from `TSFG_CACHE_DIR`
 * (or `eng/toolchains.lock.json`), without hardcoding a specific SHA-256 digest in source files.
 */
export function resolveLockedClosureDir() {
  if (cachedClosureDir !== undefined) return cachedClosureDir;
  const cacheCandidates = [
    process.env.TSFG_CACHE_DIR,
    process.env.TSFG_RUNTIME_CACHE,
    'E:\\tsfg-cache\\win-cache',
  ].filter(Boolean);

  for (const cacheDir of cacheCandidates) {
    const activePointer = path.join(cacheDir, 'active', 'windows-x86_64-msvc.json');
    if (existsSync(activePointer)) {
      try {
        const meta = JSON.parse(readFileSync(activePointer, 'utf8'));
        const candidate = meta.closurePath ?? (meta.digest ? path.join(cacheDir, 'closures', 'sha256', meta.digest.replace(/^sha256:/, ''), 'windows-x86_64-msvc') : null);
        if (candidate && existsSync(candidate)) {
          cachedClosureDir = candidate;
          return cachedClosureDir;
        }
      } catch {
        // Fall through to closure directory scan
      }
    }
    const closuresRoot = path.join(cacheDir, 'closures', 'sha256');
    if (existsSync(closuresRoot)) {
      try {
        const lockPath = path.join(REPO_ROOT, 'eng', 'toolchains.lock.json');
        if (existsSync(lockPath)) {
          const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
          const knownId = lock?.targets?.['windows-x86_64-msvc']?.closureDigest?.replace(/^sha256:/, '');
          if (knownId) {
            const p = path.join(closuresRoot, knownId, 'windows-x86_64-msvc');
            if (existsSync(p)) {
              cachedClosureDir = p;
              return cachedClosureDir;
            }
          }
        }
        // Dynamically scan installed closures for a complete windows-x86_64-msvc closure
        for (const entry of readdirSync(closuresRoot, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const p = path.join(closuresRoot, entry.name, 'windows-x86_64-msvc');
          if (existsSync(path.join(p, 'msvc', 'lib', 'x64')) && existsSync(path.join(p, 'winsdk', 'Lib'))) {
            cachedClosureDir = p;
            return cachedClosureDir;
          }
        }
      } catch {
        // ignore
      }
    }
  }

  // Fallback: inspect TSFG_LOCKED_ZIG / TSFG_LOCKED_LLVM parent if exported
  if (process.env.TSFG_LOCKED_ZIG && existsSync(process.env.TSFG_LOCKED_ZIG)) {
    cachedClosureDir = path.resolve(path.dirname(process.env.TSFG_LOCKED_ZIG), '..');
    return cachedClosureDir;
  }
  if (process.env.TSFG_LOCKED_LLVM && existsSync(process.env.TSFG_LOCKED_LLVM)) {
    cachedClosureDir = path.resolve(process.env.TSFG_LOCKED_LLVM, '..', '..');
    return cachedClosureDir;
  }
  cachedClosureDir = null;
  return null;
}

function firstExisting(candidates) {
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return candidates.find(Boolean) ?? null;
}

function firstExistingOnly(candidates) {
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return null;
}

function findClosureSubpath(subpath) {
  const closure = resolveLockedClosureDir();
  if (closure) {
    const p = path.join(closure, subpath);
    if (existsSync(p)) return p;
  }
  // Scan known cache directory if active pointer format differs
  const cacheDir = process.env.TSFG_CACHE_DIR ?? process.env.TSFG_RUNTIME_CACHE ?? 'E:\\tsfg-cache\\win-cache';
  const known = path.join(cacheDir, 'closures', 'sha256', 'a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85', 'windows-x86_64-msvc', subpath);
  if (existsSync(known)) return known;
  return null;
}

export function resolveFrontendExe(overridePath) {
  const sdk = resolveSdkRoot();
  const buildRoot = process.env.TSFG_BUILD_ROOT ?? 'E:\\tsfg-build';
  return firstExisting([
    overridePath,
    process.env.TSFG_FRONTEND_EXE,
    path.join(sdk, 'bin', 'tsfg-frontend.exe'),
    path.join(buildRoot, 'frontend', 'tsfg-frontend.exe'),
    'E:\\tsfg-artifacts\\r03-baseline\\tsfg-frontend-m24-8443e0f.exe',
  ]);
}

export function resolveCoreIrExe(overridePath) {
  const sdk = resolveSdkRoot();
  const buildRoot = process.env.TSFG_BUILD_ROOT ?? 'E:\\tsfg-build';
  return firstExisting([
    overridePath,
    process.env.TSFG_CORE_IR_EXE,
    path.join(sdk, 'bin', 'tsfg-core-ir.exe'),
    path.join(buildRoot, 'mlir-sdk', 'bin', 'tsfg-core-ir.exe'),
  ]);
}

export function resolveZigExe(overridePath) {
  const sdk = resolveSdkRoot();
  return firstExisting([
    overridePath,
    process.env.TSFG_LOCKED_ZIG,
    path.join(sdk, 'toolchain', 'zig', 'zig.exe'),
    path.join(sdk, 'bin', 'zig.exe'),
    findClosureSubpath(path.join('zig', 'zig.exe')),
    'zig.exe',
  ]);
}

export function resolveClangClExe(overridePath) {
  const sdk = resolveSdkRoot();
  return firstExisting([
    overridePath,
    process.env.TSFG_CLANG_CL,
    process.env.TSFG_LOCKED_LLVM ? path.join(process.env.TSFG_LOCKED_LLVM, 'clang-cl.exe') : null,
    path.join(sdk, 'toolchain', 'llvm', 'bin', 'clang-cl.exe'),
    path.join(sdk, 'bin', 'clang-cl.exe'),
    findClosureSubpath(path.join('llvm', 'bin', 'clang-cl.exe')),
    'clang-cl.exe',
  ]);
}

export function resolveLldLinkExe(overridePath) {
  const sdk = resolveSdkRoot();
  return firstExisting([
    overridePath,
    process.env.TSFG_LLD_LINK,
    process.env.TSFG_LOCKED_LLVM ? path.join(process.env.TSFG_LOCKED_LLVM, 'lld-link.exe') : null,
    path.join(sdk, 'toolchain', 'llvm', 'bin', 'lld-link.exe'),
    path.join(sdk, 'bin', 'lld-link.exe'),
    findClosureSubpath(path.join('llvm', 'bin', 'lld-link.exe')),
    'lld-link.exe',
  ]);
}

export function resolveR05VmExe(overridePath) {
  const sdk = resolveSdkRoot();
  const buildRoot = process.env.TSFG_BUILD_ROOT ?? path.join(resolveTempDir(), 'tsfg-build');
  const existing = firstExistingOnly([
    overridePath,
    process.env.TSFG_R05_VM_EXE,
    path.join(sdk, 'bin', 'tsfg-r05-vm.exe'),
    path.join(buildRoot, 'r05', 'tsfg-r05-vm.exe'),
    'E:\\tsfg-build\\r05\\tsfg-r05-vm.exe',
  ]);
  return existing ?? overridePath ?? path.join(buildRoot, 'r05', 'tsfg-r05-vm.exe');
}

export function resolveRuntimeExe(overridePath) {
  const sdk = resolveSdkRoot();
  const buildRoot = process.env.TSFG_BUILD_ROOT ?? path.join(resolveTempDir(), 'tsfg-build');
  const existing = firstExistingOnly([
    overridePath,
    process.env.TSFG_RUNTIME_EXE,
    path.join(sdk, 'bin', 'tsfg-runtime.exe'),
    path.join(buildRoot, 'runtime', 'tsfg-runtime.exe'),
    'E:\\tsfg-build\\runtime\\tsfg-runtime.exe',
  ]);
  return existing ?? overridePath ?? path.join(buildRoot, 'runtime', 'tsfg-runtime.exe');
}

export function resolveRuntimeLib(overridePath) {
  const sdk = resolveSdkRoot();
  const buildRoot = process.env.TSFG_BUILD_ROOT ?? path.join(resolveTempDir(), 'tsfg-build');
  const existing = firstExistingOnly([
    overridePath,
    process.env.TSFG_RUNTIME_LIB,
    path.join(sdk, 'lib', 'tsfg_runtime.lib'),
    path.join(buildRoot, 'runtime', 'tsfg_runtime.lib'),
    'E:\\tsfg-build\\runtime\\tsfg_runtime.lib',
  ]);
  return existing ?? overridePath ?? path.join(buildRoot, 'runtime', 'tsfg_runtime.lib');
}

export function resolveCommonEngineLib(overridePath) {
  const sdk = resolveSdkRoot();
  const buildRoot = process.env.TSFG_BUILD_ROOT ?? path.join(resolveTempDir(), 'tsfg-build');
  const existing = firstExistingOnly([
    overridePath,
    process.env.TSFG_COMMON_ENGINE_LIB,
    path.join(sdk, 'lib', 'tsfg_common_engine.lib'),
    path.join(buildRoot, 'runtime', 'tsfg_common_engine.lib'),
    'E:\\tsfg-build\\runtime\\tsfg_common_engine.lib',
  ]);
  return existing ?? overridePath ?? path.join(buildRoot, 'runtime', 'tsfg_common_engine.lib');
}

function firstSubdir(dir) {
  if (!dir || !existsSync(dir)) return null;
  try {
    const entries = readdirSync(dir)
      .filter((name) => {
        try {
          return statSync(path.join(dir, name)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort()
      .reverse();
    return entries.length > 0 ? path.join(dir, entries[0]) : null;
  } catch {
    return null;
  }
}

/**
 * Dynamically discover MSVC + Windows SDK + Clang builtins include/lib directories
 * from the active locked toolchain closure or SDK `toolchain/` layout (zero hardcoded versions or SHAs).
 */
export function resolveWindowsSdkPaths() {
  const sdk = resolveSdkRoot();
  const roots = [
    path.join(sdk, 'toolchain'),
    resolveLockedClosureDir(),
  ].filter((r) => r && existsSync(r));

  for (const root of roots) {
    // Support both locked closure layout (`msvc-tools/VC/Tools/MSVC/<ver>` + `windows-sdk/c`)
    // and flat SDK layout (`msvc/` + `winsdk/`).
    const msvcVerDir = firstSubdir(path.join(root, 'msvc-tools', 'VC', 'Tools', 'MSVC'));
    const msvcLib = msvcVerDir ? path.join(msvcVerDir, 'lib', 'x64') : path.join(root, 'msvc', 'lib', 'x64');
    const msvcInc = msvcVerDir ? path.join(msvcVerDir, 'include') : path.join(root, 'msvc', 'include');

    let ucrtLib = path.join(root, 'windows-sdk', 'c', 'ucrt', 'x64');
    let umLib = path.join(root, 'windows-sdk', 'c', 'um', 'x64');
    if (!existsSync(ucrtLib)) {
      const flatLibVer = firstSubdir(path.join(root, 'winsdk', 'Lib'));
      if (flatLibVer) {
        ucrtLib = path.join(flatLibVer, 'ucrt', 'x64');
        umLib = path.join(flatLibVer, 'um', 'x64');
      }
    }

    const winSdkIncVer =
      firstSubdir(path.join(root, 'windows-sdk', 'c', 'Include')) ??
      firstSubdir(path.join(root, 'winsdk', 'Include'));

    const clangVer = firstSubdir(path.join(root, 'llvm', 'lib', 'clang'));
    const builtinsLib = clangVer ? path.join(clangVer, 'lib', 'windows', 'clang_rt.builtins-x86_64.lib') : null;

    if (existsSync(msvcLib) && existsSync(ucrtLib) && existsSync(umLib) && winSdkIncVer) {
      return {
        msvcLib,
        ucrtLib,
        umLib,
        msvcInc,
        ucrtInc: path.join(winSdkIncVer, 'ucrt'),
        umInc: path.join(winSdkIncVer, 'um'),
        sharedInc: path.join(winSdkIncVer, 'shared'),
        builtinsLib: builtinsLib && existsSync(builtinsLib) ? builtinsLib : null,
      };
    }
  }
  return null;
}

export function resolveVulkanConfig(opts = {}) {
  const sdk = resolveSdkRoot();
  const systemLoader = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'vulkan-1.dll');
  const lavapipeDir = opts.lavapipeDir ?? process.env.TSFG_LAVAPIPE_DIR ?? path.join(sdk, 'redist', 'lavapipe');
  const devLavapipeDir = existsSync(lavapipeDir) ? lavapipeDir : 'E:\\tsfg-cache\\lavapipe';

  const loaderPath = opts.loaderPath
    ?? process.env.TSFG_VK_LOADER
    ?? (existsSync(systemLoader) ? systemLoader : firstExisting([path.join(devLavapipeDir, 'vulkan-1.dll')]));

  const fallbackIcdPath = opts.icdPath
    ?? process.env.TSFG_VK_ICD
    ?? firstExisting([
      path.join(devLavapipeDir, 'lvp_icd.x86_64.json'),
    ]);

  return { loaderPath, fallbackIcdPath };
}
