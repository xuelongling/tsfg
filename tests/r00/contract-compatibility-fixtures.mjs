// SPDX-License-Identifier: MIT

export const currentContractSetId =
  "sha256:5be1129c27b37ef5d0e3e78dc46af595bbb2ac48a64724da3866dcc8f3867882";
export const currentContractSetCanonical =
  "{\"tsfg.bytecode\":{\"schemaHash\":\"sha256:950f0b3756aed6c0fc48516c4ce09e5943672c48bffb29f2ee01c5259c212d66\",\"semver\":\"0.9.0\"},\"tsfg.frontend-snapshot\":{\"schemaHash\":\"sha256:b423bbc6e9b1e3ab4a2c5957e5dcaa0fd1381ce63893fa3da95cfd8390b079c2\",\"semver\":\"0.9.0\"},\"tsfg.hir\":{\"schemaHash\":\"sha256:e1c2cd004f9f6b8ab91bd86d367e4cd9b9bcdb2d9299e4da406bdaed15f93a5a\",\"semver\":\"0.9.0\"}}";

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
