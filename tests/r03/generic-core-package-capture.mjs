// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
let sequence = 0;
// Real CLI only. Root supplies one qualified executable and owned storage root.
// Preserve each raw stream and separate exit/close events even when assertions fail.
export async function invokeCore(input, command = '--canonicalize') {
  const executable = process.env.TSFG_CORE_IR_EXE;
  const storage = process.env.TSFG_TEST_STORAGE;
  assert.ok(executable, 'TSFG_CORE_IR_EXE must identify the real C++ consumer');
  assert.ok(storage, 'TSFG_TEST_STORAGE must identify Root-owned evidence storage');
  const directory = path.join(storage, String(++sequence).padStart(4, '0'));
  await mkdir(directory, { recursive: true });
  const stdin = Buffer.from(input);
  await writeFile(path.join(directory, 'stdin.bin'), stdin);
  const child = spawn(executable, [command], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const stdout = [], stderr = [];
  let exit = null, launchError = null, inputError = null;
  child.stdout.on('data', bytes => stdout.push(bytes));
  child.stderr.on('data', bytes => stderr.push(bytes));
  child.on('exit', (code, signal) => { exit = { code, signal }; });
  child.on('error', error => { launchError = error.message; });
  child.stdin.on('error', error => { inputError = error.message; });
  const closed = new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal })));
  child.stdin.end(stdin);
  const close = await closed;
  const result = { stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), exit, close };
  await Promise.all([
    writeFile(path.join(directory, 'stdout.bin'), result.stdout),
    writeFile(path.join(directory, 'stderr.bin'), result.stderr),
    writeFile(path.join(directory, 'terminal.json'), JSON.stringify({ executable, command, pid: child.pid,
      stdinBytes: stdin.length, stdoutBytes: result.stdout.length, stderrBytes: result.stderr.length,
      exit, close, launchError, inputError }, null, 2) + '\n'),
  ]);
  assert.equal(launchError, null, directory);
  assert.deepEqual(exit, close, 'independent natural exit/close must agree: ' + directory);
  assert.equal(close.signal, null, directory);
  assert.equal(inputError, null, directory);
  return result;
}
export function accepted(result) {
  assert.equal(result.close.code, 0, result.stderr.toString('utf8'));
  assert.equal(result.stderr.length, 0, 'successful Core has no hidden diagnostic');
}
export function rejected(result) {
  assert.equal(result.close.code, 3, result.stderr.toString('utf8'));
  assert.equal(result.stdout.length, 0, 'rejected Core emits no packet');
  assert.match(result.stderr.toString('utf8'), /core-ir-|r04-core-invalid/);
}
