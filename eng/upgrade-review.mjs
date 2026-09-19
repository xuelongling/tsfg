// SPDX-License-Identifier: MIT

import path from "node:path";
import { createIntakeLedger, IntakeLedgerError } from "./intake-ledger.mjs";
import { assessVulnerabilities } from "./vulnerability-admission.mjs";

const reject = message => { throw new IntakeLedgerError("upgrade-review", message); };
const exactOid = value => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
const categories = ["semantics", "diagnostics", "license", "generation", "reproducibility", "jsIsolation", "performance"];
const note = value => typeof value === "string" && value.trim().length > 0 && !/[\x00-\x1f\x7f]/.test(value);
const shape = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).sort().join(",") === keys.split(",").sort().join(",");

function inspectEvidence(snapshot, forkOid, reasons, label, reviewInputsSha256) {
  const result = {};
  for (const category of categories) {
    const supplied = snapshot.evidence?.[category];
    const required = category !== "performance" || snapshot.performanceClaim !== null;
    const status = supplied?.status ?? "missing";
    const valid = supplied && ["passed", "failed", "not-run", "not-applicable", "missing"].includes(status) &&
      note(supplied.reason) && note(supplied.reference) && supplied.subject?.forkOid === forkOid &&
      supplied.subject?.manifestRevision === snapshot.manifestRevision && supplied.subject?.reviewInputsSha256 === reviewInputsSha256;
    result[category] = supplied ?? { status: "missing" };
    if (!valid || (required ? status !== "passed" : status !== "not-applicable")) reasons.push(`${label}.${category}: ${valid ? status : "missing or invalid bound evidence"}`);
  }
  return result;
}

/** Given results exercise governance only; this producer never authorizes real intake or promotion. */
export async function reviewUpgrade({ plan, git: inspectGit, parseManifest, canonicalize, digest, gitExecutable, approvedLicenses }) {
  const git = (root, args) => inspectGit(root, ["--no-replace-objects", ...args]);
  if (plan?.schemaVersion !== "1" || plan.evidenceKind !== "governance-fixture" || !["review", "rollback"].includes(plan.action)) reject("expected a version 1 governance-fixture review or rollback");
  if (!shape(plan, `schemaVersion,evidenceKind,action,projectId,manifestRepository,accepted,candidate,mergeOid${plan.action === "rollback" ? ",rollback" : ""}${Object.hasOwn(plan, "risks") ? ",risks" : ""}`) ||
      typeof plan.manifestRepository !== "string" || !path.isAbsolute(plan.manifestRepository)) reject("invalid review plan or manifest repository");
  if (git(plan.manifestRepository, ["remote", "get-url", "origin"]).trim() !== "https://github.com/xuelongling/manifests.git") reject("unexpected manifest remote");
  const combinations = {};
  for (const name of ["accepted", "candidate"]) {
    const snapshot = plan[name];
    if (!shape(snapshot, "workspaceRoot,manifestRevision,manifest,declaration,consumption,languageBaseline,engineeringContract,generationDependencies,performanceClaim,evidence") ||
        !note(snapshot.languageBaseline) || !note(snapshot.engineeringContract) || !Array.isArray(snapshot.generationDependencies) ||
        typeof snapshot.workspaceRoot !== "string" || !exactOid(snapshot.manifestRevision) || !/^candidates\/tsfg-v\d+\.\d+\.\d+\.xml$/.test(snapshot.manifest) ||
        !path.isAbsolute(snapshot.workspaceRoot) || snapshot.declaration?.evidenceKind !== "fixture" || snapshot.consumption?.evidenceKind !== "fixture") reject("invalid fixture combination");
    const xml = git(plan.manifestRepository, ["show", `${snapshot.manifestRevision}:${snapshot.manifest}`]);
    const admission = JSON.parse(git(plan.manifestRepository, ["show", `${snapshot.manifestRevision}:${snapshot.manifest}.sources.json`]));
    const projects = parseManifest(xml);
    const product = projects.find(p => p.id === "tsfg.git");
    if (!product || product.path !== "tsfg" || projects.length !== admission.sources.length + 2 || !projects.some(p => p.id === ".agents.git")) reject("incomplete integration project set");
    const committedApproval = JSON.parse(git(path.join(snapshot.workspaceRoot, "tsfg"), ["show", `${product.revision}:eng/source-admissions.json`]));
    if (canonicalize(committedApproval) !== canonicalize(admission)) reject("product and manifest source approvals disagree");
    for (const source of admission.sources) {
      const project = projects.find(p => p.id === source.projectId);
      if (!project || project.path !== source.path || project.revision !== source.forkOid || project.remoteUrl !== source.remoteUrl || project.branch !== source.branch) reject("manifest and source identities disagree");
    }
    const source = admission.sources.find(s => s.projectId === plan.projectId);
    if (!source) reject("upgrade source is not admitted in combination");
    const ledger = await createIntakeLedger({ workspaceRoot: snapshot.workspaceRoot, admission, declaration: snapshot.declaration,
      consumption: snapshot.consumption, gitExecutable, approvedLicenses });
    combinations[name] = { source, ledger, projects, admission, integration: { repository: "https://github.com/xuelongling/manifests.git", revision: snapshot.manifestRevision,
      manifest: snapshot.manifest, manifestSha256: digest(Buffer.from(xml)) } };
  }
  const accepted = combinations.accepted, candidate = combinations.candidate;
  git(plan.manifestRepository, ["merge-base", "--is-ancestor", plan.accepted.manifestRevision, plan.candidate.manifestRevision]);
  for (const suffix of ["", ".sources.json"]) {
    const file = `${plan.accepted.manifest}${suffix}`;
    if (git(plan.manifestRepository, ["show", `${plan.accepted.manifestRevision}:${file}`]) !==
        git(plan.manifestRepository, ["show", `${plan.candidate.manifestRevision}:${file}`])) reject("candidate must preserve the accepted combination");
  }
  const sourceRoot = path.join(plan.candidate.workspaceRoot, candidate.source.path);
  if (!exactOid(plan.mergeOid)) reject("merge identity must be a complete commit OID");
  const parents = git(sourceRoot, ["rev-list", "--parents", "-n", "1", plan.mergeOid]).trim().split(" ");
  if (parents.length !== 3 || parents[1] !== accepted.source.forkOid || parents[2] !== candidate.source.baseOid) reject("candidate must merge the exact upstream OID from the accepted fork");
  git(sourceRoot, ["merge-base", "--is-ancestor", plan.mergeOid, candidate.source.forkOid]);
  git(sourceRoot, ["merge-base", "--is-ancestor", accepted.source.baseOid, candidate.source.baseOid]);
  const diff = (from, to) => {
    const patch = git(sourceRoot, ["diff", "--no-ext-diff", "--no-textconv", "--binary", from, to, "--"]);
    return { from, to, patch, sha256: digest(Buffer.from(patch)) };
  };
  const rejectionReasons = { accepted: [], candidate: [] };
  for (const name of ["accepted", "candidate"]) {
    const snapshot = plan[name];
    const reasons = rejectionReasons[name];
    if (!note(snapshot.languageBaseline) || !note(snapshot.engineeringContract)) reasons.push(`${name}: missing fixed language or engineering commitment`);
    if (!(snapshot.performanceClaim === null || (note(snapshot.performanceClaim?.description) && note(snapshot.performanceClaim?.criterion)))) reasons.push(`${name}: invalid performance claim`);
    if (!Array.isArray(snapshot.generationDependencies) || snapshot.generationDependencies.some(dependency =>
      !combinations[name].ledger.files.some(file => file.projectId === dependency?.projectId && file.path === dependency?.path && file.sha256 === dependency?.sha256))) {
      reasons.push(`${name}: generation dependency is not bound to the Intake Ledger`);
    }
  }
  if (plan.accepted.languageBaseline !== plan.candidate.languageBaseline) rejectionReasons.candidate.push("language baseline cannot change in an upgrade review");
  if (plan.accepted.engineeringContract !== plan.candidate.engineeringContract) rejectionReasons.candidate.push("engineering commitments cannot change in an upgrade review");
  const reviewInputs = Object.fromEntries(["accepted", "candidate"].map(name => [name, digest(Buffer.from(canonicalize(
    Object.fromEntries(["declaration", "consumption", "languageBaseline", "engineeringContract", "generationDependencies", "performanceClaim"].map(key => [key, plan[name][key]]))
  )))]));
  const evidence = { accepted: inspectEvidence(plan.accepted, accepted.source.forkOid, rejectionReasons.accepted, "accepted", reviewInputs.accepted),
    candidate: inspectEvidence(plan.candidate, candidate.source.forkOid, rejectionReasons.candidate, "candidate", reviewInputs.candidate) };
  const risks = Object.fromEntries(["accepted", "candidate"].map(name => [name,
    plan.risks ? assessVulnerabilities({ review: plan.risks, ledger: combinations[name].ledger,
      integration: combinations[name].integration, reviewInputsSha256: reviewInputs[name],
      contentDigest: value => digest(Buffer.from(canonicalize(value))),
      authorizationIntegration: name === "accepted" && plan.action === "rollback"
        ? { revision: plan.rollback?.manifestRevision, manifest: plan.rollback?.manifest } : combinations[name].integration })
      : { decision: "pending-verification", evidenceKind: "fixture", records: [], reason: "risk assessment missing" }]));
  const riskReasons = Object.fromEntries(["accepted", "candidate"].map(name => [name,
    risks[name].decision === "continue" ? [] : [`${name}.risks: ${risks[name].decision}`]]));
  const reasons = [...rejectionReasons.accepted, ...rejectionReasons.candidate];
  let rollback = null;
  if (plan.action === "rollback") {
    const record = plan.rollback;
    if (!record || !exactOid(record.manifestRevision) || !/^candidates\/tsfg-v\d+\.\d+\.\d+\.xml$/.test(record.manifest) || !note(record.reason)) reject("invalid rollback combination");
    git(plan.manifestRepository, ["merge-base", "--is-ancestor", plan.candidate.manifestRevision, record.manifestRevision]);
    const previousPaths = git(plan.manifestRepository, ["ls-tree", "-r", "--name-only", plan.candidate.manifestRevision]).trim().split("\n");
    if (previousPaths.includes(record.manifest) || previousPaths.includes(`${record.manifest}.sources.json`)) reject("rollback must append a new combination name");
    for (const file of previousPaths.filter(name => /^(bootstrap|snapshots|candidates)\//.test(name))) {
      if (git(plan.manifestRepository, ["show", `${plan.candidate.manifestRevision}:${file}`]) !== git(plan.manifestRepository, ["show", `${record.manifestRevision}:${file}`])) reject("rollback must preserve previous combinations");
    }
    const xml = git(plan.manifestRepository, ["show", `${record.manifestRevision}:${record.manifest}`]);
    const projects = parseManifest(xml);
    const approval = JSON.parse(git(plan.manifestRepository, ["show", `${record.manifestRevision}:${record.manifest}.sources.json`]));
    if (canonicalize(projects) !== canonicalize(accepted.projects) || canonicalize(approval) !== canonicalize(accepted.admission)) reject("rollback must point to the exact verified accepted combination");
    rollback = { repository: "https://github.com/xuelongling/manifests.git", revision: record.manifestRevision,
      manifest: record.manifest, manifestSha256: digest(Buffer.from(xml)), reason: record.reason, projects, target: accepted.integration };
  }
  const candidateDecision = reasons.length || riskReasons.candidate.length ? "rejected" : "admitted-fixture";
  reasons.push(...riskReasons.candidate, ...(rollback ? riskReasons.accepted : []));
  const decision = rollback ? (rejectionReasons.accepted.length || riskReasons.accepted.length ? "rejected" : "rollback-fixture") : candidateDecision;
  return { schemaVersion: "2", evidenceKind: "governance-fixture", operation: "upgrade-review", decision, candidateDecision, rollback, reasons, evidence, reviewInputs, risks,
    intakeComplete: false, promotionState: "Candidate", executionMode: "local-development", isolation: "not-enforced",
    integrations: { accepted: accepted.integration, candidate: candidate.integration },
    sources: { accepted: accepted.source, candidate: candidate.source },
    baseline: Object.fromEntries(["accepted", "candidate"].map(name => [name, { language: plan[name].languageBaseline, engineeringContract: plan[name].engineeringContract }])),
    consumptionDependencies: Object.fromEntries(["accepted", "candidate"].map(name => [name, combinations[name].ledger.files.map(file => ({ projectId: file.projectId, path: file.path, sha256: file.sha256, role: file.role, consumer: file.consumer }))])),
    generationDependencies: { accepted: plan.accepted.generationDependencies, candidate: plan.candidate.generationDependencies },
    licensesAndNotices: Object.fromEntries(["accepted", "candidate"].map(name => [name, combinations[name].ledger.sources.map(source => ({ projectId: source.projectId, license: source.license, legal: source.legal }))])),
    performance: Object.fromEntries(["accepted", "candidate"].map(name => [name, { claim: plan[name].performanceClaim, evidence: evidence[name].performance }])),
    affectedConsumers: [...new Set([...accepted.ledger.files, ...candidate.ledger.files].map(file => file.consumer))].sort(),
    ledgers: { accepted: accepted.ledger, candidate: candidate.ledger },
    diff: diff(accepted.source.forkOid, candidate.source.forkOid),
    localModifications: { accepted: diff(accepted.source.baseOid, accepted.source.forkOid), candidate: diff(candidate.source.baseOid, candidate.source.forkOid) },
    replay: { plan, mergeOid: plan.mergeOid }, evidenceRetentionDays: "90", stablePromotion: "requires-existing-owner-process" };
}
