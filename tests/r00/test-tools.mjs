// SPDX-License-Identifier: MIT

import path from "node:path";
import { spawnSync } from "node:child_process";

const lookup = spawnSync(process.platform === "win32" ? "where.exe" : "which", ["git"], {
  encoding: "utf8",
});

export const TEST_GIT_EXECUTABLE = lookup.stdout.split(/\r?\n/).find(Boolean);

if (lookup.status !== 0 || !TEST_GIT_EXECUTABLE || !path.isAbsolute(TEST_GIT_EXECUTABLE)) {
  throw new Error(`tests require an absolute Git executable: ${lookup.stderr}`);
}
