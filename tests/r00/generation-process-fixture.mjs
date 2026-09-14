// SPDX-License-Identifier: MIT
// Synthetic external-input failure; never a substitute for real replay evidence.
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import childProcess from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";

const read = fs.readFile;
const mode = new URL(import.meta.url).searchParams.get("mode");
const declaration = JSON.parse(await read(new URL("../../eng/typescript-generation.lock.json", import.meta.url), "utf8"));
/** @returns {Promise<any>} */
fs.readFile = async function (file, ...args) {
  if (mode === "missing-tool" && String(file).replaceAll("\\", "/").includes("/generation-packages/")
      && String(file).endsWith("package.tgz")) {
    throw Object.assign(new Error("synthetic missing locked generation archive"), { code: "ENOENT", path: String(file) });
  }
  const bytes = await read(file, ...args);
  if (mode === "changed-input" && String(file).replaceAll("\\", "/").endsWith("/eng/typescript-generation.mjs")) {
    return typeof bytes === "string" ? `${bytes}\n// synthetic input change\n`
      : Buffer.concat([bytes, Buffer.from("\n// synthetic input change\n")]);
  }
  return bytes;
};
const spawn = childProcess.spawnSync;
/** @returns {any} */
childProcess.spawnSync = function (executable, args, options) {
  if (mode === "metadata-exit" && args?.[0] === "version" && args.includes("-m")) {
    return spawn(process.execPath, ["-e", "process.stderr.write('synthetic metadata failure'); process.exit(7)"], options);
  }
  if (mode === "build-start" && args?.[0] === "build" && args.includes("./cmd/tsfg-ast")) {
    return spawn(path.join(options.cwd, "missing-build-fixture.exe"), [], options);
  }
  if (mode === "build-exit" && args?.[0] === "build" && args.includes("./cmd/tsfg-ast")) {
    return spawn(process.execPath, ["-e", "process.stderr.write('synthetic final build failure'); process.exit(7)"], options);
  }
  if (mode === "missing-source" && args?.includes("ls-tree") && args.includes(declaration.sources[0].commit)) {
    return { pid: 0, output: [], status: 128, signal: null, stdout: Buffer.alloc(0),
      stderr: Buffer.from("synthetic missing exact subsource object") };
  }
  const child = spawn(executable, args, options);
  if (mode === "difference" && path.basename(String(executable)).toLowerCase() === "dprint.exe"
      && args?.[0] === "fmt" && child.status === 0) {
    const output = args.find(arg => String(arg).replaceAll("\\", "/").endsWith("/internal/ast/ast_generated.go"));
    if (!output) throw new Error("difference fixture did not find the real generated output");
    appendFileSync(output, "\n// synthetic unexplained output difference\n");
  }
  if (mode === "skip" && path.basename(String(executable)).toLowerCase() === "go.exe"
      && args?.[0] === "test" && args.includes("./internal/ast") && child.status === 0) {
    const events = String(child.stdout).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    const event = events.find(item => item.Action === "pass" && item.Test === "TestDeepCloneNodeSanityCheck");
    if (!event) throw new Error("skip fixture did not observe the real required test passing");
    event.Action = "skip";
    return { ...child, stdout: `${events.map(item => JSON.stringify(item)).join("\n")}\n` };
  }
  return child;
};
syncBuiltinESMExports();
