// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import test from "node:test";
import { assertDecodedPdbHasNoAbsolutePaths } from "./windows-pdb-evidence.mjs";

test("PDB path audit accepts binary checksum noise but rejects decoded absolute paths", () => {
  // Actual false-positive bytes at offset 2715257 in the clean debug C++ PDB.
  const checksum = Buffer.from("413a5c54d1a4930ec95ff030", "hex");
  assert.match(checksum.toString("latin1"), /[A-Za-z]:[\\/]/);
  const yaml = `---\nStringTable:\n  - './tests/r00/smoke/cpp/main.cpp'\nChecksums:\n  - Checksum: '${checksum.toString("hex").toUpperCase()}'\n...\n`;
  assert.doesNotThrow(() => assertDecodedPdbHasNoAbsolutePaths(yaml, "checksum fixture"));
  for (const pathname of ["C:\\source\\main.cpp", "e:/source/main.cpp", "C:\\\\source\\\\main.cpp"]) {
    const leaked = yaml.replace("./tests/r00/smoke/cpp/main.cpp", pathname);
    assert.throws(() => assertDecodedPdbHasNoAbsolutePaths(leaked, "path fixture"),
      /decoded PDB contains an absolute Windows path/);
  }
});

test("PDB path audit rejects UNC paths in decoded YAML strings and command lines", () => {
  for (const value of [
    String.raw`'\\server\share\main.cpp'`,
    String.raw`"\\\\server\\share\\main.cpp"`,
    String.raw`'//server/share/main.cpp'`,
    String.raw`'clang -o "\\server\share\main.obj"'`,
    String.raw`'clang --output=\\server\share\main.obj'`,
  ]) {
    const yaml = `---\nStringTable:\n  - ${value}\n...\n`;
    assert.throws(() => assertDecodedPdbHasNoAbsolutePaths(yaml, "UNC fixture"),
      /decoded PDB contains an absolute Windows path/);
  }
});

test("PDB path audit rejects UNC paths attached to native compiler path options", () => {
  for (const command of [
    String.raw`'clang-cl /Fo\\server\share\main.obj'`,
    String.raw`'clang-cl /I\\server\share'`,
    String.raw`'clang -I\\server\share'`,
    String.raw`'clang -L\\server\share'`,
    String.raw`"clang-cl /Fo\\\\server\\share\\main.obj"`,
  ]) {
    const yaml = `---\nStringTable:\n  - ${command}\n...\n`;
    assert.throws(() => assertDecodedPdbHasNoAbsolutePaths(yaml, "attached UNC fixture"),
      /decoded PDB contains an absolute Windows path/);
  }
});

test("PDB path audit accepts relative paths with YAML-escaped separators", () => {
  for (const value of [
    String.raw`'clang -cc1 -o .build\\cpp\\main.obj ./tests/r00/smoke/cpp/main.cpp'`,
    String.raw`".build\\cpp\\main.obj"`,
    String.raw`'clang --output=".build\\cpp\\main.obj"'`,
    String.raw`'./tests//r00/smoke/cpp/main.cpp'`,
    String.raw`'clang-cl /Fo.build\\cpp\\main.obj /Itests\\r00'`,
    String.raw`'clang -Itests\\r00 -L.build\\lib'`,
  ]) {
    const yaml = `---\nStringTable:\n  - ${value}\n...\n`;
    assert.doesNotThrow(() => assertDecodedPdbHasNoAbsolutePaths(yaml, "relative fixture"));
  }
});

test("PDB path audit rejects missing or truncated decoder output", () => {
  for (const yaml of ["", "---\nStringTable:\n"]) {
    assert.throws(() => assertDecodedPdbHasNoAbsolutePaths(yaml, "broken decoder"),
      /incomplete pdb2yaml output/);
  }
});
