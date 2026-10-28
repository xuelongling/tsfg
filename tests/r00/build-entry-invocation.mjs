// SPDX-License-Identifier: MIT

import { spawn } from "node:child_process";
import { TEST_GIT_EXECUTABLE } from "./test-tools.mjs";
import { repositoryRoot, buildEntry } from "./build-entry-paths.mjs";

export function validVerifyArguments(reportPath) {
  return [
    "verify-workspace",
    "--workspace",
    repositoryRoot,
    "--manifest-url",
    "https://github.com/xuelongling/manifests.git",
    "--manifest-revision",
    "0000000000000000000000000000000000000000",
    "--manifest",
    "bootstrap/r00.xml",
    "--report",
    reportPath,
  ];
}

export function testNodeInvocation(arguments_) {
  if (process.env.TSFG_TEST_NODE_LOADER && process.env.TSFG_TEST_NODE_BINARY) {
    return {
      executable: process.env.TSFG_TEST_NODE_LOADER,
      arguments: [process.env.TSFG_TEST_NODE_BINARY, ...arguments_],
    };
  }
  return { executable: process.execPath, arguments: arguments_ };
}

export async function invoke(arguments_, options = {}) {
  return await new Promise((resolve, reject) => {
    const invocation = testNodeInvocation([buildEntry, ...arguments_]);
    const { env = process.env, ...spawnOptions } = options;
    const childEnvironment = { ...env };
    if (!Object.hasOwn(childEnvironment, "TSFG_GIT")) {
      childEnvironment.TSFG_GIT = TEST_GIT_EXECUTABLE;
    }
    const child = spawn(invocation.executable, invocation.arguments, {
      cwd: repositoryRoot,
      ...spawnOptions,
      env: childEnvironment,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}
