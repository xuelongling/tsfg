// SPDX-License-Identifier: MIT
// Standalone R04 Contract Test Kit.
// Verifies registry schemaHash integrity, golden fixtures, old-version rejection,
// deterministic fuzz mutations across BOTH JS and Zig Runtime validators, and RF-01.
import { createHash } from 'node:crypto';
import { readFile, readdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, sha256 } from '../../compiler/r04-identity.mjs';
import { validateAbiArtifact } from '../../compiler/r04-abi.mjs';
import {
  emitTmetaToDirectory,
  validateCompilerServiceMessage,
  validateCoreIrExchange,
  validateModuleReload,
  validateNativePatch,
  validateTmetaArtifact,
} from '../../compiler/r04-protocols.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const JS_VALIDATORS = Object.freeze({
  abi: (bytes) => validateAbiArtifact(bytes),
  'compiler-service': (bytes) => validateCompilerServiceMessage(bytes),
  'core-ir-exchange': (bytes) => validateCoreIrExchange(bytes),
  'module-reload': (bytes) => validateModuleReload(bytes),
  'native-patch': (bytes) => validateNativePatch(bytes),
  tmeta: (bytes) => validateTmetaArtifact(bytes),
});

export async function verifyContractRegistry(repoRoot = REPO_ROOT) {
  const regPath = path.join(repoRoot, 'contracts/registry.json');
  const regBytes = await readFile(regPath);
  const reg = JSON.parse(regBytes.toString('utf8'));
  if (`${canonical(reg)}\n` !== regBytes.toString('utf8')) {
    throw new Error('contracts/registry.json is not canonical JCS + LF');
  }
  const verified = [];
  for (const [familyId, entry] of Object.entries(reg)) {
    const schemaPath = path.join(repoRoot, entry.schema);
    const specPath = path.join(repoRoot, entry.spec);
    const schemaObj = JSON.parse(await readFile(schemaPath, 'utf8'));
    await readFile(specPath, 'utf8');
    const actualHash = sha256(canonical(schemaObj));
    if (actualHash !== entry.schemaHash) {
      throw new Error(`schemaHash mismatch for ${familyId}: expected ${entry.schemaHash}, got ${actualHash}`);
    }
    verified.push({ familyId, schemaHash: actualHash, semver: entry.semver });
  }
  return verified;
}

export function runZigValidator(validatorExe, kind, bytes) {
  const res = spawnSync(validatorExe, ['--validate', kind], {
    input: bytes,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (res.error) throw res.error;
  return {
    status: res.status,
    stderr: res.stderr.toString('utf8').trim(),
    stdout: res.stdout.toString('utf8').trim(),
  };
}

export function generateDeterministicFuzzMutations(seedBytes, count = 24) {
  const mutations = [];
  // Fixed structural fault cases
  mutations.push({ bytes: Buffer.alloc(0), name: 'empty' });
  mutations.push({ bytes: seedBytes.subarray(0, Math.max(1, seedBytes.length - 1)), name: 'strip-lf' });
  mutations.push({ bytes: seedBytes.subarray(0, Math.floor(seedBytes.length / 2)), name: 'truncate-half' });
  mutations.push({ bytes: Buffer.concat([seedBytes, Buffer.from('garbage\n')]), name: 'trailing-garbage' });
  mutations.push({ bytes: Buffer.concat([Buffer.from(' '), seedBytes]), name: 'leading-space-noncanonical' });
  mutations.push({ bytes: Buffer.from(`${'{'.repeat(80)}${'}'.repeat(80)}\n`), name: 'depth-bomb-80' });
  mutations.push({ bytes: Buffer.from([0x7b, 0xff, 0xfe, 0x7d, 0x0a]), name: 'invalid-utf8' });

  // Deterministic PRNG single-byte & multi-byte bit flips inside valid envelope
  let state = 0x5f3759df;
  const nextU32 = () => {
    state = (Math.imul(state ^ (state >>> 15), 0x85ebca6b) + 0xc2b2ae35) >>> 0;
    return state;
  };
  for (let i = 0; i < count; i++) {
    const copy = Buffer.from(seedBytes);
    const pos = nextU32() % Math.max(1, copy.length - 1);
    copy[pos] ^= 1 << (nextU32() % 7);
    if (copy.equals(seedBytes)) copy[pos] ^= 1;
    mutations.push({ bytes: copy, name: `bitflip-${i}-at-${pos}` });
  }
  return mutations;
}

import { resolveTempDir } from '../../compiler/tsfg-paths.mjs';

export async function runContractKit({
  fixtureRoot = path.join(REPO_ROOT, 'tests/fixtures/r04'),
  repoRoot = REPO_ROOT,
  tempDir = resolveTempDir('r04-rf01'),
  validatorExe = null,
  vmExe = null,
} = {}) {
  const report = {
    fuzzRejected: 0,
    goldenPassed: 0,
    oldVersionRejected: 0,
    registryVerified: 0,
    rf01Verified: false,
  };

  // 1. Registry verification
  const regEntries = await verifyContractRegistry(repoRoot);
  report.registryVerified = regEntries.length;

  // 2. Golden fixtures (JS + Zig Runtime)
  const goldenMap = [
    ['abi', 'valid.tsfgabi'],
    ['tmeta', 'valid.tmeta'],
    ['core-ir-exchange', 'valid.core-ir-exchange.json'],
    ['native-patch', 'valid.tpatch'],
    ['module-reload', 'valid.module-reload.json'],
    ['compiler-service', 'valid.compiler-service-req.json'],
    ['compiler-service', 'valid.compiler-service-res.json'],
  ];

  const goldenBuffers = new Map();
  for (const [kind, file] of goldenMap) {
    const bytes = await readFile(path.join(fixtureRoot, file));
    goldenBuffers.set(kind, bytes);
    JS_VALIDATORS[kind](bytes);
    if (validatorExe) {
      const z = runZigValidator(validatorExe, kind, bytes);
      if (z.status !== 0) {
        throw new Error(`Zig validator rejected golden ${file}: ${z.stderr}`);
      }
    }
    report.goldenPassed++;
  }

  // 3. Old-version fixtures MUST be cleanly rejected by both JS and Zig Runtime
  const oldVersionMap = [
    ['abi', 'old-v0.tsfgabi'],
    ['tmeta', 'old-v0.tmeta'],
    ['core-ir-exchange', 'old-v0.core-ir-exchange.json'],
    ['native-patch', 'old-v0.tpatch'],
    ['module-reload', 'old-v0.module-reload.json'],
    ['compiler-service', 'old-v0.compiler-service.json'],
  ];
  for (const [kind, file] of oldVersionMap) {
    const bytes = await readFile(path.join(fixtureRoot, file));
    let jsRejected = false;
    try {
      JS_VALIDATORS[kind](bytes);
    } catch (err) {
      if (!/version-mismatch|r04-/.test(String(err))) throw err;
      jsRejected = true;
    }
    if (!jsRejected) throw new Error(`JS validator accepted old-version fixture ${file}`);
    if (validatorExe) {
      const z = runZigValidator(validatorExe, kind, bytes);
      if (z.status !== 4 || !z.stderr.includes('VersionMismatch')) {
        throw new Error(`Zig validator failed to reject old-version ${file} cleanly: status=${z.status} stderr=${z.stderr}`);
      }
    }
    report.oldVersionRejected++;
  }

  // Also check old v11 .tbc fixture against real tsfg-runtime.exe when provided
  if (vmExe) {
    const oldTbc = await readFile(path.join(fixtureRoot, 'old-v11.tbc'));
    const vmRes = spawnSync(vmExe, ['--requests', '[{}]'], { input: oldTbc, windowsHide: true });
    if (vmRes.status === 0) throw new Error('tsfg-runtime.exe accepted old-v11.tbc');
    report.oldVersionRejected++;
  }

  // 4. Checked-in fuzzer seed corpus + deterministic mutations across JS & Zig Runtime
  const seedDir = path.join(fixtureRoot, 'fuzz-seeds');
  const seedFiles = (await readdir(seedDir)).sort();
  for (const sf of seedFiles) {
    const bytes = await readFile(path.join(seedDir, sf));
    for (const kind of Object.keys(JS_VALIDATORS)) {
      let rejected = false;
      try { JS_VALIDATORS[kind](bytes); } catch { rejected = true; }
      if (!rejected) throw new Error(`Fuzz seed ${sf} unexpectedly accepted by JS ${kind}`);
      if (validatorExe) {
        const z = runZigValidator(validatorExe, kind, bytes);
        // Exit code 4 = structured rejection (never 0, never crash/signal!)
        if (z.status !== 4) {
          throw new Error(`Zig validator crashed or accepted fuzz seed ${sf} (${kind}): status=${z.status} stderr=${z.stderr}`);
        }
      }
      report.fuzzRejected++;
    }
  }

  for (const [kind, seedBytes] of goldenBuffers.entries()) {
    const muts = generateDeterministicFuzzMutations(seedBytes, 12);
    for (const m of muts) {
      let rejected = false;
      try { JS_VALIDATORS[kind](m.bytes); } catch { rejected = true; }
      if (!rejected) throw new Error(`Mutation ${kind}/${m.name} unexpectedly accepted by JS`);
      if (validatorExe) {
        const z = runZigValidator(validatorExe, kind, m.bytes);
        if (z.status !== 4) {
          throw new Error(`Zig validator crashed or accepted mutation ${kind}/${m.name}: status=${z.status} stderr=${z.stderr}`);
        }
      }
      report.fuzzRejected++;
    }
  }

  // 5. RF-01: Two independent output directories yield identical Reflection Digest; mutation changes digest
  const validTmeta = validateTmetaArtifact(goldenBuffers.get('tmeta')).payload;
  const dirA = path.join(tempDir, 'out-dir-alpha');
  const dirB = path.join(tempDir, 'out-dir-beta');
  const dirC = path.join(tempDir, 'out-dir-mutated');
  try {
    const specA = {
      abiHash: validTmeta.abiHash,
      components: validTmeta.components,
      contractSetId: validTmeta.contractSetId,
      functions: validTmeta.functions,
      inputIdentity: validTmeta.inputIdentity,
      queries: validTmeta.queries,
      target: validTmeta.target,
      types: validTmeta.types,
    };
    const rA = await emitTmetaToDirectory(dirA, specA);
    const rB = await emitTmetaToDirectory(dirB, specA);
    if (!rA.bytes.equals(rB.bytes) || rA.reflectionDigest !== rB.reflectionDigest) {
      throw new Error('RF-01 violated: independent output directories produced differing .tmeta or reflectionDigest');
    }
    const rMut = await emitTmetaToDirectory(dirC, {
      ...specA,
      components: [...specA.components, 'AddedComponent'],
    });
    if (rMut.reflectionDigest === rA.reflectionDigest) {
      throw new Error('RF-01 violated: mutating component catalog did not change reflectionDigest');
    }
    report.rf01Verified = true;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Map();
  for (let i = 2; i < process.argv.length; i += 2) {
    args.set(process.argv[i], process.argv[i + 1]);
  }
  const rep = await runContractKit({
    validatorExe: args.get('--validator') ?? null,
    vmExe: args.get('--vm') ?? null,
  });
  process.stdout.write(`${JSON.stringify(rep, null, 2)}\n`);
}
