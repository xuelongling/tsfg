// SPDX-License-Identifier: MIT

export function contractSetProjection(registry) {
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) {
    throw new TypeError("invalid Contract Registry");
  }
  return Object.fromEntries(Object.entries(registry)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([familyId, contract]) => {
      if (contract?.familyId !== familyId || typeof contract.semver !== "string"
          || !/^sha256:[0-9a-f]{64}$/.test(contract.schemaHash)) {
        throw new TypeError(`invalid registered contract: ${familyId}`);
      }
      return [familyId, { semver: contract.semver, schemaHash: contract.schemaHash }];
    }));
}
