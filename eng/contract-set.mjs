// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export function contractSetProjection(registry) {
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) {
    throw new TypeError("invalid Contract Registry");
  }
  return Object.fromEntries(Object.entries(registry)
    .sort(([left], [right]) => Buffer.from(left).compare(Buffer.from(right)))
    .map(([familyId, contract]) => {
      if (contract?.familyId !== familyId || typeof contract.semver !== "string"
          || !/^sha256:[0-9a-f]{64}$/.test(contract.schemaHash)) {
        throw new TypeError(`invalid registered contract: ${familyId}`);
      }
      return [familyId, { semver: contract.semver, schemaHash: contract.schemaHash }];
    }));
}

export async function verifiedContractSet(root, registry, canonicalize) {
  const projection = contractSetProjection(registry);
  for (const contract of Object.values(registry)) {
    const name = contract.schema;
    if (contract.schemaHashAlgorithm !== "sha256-jcs" || typeof name !== "string"
        || !name.startsWith("contracts/") || path.posix.normalize(name) !== name
        || name.includes("\\")) {
      throw new TypeError("invalid registered schema path or hash algorithm");
    }
    const schema = JSON.parse(await readFile(path.join(root, name), "utf8"));
    const actual = `sha256:${createHash("sha256").update(canonicalize(schema)).digest("hex")}`;
    if (actual !== contract.schemaHash) {
      throw new TypeError("schema hash differs from registered schema bytes");
    }
  }
  return projection;
}
