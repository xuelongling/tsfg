// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, linkSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const helper = process.env.TSFG_RESTRICTED_HELPER;
test("native allowlisted helper verifies actual Low LPAC and restricting identity", {
  skip: process.env.TSFG_RESTRICTED_ACCEPTANCE !== "1",
}, () => {
  assert.equal(process.platform, "win32");
  assert.ok(helper, "explicit native acceptance requires TSFG_RESTRICTED_HELPER");
  const root = mkdtempSync("E:/ws/pro_tsfg/.tmp/native-lpac-");
  const control = path.join(root, "inputs", "control");
  const work = path.join(root, "work");
  mkdirSync(control, { recursive: true });
  mkdirSync(work);
  const executable = path.join(control, "helper.exe");
  copyFileSync(helper, executable);
  const result = spawnSync(helper, ["--allowlisted-root", root, "--rx", control, "--rw", work,
    "--", executable, "--verify-restriction"], {
    encoding: "utf8", timeout: 30000, windowsHide: true,
    env: { ...process.env, TEMP: work, TMP: work, USERPROFILE: work,
      HOME: work, APPDATA: work, LOCALAPPDATA: work },
  });
  assert.equal(result.status, 0, result.stderr);
  const token = JSON.parse(result.stdout);
  assert.equal(token.integrity, "low");
  assert.equal(token.appContainer, true);
  assert.equal(token.lpac, true);
  assert.equal(token.inJob, true);
  assert.equal(token.administratorDenyOnly, true);
  assert.equal(token.capabilityCount, 0);
  assert.match(token.restrictionSid, /^S-1-5-21-/);
  assert.notEqual(token.restrictionSid, token.userSid);
});

test("native helper ignores planted DLL names in its application directory", {
  skip: process.platform !== "win32" || !helper,
}, () => {
  const root = mkdtempSync("E:/ws/pro_tsfg/.tmp/native-imports-");
  const executable = path.join(root, "helper.exe");
  copyFileSync(helper, executable);
  for (const name of ["fwpuclnt.dll", "USERENV.dll"])
    writeFileSync(path.join(root, name), "Invalid inert DLL canary; must never be selected by the loader.");
  const result = spawnSync(executable, ["--verify-restriction"], {
    encoding: "utf8", timeout: 10000, windowsHide: true, cwd: root,
    env: { ...process.env, TEMP: root, TMP: root, USERPROFILE: root,
      HOME: root, APPDATA: root, LOCALAPPDATA: root },
  });
  assert.equal(result.status, 125);
  assert.match(result.stderr, /restriction verification failed/);
});
test("native helper static DLL imports are restricted to System32 before entry", {
  skip: !helper,
}, () => {
  const pe = readFileSync(helper);
  const header = pe.readUInt32LE(0x3c);
  const optional = header + 24;
  assert.equal(pe.readUInt16LE(optional), 0x20b, "locked native helper is PE32+");
  const configRva = pe.readUInt32LE(optional + 112 + 10 * 8);
  assert.notEqual(configRva, 0, "load configuration is present");
  const sectionStart = optional + pe.readUInt16LE(header + 20);
  let config;
  for (let i = 0; i < pe.readUInt16LE(header + 6); i++) {
    const section = sectionStart + i * 40;
    const rva = pe.readUInt32LE(section + 12);
    const size = pe.readUInt32LE(section + 16);
    if (configRva >= rva && configRva < rva + size)
      config = pe.readUInt32LE(section + 20) + configRva - rva;
  }
  assert.notEqual(config, undefined, "load configuration resolves inside the image");
  // IMAGE_LOAD_CONFIG_DIRECTORY64.DependentLoadFlags is a WORD at offset 78.
  assert.equal(pe.readUInt16LE(config + 78), 0x800, "LOAD_LIBRARY_SEARCH_SYSTEM32");
});
test("deep staged directories reach the non-admin WFP boundary without stack overflow", {
  skip: process.platform !== "win32" || !helper ||
    process.env.TSFG_RESTRICTED_NONADMIN_WFP !== "1",
}, () => {
  const root = mkdtempSync("E:/ws/pro_tsfg/.tmp/native-deep-").replaceAll("/", "\\");
  mkdirSync(path.join(root, ...Array(32).fill("d")), { recursive: true });
  const executable = path.join(root, "probe.exe");
  copyFileSync(helper, executable);
  const result = spawnSync(helper, ["--allowlisted-root", root, "--rx", executable,
    "--", executable, "--verify-restriction"], {
    encoding: "utf8", env: { ...process.env, TEMP: root, TMP: root,
      USERPROFILE: root, HOME: root, APPDATA: root, LOCALAPPDATA: root },
  });
  assert.equal(result.status, 125);
  assert.match(result.stderr, /establish dynamic WFP boundary.*\(5\)/);
});
test("allowlisted helper rejects a system-drive root before WFP setup", {
  skip: process.platform !== "win32" || !helper,
}, () => {
  const scratch = mkdtempSync("E:/ws/pro_tsfg/.tmp/native-path-");
  const result = spawnSync(helper, ["--allowlisted-root", "C:\\Windows", "--", helper], {
    encoding: "utf8", env: { ...process.env, TEMP: scratch, TMP: scratch,
      USERPROFILE: scratch, HOME: scratch, APPDATA: scratch, LOCALAPPDATA: scratch },
  });
  assert.equal(result.status, 125);
  assert.match(result.stderr, /validate allowlisted root/);
  assert.doesNotMatch(result.stderr, /WFP/);
});

test("allowlisted helper rejects outside grants, hardlinks, and an unrestricted verifier", {
  skip: process.platform !== "win32" || !helper,
}, () => {
  const root = mkdtempSync("E:/ws/pro_tsfg/.tmp/native-boundary-").replaceAll("/", "\\");
  const environment = { ...process.env, TEMP: root, TMP: root,
    USERPROFILE: root, HOME: root, APPDATA: root, LOCALAPPDATA: root };
  const invoke = (args) => spawnSync(helper, args, { encoding: "utf8", env: environment });
  const outside = invoke(["--allowlisted-root", root, "--ro", "C:\\Windows", "--", helper]);
  assert.equal(outside.status, 125);
  assert.match(outside.stderr, /validate allowlisted grant/);
  assert.doesNotMatch(outside.stderr, /WFP/);
  const original = path.join(root, "original");
  writeFileSync(original, "must not receive a grant through an alias");
  linkSync(original, path.join(root, "alias"));
  const linked = invoke(["--allowlisted-root", root, "--", helper]);
  assert.equal(linked.status, 125);
  assert.match(linked.stderr, /validate allowlisted root/);
  assert.doesNotMatch(linked.stderr, /WFP/);
  const verified = invoke(["--verify-restriction"]);
  assert.equal(verified.status, 125);
  assert.equal(verified.stdout, "");
  assert.match(verified.stderr, /restriction verification failed/);
});

test("legacy network-only mode still rejects path grants without entering WFP", {
  skip: process.platform !== "win32" || !helper,
}, () => {
  const scratch = mkdtempSync("E:/ws/pro_tsfg/.tmp/native-legacy-");
  const result = spawnSync(helper, ["--network-only", "--ro", scratch, "--", helper], {
    encoding: "utf8", env: { ...process.env, TEMP: scratch, TMP: scratch,
      USERPROFILE: scratch, HOME: scratch, APPDATA: scratch, LOCALAPPDATA: scratch },
  });
  assert.equal(result.status, 125);
  assert.match(result.stderr, /--network-only cannot use path grants/);
  assert.doesNotMatch(result.stderr, /WFP/);
});
