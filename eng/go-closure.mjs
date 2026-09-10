// SPDX-License-Identifier: MIT

import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export async function readGoDependencyLock(lockPath, lock) {
  if (!lock.goDependencies) return undefined;
  const relative = lock.goDependencies.path;
  if (typeof relative !== "string" || !/^[a-z0-9][a-z0-9.-]*\.json$/.test(relative)) {
    throw new Error("invalid Go dependency lock path");
  }
  const bytes = await readFile(path.join(path.dirname(path.resolve(lockPath)), relative))
    .catch((error) => { throw new Error(`Go dependency lock unavailable: ${error.message}`); });
  if (sha256(bytes) !== lock.goDependencies.sha256) throw new Error("Go dependency lock digest mismatch");
  if (!lock.dependencyLocks?.some((entry) => entry.projectId === "tsfg"
      && entry.path === `eng/${relative}` && entry.sha256 === lock.goDependencies.sha256)) {
    throw new Error("Go dependency lock must participate in the Toolchain Closure projection");
  }
  const declaration = JSON.parse(bytes.toString("utf8"));
  if (declaration.schemaVersion !== "1" || !Array.isArray(declaration.modules) || !declaration.modules.length) {
    throw new Error("invalid Go dependency lock schema");
  }
  if (declaration.source) {
    if (!/^1\.26\.\d+$/.test(declaration.goVersion)
        || lock.tools?.go?.version !== declaration.goVersion
        || !lock.targets?.[declaration.platform]?.tools?.includes("go")) {
      throw new Error("source target requires an exact selected Go 1.26 patch lock");
    }
    const source = declaration.source;
    if (declaration.platform !== "windows-x86_64-msvc"
        || source.projectId !== "typescript" || source.modulePath !== "tsc"
        || !/^[0-9a-f]{40}$/.test(source.commit)
        || !/^sha256:[0-9a-f]{64}$/.test(source.goModSha256)
        || !/^sha256:[0-9a-f]{64}$/.test(source.goSumSha256)
        || JSON.stringify(declaration.packages) !== JSON.stringify(["./internal/parser", "./internal/checker"])) {
      throw new Error("invalid fixed TypeScript dependency target");
    }
    if (declaration.modules.some((module) => !module.licenseEvidence
        || !["MIT", "BSD-2-Clause", "BSD-3-Clause"].includes(module.license))) {
      throw new Error("source target requires verified module license records");
    }
  }
  const seen = new Set();
  for (const module of declaration.modules) {
    if (typeof module.path !== "string" || module.path.split("/").some((segment) =>
      !segment || segment === "." || segment === ".." || /[. ]$/.test(segment)
      || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(segment))) {
      throw new Error("unsafe Go module path");
    }
    if (typeof module.path !== "string" || !/^[a-z0-9.-]+(?:\/[a-z0-9_-]+)+$/.test(module.path)
        || !/^v\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(module.version)
        || !/^h1:[A-Za-z0-9+/]{43}=$/.test(module.sum)
        || !/^h1:[A-Za-z0-9+/]{43}=$/.test(module.goModSum)
        || seen.has(module.path)) {
      throw new Error("Go dependency lock requires unique exact module identities and sums");
    }
    seen.add(module.path);
  }
  return declaration;
}

function moduleSum(files) {
  const lines = [...files].sort((a, b) => Buffer.from(a.name).compare(Buffer.from(b.name)))
    .map(({ name, contents }) => `${sha256(contents).slice(7)}  ${name}\n`).join("");
  return `h1:${createHash("sha256").update(lines).digest("base64")}`;
}

function goProxyRoot(cache, identity) {
  return path.join(cache, "go-proxies", "sha256", identity.slice(7));
}

async function verifyGoProxyMarker(root, identity, entry) {
  if (!entry.isDirectory() || entry.isSymbolicLink()
      || await readFile(path.join(root, "ready.json"), "utf8") !== JSON.stringify({ identity })) {
    throw new Error("Go proxy ready marker or directory identity mismatch");
  }
}

export async function verifyGoDependencies(cache, declaration, identity, parseZip) {
  const root = goProxyRoot(cache, identity);
  await verifyGoProxyMarker(root, identity, await lstat(root));
  return { root, identity, modules: await verifyGoProxy(root, declaration, parseZip) };
}

async function verifyGoProxy(root, declaration, parseZip) {
  const expectedFiles = new Set(["ready.json"]);
  const expectedDirectories = new Set();
  for (const module of declaration.modules) {
    const prefix = `${module.path}/@v/${module.version}`;
    for (const extension of ["mod", "zip", "info"]) expectedFiles.add(`${prefix}.${extension}`);
    const segments = module.path.split("/").concat("@v");
    for (let length = 1; length <= segments.length; length++) {
      expectedDirectories.add(segments.slice(0, length).join("/"));
    }
  }
  async function inspect(directory, relative = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory() && expectedDirectories.has(name)) {
        await inspect(path.join(directory, entry.name), name);
      } else if (!entry.isFile() || !expectedFiles.has(name)) {
        throw new Error(`unexpected Go proxy entry: ${name}`);
      }
    }
  }
  await inspect(root);
  const identities = [];
  for (const module of declaration.modules) {
    const prefix = path.join(root, ...module.path.split("/"), "@v", module.version);
    const mod = await readFile(`${prefix}.mod`);
    const zip = await readFile(`${prefix}.zip`);
    const info = await readFile(`${prefix}.info`);
    const files = parseZip(zip).filter((entry) => entry.type === "0")
      .map(({ name, bytes }) => ({ name, contents: bytes }));
    if (module.licenseEvidence) {
      const license = files.find(({ name }) => name === module.licenseEvidence.archivePath);
      if (!license || sha256(license.contents) !== module.licenseEvidence.sha256) {
        throw new Error(`Go module license content mismatch: ${module.path}`);
      }
    }
    if (files.some(({ name }) => !name.startsWith(`${module.path}@${module.version}/`))
        || moduleSum([{ name: "go.mod", contents: mod }]) !== module.goModSum
        || moduleSum(files) !== module.sum
        || info.toString() !== JSON.stringify({ Version: module.version })) {
      throw new Error(`Go module content sum mismatch: ${module.path}@${module.version}`);
    }
    identities.push({ path: module.path, version: module.version, sum: module.sum,
      goModSum: module.goModSum, archiveSha256: sha256(zip), goModSha256: sha256(mod) });
  }
  return identities;
}

export async function prefetchGoDependencies(cache, declaration, identity, parseZip) {
  if (!declaration) return undefined;
  const root = goProxyRoot(cache, identity);
  const staging = `${root}.${randomUUID()}.tmp`;
  try {
    const existing = await lstat(root).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return undefined;
    });
    if (existing) await verifyGoProxyMarker(root, identity, existing);
    if (!existing) {
      for (const module of declaration.modules) {
        const prefix = path.join(staging, ...module.path.split("/"), "@v", module.version);
        await mkdir(path.dirname(prefix), { recursive: true });
        for (const extension of ["mod", "zip"]) {
          const url = `${declaration.proxy}/${module.path}/@v/${module.version}.${extension}`;
          const response = await fetch(url);
          if (!response.ok) throw new Error(`Go module download HTTP ${response.status}: ${url}`);
          const bytes = Buffer.from(await response.arrayBuffer());
          if (extension === "mod" && moduleSum([{ name: "go.mod", contents: bytes }]) !== module.goModSum) {
            throw new Error(`Go module content sum mismatch: ${module.path}@${module.version}/go.mod`);
          }
          await writeFile(`${prefix}.${extension}`, bytes);
        }
        await writeFile(`${prefix}.info`, JSON.stringify({ Version: module.version }));
      }
      await verifyGoProxy(staging, declaration, parseZip);
      await writeFile(path.join(staging, "ready.json"), JSON.stringify({ identity }));
      await mkdir(path.dirname(root), { recursive: true });
      await rename(staging, root);
    }
    return { identity, modules: await verifyGoProxy(root, declaration, parseZip) };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
