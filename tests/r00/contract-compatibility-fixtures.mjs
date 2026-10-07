// SPDX-License-Identifier: MIT

export const currentContractSetId =
  "sha256:dd623a82d8704c446b1d1f4d955b4cba4a2b445df86cf7e2aacc5fb5a76cc957";
export const currentContractSetCanonical =
  "{\"tsfg.bytecode\":{\"schemaHash\":\"sha256:616360bef22c9c129df7b11392dc4e181797cf2f311ad62c56c701ec10ff716c\",\"semver\":\"0.8.0\"},\"tsfg.frontend-snapshot\":{\"schemaHash\":\"sha256:448e05accf1742ac0a644b85ac71210a77778fcbc7ccab47c3909d008439e7cf\",\"semver\":\"0.8.0\"},\"tsfg.hir\":{\"schemaHash\":\"sha256:137b93b252cd02acb0c6e70901640f0d4288bcc0818192b95f6ddc01e2cb8ac7\",\"semver\":\"0.8.0\"}}";

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
