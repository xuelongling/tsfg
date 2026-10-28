// SPDX-License-Identifier: MIT
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readlink, rm, symlink } from "node:fs/promises";
import { injectPublishFailure, renameWithRetry } from "./build-data.mjs";
import { buildEnvironment } from "./build-process.mjs";
import { verifyWindowsPublicationControl } from "./build-windows-sandbox.mjs";

export async function publishDirectory(source, destination, runtime) {
  const parent = path.dirname(destination);
  const versionsRoot = path.join(parent, `.${path.basename(destination)}.versions`);
  let previousVersion;
  let previousLinkTarget;
  try {
    const destinationStat = await lstat(destination);
    if (!destinationStat.isSymbolicLink()) {
      throw new Error(
        `refusing to replace unmanaged output directory: ${destination}`,
      );
    }
    const linkTarget = await readlink(destination);
    previousLinkTarget = linkTarget;
    previousVersion = path.resolve(parent, linkTarget);
    if (path.dirname(previousVersion) !== versionsRoot) {
      throw new Error(`output link escapes its managed versions directory: ${destination}`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  await mkdir(versionsRoot, { recursive: true });
  for (const entry of await readdir(versionsRoot)) {
    const candidate = path.join(versionsRoot, entry);
    if (candidate !== previousVersion) {
      await rm(candidate, { recursive: true, force: true });
    }
  }

  const versionPath = path.join(versionsRoot, randomUUID());
  const temporaryLink = path.join(
    parent,
    `.${path.basename(destination)}.${randomUUID()}.link`,
  );
  let swapped = false;
  let rolledBack = false;
  const rollback = async () => {
    if (rolledBack) return;
    rolledBack = true;
    if (swapped) {
      if (previousVersion) {
        const rollbackLink = path.join(
          parent,
          `.${path.basename(destination)}.${randomUUID()}.rollback`,
        );
        try {
          await symlink(
            previousLinkTarget,
            rollbackLink,
            process.platform === "win32" ? "junction" : "dir",
          );
          await replacePublicationLink(rollbackLink, destination, versionPath, runtime);
        } finally {
          await rm(rollbackLink, { force: true });
        }
      } else {
        await rm(destination, { force: true });
      }
    }
    await rm(versionPath, { recursive: true, force: true });
  };
  await renameWithRetry(source, versionPath);
  try {
    injectPublishFailure("output-version");
    const linkTarget = process.platform === "win32"
      ? versionPath
      : path.relative(parent, versionPath);
    await symlink(
      linkTarget,
      temporaryLink,
      process.platform === "win32" ? "junction" : "dir",
    );
    injectPublishFailure("output-link");
    await replacePublicationLink(temporaryLink, destination, previousVersion, runtime);
    swapped = true;
    await rm(temporaryLink, { force: true });
    injectPublishFailure("output-swapped");
  } catch (error) {
    try {
      await rm(temporaryLink, { force: true });
    } finally {
      await rollback();
    }
    throw error;
  }
  return { rollback };
}

async function replacePublicationLink(link, destination, previousVersion, runtime) {
  if (process.platform !== "win32" || !previousVersion) {
    await renameWithRetry(link, destination);
    return;
  }
  // Windows cannot rename a junction over another junction. Update its reparse
  // data in one operation; removing the old name first would expose a gap.
  const executable = await verifyWindowsPublicationControl(runtime);
  const result = spawnSync(executable, [destination, previousVersion, await readlink(link)], {
    cwd: path.dirname(link),
    env: buildEnvironment(path.dirname(link), []),
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Windows publication replacement failed: ${result.error?.message ?? result.stderr}`);
  }
  // The caller owns cleanup. A cleanup error after the switch must not disguise
  // a completed switch as a failure before its rollback has been registered.
}
