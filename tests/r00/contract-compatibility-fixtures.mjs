// SPDX-License-Identifier: MIT

export const currentContractSetId =
  "sha256:174e41c05613744ac8c314817efc060dc846ee2d4162cdab1fb93b3fb9d448e8";
export const currentContractSetCanonical =
  "{\"tsfg.bytecode\":{\"schemaHash\":\"sha256:834206c45eaf6a1c47fa481970869e87c5badfa631af039576cb97e34fcac6ac\",\"semver\":\"0.10.0\"},\"tsfg.frontend-snapshot\":{\"schemaHash\":\"sha256:3cee34c021eac06814b03a4b057314326b01cde2510c860432aa318ada97ddaa\",\"semver\":\"0.8.0\"},\"tsfg.hir\":{\"schemaHash\":\"sha256:fe225e07d8445184ec49e3cce978c9df7b9be6db0ca64d6e45c63d5a5aaaf1bd\",\"semver\":\"0.11.0\"}}";

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
