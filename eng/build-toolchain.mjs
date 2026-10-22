// SPDX-License-Identifier: MIT
import path from "node:path";
import { readdir, readlink } from "node:fs/promises";
import { canonicalize, digest, digestFile } from "./build-data.mjs";

export async function hashTree(root) {
  const entries = [];
  async function visit(directory, relativeDirectory) {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) =>
      Buffer.from(left.name).compare(Buffer.from(right.name)),
    );
    for (const child of children) {
      const relativePath = path.posix.join(relativeDirectory, child.name);
      const absolutePath = path.join(directory, child.name);
      if (child.isDirectory()) {
        await visit(absolutePath, relativePath);
      } else if (child.isSymbolicLink()) {
        entries.push({
          path: relativePath,
          type: "symlink",
          target: (await readlink(absolutePath)).split(path.sep).join("/"),
        });
      } else if (child.isFile()) {
        entries.push({
          path: relativePath,
          type: "file",
          sha256: await digestFile(absolutePath),
        });
      } else {
        throw new Error(`unsupported unpacked entry type: ${relativePath}`);
      }
    }
  }
  await visit(root, "");
  return digest(canonicalize({ schemaVersion: "1", entries }));
}

function selectArtifact(toolId, tool, platform) {
  if (
    typeof tool?.version !== "string" ||
    typeof tool.license !== "string" ||
    tool.license.length === 0 ||
    typeof tool.signature?.kind !== "string" ||
    tool.signature.kind.length === 0 ||
    !Array.isArray(tool.artifacts)
  ) {
    throw new Error(`invalid lock entry for ${toolId}`);
  }
  if (
    typeof tool.signature?.signer !== "string" ||
    tool.signature.signer.length === 0
  ) {
    throw new Error(`invalid signer metadata for ${toolId}`);
  }
  const matches = tool.artifacts.filter(
    (artifact) => artifact.platform === platform,
  );
  if (matches.length !== 1) {
    throw new Error(
      `lock must contain exactly one ${toolId} artifact for ${platform}`,
    );
  }
  const artifact = matches[0];
  const digestPattern = /^sha256:[0-9a-f]{64}$/;
  const commonMetadataValid =
    /^(0|[1-9][0-9]*)$/.test(artifact.byteSize) &&
    digestPattern.test(artifact.archiveSha256) &&
    digestPattern.test(artifact.unpackedTreeSha256);
  const bootstrapValid = artifact.archiveFormat !== "7zip-bootstrap" || (
    /^https?:\/\//.test(artifact.bootstrap?.url) &&
    /^(0|[1-9][0-9]*)$/.test(artifact.bootstrap?.byteSize) &&
    digestPattern.test(artifact.bootstrap?.archiveSha256)
  );
  const archiveSetValid =
    ["deb-xz-set", "zip-set"].includes(artifact.archiveFormat) &&
    Array.isArray(artifact.archives) &&
    artifact.archives.length > 0 &&
    artifact.archives.every((member) =>
      typeof member.id === "string" &&
      member.id.length > 0 &&
      /^https?:\/\//.test(member.url) &&
      /^(0|[1-9][0-9]*)$/.test(member.byteSize) &&
      digestPattern.test(member.archiveSha256) &&
      (artifact.archiveFormat !== "zip-set" || member.archiveFormat === "zip") &&
      typeof member.license === "string" &&
      member.license.length > 0);
  if (
    !commonMetadataValid ||
    !bootstrapValid ||
    (!archiveSetValid && !/^https?:\/\//.test(artifact.url))
  ) {
    throw new Error(`invalid lock artifact metadata for ${toolId}`);
  }
  if (archiveSetValid) {
    const identities = artifact.archives.map(({ id, byteSize, archiveSha256 }) => ({
      id,
      byteSize,
      archiveSha256,
    }));
    const sorted = [...identities].sort((left, right) =>
      Buffer.from(left.id).compare(Buffer.from(right.id)),
    );
    if (
      canonicalize(identities) !== canonicalize(sorted) ||
      new Set(identities.map(({ id }) => id)).size !== identities.length ||
      digest(canonicalize(identities)) !== artifact.archiveSha256 ||
      String(identities.reduce((total, member) => total + Number(member.byteSize), 0)) !== artifact.byteSize
    ) {
      throw new Error(`invalid archive set metadata for ${toolId}`);
    }
  }
  return artifact;
}

export function selectToolchain(lock, platform) {
  const configured = lock.targets?.[platform]?.tools;
  const toolIds = configured ?? Object.keys(lock.tools).sort();
  if (
    !Array.isArray(toolIds) ||
    toolIds.length === 0 ||
    toolIds.some((id) => typeof id !== "string" || !(id in lock.tools)) ||
    new Set(toolIds).size !== toolIds.length
  ) {
    throw new Error(`invalid tool selection for ${platform}`);
  }
  const sortedToolIds = [...toolIds].sort((left, right) =>
    Buffer.from(left).compare(Buffer.from(right)),
  );
  if (canonicalize(toolIds) !== canonicalize(sortedToolIds)) {
    throw new Error(`tool selection for ${platform} must be sorted`);
  }
  return toolIds.map((id) => ({
    id,
    tool: lock.tools[id],
    artifact: selectArtifact(id, lock.tools[id], platform),
  }));
}

export function toolchainClosureDigest(lock, selections, platform) {
  if (!Array.isArray(lock.dependencyLocks)) {
    throw new Error("toolchain lock must declare dependencyLocks");
  }
  const dependencyLocks = lock.dependencyLocks.map((dependency) => {
    if (
      typeof dependency?.projectId !== "string" ||
      dependency.projectId.length === 0 ||
      typeof dependency.path !== "string" ||
      dependency.path.length === 0 ||
      !/^sha256:[0-9a-f]{64}$/.test(dependency.sha256)
    ) {
      throw new Error("invalid dependency lock identity");
    }
    return {
      projectId: dependency.projectId,
      path: dependency.path,
      sha256: dependency.sha256,
    };
  }).sort((left, right) => {
    const projectOrder = Buffer.from(left.projectId).compare(Buffer.from(right.projectId));
    return projectOrder || Buffer.from(left.path).compare(Buffer.from(right.path));
  });
  const identities = dependencyLocks.map(({ projectId, path: dependencyPath }) =>
    `${projectId}\0${dependencyPath}`);
  if (new Set(identities).size !== identities.length) {
    throw new Error("duplicate dependency lock identity");
  }
  return digest(canonicalize({
    dependencyLocks,
    schemaVersion: lock.schemaVersion,
    target: platform,
    tools: selections.map(({ id, tool, artifact }) => ({
      id,
      version: tool.version,
      platform: artifact.platform,
      archiveSha256: artifact.archiveSha256,
      unpackedTreeSha256: artifact.unpackedTreeSha256,
    })),
  }));
}

export function checkedInstallPath(toolRoot, installPath) {
  if (typeof installPath !== "string" || installPath.length === 0) {
    throw new Error("artifact installPath must be a non-empty string");
  }
  const destination = path.resolve(toolRoot, ...installPath.split("/"));
  const relative = path.relative(toolRoot, destination);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`artifact installPath escapes tool root: ${installPath}`);
  }
  return destination;
}

export async function verifyInstalledTool(toolRoot, artifact) {
  const actualTreeDigest = await hashTree(toolRoot);
  if (actualTreeDigest !== artifact.unpackedTreeSha256) {
    throw new Error(
      `unpacked tree digest mismatch: expected ${artifact.unpackedTreeSha256}, got ${actualTreeDigest}`,
    );
  }
}

export function closureToolPath(runtime, toolId, executableId = toolId) {
  const selection = runtime.selections.find(({ id }) => id === toolId);
  if (!selection) throw new Error(`locked tool is not selected: ${toolId}`);
  const installPath = selection.artifact.executables?.[executableId]
    ?? selection.artifact.installPath;
  return checkedInstallPath(
    path.join(runtime.closurePath, toolId),
    installPath,
  );
}

export function windowsToolchain(runtime) {
  const msvcRoot = path.join(runtime.closurePath, "msvc-tools", "VC", "Tools", "MSVC", "14.44.35207");
  const sdkRoot = path.join(runtime.closurePath, "windows-sdk", "c");
  const sdkVersion = "10.0.26100.0";
  return {
    clangcl: closureToolPath(runtime, "llvm", "clangcl"),
    cl: closureToolPath(runtime, "msvc-tools", "cl"),
    cmake: closureToolPath(runtime, "cmake"),
    include: [
      path.join(msvcRoot, "include"),
      ...["ucrt", "shared", "um", "winrt", "cppwinrt"].map((directory) =>
        path.join(sdkRoot, "Include", sdkVersion, directory)),
    ],
    lib: [
      path.join(msvcRoot, "lib", "x64"),
      path.join(sdkRoot, "ucrt", "x64"),
      path.join(sdkRoot, "um", "x64"),
    ],
    link: closureToolPath(runtime, "msvc-tools", "link"),
    lld: closureToolPath(runtime, "llvm", "lld"),
    mt: closureToolPath(runtime, "windows-sdk", "mt"),
    mspdbsrv: path.join(msvcRoot, "bin", "Hostx64", "x64", "mspdbsrv.exe"),
    ninja: closureToolPath(runtime, "ninja"),
    node: closureToolPath(runtime, "node"),
    pdbutil: closureToolPath(runtime, "llvm", "pdbutil"),
    rc: closureToolPath(runtime, "windows-sdk", "rc"),
    zig: closureToolPath(runtime, "zig"),
  };
}
