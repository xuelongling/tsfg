// SPDX-License-Identifier: MIT
import process from "node:process";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readdir, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { archivePath, parseTar, parseZip } from "./build-archive-readers.mjs";
import { checkedInstallPath } from "./build-toolchain.mjs";

async function extractEntries(entries, toolRoot, stripComponents) {
  const prepared = [];
  const destinations = new Set();
  for (const entry of entries) {
    const destination = archivePath(toolRoot, entry.name, stripComponents);
    if (!destination) continue;
    const key = process.platform === "win32" ? destination.toLowerCase() : destination;
    if (destinations.has(key)) throw new Error(`duplicate archive path: ${entry.name}`);
    destinations.add(key);
    if (!["0", "5", "2"].includes(entry.type)) throw new Error(`unsupported archive entry type ${entry.type}: ${entry.name}`);
    prepared.push({ ...entry, destination });
  }
  prepared.sort((left, right) => ({ "5": 0, "0": 1, "2": 2 })[left.type] - ({ "5": 0, "0": 1, "2": 2 })[right.type]);
  for (const entry of prepared) {
    await mkdir(entry.type === "5" ? entry.destination : path.dirname(entry.destination), { recursive: true });
    if (entry.type === "5") {
      if (entry.mode && process.platform !== "win32") await chmod(entry.destination, entry.mode);
    } else if (entry.type === "0") {
      await writeFile(entry.destination, entry.bytes, { flag: "wx", mode: entry.mode || 0o644 });
      if (entry.mode && process.platform !== "win32") await chmod(entry.destination, entry.mode);
    } else {
      if (entry.linkName.includes("\0") || path.isAbsolute(entry.linkName)) throw new Error(`unsafe archive link target: ${entry.linkName}`);
      const target = path.resolve(path.dirname(entry.destination), ...entry.linkName.split("/"));
      const targetRelative = path.relative(toolRoot, target).split(path.sep).join("/");
      archivePath(toolRoot, targetRelative, 0);
      await symlink(entry.linkName, entry.destination);
    }
  }
}

export async function extractArchive(bytes, format, toolRoot, stripComponents, includePrefix) {
  const included = (entries) => includePrefix
    ? entries.filter(({ name }) => name.startsWith(includePrefix))
    : entries;
  if (format === "zip") await extractEntries(included(parseZip(bytes)), toolRoot, stripComponents);
  else if (["tar.gz", "apk-v2"].includes(format)) {
    await extractEntries(included(parseTar(gunzipSync(bytes))), toolRoot, stripComponents);
  }
  else throw new Error(`unsupported archive format: ${format}`);
}

function extractionEnvironment(temporaryRoot) {
  return {
    HOME: temporaryRoot,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: "",
    TMPDIR: temporaryRoot,
    TZ: "UTC",
  };
}

export function runArchiveExtractor(extractor, arguments_, temporaryRoot) {
  try {
    execFileSync(extractor, arguments_, {
      cwd: temporaryRoot,
      env: extractionEnvironment(temporaryRoot),
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (error) {
    const detail = Buffer.isBuffer(error.stderr)
      ? error.stderr.toString("utf8").trim()
      : error.message;
    throw new Error(detail || "archive extractor failed");
  }
}

export async function extractTar(
  extractor,
  archive,
  toolRoot,
  stripComponents,
  temporaryRoot,
  compression,
) {
  await mkdir(toolRoot, { recursive: true });
  if (extractor.kind === "7zip") {
    const extractionRoot = path.join(temporaryRoot, `.extract.${randomUUID()}`);
    const expandedRoot = path.join(extractionRoot, "expanded");
    await mkdir(expandedRoot, { recursive: true });
    try {
      runArchiveExtractor(
        extractor.executable,
        ["x", "-y", "-bd", "-bb0", `-o${extractionRoot}`, archive],
        temporaryRoot,
      );
      const firstPass = (await readdir(extractionRoot, { withFileTypes: true }))
        .filter(({ name }) => name !== "expanded");
      if (firstPass.length !== 1 || !firstPass[0].isFile()) {
        throw new Error("7-Zip xz extraction did not produce exactly one tar archive");
      }
      runArchiveExtractor(
        extractor.executable,
        ["x", "-y", "-bd", "-bb0", `-o${expandedRoot}`, path.join(extractionRoot, firstPass[0].name)],
        temporaryRoot,
      );
      let sourceRoot = expandedRoot;
      for (let depth = 0; depth < stripComponents; depth += 1) {
        const children = await readdir(sourceRoot, { withFileTypes: true });
        if (children.length !== 1 || !children[0].isDirectory()) {
          throw new Error("7-Zip archive cannot apply the requested stripComponents");
        }
        sourceRoot = path.join(sourceRoot, children[0].name);
      }
      for (const child of await readdir(sourceRoot)) {
        await rename(path.join(sourceRoot, child), path.join(toolRoot, child));
      }
    } finally {
      await rm(extractionRoot, { recursive: true, force: true });
    }
    return;
  }
  runArchiveExtractor(
    extractor.executable,
    [
      "tar",
      compression === "xz" ? "-xJf" : "-xzf",
      archive,
      "-C",
      toolRoot,
      "--strip-components",
      String(stripComponents),
      "--numeric-owner",
    ],
    temporaryRoot,
  );
}

export async function normalizeSysrootLinks(root) {
  async function visit(directory) {
    const children = await readdir(directory, { withFileTypes: true });
    for (const child of children) {
      const childPath = path.join(directory, child.name);
      if (child.isDirectory()) {
        await visit(childPath);
      } else if (child.isSymbolicLink()) {
        const target = await readlink(childPath);
        if (path.posix.isAbsolute(target)) {
          const lockedTarget = checkedInstallPath(root, target.slice(1));
          const relativeTarget = path.relative(path.dirname(childPath), lockedTarget);
          await rm(childPath);
          await symlink(relativeTarget, childPath);
        }
      }
    }
  }
  await visit(root);
}
