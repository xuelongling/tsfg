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

test("Build Input declaration includes both debug target control and smoke inputs", async () => {
  const declarationBytes = await readFile(
    path.join(repositoryRoot, "eng", "build-inputs.json"),
    "utf8",
  );
  const declaration = JSON.parse(declarationBytes);

  assert.equal(declarationBytes, `${JSON.stringify(declaration)}\n`);
  assert.deepEqual(declaration, {
    entries: [
      { path: "compiler/core-ir/CMakeLists.txt", projectId: "tsfg" },
      { path: "compiler/core-ir/main.cpp", projectId: "tsfg" },
      { path: "compiler/frontend.mjs", projectId: "tsfg" },
      { path: "compiler/hir.mjs", projectId: "tsfg" },
      { path: "compiler/identity.mjs", projectId: "tsfg" },
      { path: "compiler/minimal-bool-v1.d.ts", projectId: "tsfg" },
      { path: "compiler/minimal-integers-v3.d.ts", projectId: "tsfg" },
      { path: "compiler/minimal-scalars-v2.d.ts", projectId: "tsfg" },
      { path: "compiler/pipeline.mjs", projectId: "tsfg" },
      { path: "contracts/bytecode.schema.json", projectId: "tsfg" },
      { path: "contracts/frontend-snapshot.schema.json", projectId: "tsfg" },
      { path: "contracts/hir.schema.json", projectId: "tsfg" },
      { path: "contracts/registry.json", projectId: "tsfg" },
      { path: "eng/build-inputs.json", projectId: "tsfg" },
      { path: "eng/contract-set.mjs", projectId: "tsfg" },
      { path: "eng/dependency-sources.json", projectId: "tsfg" },
      { path: "eng/frontend-build.mjs", projectId: "tsfg" },
      { path: "eng/frontend-source-admission.json", projectId: "tsfg" },
      { path: "eng/frontend-source.lock.json", projectId: "tsfg" },
      { path: "eng/frontend-toolchains.lock.json", projectId: "tsfg" },
      { path: "eng/go-closure.mjs", projectId: "tsfg" },
      { path: "eng/go-network-probe.mjs", projectId: "tsfg" },
      { path: "eng/go-source-result.mjs", projectId: "tsfg" },
      { path: "eng/go-source-worker.mjs", projectId: "tsfg" },
      { path: "eng/go-work-access.mjs", projectId: "tsfg" },
      { path: "eng/intake-ledger.mjs", projectId: "tsfg" },
      { path: "eng/mlir-build.mjs", projectId: "tsfg" },
      { path: "eng/mlir-compiler-launcher.mjs", projectId: "tsfg" },
      { path: "eng/mlir-python-policy.cmake", projectId: "tsfg" },
      { path: "eng/mlir-python.lock.json", projectId: "tsfg" },
      { path: "eng/mlir-python.mjs", projectId: "tsfg" },
      { path: "eng/mlir-source-build-legal.lock.json", projectId: "tsfg" },
      { path: "eng/mlir-source-legal.lock.json", projectId: "tsfg" },
      { path: "eng/mlir-source-legal.mjs", projectId: "tsfg" },
      { path: "eng/mlir-source-notices.lock.json", projectId: "tsfg" },
      { path: "eng/mlir-source.lock.json", projectId: "tsfg" },
      { path: "eng/mlir-source.mjs", projectId: "tsfg" },
      { path: "eng/sandbox-run.c", projectId: "tsfg" },
      { path: "eng/source-admission.mjs", projectId: "tsfg" },
      { path: "eng/toolchains.lock.json", projectId: "tsfg" },
      { path: "eng/tsfg-build", projectId: "tsfg" },
      { path: "eng/tsfg-build.cmd", projectId: "tsfg" },
      { path: "eng/tsfg-build.mjs", projectId: "tsfg" },
      { path: "eng/typescript-ast-inputs.mjs", projectId: "tsfg" },
      { path: "eng/typescript-ast.mjs", projectId: "tsfg" },
      { path: "eng/typescript-repro.mjs", projectId: "tsfg" },
      { path: "eng/upgrade-review.mjs", projectId: "tsfg" },
      { path: "eng/vm-build.mjs", projectId: "tsfg" },
      { path: "eng/vulnerability-admission.mjs", projectId: "tsfg" },
      { path: "eng/windows-publish.c", projectId: "tsfg" },
      { path: "eng/windows-sandbox-run.c", projectId: "tsfg" },
      { path: "eng/workspace-policy.json", projectId: "tsfg" },
      { path: "pnpm-lock.yaml", projectId: "tsfg" },
      { path: "runtime/bytecode.zig", projectId: "tsfg" },
      { path: "runtime/contract.zig", projectId: "tsfg" },
      { path: "runtime/main.zig", projectId: "tsfg" },
      { path: "runtime/root.zig", projectId: "tsfg" },
      { path: "runtime/runtime.zig", projectId: "tsfg" },
      { path: "runtime/vm.zig", projectId: "tsfg" },
      { path: "tests/r00/smoke/cpp/CMakeLists.txt", projectId: "tsfg" },
      { path: "tests/r00/smoke/cpp/main.cpp", projectId: "tsfg" },
      { path: "tests/r00/smoke/zig/build.zig", projectId: "tsfg" },
      { path: "tests/r00/smoke/zig/main.zig", projectId: "tsfg" },
      { path: "tooling/tsfgc.mjs", projectId: "tsfg" },
      { path: "version.json", projectId: "tsfg" },
    ],
    schemaVersion: "1",
  });
  const registry = JSON.parse(await readFile(path.join(repositoryRoot, "contracts", "registry.json"), "utf8"));
  assert.equal(registry["tsfg.frontend-snapshot"].semver, "0.7.0");
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
