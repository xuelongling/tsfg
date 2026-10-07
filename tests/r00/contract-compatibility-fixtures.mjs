// SPDX-License-Identifier: MIT

export const currentContractSetId =
  "sha256:5be1129c27b37ef5d0e3e78dc46af595bbb2ac48a64724da3866dcc8f3867882";
export const currentContractSetCanonical =
  "{\"tsfg.bytecode\":{\"schemaHash\":\"sha256:648d6b8b51724b8948e057902276141cce31d7e5465cbf67d83e1a98fb2769d4\",\"semver\":\"0.9.0\"},\"tsfg.frontend-snapshot\":{\"schemaHash\":\"sha256:6abeef10230a4815cbdc7f9daa9450367860eb46f5ef6a56eab01e7f54b4dca3\",\"semver\":\"0.9.0\"},\"tsfg.hir\":{\"schemaHash\":\"sha256:9b55251f0cd7d4080c65e79bd601842fcc85c1002aec3b25bbc301edd9d816a6\",\"semver\":\"0.9.0\"}}";

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
