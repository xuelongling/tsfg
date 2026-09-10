// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const entry = fileURLToPath(new URL("../../eng/tsfg-build.mjs", import.meta.url));
const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const moduleBytes = Buffer.from("module example.com/module\n\ngo 1.26\n");
// A stored ZIP containing go.mod. Sums were independently obtained with Go 1.26.8.
const moduleZip = Buffer.from("UEsDBBQAAAAAAAAAISgJ6JEuIwAAACMAAAAgAAAAZXhhbXBsZS5jb20vbW9kdWxlQHYxLjAuMC9nby5tb2Rtb2R1bGUgZXhhbXBsZS5jb20vbW9kdWxlCgpnbyAxLjI2ClBLAQIUABQAAAAAAAAAISgJ6JEuIwAAACMAAAAgAAAAAAAAAAAAAAAAAAAAAABleGFtcGxlLmNvbS9tb2R1bGVAdjEuMC4wL2dvLm1vZFBLBQYAAAAAAQABAE4AAABhAAAAAAA=", "base64");

async function invoke(args) {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.startsWith("TSFG_RUNTIME_")) delete environment[key];
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], { env: environment });
    let output = "";
    child.stdout.on("data", (bytes) => { output += bytes; });
    child.stderr.on("data", (bytes) => { output += bytes; });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, output }));
  });
}

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "tsfg-go-closure-"));
  const toolBytes = Buffer.from("fixture tool\n");
  let online = true;
  const server = createServer((request, response) => {
    if (!online) { response.writeHead(503).end(); return; }
    response.end(request.url.endsWith(".mod") ? moduleBytes
      : request.url.endsWith(".zip") ? moduleZip : toolBytes);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(undefined)));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`;
  const declaration = { schemaVersion: "1", platform: "fixture", proxy: url, modules: [{
    path: "example.com/module", version: "v1.0.0", license: "MIT",
    sum: "h1:LqDyOz6+3lOZmdbLfuek1R0aryDDO9nzcqBfXZSsLdM=",
    goModSum: "h1:voJHzHh0tOrGVfymTEkJymjF4ElmA7N0scD+Ft5+nUc=",
  }] };
  const lock = { schemaVersion: "1", dependencyLocks: [],
    goDependencies: { path: "go-dependencies.lock.json", sha256: hash("missing") },
    targets: { fixture: { tools: ["fixture"] } },
    tools: { fixture: { version: "1", license: "MIT", signature: { kind: "fixture", signer: "test" },
      artifacts: [{ platform: "fixture", url: `${url}/tool`, byteSize: String(toolBytes.length),
        archiveFormat: "raw", archiveSha256: hash(toolBytes), installPath: "tool",
        unpackedTreeSha256: hash(JSON.stringify({ entries: [
          { path: "tool", sha256: hash(toolBytes), type: "file" },
        ], schemaVersion: "1" })),
      }],
    } },
  };
  const cache = path.join(root, "cache"), report = path.join(root, "report.json");
  async function saveDeclaration() {
    const bytes = JSON.stringify(declaration);
    lock.goDependencies.sha256 = hash(bytes);
    lock.dependencyLocks = [{ projectId: "tsfg", path: "eng/go-dependencies.lock.json", sha256: hash(bytes) }];
    await writeFile(path.join(root, lock.goDependencies.path), bytes);
  }
  async function prefetch() {
    await writeFile(path.join(root, "lock.json"), JSON.stringify(lock));
    const result = await invoke(["prefetch", "--lock", path.join(root, "lock.json"),
      "--cache", cache, "--platform", "fixture", "--report", report]);
    return { ...result, report: JSON.parse(await readFile(report, "utf8")) };
  }
  return { cache, declaration, lock, prefetch, root, saveDeclaration, offline: () => { online = false; } };
}

test("prefetch refuses a missing Go dependency lock", async (t) => {
  const f = await fixture(t);
  const result = await f.prefetch();
  assert.equal(result.status, 11, result.output);
  assert.match(result.report.error.issues[0].message, /Go dependency lock/);
});

test("prefetch rejects floating Go module versions", async (t) => {
  const f = await fixture(t);
  f.declaration.modules[0].version = "latest";
  await f.saveDeclaration();
  assert.equal((await f.prefetch()).status, 11);
});

test("prefetch rejects corrupt Go module content", async (t) => {
  const f = await fixture(t);
  f.declaration.modules[0].goModSum = "h1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  await f.saveDeclaration();
  const result = await f.prefetch();
  assert.equal(result.status, 11);
  assert.match(result.report.error.issues[0].message, /Go module content sum mismatch/);
});

test("prefetch verifies module sums and revalidates a warm cache without downloads", async (t) => {
  const f = await fixture(t);
  await f.saveDeclaration();
  const first = await f.prefetch();
  assert.equal(first.status, 0, first.output);
  assert.equal(first.report.result.goDependencies.modules[0].sum, "h1:LqDyOz6+3lOZmdbLfuek1R0aryDDO9nzcqBfXZSsLdM=");
  f.offline();
  assert.equal((await f.prefetch()).status, 0);
});

test("prefetch rejects extra files in a warmed Go proxy", async (t) => {
  const f = await fixture(t);
  await f.saveDeclaration();
  assert.equal((await f.prefetch()).status, 0);
  const parent = path.join(f.cache, "go-proxies", "sha256");
  const [identity] = await readdir(parent);
  await writeFile(path.join(parent, identity, "unexpected.zip"), "undeclared dependency");
  const result = await f.prefetch();
  assert.equal(result.status, 11, result.output);
  assert.match(result.report.error.issues[0].message, /unexpected Go proxy/);
});

test("unfinished source resolution cannot fall through to an unrelated smoke build", async (t) => {
  const f = await fixture(t);
  const result = await invoke(["build", "--source-target", "typescript-dependencies",
    "--target", "windows-x86_64-msvc", "--profile", "debug", "--dev",
    "--out", path.join(f.root, "out")]);
  assert.equal(result.status, 2, result.output);
});

test("prefetch requires the Go declaration in the Toolchain Closure projection", async (t) => {
  const f = await fixture(t);
  await f.saveDeclaration();
  f.lock.dependencyLocks = [];
  const result = await f.prefetch();
  assert.equal(result.status, 11, result.output);
});

test("prefetch rejects unsafe module paths before creating a proxy", async (t) => {
  const f = await fixture(t);
  f.declaration.modules[0].path = "../module";
  await f.saveDeclaration();
  const result = await f.prefetch();
  assert.equal(result.status, 11);
  assert.match(result.report.error.issues[0].message, /module path/);
});

test("prefetch rejects a corrupt ready marker without repairing the cache", async (t) => {
  const f = await fixture(t);
  await f.saveDeclaration();
  assert.equal((await f.prefetch()).status, 0);
  const parent = path.join(f.cache, "go-proxies", "sha256");
  const [identity] = await readdir(parent);
  const marker = path.join(parent, identity, "ready.json");
  await writeFile(marker, "corrupt");
  assert.equal((await f.prefetch()).status, 11);
  assert.equal(await readFile(marker, "utf8"), "corrupt");
});
