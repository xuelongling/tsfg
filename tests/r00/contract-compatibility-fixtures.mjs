// SPDX-License-Identifier: MIT

export const currentContractSetId =
  "sha256:10f208699b0dc9dad62a7c7aae500b9cf6d4e1f6d989e480a9024eec5cea4b84";
export const currentContractSetCanonical =
  "{\"tsfg.bytecode\":{\"schemaHash\":\"sha256:950f0b3756aed6c0fc48516c4ce09e5943672c48bffb29f2ee01c5259c212d66\",\"semver\":\"0.9.0\"},\"tsfg.frontend-snapshot\":{\"schemaHash\":\"sha256:257ab47d8b9df5cca073ff194ff632a6c27b44e5a7bd64bafc03c78baa818353\",\"semver\":\"0.9.0\"},\"tsfg.hir\":{\"schemaHash\":\"sha256:541d716b3341cfbe3ff5c08d895fc6fd1b7b753806b3fb923cd95e1ab76d9cc8\",\"semver\":\"0.9.0\"}}";

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
