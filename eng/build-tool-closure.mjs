// SPDX-License-Identifier: MIT
import path from "node:path";
import process from "node:process";
import { prefetchGoDependencies, readGoDependencyLock } from "./go-closure.mjs";
import { generationPackages, generationSources, readGenerationLock } from "./typescript-generation.mjs";
import { createHash, randomUUID } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { extractArchive, extractTar, normalizeSysrootLinks, runArchiveExtractor } from "./build-archive-extract.mjs";
import { debianDataArchive, parseTar, parseZip } from "./build-archive-readers.mjs";
import { canonicalize, digestFile, pathExists, renameWithRetry, writeAtomicText } from "./build-data.mjs";
import { ConfigurationError } from "./build-errors.mjs";
import { checkedInstallPath, selectToolchain, toolchainClosureDigest, verifyInstalledTool } from "./build-toolchain.mjs";
import { provisionWindowsPublicationControl, provisionWindowsSandboxControl, verifyWindowsPublicationControl, verifyWindowsSandboxControl } from "./build-windows-sandbox.mjs";

async function downloadToFile(toolId, source, destination) {
  const response = await fetch(source.url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`${toolId} download failed with HTTP ${response.status}`);
  }
  const hasher = createHash("sha256");
  let byteSize = 0;
  const handle = await open(destination, "wx");
  try {
    for await (const chunk of response.body) {
      hasher.update(chunk);
      byteSize += chunk.length;
      await handle.write(chunk);
    }
  } finally {
    await handle.close();
  }
  if (String(byteSize) !== source.byteSize) {
    throw new Error(
      `${toolId} byte size mismatch: expected ${source.byteSize}, got ${byteSize}`,
    );
  }
  const actualArchiveDigest = `sha256:${hasher.digest("hex")}`;
  if (actualArchiveDigest !== source.archiveSha256) {
    throw new Error(
      `${toolId} archive digest mismatch: expected ${source.archiveSha256}, got ${actualArchiveDigest}`,
    );
  }
}

function archiveSources(selections) {
  return selections.flatMap(({ artifact }) => [
    ...(artifact.archives ?? [artifact]),
    ...(artifact.bootstrap ? [artifact.bootstrap] : []),
  ]);
}

async function verifyCachedArchive(source, archivePath) {
  const archiveStat = await lstat(archivePath).catch(() => undefined);
  if (!archiveStat?.isFile() || archiveStat.isSymbolicLink()) {
    throw new Error(`cached archive is missing or has invalid type: ${source.archiveSha256}`);
  }
  if (String(archiveStat.size) !== source.byteSize) {
    throw new Error(`cached archive byte size mismatch: ${source.archiveSha256}`);
  }
  const actual = await digestFile(archivePath);
  if (actual !== source.archiveSha256) {
    throw new Error(
      `cached archive digest mismatch: expected ${source.archiveSha256}, got ${actual}`,
    );
  }
}

async function publishCachedArchive(sourcePath, archivePath) {
  const parent = path.dirname(archivePath);
  const temporaryPath = path.join(parent, `.${path.basename(archivePath)}.${randomUUID()}.tmp`);
  await mkdir(parent, { recursive: true });
  try {
    await copyFile(sourcePath, temporaryPath);
    await renameWithRetry(temporaryPath, archivePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function acquireArchive(toolId, source, destination, archiveCacheRoot) {
  const archivePath = path.join(
    archiveCacheRoot,
    source.archiveSha256.slice("sha256:".length),
  );
  if (await pathExists(archivePath)) {
    await verifyCachedArchive(source, archivePath);
    await copyFile(archivePath, destination);
    return;
  }
  await downloadToFile(toolId, source, destination);
  await publishCachedArchive(destination, archivePath);
}

async function verifyArchiveCache(archiveCacheRoot, selections, requireComplete) {
  const sources = archiveSources(selections);
  const expected = new Map(sources.map((source) => [
    source.archiveSha256.slice("sha256:".length),
    source,
  ]));
  const entries = await readdir(archiveCacheRoot, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!entries) {
    if (requireComplete) throw new Error("cached archive set is missing");
    return;
  }
  for (const entry of entries) {
    const source = expected.get(entry.name);
    if (!source) throw new Error(`unexpected cached archive object: ${entry.name}`);
    if (!entry.isFile()) throw new Error(`cached archive has invalid type: ${entry.name}`);
    await verifyCachedArchive(source, path.join(archiveCacheRoot, entry.name));
    expected.delete(entry.name);
  }
  if (requireComplete && expected.size > 0) {
    throw new Error(`cached archive is missing: ${[...expected.keys()][0]}`);
  }
}

async function downloadArtifact(
  toolId,
  artifact,
  toolRoot,
  downloadsRoot,
  extractor,
  archiveCacheRoot,
) {
  await mkdir(downloadsRoot, { recursive: true });
  if (artifact.archiveFormat === "deb-xz-set") {
    if (!extractor) throw new Error("locked archive extractor is unavailable");
    for (const member of artifact.archives) {
      const archive = path.join(downloadsRoot, `${toolId}-${member.id}.deb`);
      await acquireArchive(`${toolId}/${member.id}`, member, archive, archiveCacheRoot);
      const dataArchive = path.join(downloadsRoot, `${toolId}-${member.id}.data.tar.xz`);
      await writeFile(dataArchive, debianDataArchive(await readFile(archive)), { flag: "wx" });
      await extractTar(extractor, dataArchive, toolRoot, 0, downloadsRoot, "xz");
    }
    await normalizeSysrootLinks(toolRoot);
  } else if (artifact.archiveFormat === "zip-set") {
    const stripComponents = artifact.stripComponents ?? "0";
    if (!/^(0|[1-9][0-9]*)$/.test(stripComponents)) {
      throw new Error(`invalid stripComponents for ${toolId}`);
    }
    if (
      typeof artifact.includePrefix !== "string" ||
      !artifact.includePrefix.endsWith("/") ||
      artifact.includePrefix.startsWith("/") ||
      artifact.includePrefix.includes("..")
    ) {
      throw new Error(`invalid includePrefix for ${toolId}`);
    }
    await mkdir(toolRoot, { recursive: true });
    for (const member of artifact.archives) {
      const archive = path.join(downloadsRoot, `${toolId}-${member.id}.zip`);
      await acquireArchive(`${toolId}/${member.id}`, member, archive, archiveCacheRoot);
      try {
        await extractArchive(
          await readFile(archive),
          member.archiveFormat,
          toolRoot,
          Number.parseInt(stripComponents, 10),
          artifact.includePrefix,
        );
      } catch (error) {
        throw new Error(`${toolId}/${member.id} archive extraction failed: ${error.message}`);
      }
    }
  } else {
    const archive = path.join(downloadsRoot, `${toolId}.archive`);
    await acquireArchive(toolId, artifact, archive, archiveCacheRoot);
    if (artifact.archiveFormat === "7zip-bootstrap") {
      const bootstrap = path.join(downloadsRoot, `${toolId}-bootstrap.exe`);
      await acquireArchive(`${toolId}/bootstrap`, artifact.bootstrap, bootstrap, archiveCacheRoot);
      await mkdir(toolRoot, { recursive: true });
      runArchiveExtractor(
        bootstrap,
        ["x", "-y", "-bd", "-bb0", `-o${toolRoot}`, archive],
        downloadsRoot,
      );
    } else if (artifact.archiveFormat === "raw") {
      const destination = checkedInstallPath(toolRoot, artifact.installPath);
      await mkdir(path.dirname(destination), { recursive: true });
      await rename(archive, destination);
      if (process.platform !== "win32") await chmod(destination, 0o755);
    } else if (artifact.archiveFormat === "tar.gz" && extractor) {
      const stripComponents = artifact.stripComponents ?? "0";
      if (!/^(0|[1-9][0-9]*)$/.test(stripComponents)) {
        throw new Error(`invalid stripComponents for ${toolId}`);
      }
      await extractTar(
        extractor,
        archive,
        toolRoot,
        Number.parseInt(stripComponents, 10),
        downloadsRoot,
        "gz",
      );
    } else if (["zip", "tar.gz", "apk-v2"].includes(artifact.archiveFormat)) {
      const stripComponents = artifact.stripComponents ?? "0";
      if (!/^(0|[1-9][0-9]*)$/.test(stripComponents)) {
        throw new Error(`invalid stripComponents for ${toolId}`);
      }
      await mkdir(toolRoot, { recursive: true });
      try {
        await extractArchive(
          await readFile(archive),
          artifact.archiveFormat,
          toolRoot,
          Number.parseInt(stripComponents, 10),
        );
      } catch (error) {
        throw new Error(`${toolId} archive extraction failed: ${error.message}`);
      }
    } else if (artifact.archiveFormat === "tar.xz") {
      if (!extractor) throw new Error("locked archive extractor is unavailable");
      const stripComponents = artifact.stripComponents ?? "0";
      if (!/^(0|[1-9][0-9]*)$/.test(stripComponents)) {
        throw new Error(`invalid stripComponents for ${toolId}`);
      }
      await extractTar(
        extractor,
        archive,
        toolRoot,
        Number.parseInt(stripComponents, 10),
        downloadsRoot,
        "xz",
      );
    } else {
      throw new Error(`unsupported archive format: ${artifact.archiveFormat}`);
    }
  }
  const installed = checkedInstallPath(toolRoot, artifact.installPath);
  const installedStat = await stat(installed).catch(() => undefined);
  if (!installedStat) {
    throw new Error(`${toolId} install path is missing after extraction`);
  }
  await verifyInstalledTool(toolRoot, artifact);
}

async function verifyCachedClosure(closurePath, selections, lockDigest, platform) {
  const expected = new Set(["ready.json", ...selections.map(({ id }) => id)]);
  const entries = await readdir(closurePath, { withFileTypes: true });
  for (const entry of entries) {
    if (!expected.has(entry.name)) {
      throw new Error(`unexpected cached closure object: ${entry.name}`);
    }
    if (entry.name === "ready.json" ? !entry.isFile() : !entry.isDirectory()) {
      throw new Error(`cached closure object has invalid type: ${entry.name}`);
    }
    expected.delete(entry.name);
  }
  if (expected.size > 0) {
    throw new Error(`cached closure object is missing: ${[...expected][0]}`);
  }
  const ready = JSON.parse(await readFile(path.join(closurePath, "ready.json"), "utf8"));
  if (
    ready.status !== "ready" ||
    ready.lockDigest !== lockDigest ||
    ready.platform !== platform
  ) {
    throw new Error("cached closure readiness identity mismatch");
  }
  for (const selection of selections) {
    await verifyInstalledTool(
      path.join(closurePath, selection.id),
      selection.artifact,
    );
  }
}

export async function prefetch(options) {
  const lockPath = options.get("--lock");
  const cachePath = options.get("--cache");
  const platform = options.get("--platform");
  if (!lockPath || !cachePath || !platform) {
    throw new ConfigurationError(
      "prefetch requires --lock, --cache, and --platform",
    );
  }
  const lock = JSON.parse(await readFile(path.resolve(lockPath), "utf8"));
  const generation = await readGenerationLock(lockPath, lock);
  await generationPackages(path.resolve(cachePath), generation, parseTar, true);
  if (generation) await generationSources(path.resolve(path.dirname(lockPath), "../../typescript"), generation, process.env.TSFG_GIT);
  const goDeclaration = await readGoDependencyLock(lockPath, lock);
  const goDependencies = await prefetchGoDependencies(path.resolve(cachePath), goDeclaration,
    lock.goDependencies?.sha256, parseZip);
  if (lock.schemaVersion !== "1" || typeof lock.tools !== "object") {
    throw new Error("unsupported toolchain lock schema");
  }
  const selections = selectToolchain(lock, platform);
  const lockDigest = toolchainClosureDigest(lock, selections, platform);
  const lockHex = lockDigest.slice("sha256:".length);
  const absoluteCache = path.resolve(cachePath);
  const finalPath = path.join(
    absoluteCache,
    "closures",
    "sha256",
    lockHex,
    platform,
  );
  const activePath = path.join(absoluteCache, "active", platform);
  const archiveCacheRoot = path.join(
    absoluteCache,
    "archives",
    "sha256",
    lockHex,
    platform,
  );

  if (await pathExists(finalPath)) {
    try {
      await verifyArchiveCache(archiveCacheRoot, selections, true);
      await verifyCachedClosure(finalPath, selections, lockDigest, platform);
    } catch (error) {
      await rm(activePath, { force: true });
      throw error;
    }
  } else {
    const stagingPath = path.join(
      absoluteCache,
      ".staging",
      `${lockHex}.${platform}.${randomUUID()}`,
    );
    try {
      await verifyArchiveCache(archiveCacheRoot, selections, false);
      await mkdir(stagingPath, { recursive: true });
      const downloadsRoot = path.join(stagingPath, ".downloads");
      let extractor;
      for (const selection of selections) {
        await downloadArtifact(
          selection.id,
          selection.artifact,
          path.join(stagingPath, selection.id),
          downloadsRoot,
          extractor,
          archiveCacheRoot,
        );
        if (selection.id.includes("archive-extractor")) {
          extractor = {
            executable: checkedInstallPath(
              path.join(stagingPath, selection.id),
              selection.artifact.installPath,
            ),
            kind: selection.artifact.extractorKind ?? "busybox",
          };
        }
      }
      await rm(downloadsRoot, { recursive: true, force: true });
      await verifyArchiveCache(archiveCacheRoot, selections, true);
      await writeFile(
        path.join(stagingPath, "ready.json"),
        `${canonicalize({ status: "ready", lockDigest, platform })}\n`,
        "utf8",
      );
      await mkdir(path.dirname(finalPath), { recursive: true });
      await renameWithRetry(stagingPath, finalPath);
    } finally {
      await rm(stagingPath, {
        recursive: true,
        force: true,
        maxRetries: process.platform === "win32" ? 5 : 0,
        retryDelay: 100,
      });
    }
  }

  if (platform === "windows-x86_64-msvc" && !options.has("--dev")) {
    await provisionWindowsSandboxControl({
      cachePath: absoluteCache,
      closurePath: finalPath,
      lock,
      lockDigest,
      platform,
      selections,
    });
    await provisionWindowsPublicationControl({
      cachePath: absoluteCache, closurePath: finalPath, lock, lockDigest, platform, selections,
    });
  }

  const activeRelativePath = [
    "closures",
    "sha256",
    lockHex,
    platform,
  ].join("/");
  await writeAtomicText(
    activePath,
    `${activeRelativePath}\n`,
  );

  return {
    cacheKey: `${platform}/sha256/${lockHex}`,
    ...(options.has("--dev") ? { executionMode: "local-development", isolation: "not-enforced" } : {}),
    ...(goDependencies ? { goDependencies } : {}),
    lockDigest,
    platform,
    tools: selections.map(({ id, tool }) => ({ id, version: tool.version })),
  };
}

export async function verifyRuntimeClosure(lockPath, cachePath, platform, { nativeControls = true } = {}) {
  const lock = JSON.parse(await readFile(path.resolve(lockPath), "utf8"));
  if (lock.schemaVersion !== "1" || typeof lock.tools !== "object") {
    throw new Error("unsupported toolchain lock schema");
  }
  const selections = selectToolchain(lock, platform);
  const lockDigest = toolchainClosureDigest(lock, selections, platform);
  const expectedRelative = [
    "closures",
    "sha256",
    lockDigest.slice("sha256:".length),
    platform,
  ].join("/");
  const absoluteCache = path.resolve(cachePath);
  const activePath = path.join(absoluteCache, "active", platform);
  const activeBytes = await readFile(activePath, "utf8");
  if (activeBytes !== `${expectedRelative}\n`) {
    throw new Error("active closure identity does not match the toolchain lock");
  }
  const closurePath = path.resolve(absoluteCache, ...expectedRelative.split("/"));
  const relative = path.relative(absoluteCache, closurePath);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error("active closure escapes the toolchain cache");
  }
  await verifyCachedClosure(closurePath, selections, lockDigest, platform);
  const runtime = {
    cachePath: absoluteCache,
    closurePath,
    lock,
    lockDigest,
    platform,
    selections,
    lockPath: path.resolve(lockPath),
  };
  if (platform === "windows-x86_64-msvc" && nativeControls) {
    await verifyWindowsSandboxControl(runtime);
    await verifyWindowsPublicationControl(runtime);
  }
  return runtime;
}
