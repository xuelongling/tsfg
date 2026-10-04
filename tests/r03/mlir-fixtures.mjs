// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { lstat, mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export async function createMlirFixture(prefix) {
  const requested = tmpdir();
  const owned = process.env.TSFG_MLIR_TEST_TEMP_ROOT;
  assert.ok(typeof owned === "string" && /^E:[\\/]/i.test(owned), "MLIR temporary storage requires an explicit owned E root");
  assert.match(requested, /^E:[\\/]/i, "MLIR temporary storage must be on E before any fixture creation");
  assert.equal(path.relative(path.resolve(owned), requested), "", "MLIR temporary storage must match the declared owned root");
  const state = await lstat(requested);
  assert.ok(state.isDirectory() && !state.isSymbolicLink(), "MLIR temporary storage must be an ordinary directory");
  assert.equal(path.relative(requested, await realpath(requested)), "", "MLIR temporary storage must not be redirected");
  return mkdtemp(path.join(requested, prefix));
}
