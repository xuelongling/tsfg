// SPDX-License-Identifier: MIT
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, rm, writeFile } from "node:fs/promises";
import { readRegularFile } from "./build-data.mjs";
import { BuildFailureError } from "./build-errors.mjs";
import { runBuildTool } from "./build-process.mjs";
import { runWindowsSandboxedCapture, windowsSandboxArguments } from "./build-windows-sandbox.mjs";

export function normalizeEmbeddedPaths(bytes, mappings) {
  const normalized = Buffer.from(bytes);
  const unique = new Map();
  for (const [source, label] of mappings) {
    for (const form of [source, source.replaceAll("\\", "/")]) {
      if (form.length > 1) unique.set(form, label);
    }
  }
  for (const [source, label] of [...unique].sort((left, right) => right[0].length - left[0].length)) {
    const sourceBytes = Buffer.from(source);
    const labelBytes = Buffer.from(label);
    if (labelBytes.length > sourceBytes.length) {
      throw new BuildFailureError(`embedded path label ${label} is longer than ${source}`);
    }
    const replacement = Buffer.alloc(sourceBytes.length, 0x5f);
    labelBytes.copy(replacement);
    for (let offset = normalized.indexOf(sourceBytes); offset !== -1;) {
      replacement.copy(normalized, offset);
      offset = normalized.indexOf(sourceBytes, offset + replacement.length);
    }
  }
  return normalized;
}

function canonicalWindowsPdbStringTable(yaml) {
  const stringTable = yaml.match(/^StringTable:\r?\n([\s\S]*?)(?=^PdbStream:)/m);
  if (stringTable === null) {
    throw new BuildFailureError("PDB normalization could not locate its string table");
  }
  const entries = stringTable[1].split(/\r?\n/).filter(Boolean)
    .map((entry) => entry === "  - '.external'" ? "  - .external"
      : entry === "  - '.'" ? "  - ." : entry);
  if (entries.some((entry) => !entry.startsWith("  - "))) {
    throw new BuildFailureError("PDB normalization found an invalid string table entry");
  }
  const canonicalEntries = [...new Set(entries)]
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  return yaml
    // yaml2pdb assigns string offsets in input order, so canonicalize this set
    // before producing the final PDB as well as before comparing semantics.
    .replace(stringTable[0], `StringTable:\n${canonicalEntries.join("\n")}\n`)
    .replaceAll("'.external'", ".external")
    .replaceAll("'.'", ".");
}

function canonicalWindowsPdbSemantics(yaml) {
  let semantic = canonicalWindowsPdbStringTable(yaml)
    // The MSF superblock, stream sizes, and stream-to-block map describe only
    // the physical container. yaml2pdb always regenerates them.
    .replace(/^MSF:\r?\n[\s\S]*?(?=^StringTable:)/m, "");
  const publics = semantic.match(
    /^PublicsStream:\r?\n  Records:\r?\n([\s\S]*?)(?=^\.\.\.)/m,
  );
  if (publics === null) {
    throw new BuildFailureError("PDB normalization could not locate its public symbols");
  }
  const publicRecords = publics[1].split(/(?=^    - Kind:)/m).filter(Boolean);
  if (publicRecords.some((record) => !record.startsWith("    - Kind:"))) {
    throw new BuildFailureError("PDB normalization found an invalid public symbol record");
  }
  publicRecords.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  // The publics hash stream does not preserve record order across yaml2pdb.
  semantic = semantic.replace(
    publics[0],
    `PublicsStream:\n  Records:\n${publicRecords.join("")}`,
  );
  if (semantic === yaml) {
    throw new BuildFailureError("PDB normalization could not isolate physical layout metadata");
  }
  return semantic;
}

function neutralizeWindowsPdbIdentity(yaml) {
  return yaml
    .replace(/^  Guid:\s+.*$/m, "  Guid:            '{00000000-0000-0000-0000-000000000000}'")
    .replace(/^  Signature:\s+.*$/m, "  Signature:       0")
    .replace(/^StreamSizes:\s+\[\s*0,\s*\d+,/m, "StreamSizes:     [ 0, 0,")
    .replace(/^  Features:\s+\[([^\]]*)\]$/m, (_match, features) => {
      const unique = [...new Set(features.split(",").map((feature) => feature.trim()).filter(Boolean))];
      return `  Features:        [ ${unique.join(", ")} ]`;
    });
}

function assertWindowsPdbIdentity(yaml, guidText) {
  if (/[A-Za-z]:[\\/]/.test(yaml)) {
    throw new BuildFailureError("normalized PDB still contains an absolute Windows path");
  }
  if (
    [...yaml.matchAll(/^  Guid:\s+.*$/gm)].length !== 1 ||
    [...yaml.matchAll(/^  Signature:\s+.*$/gm)].length !== 1 ||
    !yaml.includes(`Guid:            '${guidText}'`)
  ) {
    throw new BuildFailureError("normalized PDB identity fields are invalid");
  }
}

export async function normalizeWindowsPdb(
  pdbPath,
  pdbutil,
  pathMappings,
  workRoot,
  environment,
  sandboxExecutable,
  sandboxPolicy,
) {
  const yamlPath = path.join(workRoot, `${path.basename(pdbPath)}.${randomUUID()}.yaml`);
  const preliminaryPath = path.join(workRoot, `${path.basename(pdbPath)}.${randomUUID()}.preliminary.pdb`);
  const normalizedPath = path.join(workRoot, `${path.basename(pdbPath)}.${randomUUID()}.pdb`);
  const dumped = runWindowsSandboxedCapture(
    "llvm-pdbutil pdb2yaml",
    sandboxExecutable,
    sandboxPolicy,
    pdbutil,
    ["pdb2yaml", "--all", pdbPath],
    workRoot,
    environment,
  );
  let yaml = dumped.stdout;
  for (const [source, replacement] of pathMappings) {
    if (source instanceof RegExp) {
      yaml = yaml.replaceAll(source, replacement);
      continue;
    }
    yaml = yaml.replaceAll(source, replacement);
    yaml = yaml.replaceAll(source.replaceAll("\\", "/"), replacement);
    yaml = yaml.replaceAll(source.replaceAll("\\", "\\\\"), replacement);
  }
  yaml = yaml.replace(/[A-Za-z]:\\[^'\r\n]*/g, ".external");
  yaml = yaml.replace(/[A-Za-z]:\/[^'\r\n]*/g, ".external");
  if (
    [...yaml.matchAll(/^  Guid:\s+.*$/gm)].length !== 1 ||
    [...yaml.matchAll(/^  Signature:\s+.*$/gm)].length !== 1
  ) {
    throw new BuildFailureError("PDB normalization could not locate its unique identity fields");
  }
  // llvm-pdbutil adjusts physical stream sizes and appends VC140 on each
  // round-trip. Neither value describes program semantics.
  const identityNeutralYaml = neutralizeWindowsPdbIdentity(yaml);
  if (
    [...identityNeutralYaml.matchAll(/^StreamSizes:\s+\[\s*0,\s*0,/gm)].length !== 1 ||
    [...identityNeutralYaml.matchAll(/^  Features:\s+\[[^\]]*\]$/gm)].length !== 1
  ) {
    throw new BuildFailureError("PDB normalization could not locate its semantic layout fields");
  }
  const semanticIdentityYaml = canonicalWindowsPdbSemantics(identityNeutralYaml);
  await writeFile(yamlPath, identityNeutralYaml, { encoding: "utf8", flag: "wx" });
  try {
    const identityHex = createHash("sha256").update(semanticIdentityYaml).digest("hex");
    const guidText = `{${identityHex.slice(0, 8)}-${identityHex.slice(8, 12)}-${identityHex.slice(12, 16)}-${identityHex.slice(16, 20)}-${identityHex.slice(20, 32)}}`.toUpperCase();
    yaml = identityNeutralYaml
      .replace("'{00000000-0000-0000-0000-000000000000}'", `'${guidText}'`)
      .replace(
        /^  Signature:\s+0$/m,
        `  Signature:       ${Number.parseInt(identityHex.slice(0, 8), 16)}`,
      );
    await writeFile(yamlPath, yaml, { encoding: "utf8" });
    runBuildTool(
      "llvm-pdbutil canonicalization",
      sandboxExecutable ?? pdbutil,
      windowsSandboxArguments(
        sandboxPolicy,
        pdbutil,
        ["yaml2pdb", `--pdb=${preliminaryPath}`, yamlPath],
      ),
      workRoot,
      environment,
      true,
    );
    const preliminary = runWindowsSandboxedCapture(
      "llvm-pdbutil preliminary verification",
      sandboxExecutable,
      sandboxPolicy,
      pdbutil,
      ["pdb2yaml", "--all", preliminaryPath],
      workRoot,
      environment,
    ).stdout;
    assertWindowsPdbIdentity(preliminary, guidText);
    const preliminaryNeutral = neutralizeWindowsPdbIdentity(preliminary);
    if (canonicalWindowsPdbSemantics(preliminaryNeutral) !== semanticIdentityYaml) {
      throw new BuildFailureError("normalized PDB semantic content changed during canonicalization");
    }
    yaml = canonicalWindowsPdbStringTable(preliminaryNeutral)
      .replace("'{00000000-0000-0000-0000-000000000000}'", `'${guidText}'`)
      .replace(
        /^  Signature:\s+0$/m,
        `  Signature:       ${Number.parseInt(identityHex.slice(0, 8), 16)}`,
      );
    await writeFile(yamlPath, yaml, { encoding: "utf8" });
    runBuildTool(
      "llvm-pdbutil fixed-point canonicalization",
      sandboxExecutable ?? pdbutil,
      windowsSandboxArguments(
        sandboxPolicy,
        pdbutil,
        ["yaml2pdb", `--pdb=${normalizedPath}`, yamlPath],
      ),
      workRoot,
      environment,
      true,
    );
    const verified = runWindowsSandboxedCapture(
      "llvm-pdbutil fixed-point verification",
      sandboxExecutable,
      sandboxPolicy,
      pdbutil,
      ["pdb2yaml", "--all", normalizedPath],
      workRoot,
      environment,
    ).stdout;
    assertWindowsPdbIdentity(verified, guidText);
    if (
      canonicalWindowsPdbSemantics(neutralizeWindowsPdbIdentity(verified)) !==
      semanticIdentityYaml
    ) {
      throw new BuildFailureError("normalized PDB semantic content changed at its fixed point");
    }
    await copyFile(normalizedPath, pdbPath);
    const guidBytes = Buffer.alloc(16);
    guidBytes.writeUInt32LE(Number.parseInt(identityHex.slice(0, 8), 16), 0);
    guidBytes.writeUInt16LE(Number.parseInt(identityHex.slice(8, 12), 16), 4);
    guidBytes.writeUInt16LE(Number.parseInt(identityHex.slice(12, 16), 16), 6);
    Buffer.from(identityHex.slice(16, 32), "hex").copy(guidBytes, 8);
    return guidBytes;
  } finally {
    await rm(yamlPath, { force: true });
    await rm(preliminaryPath, { force: true });
    await rm(normalizedPath, { force: true });
  }
}

export async function normalizeWindowsExecutable(executablePath, pdbGuid, timestamp) {
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp > 0xffff_ffff) {
    throw new BuildFailureError("Windows executable timestamp is outside the PE range");
  }
  const bytes = await readRegularFile(executablePath, path.basename(executablePath));
  if (bytes.length < 0x40 || bytes.toString("ascii", 0, 2) !== "MZ") {
    throw new BuildFailureError("Windows executable is missing its DOS header");
  }
  const peOffset = bytes.readUInt32LE(0x3c);
  if (peOffset + 24 > bytes.length || bytes.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0") {
    throw new BuildFailureError("Windows executable is missing its PE header");
  }
  const coffOffset = peOffset + 4;
  const sectionCount = bytes.readUInt16LE(coffOffset + 2);
  const optionalHeaderSize = bytes.readUInt16LE(coffOffset + 16);
  const optionalOffset = coffOffset + 20;
  if (
    optionalHeaderSize < 112 + 8 * 7 ||
    optionalOffset + optionalHeaderSize > bytes.length ||
    bytes.readUInt16LE(optionalOffset) !== 0x20b ||
    bytes.readUInt32LE(optionalOffset + 108) < 7
  ) {
    throw new BuildFailureError("Windows executable has an unsupported optional header");
  }
  const debugDirectoryRva = bytes.readUInt32LE(optionalOffset + 112 + 8 * 6);
  const debugDirectorySize = bytes.readUInt32LE(optionalOffset + 112 + 8 * 6 + 4);
  const sectionTableOffset = optionalOffset + optionalHeaderSize;
  let debugDirectoryOffset;
  for (let index = 0; index < sectionCount; index += 1) {
    const sectionOffset = sectionTableOffset + 40 * index;
    if (sectionOffset + 40 > bytes.length) break;
    const virtualAddress = bytes.readUInt32LE(sectionOffset + 12);
    const rawSize = bytes.readUInt32LE(sectionOffset + 16);
    const rawOffset = bytes.readUInt32LE(sectionOffset + 20);
    if (debugDirectoryRva >= virtualAddress) {
      const relativeOffset = debugDirectoryRva - virtualAddress;
      if (
        relativeOffset <= rawSize &&
        debugDirectorySize <= rawSize - relativeOffset &&
        rawOffset <= bytes.length &&
        relativeOffset <= bytes.length - rawOffset &&
        debugDirectorySize <= bytes.length - rawOffset - relativeOffset
      ) {
        debugDirectoryOffset = rawOffset + relativeOffset;
      }
    }
    if (debugDirectoryOffset !== undefined) {
      break;
    }
  }
  if (
    debugDirectoryOffset === undefined ||
    debugDirectorySize === 0 ||
    debugDirectorySize % 28 !== 0 ||
    debugDirectoryOffset + debugDirectorySize > bytes.length
  ) {
    throw new BuildFailureError("Windows executable has an invalid debug directory");
  }
  let codeViewRecords = 0;
  for (let offset = debugDirectoryOffset; offset < debugDirectoryOffset + debugDirectorySize; offset += 28) {
    bytes.writeUInt32LE(timestamp, offset + 4);
    if (bytes.readUInt32LE(offset + 12) !== 2) continue;
    const dataSize = bytes.readUInt32LE(offset + 16);
    const dataOffset = bytes.readUInt32LE(offset + 24);
    if (
      dataSize < 24 ||
      dataOffset + dataSize > bytes.length ||
      bytes.toString("ascii", dataOffset, dataOffset + 4) !== "RSDS"
    ) {
      throw new BuildFailureError("Windows executable has an invalid CodeView record");
    }
    pdbGuid.copy(bytes, dataOffset + 4);
    codeViewRecords += 1;
  }
  if (codeViewRecords !== 1) {
    throw new BuildFailureError("Windows executable must contain exactly one CodeView record");
  }
  bytes.writeUInt32LE(timestamp, coffOffset + 4);
  await writeFile(executablePath, bytes);
  return bytes;
}
