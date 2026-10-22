// SPDX-License-Identifier: MIT
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WorkspaceMismatchError } from "./build-errors.mjs";
import { gitOutput, requireVisibleTrackedFiles } from "./build-git.mjs";

export const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export function inspectProductWorkspace(options, allowDevelopment, command = "build") {
  const workspace = path.resolve(options.get("--workspace") ?? repositoryRoot);
  const status = gitOutput(workspace, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--ignore-submodules=none",
  ]);
  const dirty = status.length !== 0;
  const development = options.has("--dev");
  if (development && !allowDevelopment) {
    throw new WorkspaceMismatchError(
      "development-mode-forbidden",
      `${command} does not permit development mode`,
    );
  }
  if (dirty && !development) {
    throw new WorkspaceMismatchError("dirty-project", `${workspace} is dirty`);
  }
  requireVisibleTrackedFiles(workspace);
  return {
    development,
    dirty,
    publishable: !development && !dirty,
    root: workspace,
  };
}
