// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

function decodeContractJson(bytes) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new TypeError("invalid UTF-8 contract JSON"); }
}

function parseUniqueJson(text) {
  const value = JSON.parse(text);
  let offset = 0;
  const skipWhitespace = () => {
    while (/[ \t\r\n]/.test(text[offset] ?? "")) offset++;
  };
  const readString = () => {
    const start = offset++;
    while (offset < text.length) {
      if (text[offset] === "\\") offset += 2;
      else if (text[offset++] === '"') return JSON.parse(text.slice(start, offset));
    }
    throw new SyntaxError("unterminated JSON string");
  };
  const scanValue = () => {
    skipWhitespace();
    if (text[offset] === "{") {
      offset++;
      skipWhitespace();
      const keys = new Set();
      while (text[offset] !== "}") {
        const key = readString();
        if (keys.has(key)) throw new TypeError(`duplicate JSON key: ${key}`);
        keys.add(key);
        skipWhitespace();
        offset++;
        scanValue();
        if (text[offset] !== ",") break;
        offset++;
        skipWhitespace();
      }
      offset++;
    } else if (text[offset] === "[") {
      offset++;
      skipWhitespace();
      while (text[offset] !== "]") {
        scanValue();
        if (text[offset] !== ",") break;
        offset++;
      }
      offset++;
    } else if (text[offset] === '"') {
      readString();
    } else {
      while (offset < text.length && !/[,\]} \t\r\n]/.test(text[offset])) offset++;
    }
    skipWhitespace();
  };
  scanValue();
  return value;
}

function isContractSemver(value) {
  if (typeof value !== "string") return false;
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value);
  return !!match && (!match[4] || match[4].split(".").every(identifier =>
    !/^[0-9]+$/.test(identifier) || /^(0|[1-9][0-9]*)$/.test(identifier)));
}

export function contractSetProjection(registry) {
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) {
    throw new TypeError("invalid Contract Registry");
  }
  return Object.fromEntries(Object.entries(registry)
    .sort(([left], [right]) => Buffer.from(left).compare(Buffer.from(right)))
    .map(([familyId, contract]) => {
      if (contract?.familyId !== familyId || !isContractSemver(contract.semver)
          || !/^sha256:[0-9a-f]{64}$/.test(contract.schemaHash)
          || !["backward", "bidirectional", "exact"].includes(contract.compatibility)
          || contract.schemaHashAlgorithm !== "sha256-jcs"
          || !["schema", "spec", "producer", "consumer", "owner", "supportWindow"]
            .every(field => typeof contract[field] === "string" && contract[field].length > 0)
          || !Array.isArray(contract.fixtures) || contract.fixtures.length === 0
          || contract.fixtures.some(fixture => typeof fixture !== "string" || fixture.length === 0)
          || typeof contract.deprecated !== "boolean") {
        throw new TypeError(`invalid registered contract: ${familyId}`);
      }
      return [familyId, { semver: contract.semver, schemaHash: contract.schemaHash }];
    }));
}

export async function verifiedContractSet(root, registry, canonicalize) {
  const registryBytes = await readFile(path.join(root, "contracts/registry.json"));
  const registryText = decodeContractJson(registryBytes);
  const diskRegistry = parseUniqueJson(registryText);
  const canonicalRegistry = canonicalize(diskRegistry);
  if ((!registryBytes.equals(Buffer.from(canonicalRegistry))
      && !registryBytes.equals(Buffer.from(`${canonicalRegistry}\n`)))
      || canonicalize(registry) !== canonicalRegistry) {
    throw new TypeError("invalid canonical Contract Registry");
  }
  const projection = contractSetProjection(registry);
  for (const contract of Object.values(registry)) {
    const name = contract.schema;
    if (contract.schemaHashAlgorithm !== "sha256-jcs" || typeof name !== "string"
        || !name.startsWith("contracts/") || path.posix.normalize(name) !== name
        || name.includes("\\")) {
      throw new TypeError("invalid registered schema path or hash algorithm");
    }
    const schema = parseUniqueJson(decodeContractJson(await readFile(path.join(root, name))));
    const actual = `sha256:${createHash("sha256").update(canonicalize(schema)).digest("hex")}`;
    if (actual !== contract.schemaHash) {
      throw new TypeError("schema hash differs from registered schema bytes");
    }
  }
  return projection;
}
