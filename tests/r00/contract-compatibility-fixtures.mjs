// SPDX-License-Identifier: MIT

export const currentContractSetId =
  "sha256:040267882bc16ab2e1e4849212b042728831cdb8d7b4e45ac9d0d214570173df";
export const currentContractSetCanonical =
  '{"tsfg.bytecode":{"schemaHash":"sha256:2119acbdab7a604f5947b765f607d596d534f11fb88d81770e7230011f3de13b","semver":"0.6.0"},"tsfg.frontend-snapshot":{"schemaHash":"sha256:969c8c5101b6f00f8da8bfff0157a7d27b908603dc6277d988ccbcdbcd07d968","semver":"0.6.0"},"tsfg.hir":{"schemaHash":"sha256:416f59c1c87fc1f0eac6baa1b2ef4ee3da3a13de0e766deba105783137747aa1","semver":"0.6.0"}}';

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
