// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("explicit real Go acceptance fails when required inputs are unavailable", () => {
  const env = /** @type {NodeJS.ProcessEnv} */ ({ ...process.env, TSFG_TEST_GO_ACCEPTANCE: "1" });
  delete env.TSFG_TEST_GO_CACHE;
  delete env.TSFG_TEST_GO_LOCK;
  delete env.NODE_TEST_CONTEXT;
  const child = spawnSync(process.execPath, ["--test", "--test-name-pattern=real Go source target",
    "tests/r00/go-closure.test.mjs"], { env, encoding: "utf8" });
  assert.equal(child.status, 1, child.stdout + child.stderr);
  assert.match(child.stdout + child.stderr, /real Go acceptance requires TSFG_TEST_GO_CACHE and TSFG_TEST_GO_LOCK/);
});
