// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startVmBuildChild } from "../../eng/vm-build.mjs";

const fixture = fileURLToPath(new URL("./fixtures/vm-build-child-lifecycle.mjs", import.meta.url));
const environmentKeys = ["SystemRoot", "ComSpec", "PATH", "NODE_DISABLE_COMPILE_CACHE", "NODE_OPTIONS",
  "NODE_PATH", "NODE_COMPILE_CACHE", "NODE_V8_COVERAGE", "TZ", "LANG", "NO_COLOR", "HOME", "USERPROFILE",
  "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "TMPDIR", "TSFG_TEST_STORAGE", "TSFG_FRONTEND_EXE", "TSFG_CORE_EXE", "TSFG_VM_EXE"];

async function observeChild(root, code) {
  const label = code === null ? "missing-program" : "node-" + code;
  const logPath = path.join(root, label + ".log");
  const log = await open(logPath, "wx");
  let started, result = null, failure = null;
  try {
    started = startVmBuildChild({ command: { label,
      executable: code === null ? path.join(root, "program-does-not-exist.exe") : process.execPath,
      args: code === null ? [] : [fixture, String(code)], cwd: root,
      environment: Object.fromEntries(environmentKeys.map(key => {
        assert.equal(typeof process.env[key], "string", "closed environment missing " + key);
        return [key, process.env[key]];
      })) }, logFd: log.fd, logPath });
    try { result = await started.completion; } catch (error) { failure = error; }
  } finally { await log.close(); }
  const observation = started.observation;
  const raw = await readFile(logPath, "utf8");
  // Keep all observations and the raw merged log before any failing assertion.
  await writeFile(path.join(root, label + ".observation.json"), JSON.stringify({ result, observation,
    failure: failure === null ? null : String(failure) }, null, 2) + "\n", { flag: "wx" });
  return { result, observation, raw, failure };
}

test("production VM child runner records observed lifecycle independently", async t => {
  const storage = process.env.TSFG_TEST_STORAGE;
  assert.equal(typeof storage, "string");
  assert.match(storage, /^E:[\\/]/i);
  await mkdir(storage, { recursive: true });
  const root = await mkdtemp(path.join(storage, "vm-child-lifecycle-"));
  const zero = await observeChild(root, 0);
  const nonzero = await observeChild(root, 7);
  const missing = await observeChild(root, null);
  for (const { code, observed } of [{ code: 0, observed: zero }, { code: 7, observed: nonzero }]) {
    await t.test("natural " + code + " preserves close result and both raw streams", () => {
      assert.equal(observed.failure, null);
      assert.deepEqual(observed.result, { code, signal: null });
      assert.deepEqual(observed.observation.close, { code, signal: null });
      assert.equal(observed.observation.error, null);
      assert.match(observed.raw, /child-stderr-marker/);
      const facts = JSON.parse(observed.raw.split(/\r?\n/).find(line => line.startsWith("{")));
      assert.equal(facts.code, code);
      assert.ok(Number.isSafeInteger(facts.pid) && facts.pid > 0);
    });
    await t.test("natural " + code + " records the separate exit event", () => {
      assert.deepEqual(observed.observation.exit, { code, signal: null });
    });
    await t.test("natural " + code + " records the actual child PID", () => {
      const facts = JSON.parse(observed.raw.split(/\r?\n/).find(line => line.startsWith("{")));
      assert.equal(observed.observation.pid, facts.pid);
    });
  }
  await t.test("spawn error remains a rejection with no invented PID or exit", () => {
    assert.equal(missing.result, null);
    assert.match(String(missing.failure), /ENOENT/);
    assert.match(missing.observation.error, /ENOENT/);
    assert.equal(missing.observation.pid, null);
    assert.equal(missing.observation.exit, null);
    // A close event after error is permitted; its code is never used as exit.
    if (missing.observation.close !== null) {
      assert.ok(Number.isSafeInteger(missing.observation.close.code));
      assert.equal(missing.observation.close.signal, null);
    }
    assert.equal(missing.raw, "");
  });
});
