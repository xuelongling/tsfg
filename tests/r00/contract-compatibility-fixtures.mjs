// SPDX-License-Identifier: MIT

export const currentContractSetId =
  "sha256:c9ea525b0ab6a94be58a2edf1c7170fb1a1685a3a1a6442cb54483f3604005fb";
export const currentContractSetCanonical =
  '{"tsfg.bytecode":{"schemaHash":"sha256:80745002f3315a96fd01679dd5d4a3052785dfb6acf8f4bdb56f7e040e1dfb72","semver":"0.3.0"},"tsfg.frontend-snapshot":{"schemaHash":"sha256:cd57a8d8ad7ccdb839f83c898cb4c5dc948a24349cda6444b32d5733d34e195f","semver":"0.5.0"},"tsfg.hir":{"schemaHash":"sha256:21ef98a799c31838948a456d665fc9fe914bfed108fd9fdd68717c5ba4a66005","semver":"0.3.0"}}';

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
