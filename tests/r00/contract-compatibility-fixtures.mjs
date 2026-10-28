// SPDX-License-Identifier: MIT

export const currentContractSetId =
  "sha256:7a797d28aad980e7a1d2dcc5ccff63933cf74a662a96c82c6acdc99b39bcc55e";
export const currentContractSetCanonical =
  "{\"tsfg.bytecode\":{\"schemaHash\":\"sha256:fec456a47f509480d96f65e5c03d465c7c204d60f09630e71b19c714d4aaafa7\",\"semver\":\"0.12.0\"},\"tsfg.frontend-snapshot\":{\"schemaHash\":\"sha256:0e3c00251aee18dafe09074ce50634a2f8f5e3143a03afa91d24310f4f3cdcd9\",\"semver\":\"0.10.0\"},\"tsfg.hir\":{\"schemaHash\":\"sha256:bfc28b79c2e8ee7a66c3e12a963d939c6f4e209a38579ce437c18ca4745a57df\",\"semver\":\"0.13.0\"}}";

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
