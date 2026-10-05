// SPDX-License-Identifier: MIT

export const currentContractSetId =
  "sha256:88267a32049cce9d46568d281f9fc7e0c239531b6117964960aa58639858a00c";
export const currentContractSetCanonical =
  '{"tsfg.bytecode":{"schemaHash":"sha256:e034e1ae65ef513b19c440406a332605731e80326a95c8bbfe00bfd0651fcfd4","semver":"0.2.0"},"tsfg.frontend-snapshot":{"schemaHash":"sha256:cd57a8d8ad7ccdb839f83c898cb4c5dc948a24349cda6444b32d5733d34e195f","semver":"0.5.0"},"tsfg.hir":{"schemaHash":"sha256:b8eb2af3c5c50a41a61b7f8df9cc99a09fe52eca0cbd9648963a115b6acdbf38","semver":"0.2.0"}}';

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
