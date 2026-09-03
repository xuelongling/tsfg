// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

test("Build Input declaration includes only Linux smoke payload inputs", async () => {
  const declarationBytes = await readFile(
    path.join(repositoryRoot, "eng", "build-inputs.json"),
    "utf8",
  );
  const declaration = JSON.parse(declarationBytes);

  assert.equal(declarationBytes, `${JSON.stringify(declaration)}\n`);
  assert.deepEqual(declaration, {
    entries: [
      { path: "contracts/registry.json", projectId: "tsfg" },
      { path: "eng/build-inputs.json", projectId: "tsfg" },
      { path: "eng/sandbox-run.c", projectId: "tsfg" },
      { path: "eng/toolchains.lock.json", projectId: "tsfg" },
      { path: "eng/tsfg-build", projectId: "tsfg" },
      { path: "eng/tsfg-build.mjs", projectId: "tsfg" },
      { path: "pnpm-lock.yaml", projectId: "tsfg" },
      { path: "tests/r00/smoke/cpp/CMakeLists.txt", projectId: "tsfg" },
      { path: "tests/r00/smoke/cpp/main.cpp", projectId: "tsfg" },
      { path: "tests/r00/smoke/zig/build.zig", projectId: "tsfg" },
      { path: "tests/r00/smoke/zig/main.zig", projectId: "tsfg" },
      { path: "version.json", projectId: "tsfg" },
    ],
    schemaVersion: "1",
  });
  assert.equal(
    await readFile(path.join(repositoryRoot, "contracts", "registry.json"), "utf8"),
    "{}\n",
  );
  assert.equal(
    declaration.entries.some(({ path: inputPath }) =>
      inputPath.endsWith(".test.mjs") || inputPath.includes("fixture") || inputPath.includes("report")),
    false,
  );
  const toolchainLock = JSON.parse(await readFile(
    path.join(repositoryRoot, "eng", "toolchains.lock.json"),
    "utf8",
  ));
  assert.equal(
    toolchainLock.tools.llvm.artifacts.find(
      ({ platform }) => platform === "linux-x86_64-gnu",
    ).executables.objcopy,
    "bin/llvm-objcopy",
  );
  const launcher = await readFile(path.join(repositoryRoot, "eng", "tsfg-build"), "utf8");
  assert.match(launcher, /\[ "\$command" = package \]/);
});
