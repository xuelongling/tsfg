// SPDX-License-Identifier: MIT
// Synthetic external-input failure; never a substitute for real replay evidence.
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";

const read = fs.readFile;
const mode = new URL(import.meta.url).searchParams.get("mode");
/** @returns {Promise<any>} */
fs.readFile = async function (file, ...args) {
  if (mode === "missing-tool" && String(file).replaceAll("\\", "/").includes("/generation-packages/")
      && String(file).endsWith("package.tgz")) {
    throw Object.assign(new Error("synthetic missing locked generation archive"), { code: "ENOENT", path: String(file) });
  }
  return read(file, ...args);
};
syncBuiltinESMExports();
