// SPDX-License-Identifier: MIT
// R05 & R06 End-to-End Parity, Bytecode Fuzzing, and Superinstruction Measurement Suite:
//   Real TypeScript Source -> Go Frontend -> HIR -> Core IR (tsfg-core-ir.exe)
//     -> R05 Bytecode Lowering (r05-bytecode-lower.mjs)
//     -> Pre-Load Verifier + Zig Predecoded Register Interpreter (tsfg-r05-vm.exe, unfused AND fused)
//     === CommonCoreVm === Independent Semantic Oracle
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { canonical } from '../../compiler/identity.mjs';
import { commonSourceFormatV3 } from '../../compiler/common-program-common.mjs';
import { readCommonProgramFacts } from '../../compiler/common-program-facts.mjs';
import { projectCommonProgram } from '../../compiler/common-program-hir.mjs';
import { createCommonProgramPublication } from '../../compiler/common-program-analysis.mjs';
import { emitCommonProgramCore } from '../../compiler/common-program-core.mjs';
import { CommonCoreVm } from '../../compiler/common-vm.mjs';
import { lowerCommonCoreToR05Bytecode } from '../../compiler/r05-bytecode-lower.mjs';

const FRONTEND_EXE = process.env.TSFG_FRONTEND_EXE ?? 'E:\\tsfg-artifacts\\r03-baseline\\tsfg-frontend-m24-8443e0f.exe';
const CORE_EXE = process.env.TSFG_CORE_IR_EXE ?? 'E:\\tsfg-build\\mlir-sdk\\bin\\tsfg-core-ir.exe';
const ZIG_EXE = process.env.TSFG_LOCKED_ZIG ?? 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\zig\\zig.exe';
const BUILD_DIR = process.env.TSFG_R05_BUILD_DIR ?? 'E:\\tsfg-build\\r05';

let cachedVmExe = null;
async function ensureR05VmExe() {
  if (cachedVmExe) return cachedVmExe;
  await mkdir(BUILD_DIR, { recursive: true });
  const exe = path.join(BUILD_DIR, 'tsfg-r05-vm.exe');
  const res = spawnSync(ZIG_EXE, [
    'build-exe', 'r05-vm-cli.zig',
    '-target', 'x86_64-windows-msvc', '-mcpu', 'x86_64_v2', '-O', 'ReleaseSafe', '-fno-lto',
    `-femit-bin=${exe}`,
  ], { cwd: path.resolve('runtime'), windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(res.status, 0, `zig build-exe r05-vm-cli failed:\n${res.stderr.toString('utf8')}`);
  cachedVmExe = exe;
  return exe;
}

function compileRawTsToCoreMlir(rawTs, exportedRootNames) {
  const sha = (s) => createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
  const pos = JSON.parse(readFileSync(new URL('../r03/common-program-positive.json', import.meta.url), 'utf8'));
  const dts = pos.payload.files.find((f) => f.path.endsWith('.d.ts'));
  const req = {
    family: 'tsfg.program-facts-request-candidate',
    version: commonSourceFormatV3.version,
    schemaHash: commonSourceFormatV3.schemaHash,
    input: {
      sourceRoot: '/src',
      rootFile: '/src/main.ts',
      files: [
        { path: '/src/main.ts', content: rawTs, sha256: sha(rawTs) },
        { path: dts.path, content: dts.content, sha256: dts.sha256 },
      ],
      declarations: pos.payload.declarations,
      config: pos.payload.config,
      target: pos.payload.target,
      compilationClosure: {
        roots: [
          ...exportedRootNames.map((name) => ({ kind: 'application', sourcePath: '/src/main.ts', name })),
          { kind: 'module-initialization', sourcePath: '/src/main.ts', name: '$moduleInit' },
        ],
        requiredRoots: [],
      },
      hostImports: [],
    },
  };
  const fe = spawnSync(FRONTEND_EXE, ['--program-facts-io-v3'], {
    input: Buffer.from(canonical(req) + '\n', 'utf8'), windowsHide: true, maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(fe.status, 0, `Go frontend failed:\n${fe.stderr.toString('utf8')}`);
  const facts = readCommonProgramFacts(fe.stdout);
  const hir = projectCommonProgram(facts);
  const pub = createCommonProgramPublication(hir);
  const core = emitCommonProgramCore(hir, pub, { targets: [] });
  const canon = spawnSync(CORE_EXE, ['--common-program', '--canonicalize'], {
    input: Buffer.from(core, 'utf8'), windowsHide: true, maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(canon.status, 0, `--canonicalize failed:\n${canon.stderr.toString('utf8')}`);
  return canon.stdout.toString('utf8');
}

function runZigVm(vmExe, tbcBytes, args) {
  const res = spawnSync(vmExe, args, { input: tbcBytes, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  if (res.error) throw res.error;
  return { status: res.status, stderr: res.stderr.toString('utf8').trim(), stdout: res.stdout.toString('utf8').trim() };
}

test('R05 E2E: Real TypeScript -> Go Frontend -> Core IR -> TSFGR05B -> Zig Predecoded VM (unfused === fused === CommonCoreVm === Oracle)', async () => {
  const vmExe = await ensureR05VmExe();
  const rawTs = `
export function arraySpanCalc(idx: u32): i32 {
  const arr: i32[] = [10, 20, 30, 40];
  const sp: ReadSpan<i32> = readSpan(arr, 1, 2);
  let total: i32 = 0;
  let i: u32 = 0;
  while (i < sp.length) {
    total = total + sp[i];
    i = i + 1;
  }
  return total + sp[idx];
}

export function divSafe(a: i32, b: i32): i32 {
  return a / b;
}

export function sumLoop(n: i32): i32 {
  let acc: i32 = 0;
  let i: i32 = 0;
  while (i < n) {
    acc = acc + i;
    i = i + 1;
  }
  return acc;
}
`;

  const mlir = compileRawTsToCoreMlir(rawTs, ['arraySpanCalc', 'divSafe', 'sumLoop']);
  const lowered = lowerCommonCoreToR05Bytecode(mlir);

  // 1. Standalone Zig pre-load verifier accepts lowered bytecode
  const ver = runZigVm(vmExe, lowered.bytes, ['--verify-only']);
  assert.equal(ver.status, 0, `R05 verifier rejected lowered bytecode: ${ver.stderr}`);
  const verJson = JSON.parse(ver.stdout);
  assert.equal(verJson.status, 'verified');

  // 2. Compare unfused Zig VM === fused Zig VM === CommonCoreVm === Independent Oracle
  const refVm = new CommonCoreVm(mlir);
  const sumIdx = lowered.exportsByName.get('sumLoop');
  const arrIdx = lowered.exportsByName.get('arraySpanCalc');
  const divIdx = lowered.exportsByName.get('divSafe');

  const uSum = JSON.parse(runZigVm(vmExe, lowered.bytes, ['--run', String(sumIdx), '--unfused', '--args', '50']).stdout);
  const fSum = JSON.parse(runZigVm(vmExe, lowered.bytes, ['--run', String(sumIdx), '--args', '50']).stdout);
  const rSum = refVm.callExport('sumLoop', [50]);
  assert.equal(uSum.status, 'ok');
  assert.equal(uSum.i32, 1225);
  assert.equal(fSum.i32, uSum.i32);
  assert.equal(fSum.fuelConsumed, uSum.fuelConsumed);
  assert.equal(rSum.i32, 1225);

  // Array + ReadSpan positive & OOB trap parity
  const arrOk = JSON.parse(runZigVm(vmExe, lowered.bytes, ['--run', String(arrIdx), '--args', '1']).stdout);
  assert.equal(arrOk.status, 'ok');
  assert.equal(arrOk.i32, 80); // (20 + 30) + 30 = 80
  assert.equal(refVm.callExport('arraySpanCalc', [1]).i32, 80);

  const arrTrap = JSON.parse(runZigVm(vmExe, lowered.bytes, ['--run', String(arrIdx), '--args', '5']).stdout);
  assert.equal(arrTrap.status, 'trap');
  assert.equal(arrTrap.code, 'r01-t-bounds');

  // Div-zero trap + Fuel exhaustion trap parity
  const divTrap = JSON.parse(runZigVm(vmExe, lowered.bytes, ['--run', String(divIdx), '--args', '10,0']).stdout);
  assert.equal(divTrap.status, 'trap');
  assert.equal(divTrap.code, 'r01-t-div-zero');

  const fuelTrapU = JSON.parse(runZigVm(vmExe, lowered.bytes, ['--run', String(sumIdx), '--unfused', '--fuel', '10', '--args', '50']).stdout);
  const fuelTrapF = JSON.parse(runZigVm(vmExe, lowered.bytes, ['--run', String(sumIdx), '--fuel', '10', '--args', '50']).stdout);
  assert.equal(fuelTrapU.status, 'trap');
  assert.equal(fuelTrapF.code, 'r01-t-fuel');
  assert.equal(fuelTrapF.sourceStart, fuelTrapU.sourceStart);
  assert.equal(fuelTrapF.sourceEnd, fuelTrapU.sourceEnd);

  // 3. Measure unfused vs superinstruction-fused hot loop execution & expanded memory
  const benchU = JSON.parse(runZigVm(vmExe, lowered.bytes, ['--bench', String(sumIdx), '200', '--unfused', '--args', '200']).stdout);
  const benchF = JSON.parse(runZigVm(vmExe, lowered.bytes, ['--bench', String(sumIdx), '200', '--args', '200']).stdout);
  assert.equal(benchU.value, 19900);
  assert.equal(benchF.value, 19900);
  assert.ok(benchF.expandedBytes > 0);

  // 4. 50-case CLI bytecode fuzz campaign (zero crashes, structured exit code 4 on corruption!)
  let state = 0x12345678;
  const nextU32 = () => {
    state = (Math.imul(state ^ (state >>> 15), 0x85ebca6b) + 0xc2b2ae35) >>> 0;
    return state;
  };
  for (let i = 0; i < 50; i++) {
    const mutated = Buffer.from(lowered.bytes);
    const pos = nextU32() % mutated.length;
    mutated[pos] ^= 1 << (nextU32() % 8);
    const fuzzRes = runZigVm(vmExe, mutated, ['--verify-only']);
    assert.equal(fuzzRes.status, 4, `corrupted bytecode fuzz #${i} must reject with exit 4, got ${fuzzRes.status}`);
  }
});
