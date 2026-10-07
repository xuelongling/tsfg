// SPDX-License-Identifier: MIT

export const currentContractSetId =
  "sha256:8b4add25dee53b3850021a4576464da22d8b1a67954c4b4592db15938043a3c1";
export const currentContractSetCanonical =
  '{"tsfg.bytecode":{"schemaHash":"sha256:d2cb324a10de4d0f3af422077644559a5cc2048f0d2abe9d5619b653a8e7c54c","semver":"0.7.0"},"tsfg.frontend-snapshot":{"schemaHash":"sha256:7ecd52a60570c2beb922441c193bafc8d645944a2b56566cc003436abb9d363f","semver":"0.7.0"},"tsfg.hir":{"schemaHash":"sha256:f078a7700789a9c8e83b37c97de1a12424a4dd97521d1bfb2d7cb05d99dfc5a1","semver":"0.7.0"}}';

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
