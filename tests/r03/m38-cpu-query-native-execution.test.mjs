// SPDX-License-Identifier: MIT
// M38: End-to-end CPU Query/Jobs static analysis, live paired LLVM IR + tmeta
// generation, native DLL compilation, production CodeLease ownership, and
// multi-threaded parallel Store execution verified against independent oracles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { canonical } from '../../compiler/identity.mjs';
import { compileSystemQuery } from '../../compiler/pipeline.mjs';

const CORE_EXE = process.env.TSFG_CORE_IR_EXE ?? 'E:\\tsfg-build\\mlir-sdk\\bin\\tsfg-core-ir.exe';
const ZIG_EXE = process.env.TSFG_LOCKED_ZIG ?? 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\zig\\zig.exe';
const CLANG_CL = process.env.TSFG_CLANG_CL ?? 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\llvm\\bin\\clang-cl.exe';
const LLD_LINK = process.env.TSFG_LLD_LINK ?? 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\llvm\\bin\\lld-link.exe';
const BUILD_DIR = process.env.TSFG_M38_BUILD_DIR ?? 'E:\\tsfg-build\\m38';

const sha256 = (buf) => 'sha256:' + createHash('sha256').update(buf).digest('hex');

async function buildRunner() {
  await mkdir(BUILD_DIR, { recursive: true });
  const runnerExe = path.join(BUILD_DIR, 'jobs-code-lease-runner.exe');
  const build = spawnSync(ZIG_EXE, [
    'build-exe', 'jobs-code-lease-runner.zig',
    '-target', 'x86_64-windows-msvc', '-mcpu', 'x86_64_v2', '-ODebug', '-fno-lto',
    `-femit-bin=${runnerExe}`,
  ], { cwd: path.resolve('runtime'), windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (build.error) throw build.error;
  assert.equal(build.status, 0, `build jobs-code-lease-runner failed:\n${build.stderr.toString('utf8')}`);
  return runnerExe;
}

async function compileLlvmToDll(tag, llvmText, entrySymbols) {
  const dir = path.join(BUILD_DIR, tag);
  await mkdir(dir, { recursive: true });
  const llPath = path.join(dir, `${tag}.ll`);
  const objPath = path.join(dir, `${tag}.obj`);
  const dllPath = path.join(dir, `${tag}.dll`);
  await writeFile(llPath, llvmText, 'utf8');

  const cc = spawnSync(CLANG_CL, [
    '/c', '/O2', '-x', 'ir', llPath, `/Fo${objPath}`,
  ], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (cc.error) throw cc.error;
  assert.equal(cc.status, 0, `clang-cl IR compile failed for ${tag}:\n${cc.stderr.toString('utf8')}`);

  const fltSrc = path.join(dir, 'fltused.c');
  const fltObj = path.join(dir, 'fltused.obj');
  await writeFile(fltSrc, 'int _fltused = 1;\n', 'utf8');
  const ccFlt = spawnSync(CLANG_CL, ['/c', '/O2', fltSrc, `/Fo${fltObj}`], { windowsHide: true });
  assert.equal(ccFlt.status, 0, `fltused compile failed:\n${ccFlt.stderr.toString('utf8')}`);

  const exports = entrySymbols.map((s) => `/EXPORT:${s}`);
  const ld = spawnSync(LLD_LINK, [
    '/DLL', '/NOENTRY', '/NODEFAULTLIB', ...exports, `/OUT:${dllPath}`, objPath, fltObj,
  ], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (ld.error) throw ld.error;
  assert.equal(ld.status, 0, `lld-link DLL failed for ${tag}:\n${ld.stderr.toString('utf8')}`);
  return { llPath, dllPath };
}

function runNative(runnerExe, args) {
  const res = spawnSync(runnerExe, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (res.error) throw res.error;
  assert.equal(res.status, 0, `runner exited ${res.status}:\n${res.stderr.toString('utf8')}`);
  return JSON.parse(res.stdout.toString('utf8'));
}

test('M38: Retained official i32-copy LLVM kernel compiled to DLL and executed concurrently on Store via CodeLease', async () => {
  const runnerExe = await buildRunner();
  const tmetaPath = path.resolve('runtime/jobs/testdata/query-tmeta-i32-copy.tmeta');
  const llOrigPath = path.resolve('runtime/jobs/testdata/query-tmeta-i32-copy-retained.ll');
  const receiptOrig = JSON.parse(readFileSync(path.resolve('runtime/jobs/testdata/query-tmeta-i32-copy-receipt.json'), 'utf8'));
  const tmetaEnv = JSON.parse(readFileSync(tmetaPath, 'utf8'));
  const tmetaPayload = JSON.parse(tmetaEnv.payload);
  const llvmBytes = readFileSync(llOrigPath);

  const symbols = tmetaPayload.entries.map((e) => e.entrySymbol);
  const { llPath, dllPath } = await compileLlvmToDll('retained-i32-copy', llvmBytes.toString('utf8'), symbols);
  const receiptPath = path.join(BUILD_DIR, 'retained-i32-copy', 'receipt.json');
  await writeFile(receiptPath, JSON.stringify({
    ...receiptOrig,
    llvmHash: sha256(llvmBytes),
    batchHash: tmetaPayload.batchHash,
  }));

  // Compare serial (1 worker) vs parallel (4 workers) across 2048 rows in 16 chunks (chunkCap=128)
  const serial = runNative(runnerExe, ['i32-copy', tmetaPath, llPath, dllPath, receiptPath, '128', '2048', '1']);
  const parallel = runNative(runnerExe, ['i32-copy', tmetaPath, llPath, dllPath, receiptPath, '128', '2048', '4']);
  assert.equal(parallel.batchesExecuted, 16);
  assert.ok(parallel.distinctThreads >= 2, `expected real multi-thread execution, got ${parallel.distinctThreads} thread(s)`);
  assert.deepEqual(parallel.rows, serial.rows, 'parallel vs serial exact numerical equivalence');

  // Verify every single row against independent oracle: dst.n == src.n, dst.pad untouched!
  for (let i = 0; i < parallel.rows.length; i++) {
    assert.equal(parallel.rows[i].dstN, parallel.rows[i].srcN, `row ${i} copy oracle`);
    assert.equal(parallel.rows[i].dstPad, 0x1000 + i, `row ${i} untouched pad field`);
  }
});

test('M38: Live tsfg-core-ir compilation of i32 wrapping compound Query -> DLL -> multi-thread Store execution', async () => {
  const runnerExe = await buildRunner();
  const dir = path.resolve('tests/r03/testdata/system-query-i32-field-compound');
  const pkgBytes = readFileSync(path.join(dir, 'package.json'));
  const reqBytes = readFileSync(path.join(dir, 'request.json'));
  const pkg = JSON.parse(pkgBytes.toString('utf8'));
  const sourceText = readFileSync(path.join(dir, 'source.ts'), 'utf8');

  // Single public compileSystemQuery producing paired tmeta + LLVM IR from live tsfg-core-ir.exe
  const compiled = await compileSystemQuery(pkgBytes, {
    family: 'tsfg.system-query-context-candidate',
    version: 6,
    requestBytes: reqBytes,
    expectedPackageId: pkg.packageId,
  }, { core: CORE_EXE, effects: true, cpuBatch: true, cpuLLVM: 'ir', tmeta: true });

  assert.ok(compiled.tmeta && compiled.cpuLLVM && compiled.effects && compiled.cpuBatch);
  const tmetaText = canonical(compiled.tmeta.envelope) + '\n';
  const workDir = path.join(BUILD_DIR, 'live-i32-compound');
  await mkdir(workDir, { recursive: true });
  const tmetaPath = path.join(workDir, 'compound.tmeta');
  await writeFile(tmetaPath, tmetaText, 'utf8');

  const symbols = compiled.tmeta.payload.entries.map((e) => e.entrySymbol);
  const { llPath, dllPath } = await compileLlvmToDll('live-i32-compound', compiled.cpuLLVM, symbols);
  const receiptPath = path.join(workDir, 'receipt.json');
  await writeFile(receiptPath, JSON.stringify({
    payloadHash: compiled.tmeta.payloadHash ?? compiled.tmeta.envelope.payloadHash,
    inputIdentity: compiled.tmeta.payload.inputIdentity,
    packageId: compiled.tmeta.payload.packageId,
    llvmHash: sha256(Buffer.from(compiled.cpuLLVM, 'utf8')),
    batchHash: compiled.tmeta.payload.batchHash,
  }));

  const serial = runNative(runnerExe, ['i32-compound', tmetaPath, llPath, dllPath, receiptPath, '128', '2048', '1']);
  const parallel = runNative(runnerExe, ['i32-compound', tmetaPath, llPath, dllPath, receiptPath, '128', '2048', '4']);
  assert.equal(parallel.batchesExecuted, 16);
  assert.ok(parallel.distinctThreads >= 2, `expected multi-thread execution, got ${parallel.distinctThreads}`);
  assert.deepEqual(parallel.rows, serial.rows, 'compound parallel vs serial equivalence');

  // Independent wrapping i32 oracle based on source.ts operator (+=, -=, *=)
  const seedSrc = [0, 1, -1, 42, -42, 2147483647, -2147483648, 123456, -987654, 7, 1000000000, -1000000000, 13, -13, 999999];
  const seedDst = [10, 20, -30, 100, -100, 5, -5, 2147483640, -2147483640, 3, 1500000000, -1500000000, 77, -77, 1];
  const op = sourceText.includes('+=') ? '+' : sourceText.includes('-=') ? '-' : sourceText.includes('*=') ? '*' : null;
  assert.ok(op, `recognized compound op in source.ts:\n${sourceText}`);
  for (let i = 0; i < parallel.rows.length; i++) {
    const a = seedDst[i % seedDst.length];
    const b = seedSrc[i % seedSrc.length];
    const expected = op === '+' ? ((a + b) | 0) : op === '-' ? ((a - b) | 0) : Math.imul(a, b);
    assert.equal(parallel.rows[i].dstN, expected, `row ${i} wrapping i32 oracle (${a} ${op} ${b})`);
    assert.equal(parallel.rows[i].dstPad, 0x1000 + i, `row ${i} untouched pad field`);
  }
});

test('M38: Live tsfg-core-ir multi-system conflict rejection & concurrent non-conflicting native execution', async () => {
  const runnerExe = await buildRunner();
  const dir = path.resolve('tests/r03/testdata/system-query-effects');
  const pkgBytes = readFileSync(path.join(dir, 'multi-facts.json'));
  const reqBytes = readFileSync(path.join(dir, 'multi-request.json'));
  const pkg = JSON.parse(pkgBytes.toString('utf8'));

  const compiled = await compileSystemQuery(pkgBytes, {
    family: 'tsfg.system-query-context-candidate',
    version: 6,
    requestBytes: reqBytes,
    expectedPackageId: pkg.packageId,
  }, { core: CORE_EXE, effects: true, cpuBatch: true, cpuLLVM: 'ir', tmeta: true });

  assert.equal(compiled.effects.conflicts.length, 13, 'official 7-system conflict graph has 13 conflicts');
  const tmetaText = canonical(compiled.tmeta.envelope) + '\n';
  const workDir = path.join(BUILD_DIR, 'live-multi-systems');
  await mkdir(workDir, { recursive: true });
  const tmetaPath = path.join(workDir, 'multi.tmeta');
  await writeFile(tmetaPath, tmetaText, 'utf8');

  const symbols = compiled.tmeta.payload.entries.map((e) => e.entrySymbol);
  const { llPath, dllPath } = await compileLlvmToDll('live-multi-systems', compiled.cpuLLVM, symbols);
  const receiptPath = path.join(workDir, 'receipt.json');
  await writeFile(receiptPath, JSON.stringify({
    payloadHash: compiled.tmeta.payloadHash ?? compiled.tmeta.envelope.payloadHash,
    inputIdentity: compiled.tmeta.payload.inputIdentity,
    packageId: compiled.tmeta.payload.packageId,
    llvmHash: sha256(Buffer.from(compiled.cpuLLVM, 'utf8')),
    batchHash: compiled.tmeta.payload.batchHash,
  }));

  const out = runNative(runnerExe, ['multi-conflict-and-parallel', tmetaPath, llPath, dllPath, receiptPath, '128', '2048', '4']);
  assert.equal(out.conflictsRejected, 13, 'all 13 conflicting system pairs rejected before Store lease');
  assert.equal(out.batchesExecuted, 32, '2 non-conflicting systems x 16 chunks = 32 parallel batches executed');
  assert.ok(out.distinctThreads >= 2, `multi-system native kernels ran concurrently across ${out.distinctThreads} threads`);
});
