// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const responsibilityAreas = {
  contracts: "registry.json",
  compiler: "README.md",
  runtime: "README.md",
  tooling: "README.md",
  eng: "tsfg-build.mjs",
  tests: "r00",
  docs: "r00-engineering-charter.md",
  third_party: "README.md",
};

test("product repository exposes every stable responsibility area", async () => {
  for (const [directory, anchor] of Object.entries(responsibilityAreas)) {
    assert.equal(
      (await stat(path.join(repositoryRoot, directory))).isDirectory(),
      true,
      `${directory}/ must be a directory`,
    );
    await stat(path.join(repositoryRoot, directory, anchor));
  }
});

test("empty R00 product seams state their ownership without claiming implementation", async () => {
  for (const directory of ["compiler", "runtime", "tooling"]) {
    const readme = await readFile(
      path.join(repositoryRoot, directory, "README.md"),
      "utf8",
    );
    assert.match(readme, new RegExp(`^# ${directory[0].toUpperCase()}${directory.slice(1)} responsibility area$`, "m"));
    assert.match(
      readme.replace(/\s+/g, " "),
      /R00 defines the boundary but intentionally ships no .* implementation/,
    );
  }
});
