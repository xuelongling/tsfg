// SPDX-License-Identifier: MIT

export const currentContractSetId =
  "sha256:e28184239b558e60c3b145309362f7bdc9d3f64744e0eeb40c518b7d2b897fb4";
export const currentContractSetCanonical =
  "{\"tsfg.bytecode\":{\"schemaHash\":\"sha256:6e1a281d385887750208b8ff69339e91407811128ce7ef3e68b43d3b0663c0b8\",\"semver\":\"0.10.0\"},\"tsfg.frontend-snapshot\":{\"schemaHash\":\"sha256:74ec5ecd26d77023bc861dd3f0f10cf176e64deaf09a75f0387a92812c76c9f8\",\"semver\":\"0.10.0\"},\"tsfg.hir\":{\"schemaHash\":\"sha256:28de654db055215675ed5d514261fb3ef454d9556a7d7557739b5f8ace1d8340\",\"semver\":\"0.10.0\"}}";

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
