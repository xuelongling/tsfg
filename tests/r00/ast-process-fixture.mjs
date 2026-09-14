// SPDX-License-Identifier: MIT
// Synthetic external-process failure, never real-source acceptance evidence.
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { writeFileSync } from "node:fs";
import path from "node:path";

const spawn = childProcess.spawnSync;
const mode = new URL(import.meta.url).searchParams.get("mode");
/** @returns {any} */
childProcess.spawnSync = function (executable, args, options) {
  if (mode === "git" && args?.[0] === "--no-replace-objects") {
    const clean = options.env.AST_AMBIENT_CANARY === undefined
      && options.env.GIT_CONFIG_COUNT === undefined
      && options.env.TEMP === process.env.TEMP && options.env.HOME === process.env.HOME;
    return { pid: 0, output: [], status: 1, signal: null, stdout: Buffer.alloc(0),
      stderr: Buffer.from(clean ? "fixture Git environment accepted" : "fixture Git environment leaked or lost task paths") };
  }
  if (args?.[0]?.endsWith("go-source-worker.mjs")) {
    if (mode === "integrity") {
      writeFileSync(path.join(options.cwd, "work/go-list.jsonstream"), "changed output");
      writeFileSync(path.join(options.cwd, "work/worker-result.json"), JSON.stringify({
        status: "success", executionMode: "local-development", outputSha256: `sha256:${"0".repeat(64)}`,
      }));
      return { pid: 0, output: [], status: 0, signal: null, stdout: "", stderr: "" };
    }
    writeFileSync(path.join(options.cwd, "work/worker-result.json"), JSON.stringify({
      status: "failure", executionMode: "local-development", phase: "dependency-resolution",
      message: "synthetic locked dependency failure",
    }));
    return { pid: 0, output: [], status: 20, signal: null, stdout: "", stderr: "synthetic failure" };
  }
  return spawn(executable, args, options);
};
syncBuiltinESMExports();
