// SPDX-License-Identifier: MIT
// Hermetic Windows x64 Product SDK Packager:
//   Assembles a complete, self-contained Windows x64 `tsfg` SDK layout (`bin/`, `lib/`, `include/`,
//   `stdlib/`, `compiler/`, `tooling/`, `contracts/`, `LICENSE`, `NOTICE`, `spdx-sbom.json`,
//   `sdk-manifest.json`, `sdk-provenance.sig.json`) that runs `tsfgc`, `tsfg-runtime.exe`, and
//   `tsfg-r05-vm.exe` from an isolated directory with ZERO repository checkout!
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonical, contractSetId, sha256, WINDOWS_X64_TARGET } from '../compiler/r04-identity.mjs';
import { ensureR05VmBinary } from '../compiler/r05-ts-driver.mjs';
import { ensureCommonEngineLib } from '../compiler/tsfg-aot-driver.mjs';
import {
  REPO_ROOT,
  resolveCoreIrExe,
  resolveFrontendExe,
  resolveRuntimeExe,
  resolveRuntimeLib,
  resolveTempDir,
  resolveZigCacheEnv,
  resolveZigExe,
} from '../compiler/tsfg-paths.mjs';
import {
  auditRuntimeDependencyClosure,
  auditSpdxAndGenerateSbom,
  signAndVerifyReleaseBundle,
} from '../tooling/release/r13-release-audit.mjs';

async function ensureRuntimeBinaries(opts = {}) {
  const zigExe = resolveZigExe(opts.zig);
  const vmExe = await ensureR05VmBinary(opts.vmExe, opts);
  const commonLib = await ensureCommonEngineLib(opts.commonLib, opts);
  const runtimeExe = resolveRuntimeExe(opts.runtimeExe);
  const runtimeLib = resolveRuntimeLib(opts.runtimeLib);

  if (!existsSync(runtimeExe) || opts.forceRebuild) {
    await mkdir(path.dirname(runtimeExe), { recursive: true });
    const r = spawnSync(
      zigExe,
      ['build-exe', 'tsfg-runtime-cli.zig', '-target', 'x86_64-windows-msvc', '-mcpu', 'x86_64_v2', '-O', 'ReleaseSafe', '-fno-lto', `-femit-bin=${runtimeExe}`],
      { cwd: path.join(REPO_ROOT, 'runtime'), windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: resolveZigCacheEnv() },
    );
    if (r.status !== 0) throw new Error(`sdk: build tsfg-runtime.exe failed:\n${r.stderr.toString('utf8')}`);
  }
  if (!existsSync(runtimeLib) || opts.forceRebuild) {
    await mkdir(path.dirname(runtimeLib), { recursive: true });
    const r = spawnSync(
      zigExe,
      ['build-lib', 'tsfg-runtime.zig', '-target', 'x86_64-windows-msvc', '-mcpu', 'x86_64_v2', '-O', 'ReleaseSafe', '-fno-lto', `-femit-bin=${runtimeLib}`],
      { cwd: path.join(REPO_ROOT, 'runtime'), windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: resolveZigCacheEnv() },
    );
    if (r.status !== 0) throw new Error(`sdk: build tsfg_runtime.lib failed:\n${r.stderr.toString('utf8')}`);
  }
  return { vmExe, runtimeExe, runtimeLib, commonLib };
}

async function listFilesRecursive(dir, relBase = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    const rel = relBase ? `${relBase}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(...(await listFilesRecursive(path.join(dir, e.name), rel)));
    } else if (e.isFile()) {
      out.push(rel);
    }
  }
  return out.sort();
}

/**
 * Assemble a complete standalone Windows x64 Product SDK in `outDir` (and optional `.zip`).
 */
export async function buildWindowsX64ProductSdk(outDir, opts = {}) {
  const sdkDir = path.resolve(outDir ?? path.join(resolveTempDir('tsfg-sdk'), 'tsfg-windows-x64-sdk'));
  await rm(sdkDir, { recursive: true, force: true });
  for (const sub of ['bin', 'lib', 'include', 'stdlib', 'compiler', 'tooling', 'contracts', 'eng']) {
    await mkdir(path.join(sdkDir, sub), { recursive: true });
  }

  const bins = await ensureRuntimeBinaries(opts);
  const frontendExe = resolveFrontendExe(opts.frontendExe);
  const coreIrExe = resolveCoreIrExe(opts.coreIrExe);
  if (!frontendExe || !existsSync(frontendExe)) throw new Error('sdk: tsfg-frontend.exe not found');
  if (!coreIrExe || !existsSync(coreIrExe)) throw new Error('sdk: tsfg-core-ir.exe not found');

  // 1. Copy native executables, static libraries, headers, prelude, and launchers
  await Promise.all([
    cp(bins.runtimeExe, path.join(sdkDir, 'bin', 'tsfg-runtime.exe')),
    cp(bins.vmExe, path.join(sdkDir, 'bin', 'tsfg-r05-vm.exe')),
    cp(frontendExe, path.join(sdkDir, 'bin', 'tsfg-frontend.exe')),
    cp(coreIrExe, path.join(sdkDir, 'bin', 'tsfg-core-ir.exe')),
    cp(path.join(REPO_ROOT, 'bin', 'tsfgc.cmd'), path.join(sdkDir, 'bin', 'tsfgc.cmd')),
    cp(bins.runtimeLib, path.join(sdkDir, 'lib', 'tsfg_runtime.lib')),
    cp(bins.commonLib, path.join(sdkDir, 'lib', 'tsfg_common_engine.lib')),
    cp(path.join(REPO_ROOT, 'include', 'tsfg_runtime.h'), path.join(sdkDir, 'include', 'tsfg_runtime.h')),
    cp(path.join(REPO_ROOT, 'compiler', 'stdlib', 'tsfg-prelude.d.ts'), path.join(sdkDir, 'stdlib', 'tsfg-prelude.d.ts')),
    cp(path.join(REPO_ROOT, 'LICENSE'), path.join(sdkDir, 'LICENSE')),
    cp(path.join(REPO_ROOT, 'NOTICE'), path.join(sdkDir, 'NOTICE')),
  ]);

  // 2. Copy JS compiler drivers, tooling (`tsfgc`, `tsfg-lsp`, `tsfg-dap`, `compiler-service`, `release`), contracts, and shared `eng/` contract modules
  await Promise.all([
    cp(path.join(REPO_ROOT, 'compiler'), path.join(sdkDir, 'compiler'), {
      recursive: true,
      filter: (src) => !src.endsWith('.cpp') && !src.endsWith('.hpp') && !src.includes(`${path.sep}core-ir${path.sep}`),
    }),
    cp(path.join(REPO_ROOT, 'tooling'), path.join(sdkDir, 'tooling'), { recursive: true }),
    cp(path.join(REPO_ROOT, 'contracts'), path.join(sdkDir, 'contracts'), { recursive: true }),
    cp(path.join(REPO_ROOT, 'eng'), path.join(sdkDir, 'eng'), {
      recursive: true,
      filter: (src) => src === path.join(REPO_ROOT, 'eng') || src.endsWith('.mjs') || src.endsWith('.json'),
    }),
  ]);

  // 3. Minimal package.json (`"type": "module"`) so ESM `.mjs` tooling runs cleanly from the unpacked SDK!
  await writeFile(
    path.join(sdkDir, 'package.json'),
    JSON.stringify({ name: 'tsfg-windows-x64-sdk', version: '1.0.0', type: 'module', private: true }, null, 2) + '\n',
    'utf8',
  );

  // 4. Run Zero-Compiler-Dependency PE32+ closure audit + SPDX 2.3 SBOM generation
  const depAudit = await auditRuntimeDependencyClosure(REPO_ROOT, {
    binaries: [
      path.join(sdkDir, 'bin', 'tsfg-runtime.exe'),
      path.join(sdkDir, 'bin', 'tsfg-r05-vm.exe'),
    ],
  });
  if (!depAudit.ok) {
    throw new Error(`sdk: runtime dependency closure violation: ${JSON.stringify(depAudit.violations)}`);
  }

  const spdxAudit = await auditSpdxAndGenerateSbom(REPO_ROOT);
  await writeFile(path.join(sdkDir, 'spdx-sbom.json'), JSON.stringify(spdxAudit.sbom, null, 2) + '\n', 'utf8');

  // 5. Build canonical SHA-256 manifest for every SDK file + Ed25519 provenance signature
  const sdkFiles = await listFilesRecursive(sdkDir);
  const entries = [];
  for (const rel of sdkFiles) {
    const raw = await readFile(path.join(sdkDir, rel));
    entries.push({
      path: rel,
      bytes: raw.length,
      sha256: `sha256:${createHash('sha256').update(raw).digest('hex')}`,
    });
  }

  const manifest = {
    contractSetId: contractSetId(),
    fileCount: entries.length,
    files: entries,
    peBinaryAudits: depAudit.binaryAudits,
    sbomDigest: spdxAudit.sbomDigest,
    sdkName: 'tsfg-windows-x64-sdk',
    target: WINDOWS_X64_TARGET,
    version: '1.0.0',
  };
  await writeFile(path.join(sdkDir, 'sdk-manifest.json'), canonical(manifest) + '\n', 'utf8');

  const provenance = signAndVerifyReleaseBundle(manifest);
  await writeFile(
    path.join(sdkDir, 'sdk-provenance.sig.json'),
    JSON.stringify(
      {
        algorithm: provenance.algorithm,
        payloadDigest: provenance.payloadDigest,
        publicKeyPem: provenance.publicKeyPem,
        signatureBase64: provenance.signatureBase64,
        signatureHex: provenance.signatureHex,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  // 6. Optional Windows ZIP archive via PowerShell Compress-Archive
  let zipPath = null;
  if (opts.zip) {
    zipPath = typeof opts.zip === 'string' ? path.resolve(opts.zip) : `${sdkDir}.zip`;
    await rm(zipPath, { force: true });
    const z = spawnSync(
      'powershell',
      ['-NoProfile', '-Command', `Compress-Archive -Path '${sdkDir}\\*' -DestinationPath '${zipPath}' -Force`],
      { windowsHide: true, encoding: 'utf8' },
    );
    if (z.status !== 0) throw new Error(`sdk: Compress-Archive failed:\n${z.stderr}`);
  }

  return {
    sdkDir,
    zipPath,
    manifest,
    provenance,
    depAudit,
    spdxAudit,
    sdkDigest: sha256(Buffer.from(canonical(manifest), 'utf8')),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outIdx = process.argv.indexOf('--out');
  const outDir = outIdx >= 0 ? process.argv[outIdx + 1] : undefined;
  const wantZip = process.argv.includes('--zip');
  const res = await buildWindowsX64ProductSdk(outDir, { zip: wantZip });
  process.stdout.write(JSON.stringify({ status: 'ok', sdkDir: res.sdkDir, zipPath: res.zipPath, fileCount: res.manifest.fileCount, sdkDigest: res.sdkDigest }) + '\n');
}
