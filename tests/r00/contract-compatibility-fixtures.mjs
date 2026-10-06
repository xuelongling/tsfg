// SPDX-License-Identifier: MIT

export const currentContractSetId =
  "sha256:32ee643ff616666e1a3c305459b3648edee9a83255e157f14aefc58e1421cd93";
export const currentContractSetCanonical =
  '{"tsfg.bytecode":{"schemaHash":"sha256:cd7152bad3cdcb1f307adb550b8b4dc58334df38b7e690b942fa81e5b99374a7","semver":"0.4.0"},"tsfg.frontend-snapshot":{"schemaHash":"sha256:cd57a8d8ad7ccdb839f83c898cb4c5dc948a24349cda6444b32d5733d34e195f","semver":"0.5.0"},"tsfg.hir":{"schemaHash":"sha256:bbd596cdcc28d94a5bdc91651c1c240f4143af44060597d3ad53c720f3326b8b","semver":"0.4.0"}}';

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
