// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

export class MlirPythonError extends Error {
  constructor(message) { super(message); this.issueCode = "mlir-python-integrity"; }
}
const reject = message => { throw new MlirPythonError(message); };
const digest = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const canonicalize = value => Array.isArray(value) ? `[${value.map(canonicalize).join(",")}]`
  : value !== null && typeof value === "object" ? `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}` : JSON.stringify(value);
const safeRelative = name => typeof name === "string" && /^[A-Za-z0-9._/-]+$/.test(name) &&
  name.split("/").every(part => part !== "" && ![".", ".."].includes(part));

async function ordinaryDirectory(root) {
  const state = await lstat(root);
  if (!state.isDirectory() || state.isSymbolicLink() || path.resolve(await realpath(root)) !== path.resolve(root))
    reject("Python closure paths must be ordinary directories");
}
async function originalFile(root, name, expected) {
  if (!safeRelative(name)) reject("unsafe Python closure path");
  let current = root;
  const parts = name.split("/");
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const state = await lstat(current);
    if (state.isSymbolicLink() || (index === parts.length - 1 ? !state.isFile() : !state.isDirectory()))
      reject(`nonregular Python closure input: ${name}`);
  }
  const bytes = await readFile(current);
  if (digest(bytes) !== expected) reject(`Python closure bytes mismatch: ${name}`);
  return bytes;
}
// The same tsfg-tree-sha256-v1 projection used by the existing tool closures.
async function inspectTree(root) {
  const entries = [];
  async function visit(directory, relative = "") {
    for (const child of (await readdir(directory, { withFileTypes: true })).sort((a, b) => Buffer.from(a.name).compare(Buffer.from(b.name)))) {
      const name = path.posix.join(relative, child.name);
      const absolute = path.join(directory, child.name);
      if (child.isDirectory()) await visit(absolute, name);
      else if (child.isSymbolicLink()) entries.push({ path: name, type: "symlink", target: (await readlink(absolute)).split(path.sep).join("/") });
      else if (child.isFile()) entries.push({ path: name, type: "file", sha256: digest(await readFile(absolute)) });
      else reject(`unsupported Python closure entry: ${name}`);
    }
  }
  await ordinaryDirectory(root);
  await visit(root);
  return { entries, sha256: digest(canonicalize({ schemaVersion: "1", entries })) };
}

/**
 * Verify the scoped official build-only tool; never discover or execute Python.
 * @param {{toolRoot?: string}} input
 */
export async function readMlirPythonTool({ toolRoot }) {
  try {
    if (process.platform !== "win32" || process.arch !== "x64" || typeof toolRoot !== "string" ||
        !path.isAbsolute(toolRoot) || !/^E:[\\/]/i.test(toolRoot)) reject("Python tool preparation requires an explicit E-drive Windows x64 closure");
    await ordinaryDirectory(toolRoot);
    const lockBytes = await readFile(new URL("./mlir-python.lock.json", import.meta.url));
    if (digest(lockBytes) !== "sha256:e8d3950c8e9afd037f767314689c13b48d9efba111a40b6b930650759011f359")
      reject("Python tool lock differs from the verified finite acquisition capsule");
    const lock = JSON.parse(lockBytes.toString("utf8"));
    // This finite selection follows the direct approval; editing a JSON version/hash cannot extend it.
    if (lock.schemaVersion !== "1" || lock.toolId !== "cpython-mlir-build-only" || lock.version !== "3.14.8" || lock.role !== "build-only" ||
        lock.url !== "https://www.python.org/ftp/python/3.14.8/python-3.14.8-embed-amd64.zip" ||
        lock.platform !== "windows-x86_64-msvc" || lock.archive !== "python-3.14.8-embed-amd64.zip" ||
        lock.archiveSha256 !== "sha256:a93abe456ab01bd96d7a085b3cdb6566b3063f4241360d114142fbdb07f0a310" ||
        lock.treeAlgorithm !== "tsfg-tree-sha256-v1" ||
        lock.treeSha256 !== "sha256:1e03237f0fa64b481d77e77013b5466c115c78198be90fde5bde9e554cd9ce3b" ||
        lock.executable !== "python.exe" || !Array.isArray(lock.files) || lock.files.length !== 37 ||
        !Array.isArray(lock.legalMaterials) || lock.legalMaterials.length !== 20 ||
        lock.signature.identity !== "hugo@python.org" || lock.signature.issuer !== "https://github.com/login/oauth")
      reject("Python tool lock is outside the exact approved selection");
    const archive = await originalFile(toolRoot, lock.archive, lock.archiveSha256);
    const runtimeRoot = path.join(toolRoot, "runtime");
    const runtime = await inspectTree(runtimeRoot);
    if (runtime.sha256 !== lock.treeSha256 || canonicalize(runtime.entries) !== canonicalize(lock.files))
      reject("Python unpacked tree differs from the verified official package");
    await originalFile(runtimeRoot, lock.executable, lock.executableSha256);
    await originalFile(runtimeRoot, "LICENSE.txt", lock.originalLicenseSha256);
    const legalRoot = path.join(toolRoot, "legal");
    const legal = await inspectTree(legalRoot);
    const expectedLegal = lock.legalMaterials.map(material => ({ path: material.file, type: "file", sha256: material.sha256 }))
      .sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
    if (canonicalize(legal.entries) !== canonicalize(expectedLegal)) reject("Python original legal material set differs");
    const bundleBytes = await originalFile(toolRoot, lock.signature.bundle, lock.signature.bundleSha256);
    await originalFile(toolRoot, lock.sbom.file, lock.sbom.sha256);
    const metadataRoot = path.join(toolRoot, "sigstore-tuf");
    const metadata = await inspectTree(metadataRoot);
    if (metadata.sha256 !== lock.signature.trustedMetadataTreeSha256 ||
        canonicalize(metadata.entries) !== canonicalize(lock.signature.metadataFiles)) reject("Python signature trust metadata differs from the verified acquisition");
    const nodeRoot = path.dirname(process.execPath);
    if (!/^E:[\\/]/i.test(nodeRoot) || process.versions.node !== "24.20.0" ||
        lock.signature.verifierNodeTreeSha256 !== "sha256:d3c8d5a3cd0b70b8ca9184537edd6d221b3dea6b006de0e348308f102a7822e9" ||
        (await inspectTree(nodeRoot)).sha256 !== lock.signature.verifierNodeTreeSha256)
      reject("Python signature verifier is not the locked Node tool tree");
    // Verify offline with the exact trusted-root bytes acquired through fresh TUF.
    // No cache refresh or network fallback is used during build preparation.
    const require = createRequire(import.meta.url);
    const modules = path.join(nodeRoot, "node_modules/npm/node_modules");
    const { bundleFromJSON } = require(path.join(modules, "@sigstore/bundle"));
    const { TrustedRoot } = require(path.join(modules, "@sigstore/protobuf-specs"));
    const { Verifier, toTrustMaterial, toSignedEntity } = require(path.join(modules, "@sigstore/verify"));
    const rootEntry = lock.signature.metadataFiles.find(file => file.path === lock.signature.trustedRoot);
    if (!rootEntry) reject("Python trusted root is not in the verified metadata set");
    const trustedRoot = TrustedRoot.fromJSON(JSON.parse((await originalFile(metadataRoot,
      rootEntry.path, rootEntry.sha256)).toString("utf8")));
    const verifier = new Verifier(toTrustMaterial(trustedRoot), { ctlogThreshold: 1, tlogThreshold: 1, timestampThreshold: 1 });
    verifier.verify(toSignedEntity(bundleFromJSON(JSON.parse(bundleBytes.toString("utf8"))), archive),
      { subjectAlternativeName: "hugo@python.org", extensions: { issuer: "https://github.com/login/oauth" } });
    return { version: lock.version, role: "build-only", executed: false, signatureVerified: true,
      executable: path.join(runtimeRoot, lock.executable), archiveSha256: lock.archiveSha256,
      treeSha256: runtime.sha256, files: runtime.entries.length, legalMaterials: legal.entries.length,
      lockSha256: digest(lockBytes), trustedMetadataTreeSha256: metadata.sha256 };
  } catch (error) {
    if (error instanceof MlirPythonError) throw error;
    reject(`Python tool closure verification failed: ${error.message}`);
  }
}
