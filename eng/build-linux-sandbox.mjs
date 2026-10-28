// SPDX-License-Identifier: MIT
import process from "node:process";
import path from "node:path";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { readRegularFile } from "./build-data.mjs";
import { buildEnvironment, runBuildTool } from "./build-process.mjs";
import { closureToolPath } from "./build-toolchain.mjs";

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export async function writeLockedLlvmWrapper(
  destination,
  loader,
  libraries,
  executable,
  leadingArguments = [],
) {
  const command = [
    loader,
    "--inhibit-cache",
    "--library-path",
    libraries,
    executable,
    ...leadingArguments,
  ]
    .map(shellQuote)
    .join(" ");
  await writeFile(destination, `#!/bin/sh\nexec ${command} "$@"\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o755,
  });
  if (process.platform !== "win32") await chmod(destination, 0o755);
}

export function sandboxArguments(
  { readOnly = [], readExecute = [], readWrite = [], root, shell },
  executable,
  arguments_,
) {
  return [
    "--root", root,
    "--shell", shell,
    ...readOnly.flatMap((allowedPath) => ["--ro", allowedPath]),
    ...readExecute.flatMap((allowedPath) => ["--rx", allowedPath]),
    ...readWrite.flatMap((allowedPath) => ["--rw", allowedPath]),
    "--",
    executable,
    ...arguments_,
  ];
}

export async function compileSandbox(runtime, sourceRoot, controlRoot) {
  const zig = closureToolPath(runtime, "zig");
  const executable = path.join(controlRoot, "sandbox-run");
  await mkdir(controlRoot, { recursive: true });
  runBuildTool(
    "sandbox-bootstrap",
    zig,
    [
      "cc",
      "-target", "x86_64-linux-musl",
      "-static",
      "-O2",
      path.join(sourceRoot, "eng", "sandbox-run.c"),
      "-o", executable,
    ],
    sourceRoot,
    buildEnvironment(controlRoot, [path.dirname(zig)]),
  );
  await readRegularFile(executable, "sandbox executable");
  await chmod(executable, 0o755);
  return { executable };
}
