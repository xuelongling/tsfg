// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, linkSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const helper = process.env.TSFG_RESTRICTED_HELPER;
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
