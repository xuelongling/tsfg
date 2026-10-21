// SPDX-License-Identifier: MIT

export const currentContractSetId =
  "sha256:32fb9cff0f8b8df7e1745bd2adbe0710a77351e2ab82a787f5b02d53fee8aafe";
export const currentContractSetCanonical =
  "{\"tsfg.bytecode\":{\"schemaHash\":\"sha256:fec456a47f509480d96f65e5c03d465c7c204d60f09630e71b19c714d4aaafa7\",\"semver\":\"0.12.0\"},\"tsfg.frontend-snapshot\":{\"schemaHash\":\"sha256:0e16113521b89c5a04a1c92ce669cb3924ccb7db9616f977cd047622ad3724e7\",\"semver\":\"0.9.0\"},\"tsfg.hir\":{\"schemaHash\":\"sha256:09c18929e4c6acecd4eea93318c56ccddb7d66e693be311aec220e3c0fe7c073\",\"semver\":\"0.13.0\"}}";

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
