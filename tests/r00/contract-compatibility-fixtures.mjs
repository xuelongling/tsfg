// SPDX-License-Identifier: MIT

export const currentContractSetId =
  "sha256:dead632e671a49056c7e1e946a7b4d3731f4e7e94d6afc382769735fde9c975a";
export const currentContractSetCanonical =
  '{"tsfg.bytecode":{"schemaHash":"sha256:cd53e23d8b988f8ce86fcf0d72fcf6c59a308f6bf03de8f8bc0f27a458890954","semver":"0.1.0"},"tsfg.frontend-snapshot":{"schemaHash":"sha256:cd57a8d8ad7ccdb839f83c898cb4c5dc948a24349cda6444b32d5733d34e195f","semver":"0.5.0"},"tsfg.hir":{"schemaHash":"sha256:ec48d362c36c7741b87530af59638b62fa3804437f9de06f3a820d7e8bccbdf3","semver":"0.1.0"}}';

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
