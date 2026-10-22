// SPDX-License-Identifier: MIT
import path from "node:path";
import { verifiedContractSet } from "./contract-set.mjs";
import { canonicalize, digest, digestFile, readCanonicalJson } from "./build-data.mjs";
import { CompatibilityFailureError, TestFailureError } from "./build-errors.mjs";

const SYNTHETIC_CHANGE_SEMANTICS = Object.freeze({
  "breaking": "changed",
  "compatible-extension": "changed",
  "editorial": "unchanged",
  "exact-change": "changed",
  "unchanged": "unchanged",
});

function validateSyntheticArtifact(artifact, label, contractSetId) {
  const requiredFields = artifact?.consumer?.requiredFields;
  const optionalFields = artifact?.consumer?.optionalFields;
  const fields = [...(requiredFields ?? []), ...(optionalFields ?? [])];
  const changeClass = artifact?.contract?.change?.class;
  const validChangeClass = label === "baseline"
    ? changeClass === "baseline"
    : Object.hasOwn(SYNTHETIC_CHANGE_SEMANTICS, changeClass);
  if (
    artifact?.schemaVersion !== "1" ||
    artifact.artifactKind !== "r00-synthetic-contract-artifact" ||
    artifact.product?.contractSetId !== contractSetId ||
    !/^[0-9a-f]{40}$/.test(artifact.product?.commitOid) ||
    !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/.test(
      artifact.product?.semver,
    ) ||
    typeof artifact.contract?.familyId !== "string" ||
    artifact.contract.familyId.length === 0 ||
    !["backward", "bidirectional", "exact"].includes(artifact.contract?.compatibility) ||
    !/^sha256:[0-9a-f]{64}$/.test(artifact.contract?.schemaHash) ||
    typeof artifact.contract?.semanticRevision !== "string" ||
    artifact.contract.semanticRevision.length === 0 ||
    !parseSyntheticContractSemver(artifact.contract?.semver) ||
    !validChangeClass ||
    artifact.producer?.payload === null ||
    typeof artifact.producer?.payload !== "object" ||
    Array.isArray(artifact.producer.payload) ||
    !Array.isArray(requiredFields) ||
    !Array.isArray(optionalFields) ||
    fields.some((field) => typeof field !== "string" || field.length === 0) ||
    new Set(fields).size !== fields.length ||
    typeof artifact.consumer.acceptsUnknownFields !== "boolean"
  ) {
    throw new TestFailureError(
      `${label} synthetic compatibility artifact is invalid`,
      "invalid-synthetic-artifact",
    );
  }
}

function consumeSyntheticPayload(producer, consumer) {
  if (
    consumer.contract.compatibility === "exact" &&
    (
      producer.contract.semver !== consumer.contract.semver ||
      producer.contract.schemaHash !== consumer.contract.schemaHash ||
      producer.contract.semanticRevision !== consumer.contract.semanticRevision
    )
  ) {
    return {
      code: "exact-match-version-mixed",
      message: "exact-match synthetic contract versions cannot be mixed",
    };
  }
  const payload = producer.producer.payload;
  const required = new Set(consumer.consumer.requiredFields);
  const allowed = new Set([
    ...consumer.consumer.requiredFields,
    ...consumer.consumer.optionalFields,
  ]);
  const missing = [...required].filter((field) => !Object.hasOwn(payload, field));
  const unknown = Object.keys(payload).filter((field) => !allowed.has(field));
  if (missing.length > 0) {
    return {
      code: "serialized-payload-incompatible",
      message: `missing required fields: ${missing.join(", ")}`,
    };
  }
  if (!consumer.consumer.acceptsUnknownFields && unknown.length > 0) {
    return {
      code: "serialized-payload-incompatible",
      message: `unknown fields: ${unknown.join(", ")}`,
    };
  }
  return undefined;
}

function parseSyntheticContractSemver(value) {
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(value);
  if (!match) return undefined;
  return match.slice(1).map((part) => Number.parseInt(part, 10));
}

function hasCompleteSyntheticMigrationWindow(
  change,
  baselineProductSemver,
  candidateProductSemver,
) {
  const phases = change?.migration?.phases;
  const stableProductMinors = change?.migration?.stableProductMinors;
  if (
    canonicalize(phases) !== canonicalize(["expand", "migrate", "remove"]) ||
    !Array.isArray(stableProductMinors) ||
    stableProductMinors.length !== 3
  ) {
    return false;
  }
  const parsed = stableProductMinors.map((minor) =>
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(minor),
  );
  return parsed.every(Boolean) &&
    parsed.every((minor) => minor[1] === parsed[0][1]) &&
    Number.parseInt(parsed[1][2], 10) === Number.parseInt(parsed[0][2], 10) + 1 &&
    Number.parseInt(parsed[2][2], 10) === Number.parseInt(parsed[1][2], 10) + 1 &&
    baselineProductSemver === `${parsed[0][1]}.${parsed[0][2]}.0` &&
    candidateProductSemver === `${parsed[2][1]}.${parsed[2][2]}.0`;
}

function hasValidBreakingContractBump(baselineSemver, candidateSemver) {
  const baseline = parseSyntheticContractSemver(baselineSemver);
  const candidate = parseSyntheticContractSemver(candidateSemver);
  if (!baseline || !candidate || candidate[2] !== 0) return false;
  return baseline[0] === 0
    ? candidate[0] === 0 && candidate[1] > baseline[1]
    : candidate[0] > baseline[0] && candidate[1] === 0;
}

function syntheticVersionGateIssue(baseline, candidate, semanticChange) {
  if (semanticChange && baseline.contract.semver === candidate.contract.semver) {
    return {
      code: "contract-version-not-bumped",
      message: "synthetic contract semantics or Schema Hash changed without a Contract SemVer bump",
    };
  }
  const baselineVersion = parseSyntheticContractSemver(baseline.contract.semver);
  const candidateVersion = parseSyntheticContractSemver(candidate.contract.semver);
  const patchBump = candidateVersion[0] === baselineVersion[0] &&
    candidateVersion[1] === baselineVersion[1] &&
    candidateVersion[2] > baselineVersion[2];
  const minorBump = candidateVersion[0] === baselineVersion[0] &&
    candidateVersion[1] > baselineVersion[1] &&
    candidateVersion[2] === 0;
  const versionIncreased = candidateVersion[0] > baselineVersion[0] ||
    (candidateVersion[0] === baselineVersion[0] && candidateVersion[1] > baselineVersion[1]) ||
    (candidateVersion[0] === baselineVersion[0] &&
      candidateVersion[1] === baselineVersion[1] &&
      candidateVersion[2] > baselineVersion[2]);
  const gates = {
    breaking: () =>
      hasValidBreakingContractBump(baseline.contract.semver, candidate.contract.semver) &&
      hasCompleteSyntheticMigrationWindow(
        candidate.contract.change,
        baseline.product.semver,
        candidate.product.semver,
      )
        ? undefined
        : {
            code: "breaking-migration-window-incomplete",
            message: "breaking synthetic change requires a complete expand-migrate-remove window bound to baseline and candidate stable Product SemVer",
          },
    "compatible-extension": () => minorBump
      ? undefined
      : {
          code: "compatible-extension-requires-minor",
          message: "backward-compatible synthetic extension requires a Contract SemVer minor bump",
        },
    editorial: () => patchBump
      ? undefined
      : {
          code: "editorial-change-requires-patch",
          message: "editorial synthetic change requires a Contract SemVer patch bump",
        },
    "exact-change": () => versionIncreased
      ? undefined
      : {
          code: "exact-change-requires-version-bump",
          message: "exact-match synthetic change requires a Contract SemVer bump",
        },
    unchanged: () => candidate.contract.semver === baseline.contract.semver
      ? undefined
      : {
          code: "unchanged-contract-version-changed",
          message: "unchanged synthetic contract cannot change Contract SemVer",
        },
  };
  return gates[candidate.contract.change.class]();
}

export async function testCompatibility(options, workspaceState, networkCanary) {
  const baselinePath = path.resolve(options.get("--compatibility-baseline"));
  const candidatePath = path.resolve(options.get("--compatibility-candidate"));
  let registry;
  let baseline;
  let candidate;
  try {
    registry = await readCanonicalJson(
      path.join(workspaceState.root, "contracts", "registry.json"),
      "Contract Registry",
    );
    baseline = await readCanonicalJson(
      baselinePath,
      "baseline synthetic compatibility artifact",
    );
    candidate = await readCanonicalJson(
      candidatePath,
      "candidate synthetic compatibility artifact",
    );
  } catch (error) {
    throw new TestFailureError(error.message);
  }
  let canonicalContractSet;
  try { canonicalContractSet = canonicalize(await verifiedContractSet(workspaceState.root, registry, canonicalize)); }
  catch (error) { throw new TestFailureError(error.message); }
  const contractSetId = digest(canonicalContractSet);
  validateSyntheticArtifact(baseline, "baseline", contractSetId);
  validateSyntheticArtifact(candidate, "candidate", contractSetId);
  const semanticChange = baseline.contract.schemaHash !== candidate.contract.schemaHash ||
    baseline.contract.semanticRevision !== candidate.contract.semanticRevision;
  const expectedSemanticChange = SYNTHETIC_CHANGE_SEMANTICS[candidate.contract.change.class];
  if (
    baseline.contract.familyId !== candidate.contract.familyId ||
    baseline.contract.compatibility !== candidate.contract.compatibility ||
    candidate.contract.change.fromSemver !== baseline.contract.semver ||
    (expectedSemanticChange === "changed") !== semanticChange ||
    (candidate.contract.compatibility === "exact" &&
      semanticChange && candidate.contract.change.class !== "exact-change") ||
    (candidate.contract.change.class === "exact-change" &&
      candidate.contract.compatibility !== "exact")
  ) {
    throw new TestFailureError(
      "baseline and candidate synthetic compatibility metadata is inconsistent",
      "invalid-synthetic-artifact",
    );
  }

  const artifacts = { baseline, candidate };
  const combinations = [];
  for (const [producerName, consumerName] of [
    ["baseline", "baseline"],
    ["candidate", "baseline"],
    ["baseline", "candidate"],
    ["candidate", "candidate"],
  ]) {
    const producer = artifacts[producerName];
    const consumer = artifacts[consumerName];
    const issue = consumeSyntheticPayload(producer, consumer);
    combinations.push({
      consumer: consumerName,
      consumerProductOid: consumer.product.commitOid,
      exchange: "serialized-payload",
      ...(issue ? { issue: issue.message, issueCode: issue.code } : {}),
      producer: producerName,
      producerProductOid: producer.product.commitOid,
      status: issue ? "failed" : "passed",
    });
  }
  const versionGateIssue = syntheticVersionGateIssue(baseline, candidate, semanticChange);
  const gateIssues = versionGateIssue ? [versionGateIssue] : [];
  const compatibility = {
    artifacts: {
      baseline: {
        productOid: baseline.product.commitOid,
        productSemver: baseline.product.semver,
        sha256: await digestFile(baselinePath),
        syntheticContractSemver: baseline.contract.semver,
      },
      candidate: {
        productOid: candidate.product.commitOid,
        productSemver: candidate.product.semver,
        sha256: await digestFile(candidatePath),
        syntheticContractSemver: candidate.contract.semver,
      },
    },
    artifactTransport: "serialized-json-only",
    combinations,
    gate: {
      issues: gateIssues,
      status: gateIssues.length > 0 ? "failed" : "passed",
    },
    syntheticFamilyRegistered: false,
  };
  const failedCombination = combinations.find(({ status }) => status === "failed");
  const firstIssue = gateIssues[0];
  if (firstIssue || failedCombination) {
    throw new CompatibilityFailureError(
      firstIssue?.code ?? failedCombination.issueCode,
      firstIssue?.message ?? failedCombination.issue,
      compatibility,
    );
  }
  return {
    compatibility,
    contractSet: { canonical: canonicalContractSet, id: contractSetId },
    development: workspaceState.development,
    dirty: workspaceState.dirty,
    networkCanary,
    publishable: workspaceState.publishable,
    target: options.get("--target"),
  };
}
