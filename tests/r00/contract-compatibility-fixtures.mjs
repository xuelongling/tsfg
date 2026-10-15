// SPDX-License-Identifier: MIT

export const currentContractSetId =
  "sha256:cf2c555316b69cb06f56d81ce2cde73b5529be7545e1c9bad05890288b7fa007";
export const currentContractSetCanonical =
  "{\"tsfg.bytecode\":{\"schemaHash\":\"sha256:5e080a9472ede4ee7c15de242c00999ac63a65534dfb489afabdf020a442fdc6\",\"semver\":\"0.8.0\"},\"tsfg.frontend-snapshot\":{\"schemaHash\":\"sha256:3cee34c021eac06814b03a4b057314326b01cde2510c860432aa318ada97ddaa\",\"semver\":\"0.8.0\"},\"tsfg.hir\":{\"schemaHash\":\"sha256:cab2bb75a73ee5a7dd9889b7e43ed82b9544ff8ad4e138b2f684281efc9acd14\",\"semver\":\"0.8.0\"}}";

/** @returns {Record<string, any>} */
export function baselineSyntheticArtifact() {
  return {
    artifactKind: "r00-synthetic-contract-artifact",
    consumer: {
      acceptsUnknownFields: true,
      optionalFields: [],
      requiredFields: ["id"],
    },
    contract: {
      change: { class: "baseline" },
      compatibility: "bidirectional",
      familyId: "r00.synthetic.compatibility",
      schemaHash: `sha256:${"a".repeat(64)}`,
      semanticRevision: "baseline",
      semver: "0.1.0",
    },
    producer: { payload: { id: "baseline" } },
    product: {
      commitOid: "1".repeat(40),
      contractSetId: currentContractSetId,
      semver: "0.1.0-dev.0",
    },
    schemaVersion: "1",
  };
}

/** @returns {Record<string, any>} */
export function candidateSyntheticArtifact() {
  return {
    artifactKind: "r00-synthetic-contract-artifact",
    consumer: {
      acceptsUnknownFields: true,
      optionalFields: ["label"],
      requiredFields: ["id"],
    },
    contract: {
      change: { class: "compatible-extension", fromSemver: "0.1.0" },
      compatibility: "bidirectional",
      familyId: "r00.synthetic.compatibility",
      schemaHash: `sha256:${"b".repeat(64)}`,
      semanticRevision: "candidate-extension",
      semver: "0.2.0",
    },
    producer: { payload: { id: "candidate", label: "optional" } },
    product: {
      commitOid: "2".repeat(40),
      contractSetId: currentContractSetId,
      semver: "0.1.0-dev.0",
    },
    schemaVersion: "1",
  };
}
