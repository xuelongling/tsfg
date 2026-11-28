// SPDX-License-Identifier: MIT

export const currentContractSetId =
  "sha256:224753af186d4d73d11a1462ce51f16bd617222b109d3cf12cbcfe61d3151734";
export const currentContractSetCanonical =
  "{\"tsfg.abi\":{\"schemaHash\":\"sha256:78bc3b4af534c1b91d1d7f289ec9b19eb91b7a49d41c0acf86ac2bef63452ac9\",\"semver\":\"1.0.0\"},\"tsfg.bytecode\":{\"schemaHash\":\"sha256:fec456a47f509480d96f65e5c03d465c7c204d60f09630e71b19c714d4aaafa7\",\"semver\":\"0.12.0\"},\"tsfg.compiler-service\":{\"schemaHash\":\"sha256:2aa219677299b27634342572fc1a069ab0e482fb4e427ad20e186660445e3fc9\",\"semver\":\"1.0.0\"},\"tsfg.core-ir-exchange\":{\"schemaHash\":\"sha256:f62ad55e4b8879de91097bb1a4824f076e165d1278c9a0cf1f1cf0e668c19f5c\",\"semver\":\"1.0.0\"},\"tsfg.frontend-snapshot\":{\"schemaHash\":\"sha256:0e3c00251aee18dafe09074ce50634a2f8f5e3143a03afa91d24310f4f3cdcd9\",\"semver\":\"0.10.0\"},\"tsfg.hir\":{\"schemaHash\":\"sha256:bfc28b79c2e8ee7a66c3e12a963d939c6f4e209a38579ce437c18ca4745a57df\",\"semver\":\"0.13.0\"},\"tsfg.module-reload\":{\"schemaHash\":\"sha256:2c676acc011a37c3ab8576b93930f39aa0475c4c741a8c22c15d0f524d301b99\",\"semver\":\"1.0.0\"},\"tsfg.native-patch\":{\"schemaHash\":\"sha256:0afdd5b14a932fe2e66ed027b32bd21981212e0ec9a3bf9360173803960a9282\",\"semver\":\"1.0.0\"},\"tsfg.tmeta\":{\"schemaHash\":\"sha256:d4efb57e59cb42ca9f613707fb8c75e9a611022c86724843be25ff56d6dadb10\",\"semver\":\"1.0.0\"}}";

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
