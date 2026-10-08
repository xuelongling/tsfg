// SPDX-License-Identifier: MIT

export const currentContractSetId =
  "sha256:2980adcb7f9987a84a96da166a7db7e802eaaa14556521577e39365e43a44d88";
export const currentContractSetCanonical =
  "{\"tsfg.bytecode\":{\"schemaHash\":\"sha256:6e1a281d385887750208b8ff69339e91407811128ce7ef3e68b43d3b0663c0b8\",\"semver\":\"0.10.0\"},\"tsfg.frontend-snapshot\":{\"schemaHash\":\"sha256:0e3c00251aee18dafe09074ce50634a2f8f5e3143a03afa91d24310f4f3cdcd9\",\"semver\":\"0.10.0\"},\"tsfg.hir\":{\"schemaHash\":\"sha256:0f230b5cb6c52c590e6b0b99fa9bacc117e0579efe16f03842d1f673845d9d9c\",\"semver\":\"0.10.0\"}}";

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
