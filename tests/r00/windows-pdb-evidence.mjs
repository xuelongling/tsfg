// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readlink } from "node:fs/promises";
import path from "node:path";

// Audit decoded pdb2yaml --all output, including UNC paths. PDB
// checksums and other binary streams must never be interpreted as path strings.
export function assertDecodedPdbHasNoAbsolutePaths(yaml, label) {
  assert.equal(typeof yaml, "string");
  assert.ok(yaml.startsWith("---") && yaml.trimEnd().endsWith("..."),
    `${label}: incomplete pdb2yaml output`);
  assert.equal(/[A-Za-z]:[\\/]/.test(yaml), false,
    `${label}: decoded PDB contains an absolute Windows path`);
  // A path boundary distinguishes UNC roots (also YAML-escaped) from
  // doubled separators inside relative command-line paths such as .build\\cpp.
  // Native compiler path options may attach their operand without whitespace;
  // recognize those prefixes explicitly, never arbitrary relative path text.
  assert.equal(/(?:^|[\s"'=])(?:\/(?:Fo|Fd|Fe|Fi|Fp|FI|I)|-(?:I|L|isystem|iquote))?(?:\\{2,}|\/\/)[^\\/\s"']+[\\/]+[^\\/\s"']+/m.test(yaml), false,
    `${label}: decoded PDB contains an absolute Windows path`);
}

export async function verifyLockedLlvmTree(root, expectedDigest) {
  // tsfg-tree-sha256-v1: byte-sorted traversal, JCS object keys, file bytes
  // and symlink targets. Verify the entire LLVM tree, including DLLs, before
  // executing pdbutil; a cache path or ready.json alone is not verification.
  const entries = [];
  async function visit(directory, relativeDirectory) {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)));
    for (const child of children) {
      const relative = path.posix.join(relativeDirectory, child.name);
      const absolute = path.join(directory, child.name);
      if (child.isDirectory()) {
        await visit(absolute, relative);
      } else if (child.isSymbolicLink()) {
        entries.push({ path: relative, target: (await readlink(absolute)).split(path.sep).join("/"), type: "symlink" });
      } else {
        assert.ok(child.isFile(), `unsupported LLVM tree entry: ${relative}`);
        const hash = createHash("sha256");
        for await (const chunk of createReadStream(absolute)) hash.update(chunk);
        entries.push({ path: relative, sha256: `sha256:${hash.digest("hex")}`, type: "file" });
      }
    }
  }
  await visit(root, "");
  const actual = `sha256:${createHash("sha256")
    .update(JSON.stringify({ entries, schemaVersion: "1" })).digest("hex")}`;
  assert.equal(actual, expectedDigest, "locked LLVM tree digest mismatch");
}
