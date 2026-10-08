// SPDX-License-Identifier: MIT

export const currentContractSetId =
  "sha256:cd173befa39fd5418267577b77928c4b3ff8f704adb66dcd2effb6249562d892";
export const currentContractSetCanonical =
  "{\"tsfg.bytecode\":{\"schemaHash\":\"sha256:e847905d8da4932523997659c12526b5512fe0525b541b85ec8a60518d7c5942\",\"semver\":\"0.10.0\"},\"tsfg.frontend-snapshot\":{\"schemaHash\":\"sha256:a6a41896fdf0fd6acfb6f614bc4ec50d7e4593927814446a5f8ab994fbc4d1ec\",\"semver\":\"0.10.0\"},\"tsfg.hir\":{\"schemaHash\":\"sha256:764405409e01d9495d11876933e2b3e3c64fb65912c5168c740cde1b0d811cb7\",\"semver\":\"0.10.0\"}}";

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
