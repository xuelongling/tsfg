// SPDX-License-Identifier: MIT

import path from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export const buildEntry = path.join(repositoryRoot, "eng", "tsfg-build.mjs");

export const windowsLauncher = path.join(repositoryRoot, "eng", "tsfg-build.cmd");

export const networkDenialHook = path.join(repositoryRoot, "tests", "r00", "deny-network.cjs");

export const networkAccessHook = path.join(repositoryRoot, "tests", "r00", "allow-network.cjs");
