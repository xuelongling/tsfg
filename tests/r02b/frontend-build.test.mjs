// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { executeFrontendTarget } from "../../eng/frontend-build.mjs";

const productRoot = path.resolve(import.meta.dirname, "../..");
const serialize = value => Array.isArray(value) ? `[${value.map(serialize).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${serialize(value[key])}`).join(",")}}`
    : JSON.stringify(value);

async function createBuildFixture() {
  const tempRoot = process.env.TEMP;
  if (!tempRoot?.startsWith("E:\\")) throw new Error("test temporary root must be on E:");
  const root = await mkdtemp(path.join(tempRoot, "r02b-build-registry-"));
  await mkdir(path.join(root, "eng"));
  await mkdir(path.join(root, "contracts"));
  await writeFile(path.join(root, "eng/frontend-source.lock.json"),
    await readFile(path.join(productRoot, "eng/frontend-source.lock.json")));
  await writeFile(path.join(root, "contracts/frontend-snapshot.schema.json"),
    await readFile(path.join(productRoot, "contracts/frontend-snapshot.schema.json")));
  return root;
}

test("frontend build rejects duplicate Contract Registry keys before source work", async () => {
  const root = await createBuildFixture();
  try {
    const registry = (await readFile(path.join(productRoot, "contracts/registry.json"), "utf8")).trim();
    await writeFile(path.join(root, "contracts/registry.json"),
      `${registry.slice(0, -1)},"tsfg.frontend-snapshot":${registry.slice(registry.indexOf(":") + 1, -1)}}\n`);
    await assert.rejects(executeFrontendTarget({ command: "build", productRoot: root,
      sourceRoot: root, out: path.join(root, "out"), git: "missing-git.exe",
      runtime: {}, go: "missing-go.exe", node: process.execPath, dependencyProxy: {},
      serialize }), /duplicate JSON key/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("frontend build rejects noncanonical Contract Registry bytes before source work", async () => {
  const root = await createBuildFixture();
  try {
    const registry = await readFile(path.join(productRoot, "contracts/registry.json"), "utf8");
    await writeFile(path.join(root, "contracts/registry.json"), ` ${registry}`);
    await assert.rejects(executeFrontendTarget({ command: "test", productRoot: root,
      sourceRoot: root, out: path.join(root, "out"), git: "missing-git.exe",
      runtime: {}, go: "missing-go.exe", node: process.execPath, dependencyProxy: {},
      serialize }), /invalid canonical Contract Registry/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("frontend build rejects malformed UTF-8 Contract Registry bytes before source work", async () => {
  const root = await createBuildFixture();
  try {
    const registry = JSON.parse(await readFile(path.join(productRoot, "contracts/registry.json"), "utf8"));
    registry["tsfg.frontend-snapshot"].owner = "Owner-\ufffd";
    const canonicalBytes = Buffer.from(`${serialize(registry)}\n`);
    const replacement = Buffer.from("\ufffd");
    const offset = canonicalBytes.indexOf(replacement);
    const bytes = Buffer.concat([canonicalBytes.subarray(0, offset), Buffer.from([0xff]),
      canonicalBytes.subarray(offset + replacement.length)]);
    await writeFile(path.join(root, "contracts/registry.json"), bytes);
    await assert.rejects(executeFrontendTarget({ command: "build", productRoot: root,
      sourceRoot: root, out: path.join(root, "out"), git: "missing-git.exe",
      runtime: {}, go: "missing-go.exe", node: process.execPath, dependencyProxy: {},
      serialize }), /invalid UTF-8/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
