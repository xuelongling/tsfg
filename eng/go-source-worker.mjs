// SPDX-License-Identifier: MIT

// Private worker of the Hermetic Build Entry. Only the native supervisor may
// turn its result into execution evidence; invoking this file is not a build.
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { connect } from "node:net";
import path from "node:path";
import { createHash } from "node:crypto";

const plan = JSON.parse(await readFile(process.argv[2], "utf8"));
const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const run = (executable, arguments_) => {
  const child = spawnSync(executable, arguments_, {
    cwd: plan.moduleRoot, env: plan.environment, encoding: "utf8",
    timeout: 120000, maxBuffer: 64 * 1024 * 1024, windowsHide: true,
  });
  if (child.error || child.status !== 0) {
    throw new Error(`child failed (${child.status}): ${child.error?.message ?? child.stderr}`);
  }
  return child.stdout;
};

function parsePackages(text) {
  const packages = [];
  let depth = 0, start = 0, quoted = false, escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{") { if (depth++ === 0) start = index; }
    else if (char === "}" && --depth === 0) packages.push(JSON.parse(text.slice(start, index + 1)));
    else if (depth === 0 && !/\s/.test(char)) throw new Error("invalid Go package stream");
  }
  if (depth || quoted || !packages.length) throw new Error("incomplete Go package stream");
  return packages;
}

async function networkDenied(host) {
  return await new Promise((resolve, reject) => {
    const socket = connect({ host, port: 443 });
    const finish = (error) => { socket.destroy(); error ? reject(error) : resolve("blocked"); };
    socket.once("connect", () => finish(new Error(`network canary connected: ${host}`)));
    socket.once("error", () => finish(undefined));
    socket.setTimeout(1000, () => finish(undefined));
  });
}

let result;
let phase = "boundary-probes";
try {
  const token = JSON.parse(run(plan.helper, ["--verify-restriction"]));
  // The helper checks actual token state and job membership, not environment.
  const checks = {};
  for (const operation of ["read", "write"]) {
    try {
      if (operation === "read") await readFile(plan.undeclaredCanary);
      else await writeFile(path.join(plan.inputRoot, "forbidden-write"), "must be denied", { flag: "wx" });
      throw new Error(`undeclared ${operation} unexpectedly succeeded`);
    } catch (error) {
      if (!["EACCES", "EPERM"].includes(error.code)) throw error;
      checks[operation] = "denied";
    }
  }
  const canaries = {};
  for (const host of ["1.1.1.1", "2606:4700:4700::1111"]) canaries[host] = await networkDenied(host);
  for (const input of plan.inputs) {
    if (hash(await readFile(input.path)) !== input.sha256) throw new Error(`staged input changed: ${input.path}`);
  }
  phase = "go-version";
  const version = run(plan.go, ["version"]).trim();
  if (version !== `go version go${plan.goVersion} windows/amd64`) throw new Error(`unexpected Go identity: ${version}`);
  phase = "dependency-resolution";
  const output = run(plan.go, plan.arguments);
  const packages = parsePackages(output);
  const modules = new Map();
  for (const item of packages) {
    if (item.Error || item.DepsErrors || item.Incomplete) throw new Error(`incomplete package: ${item.ImportPath}`);
    if (item.Module && !item.Module.Main) {
      if (item.Module.Replace) throw new Error("Go module replacements are forbidden");
      modules.set(item.Module.Path, item.Module.Version);
    }
  }
  if (modules.size !== plan.modules.length || plan.modules.some((item) => modules.get(item.path) !== item.version)) {
    throw new Error("resolved Go modules differ from the declared closure");
  }
  const targets = plan.arguments.slice(-2).map((name) => `github.com/microsoft/typescript-go/${name.slice(2)}`);
  if (targets.some((name) => !packages.some((item) => item.ImportPath === name))) {
    throw new Error("Go did not resolve both declared targets");
  }
  for (const input of plan.inputs) {
    if (hash(await readFile(input.path)) !== input.sha256) throw new Error(`input mutated during Go execution: ${input.path}`);
  }
  for (const host of Object.keys(canaries)) await networkDenied(host);
  await writeFile(path.join(plan.workRoot, "go-list.jsonstream"), output, { flag: "wx" });
  result = { status: "success", token, checks, canaries, version,
    packages: packages.map((item) => ({ importPath: item.ImportPath, standard: Boolean(item.Standard),
      goFiles: item.GoFiles ?? [], directory: item.Dir, module: item.Module?.Path ?? null })),
    modules: [...modules].map(([module, version]) => ({ path: module, version })), outputSha256: hash(output) };
} catch (error) {
  result = { status: "failure", phase, message: error.message };
  process.exitCode = 20;
}
await writeFile(path.join(plan.workRoot, "worker-result.json"), JSON.stringify(result), { flag: "wx" });
