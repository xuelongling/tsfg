// SPDX-License-Identifier: MIT

export const currentContractSetId =
  "sha256:bcab3518e1f4b83abc0cdf74a695e4c424406a291992f59f861f07dfbdab7b99";
export const currentContractSetCanonical =
  '{"tsfg.bytecode":{"schemaHash":"sha256:cd74db13611d560646a088766cad13e41bfabb2976cb6573cbe488cbcce4e975","semver":"0.5.0"},"tsfg.frontend-snapshot":{"schemaHash":"sha256:cd57a8d8ad7ccdb839f83c898cb4c5dc948a24349cda6444b32d5733d34e195f","semver":"0.5.0"},"tsfg.hir":{"schemaHash":"sha256:1b8563e6f89955a9f968e9db8d86440a35db6d3526447c1fd033a8fb62bf5c63","semver":"0.5.0"}}';

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
