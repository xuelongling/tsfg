// SPDX-License-Identifier: MIT

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const manifestRepository = "https://github.com/xuelongling/manifests.git";
const completeOid = /^[0-9a-f]{40}$/;
const requiredJobs = [
  "candidate-identity",
  "repository-gates",
  "workspace-verification",
  "product-build",
  "compatibility",
  "reproducibility",
  "candidate-evidence",
];
let injectedCandidateIdentityRenameFailure = false;

class ProductPrError extends Error {}

function parseOptions(arguments_, allowed) {
  const options = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!allowed.has(name) || value === undefined || value === "" || options.has(name)) {
      throw new ProductPrError(`invalid option: ${name ?? "<missing>"}`);
    }
    options.set(name, value);
  }
  return options;
}

function requireOption(options, name) {
  const value = options.get(name);
  if (!value) throw new ProductPrError(`missing required option: ${name}`);
  return value;
}

function requireOid(value, label) {
  if (!completeOid.test(value)) {
    throw new ProductPrError(`${label} must be a complete lowercase commit OID`);
  }
  return value;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`);
}

function canonicalJsonBytes(value) {
  return Buffer.from(canonicalize(value));
}

function hasLoneSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) return true;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function canonicalize(value) {
  if (typeof value === "string") {
    if (hasLoneSurrogate(value)) {
      throw new ProductPrError("candidate evidence contains a non-I-JSON string");
    }
    return JSON.stringify(value);
  }
  if (value === null || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => {
      if (hasLoneSurrogate(key)) {
        throw new ProductPrError("candidate evidence contains a non-I-JSON key");
      }
      return `${JSON.stringify(key)}:${canonicalize(value[key])}`;
    }).join(",")}}`;
  }
  throw new ProductPrError("candidate evidence contains a non-I-JSON value");
}

function attributes(tag) {
  return new Map([...tag.matchAll(/([A-Za-z][A-Za-z0-9_-]*)="([^"]*)"/g)]
    .map((match) => [match[1], match[2]]));
}

function projectsFromManifest(xml) {
  const remotes = new Map();
  for (const match of xml.matchAll(/<remote\b[^>]*\/>/g)) {
    const values = attributes(match[0]);
    const name = values.get("name");
    const fetch = values.get("fetch");
    if (!name || !fetch || remotes.has(name)) {
      throw new ProductPrError("Integration Snapshot remotes require unique names and fetch URLs");
    }
    remotes.set(name, fetch.endsWith("/") ? fetch : `${fetch}/`);
  }
  const projects = [];
  const activation = [];
  const identities = new Set();
  for (const match of xml.matchAll(/<project\b([^>]*?)(?:\/>|>([\s\S]*?)<\/project\s*>)/g)) {
    const values = attributes(match[1]);
    const name = values.get("name");
    const projectPath = values.get("path");
    const remoteName = values.get("remote");
    const revision = values.get("revision");
    const fetch = remoteName ? remotes.get(remoteName) : undefined;
    if (!name || !projectPath || !revision || !remoteName || !fetch) {
      throw new ProductPrError("every Integration Snapshot project requires name, path, remote, and revision");
    }
    requireOid(revision, `${name} baseline revision`);
    if (identities.has(name) || projects.some((project) => project.path === projectPath)) {
      throw new ProductPrError("Integration Snapshot project names and paths must be unique");
    }
    identities.add(name);
    projects.push({
      name,
      path: projectPath,
      remote: new URL(name, fetch).href,
      revision,
    });
    for (const link of (match[2] ?? "").matchAll(/<linkfile\b[^>]*\/>/g)) {
      const linkValues = attributes(link[0]);
      const source = linkValues.get("src");
      const destination = linkValues.get("dest");
      if (!source || !destination) {
        throw new ProductPrError(`project ${name} contains an invalid activation link`);
      }
      activation.push({
        destination,
        source: `${projectPath}/${source}`,
        type: "symbolic-link",
      });
    }
  }
  if (projects.length === 0) throw new ProductPrError("Integration Snapshot contains no projects");
  activation.sort((left, right) => Buffer.from(left.destination).compare(Buffer.from(right.destination)));
  return { activation, projects };
}

function resolveCandidateManifest(xml, revisions) {
  const remaining = new Map(revisions);
  const resolved = xml.replace(/<project\b[^>]*>/g, (tag) => {
    const values = attributes(tag);
    const name = values.get("name");
    if (!remaining.has(name)) return tag;
    const revisionAttributes = [...tag.matchAll(/\brevision="[^"]*"/g)];
    if (revisionAttributes.length !== 1) {
      throw new ProductPrError(`canonical ${name} project must have one revision attribute`);
    }
    const revision = remaining.get(name);
    remaining.delete(name);
    return tag.replace(revisionAttributes[0][0], `revision="${revision}"`);
  });
  if (remaining.size !== 0) {
    throw new ProductPrError(
      `Integration Snapshot must contain one canonical project for: ${[...remaining.keys()].join(", ")}`,
    );
  }
  return Buffer.from(resolved);
}

async function atomicWrite(directory, name, bytes) {
  const destination = path.join(directory, name);
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, bytes, { flag: "wx" });
  await renameWithRetry(temporary, destination);
}

async function renameWithRetry(source, destination, injectCandidateIdentityFailure = false) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      if (
        injectCandidateIdentityFailure &&
        process.env.TSFG_TEST_CANDIDATE_IDENTITY_RENAME_EPERM_ONCE === "1" &&
        !injectedCandidateIdentityRenameFailure
      ) {
        injectedCandidateIdentityRenameFailure = true;
        throw Object.assign(new Error("injected transient candidate identity rename denial"), {
          code: "EPERM",
        });
      }
      await rename(source, destination);
      return;
    } catch (error) {
      if (
        process.platform !== "win32" ||
        !["EPERM", "EBUSY"].includes(error.code) ||
        attempt >= 7
      ) {
        throw error;
      }
      await delay(50 * 2 ** Math.min(attempt, 4));
    }
  }
}

async function writeCandidateIdentity(options) {
  const manifestPath = path.resolve(requireOption(options, "--manifest"));
  const manifestName = requireOption(options, "--manifest-name");
  const manifestRevision = requireOid(
    requireOption(options, "--manifest-revision"),
    "manifest revision",
  );
  const candidateRevision = requireOid(
    requireOption(options, "--candidate-revision"),
    "candidate revision",
  );
  const agentRevision = requireOid(
    requireOption(options, "--agent-revision"),
    "agent revision",
  );
  const outputPath = path.resolve(requireOption(options, "--out"));
  if (manifestName !== "bootstrap/r00.xml") {
    throw new ProductPrError("product PRs must use the fixed bootstrap/r00.xml Integration Snapshot");
  }

  const manifestBytes = await readFile(manifestPath);
  const { activation, projects } = projectsFromManifest(manifestBytes.toString("utf8"));
  const product = projects.find((project) => project.name === "tsfg.git" && project.path === "tsfg");
  if (!product) throw new ProductPrError("Integration Snapshot does not contain canonical tsfg.git project");
  const agent = projects.find((project) => project.name === ".agents.git" && project.path === ".agents");
  if (!agent) throw new ProductPrError("Integration Snapshot does not contain canonical .agents.git project");
  const baseline = {
    manifest: manifestName,
    repository: manifestRepository,
    revision: manifestRevision,
  };
  const overlay = {
    baseline,
    replacements: [
      { project: ".agents.git", revision: agentRevision },
      { project: "tsfg.git", revision: candidateRevision },
    ],
    schemaVersion: "1",
  };
  const resolvedManifest = {
    activation,
    baseline,
    projects: projects
      .map((project) => {
        if (project.name === "tsfg.git") return { ...project, revision: candidateRevision };
        if (project.name === ".agents.git") return { ...project, revision: agentRevision };
        return project;
      })
      .sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name))),
    schemaVersion: "1",
  };
  const overlayBytes = jsonBytes(overlay);
  const resolvedBytes = jsonBytes(resolvedManifest);
  const resolvedManifestBytes = resolveCandidateManifest(manifestBytes.toString("utf8"), new Map([
    ["tsfg.git", candidateRevision],
    [".agents.git", agentRevision],
  ]));
  const reportBytes = jsonBytes({
    agentRevision,
    baselineManifestDigest: sha256(manifestBytes),
    baselineProductRevision: product.revision,
    candidateRevision,
    overlayDigest: sha256(canonicalJsonBytes(overlay)),
    resolvedManifestDigest: sha256(canonicalJsonBytes(resolvedManifest)),
    schemaVersion: "1",
  });

  await mkdir(path.dirname(outputPath), { recursive: true });
  const stagingPath = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath)}.${randomUUID()}.tmp`,
  );
  await mkdir(stagingPath);
  try {
    await writeFile(path.join(stagingPath, "baseline-manifest.xml"), manifestBytes, { flag: "wx" });
    await writeFile(path.join(stagingPath, "candidate-overlay.json"), overlayBytes, { flag: "wx" });
    await writeFile(path.join(stagingPath, "resolved-manifest.json"), resolvedBytes, { flag: "wx" });
    await writeFile(path.join(stagingPath, "resolved-manifest.xml"), resolvedManifestBytes, { flag: "wx" });
    await writeFile(path.join(stagingPath, "candidate-identity.json"), reportBytes, { flag: "wx" });
    await renameWithRetry(stagingPath, outputPath, true);
  } catch (error) {
    await rm(stagingPath, { recursive: true, force: true });
    throw error;
  }
}

async function writePlan(options) {
  const outputPath = path.resolve(requireOption(options, "--out"));
  const platforms = [
    { os: "ubuntu-24.04", target: "linux-x86_64-gnu" },
    { os: "windows-2025", target: "windows-x86_64-msvc" },
  ];
  const profiles = ["debug", "release"];
  const producerMatrix = [];
  const comparatorMatrix = [];
  for (const platform of platforms) {
    for (const profile of profiles) {
      for (const producer of ["a", "b"]) {
        producerMatrix.push({ os: platform.os, producer, profile, target: platform.target });
      }
      comparatorMatrix.push({ os: platform.os, profile, target: platform.target });
    }
  }
  const plan = {
    comparatorMatrix,
    compatibilityMatrix: platforms.map(({ os, target }) => ({ os, target })),
    evidenceRetentionDays: "90",
    producerMatrix,
    requiredJobs,
    schemaVersion: "1",
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await atomicWrite(path.dirname(outputPath), path.basename(outputPath), jsonBytes(plan));
}

async function readJson(filePath, label) {
  let text;
  try {
    const bytes = await readFile(filePath);
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (error) {
    throw new ProductPrError(`${label} is missing or not I-JSON UTF-8: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (text.charCodeAt(0) === 0xfeff) {
    throw new ProductPrError(`${label} must not contain a BOM`);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new ProductPrError(`${label} is missing or invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  return value;
}

async function readCanonicalJson(filePath, label) {
  const bytes = await readFile(filePath).catch((error) => {
    throw new ProductPrError(`${label} is missing: ${error.message}`);
  });
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new ProductPrError(`${label} must be I-JSON encoded as UTF-8`);
  }
  if (text.charCodeAt(0) === 0xfeff) {
    throw new ProductPrError(`${label} must not contain a BOM`);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new ProductPrError(`${label} is not valid JSON: ${error.message}`);
  }
  const canonical = canonicalize(value);
  if (text !== canonical && text !== `${canonical}\n`) {
    throw new ProductPrError(`${label} must use canonical JSON`);
  }
  return value;
}

function requireSuccessfulReport(report, label, command) {
  if (report?.schemaVersion !== "1" || report.status !== "success") {
    throw new ProductPrError(`${label} is not a successful version 1 report`);
  }
  if (command && report.command !== command) {
    throw new ProductPrError(`${label} does not report ${command}`);
  }
  return report;
}

function requireResolvedWorkspace(report, resolvedManifest, label, expectedBinding) {
  requireSuccessfulReport(report, label, "verify-workspace");
  const byProjectId = (left, right) => Buffer.from(left.id).compare(Buffer.from(right.id));
  const expectedProjects = resolvedManifest.projects
    .map(({ name, path: projectPath, remote, revision }) => ({
      dirty: false,
      head: revision,
      id: name,
      path: projectPath,
      remote,
    }))
    .sort(byProjectId);
  const actualProjects = report.result?.projects
    ?.map(({ dirty, head, id, path: projectPath, remote }) => ({
      dirty,
      head,
      id,
      path: projectPath,
      remote,
    }))
    .sort(byProjectId);
  const expectedActivation = resolvedManifest.activation ?? [];
  const actualActivation = report.result?.activation;
  const actualManifest = report.result?.manifest;
  if (
    !Array.isArray(actualProjects) ||
    canonicalize(actualProjects) !== canonicalize(expectedProjects) ||
    report.result?.dirty !== false ||
    actualManifest?.repositoryUrl !== resolvedManifest.baseline.repository ||
    actualManifest?.selected !== resolvedManifest.baseline.manifest ||
    !completeOid.test(actualManifest?.revision) ||
    !Array.isArray(actualActivation) ||
    canonicalize(actualActivation.map(({ destination, source, type }) => ({ destination, source, type })))
      !== canonicalize(expectedActivation) ||
    actualActivation.some((entry) =>
      !/^sha256:[0-9a-f]{64}$/.test(entry?.sha256) ||
      Object.keys(entry).sort().join(",") !== "destination,sha256,source,type")
  ) {
    throw new ProductPrError(`${label} is not bound to the resolved Candidate Overlay`);
  }
  const policy = report.result?.policy;
  const expectedRepositories = [
    { id: "manifests", path: ".repo/manifests" },
    ...resolvedManifest.projects.map(({ name, path: projectPath }) => ({ id: name, path: projectPath })),
  ].sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
  const actualRepositories = policy?.repositories
    ?.map(({ files, id, license, path: repositoryPath }) => ({ files, id, license, path: repositoryPath }))
    .sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
  const repositoryFacts = actualRepositories?.map(({ id, path: repositoryPath }) => ({
    id,
    path: repositoryPath,
  }));
  const coverage = policy?.licenseReport?.coverage;
  if (
    !Array.isArray(actualRepositories) ||
    canonicalize(repositoryFacts) !== canonicalize(expectedRepositories) ||
    actualRepositories.some(({ files, license }) => !Number.isSafeInteger(files) || files < 1 || license !== "MIT") ||
    !Number.isSafeInteger(coverage?.covered) || coverage.covered < 1 ||
    coverage.total !== coverage.covered || coverage.percent !== "100" ||
    !Array.isArray(policy?.licenseReport?.dependencies) ||
    !Array.isArray(policy?.licenseReport?.inputs) ||
    !Array.isArray(policy?.upstreamForks) || policy.upstreamForks.length !== 0
  ) {
    throw new ProductPrError(`${label} does not contain complete workspace policy evidence`);
  }
  const binding = {
    activation: actualActivation,
    policy,
    projects: actualProjects,
  };
  if (expectedBinding && canonicalize(binding) !== canonicalize(expectedBinding)) {
    throw new ProductPrError(`${label} disagrees with the canonical Workspace Verification evidence`);
  }
  return binding;
}

async function evidenceFiles(root, current = "") {
  const directory = path.join(root, ...current.split("/").filter(Boolean));
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)))) {
    const relative = current ? `${current}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await evidenceFiles(root, relative));
    else if (entry.isFile()) files.push(relative);
    else throw new ProductPrError(`evidence entry must be a regular file: ${relative}`);
  }
  return files;
}

async function writeVerdict(options) {
  const root = path.resolve(requireOption(options, "--evidence"));
  const jobResults = await readJson(
    path.resolve(requireOption(options, "--job-results")),
    "required job results",
  );
  const outputPath = path.resolve(requireOption(options, "--out"));
  for (const job of requiredJobs) {
    if (jobResults?.[job] !== "success") {
      throw new ProductPrError(`required job ${job} did not succeed (observed ${jobResults?.[job] ?? "missing"})`);
    }
  }

  const identityRoot = path.join(root, "identity");
  const identity = await readJson(path.join(identityRoot, "candidate-identity.json"), "candidate identity");
  requireOid(identity?.candidateRevision, "candidate revision");
  requireOid(identity?.baselineProductRevision, "baseline product revision");
  requireOid(identity?.agentRevision, "agent revision");
  const overlay = await readCanonicalJson(path.join(identityRoot, "candidate-overlay.json"), "Candidate Overlay");
  const resolvedManifest = await readCanonicalJson(
    path.join(identityRoot, "resolved-manifest.json"),
    "resolved manifest",
  );
  const baselineManifestBytes = await readFile(path.join(identityRoot, "baseline-manifest.xml")).catch((error) => {
    throw new ProductPrError(`baseline manifest is missing: ${error.message}`);
  });
  const baselineFacts = projectsFromManifest(baselineManifestBytes.toString("utf8"));
  const baselineProduct = baselineFacts.projects.find(
    ({ name, path: projectPath }) => name === "tsfg.git" && projectPath === "tsfg",
  );
  const expectedResolvedManifest = {
    activation: baselineFacts.activation,
    baseline: overlay?.baseline,
    projects: baselineFacts.projects
      .map((project) => {
        if (project.name === "tsfg.git") return { ...project, revision: identity.candidateRevision };
        if (project.name === ".agents.git") return { ...project, revision: identity.agentRevision };
        return project;
      })
      .sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name))),
    schemaVersion: "1",
  };
  if (
    identity.schemaVersion !== "1" ||
    identity.baselineManifestDigest !== sha256(baselineManifestBytes) ||
    baselineProduct?.revision !== identity.baselineProductRevision ||
    identity.overlayDigest !== sha256(canonicalJsonBytes(overlay)) ||
    identity.resolvedManifestDigest !== sha256(canonicalJsonBytes(resolvedManifest)) ||
    canonicalize(overlay?.baseline) !== canonicalize(resolvedManifest?.baseline) ||
    canonicalize(overlay?.replacements) !== canonicalize([
      { project: ".agents.git", revision: identity.agentRevision },
      { project: "tsfg.git", revision: identity.candidateRevision },
    ]) ||
    resolvedManifest?.projects?.find(({ name }) => name === "tsfg.git")?.revision
      !== identity.candidateRevision ||
    resolvedManifest?.projects?.find(({ name }) => name === ".agents.git")?.revision
      !== identity.agentRevision ||
    canonicalize(resolvedManifest) !== canonicalize(expectedResolvedManifest)
  ) {
    throw new ProductPrError("candidate identity digests do not bind the archived overlay and resolved manifest");
  }
  const verifiedBaselineManifestBytes = await readFile(path.join(
    root,
    "workspace-verification",
    "verified-baseline-manifest.xml",
  )).catch((error) => {
    throw new ProductPrError(`verified baseline manifest is missing: ${error.message}`);
  });
  if (!verifiedBaselineManifestBytes.equals(baselineManifestBytes)) {
    throw new ProductPrError("Workspace Verification and candidate identity used different baseline manifests");
  }
  const workspaceVerificationRoot = path.join(root, "workspace-verification");
  const verifiedManifestIdentity = await readJson(
    path.join(workspaceVerificationRoot, "verified-manifest-identity.json"),
    "verified manifest identity",
  );
  const verifiedResolvedManifestBytes = await readFile(
    path.join(workspaceVerificationRoot, "verified-resolved-manifest.xml"),
  ).catch((error) => {
    throw new ProductPrError(`verified resolved manifest is missing: ${error.message}`);
  });
  const verifiedResolvedFacts = projectsFromManifest(verifiedResolvedManifestBytes.toString("utf8"));
  verifiedResolvedFacts.projects.sort(
    (left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)),
  );
  if (
    verifiedManifestIdentity?.manifestUrl !== resolvedManifest.baseline.repository ||
    verifiedManifestIdentity?.selectedManifest !== resolvedManifest.baseline.manifest ||
    !completeOid.test(verifiedManifestIdentity?.manifestRevision) ||
    canonicalize(verifiedResolvedFacts) !== canonicalize({
      activation: resolvedManifest.activation,
      projects: resolvedManifest.projects,
    })
  ) {
    throw new ProductPrError("Workspace Verification did not archive the resolved manifest identity and content");
  }

  const gateReport = requireSuccessfulReport(
    await readJson(path.join(root, "repository-gates", "report.json"), "repository gates"),
    "repository gates",
  );
  for (const gate of ["compatibility", "format", "policy", "license", "lock"]) {
    if (gateReport.gates?.[gate] !== "passed") {
      throw new ProductPrError(`repository ${gate} gate is missing or failed`);
    }
  }
  const workspaceReport = await readJson(
    path.join(workspaceVerificationRoot, "report.json"),
    "Workspace Verification",
  );
  const workspaceBinding = requireResolvedWorkspace(
    workspaceReport,
    resolvedManifest,
    "Workspace Verification",
  );
  if (workspaceReport.result.manifest.revision !== verifiedManifestIdentity.manifestRevision) {
    throw new ProductPrError("Workspace Verification report disagrees with the archived manifest HEAD");
  }

  const targets = ["linux-x86_64-gnu", "windows-x86_64-msvc"];
  const profiles = ["debug", "release"];
  let producerCount = 0;
  let reproCount = 0;
  for (const target of targets) {
    const compatibility = requireSuccessfulReport(
      await readJson(path.join(root, "compatibility", target, "report.json"), `${target} compatibility`),
      `${target} compatibility`,
    );
    const combinations = compatibility.result?.compatibility?.combinations;
    const artifactOids = {
      baseline: identity.baselineProductRevision,
      candidate: identity.candidateRevision,
    };
    const compatibilityRoot = path.join(root, "compatibility", target);
    for (const artifactName of ["baseline", "candidate"]) {
      const artifactPath = path.join(compatibilityRoot, `${artifactName}.json`);
      const artifactBytes = await readFile(artifactPath).catch((error) => {
        throw new ProductPrError(`${target} ${artifactName} compatibility artifact is missing: ${error.message}`);
      });
      const artifact = await readJson(artifactPath, `${target} ${artifactName} compatibility artifact`);
      if (
        artifact?.product?.commitOid !== artifactOids[artifactName] ||
        compatibility.result?.compatibility?.artifacts?.[artifactName]?.productOid
          !== artifactOids[artifactName] ||
        compatibility.result?.compatibility?.artifacts?.[artifactName]?.sha256 !== sha256(artifactBytes)
      ) {
        throw new ProductPrError(`${target} ${artifactName} compatibility artifact identity is invalid`);
      }
    }
    const expectedCombinations = [
      ["baseline", "baseline"],
      ["candidate", "baseline"],
      ["baseline", "candidate"],
      ["candidate", "candidate"],
    ];
    if (
      compatibility.result?.target !== target ||
      compatibility.result?.contractSet?.canonical !== "{}" ||
      compatibility.result?.contractSet?.id !== sha256(canonicalJsonBytes({})) ||
      !Array.isArray(combinations) ||
      expectedCombinations.some(([producer, consumer], index) =>
        combinations[index]?.producer !== producer ||
        combinations[index]?.consumer !== consumer ||
        combinations[index]?.producerProductOid !== artifactOids[producer] ||
        combinations[index]?.consumerProductOid !== artifactOids[consumer] ||
        combinations[index]?.status !== "passed")
    ) {
      throw new ProductPrError(`${target} compatibility evidence does not contain the complete candidate-bound matrix`);
    }

    for (const profile of profiles) {
      let producerIdentity;
      let producerInputSet;
      const producerEvidence = new Map();
      for (const producer of ["a", "b"]) {
        const producerRoot = path.join(root, "producers", target, profile, producer);
        const producerWorkspaceReport = await readJson(
          path.join(producerRoot, "workspace-report.json"),
          `${target}/${profile}/${producer} workspace`,
        );
        requireResolvedWorkspace(
          producerWorkspaceReport,
          resolvedManifest,
          `${target}/${profile}/${producer} workspace`,
          workspaceBinding,
        );
        const build = requireSuccessfulReport(
          await readJson(path.join(producerRoot, "build-report.json"), `${target}/${profile}/${producer} build`),
          `${target}/${profile}/${producer} build`,
          "build",
        );
        const test = requireSuccessfulReport(
          await readJson(path.join(producerRoot, "test-report.json"), `${target}/${profile}/${producer} test`),
          `${target}/${profile}/${producer} test`,
          "test",
        );
        const packageReport = requireSuccessfulReport(
          await readJson(path.join(producerRoot, "package-report.json"), `${target}/${profile}/${producer} package`),
          `${target}/${profile}/${producer} package`,
          "package",
        );
        if (
          build.result?.target !== target || build.result?.profile !== profile ||
          packageReport.result?.buildIdentity?.target !== target ||
          packageReport.result?.buildIdentity?.profile !== profile ||
          canonicalize(build.result?.buildIdentity) !== canonicalize(packageReport.result?.buildIdentity) ||
          canonicalize(test.result?.buildIdentity) !== canonicalize(packageReport.result?.buildIdentity)
        ) {
          throw new ProductPrError(`${target}/${profile}/${producer} reports disagree on Build Identity`);
        }
        const digestValue = packageReport.result.buildIdentity.digest;
        if (
          !/^sha256:[0-9a-f]{64}$/.test(digestValue) ||
          (producerIdentity && producerIdentity !== digestValue)
        ) {
          throw new ProductPrError(`${target}/${profile} producers have different Build Identities`);
        }
        producerIdentity = digestValue;
        const packageInputSet = packageReport.result?.buildInputSet;
        if (
          packageInputSet?.schemaVersion !== "1" ||
          !Array.isArray(packageInputSet.entries) ||
          packageInputSet.digest !== sha256(canonicalJsonBytes({
            entries: packageInputSet.entries,
            schemaVersion: "1",
          })) ||
          (producerInputSet && canonicalize(producerInputSet) !== canonicalize(packageInputSet))
        ) {
          throw new ProductPrError(`${target}/${profile}/${producer} has invalid Build Input Set evidence`);
        }
        producerInputSet = packageInputSet;
        const packageRoot = path.join(producerRoot, "package");
        const archiveName = packageReport.result.archive;
        if (typeof archiveName !== "string" || archiveName === "" || archiveName.includes("/") || archiveName.includes("\\")) {
          throw new ProductPrError(`${target}/${profile}/${producer} package report has an invalid archive name`);
        }
        for (const member of [archiveName, `${archiveName}.checksums.json`, "producer-attestation.json"]) {
          const metadata = await stat(path.join(packageRoot, member)).catch(() => undefined);
          if (!metadata?.isFile()) throw new ProductPrError(`${target}/${profile}/${producer} is missing ${member}`);
        }
        const attestation = await readJson(
          path.join(packageRoot, "producer-attestation.json"),
          `${target}/${profile}/${producer} producer attestation`,
        );
        if (
          attestation.schemaVersion !== "1" || attestation.target !== target ||
          attestation.profile !== profile || attestation.buildIdentityDigest !== digestValue ||
          typeof attestation.buildExecutionId !== "string" || attestation.buildExecutionId.length === 0 ||
          typeof attestation.workspacePath !== "string" ||
          attestation.workspacePath.length === 0
        ) {
          throw new ProductPrError(`${target}/${profile}/${producer} producer attestation is inconsistent`);
        }
        const binding = await readJson(
          path.join(producerRoot, "candidate-binding.json"),
          `${target}/${profile}/${producer} candidate binding`,
        );
        if (
          binding.schemaVersion !== "1" ||
          binding.candidateRevision !== identity.candidateRevision ||
          binding.buildIdentityDigest !== digestValue ||
          binding.manifestRevision !== producerWorkspaceReport.result.manifest.revision
        ) {
          throw new ProductPrError(`${target}/${profile}/${producer} build evidence is not bound to the candidate`);
        }
        producerEvidence.set(producer, {
          archiveName,
          archiveSha256: sha256(await readFile(path.join(packageRoot, archiveName))),
          buildExecutionId: attestation.buildExecutionId,
          buildIdentity: packageReport.result.buildIdentity,
          buildIdentityDigest: digestValue,
          buildInputSet: packageInputSet,
          checksumsName: `${archiveName}.checksums.json`,
          checksumsSha256: sha256(await readFile(path.join(packageRoot, `${archiveName}.checksums.json`))),
          workspacePath: attestation.workspacePath,
        });
        producerCount += 1;
      }
      const repro = requireSuccessfulReport(
        await readJson(
          path.join(root, "reproducibility", target, profile, "report.json"),
          `${target}/${profile} reproducibility`,
        ),
        `${target}/${profile} reproducibility`,
        "repro-check",
      );
      const compared = repro.result?.compared;
      const reproProducers = repro.result?.producers;
      const firstProducer = producerEvidence.get("a");
      const comparedByPath = new Map(Array.isArray(compared)
        ? compared.map((entry) => [entry?.path, entry])
        : []);
      if (
        repro.result?.target !== target || repro.result?.profile !== profile ||
        repro.result?.buildExecuted !== false ||
        canonicalize(repro.result?.buildIdentity) !== canonicalize(firstProducer?.buildIdentity) ||
        canonicalize(repro.result?.buildInputSet) !== canonicalize(firstProducer?.buildInputSet) ||
        repro.result?.comparator?.buildIdentityDigest !== firstProducer?.buildIdentityDigest ||
        repro.result?.comparator?.buildInputSetDigest !== firstProducer?.buildInputSet?.digest ||
        (Object.hasOwn(repro.result?.comparator ?? {}, "workspacePath") &&
          (typeof repro.result.comparator.workspacePath !== "string" ||
            repro.result.comparator.workspacePath.length === 0)) ||
        !Array.isArray(compared) || compared.length < 2 ||
        compared.some((entry) =>
          typeof entry?.path !== "string" || entry.path.length === 0 ||
          !/^sha256:[0-9a-f]{64}$/.test(entry.sha256)) ||
        comparedByPath.size !== compared.length ||
        repro.result?.reproducibilitySetDigest
          !== sha256(canonicalJsonBytes({ entries: compared, schemaVersion: "1" })) ||
        !Array.isArray(reproProducers) || reproProducers.length !== 2 ||
        ["a", "b"].some((producer, index) => {
          const actual = reproProducers[index];
          const expected = producerEvidence.get(producer);
          const normalizedArtifactPath = typeof actual?.artifactPath === "string"
            ? actual.artifactPath.replaceAll("\\", "/").toLowerCase()
            : "";
          const expectedSuffix = `/producers/${target}/${profile}/${producer}/package`.toLowerCase();
          return actual?.label !== producer ||
            actual?.archive !== expected?.archiveName ||
            actual?.archiveSha256 !== expected?.archiveSha256 ||
            actual?.checksumsSha256 !== expected?.checksumsSha256 ||
            actual?.buildExecutionId !== expected?.buildExecutionId ||
            !normalizedArtifactPath.endsWith(expectedSuffix) ||
            actual?.workspacePath !== expected?.workspacePath ||
            actual?.buildIdentityDigest !== expected?.buildIdentityDigest ||
            comparedByPath.get(`package/${expected?.archiveName}`)?.sha256 !== expected?.archiveSha256 ||
            comparedByPath.get(`package/${expected?.checksumsName}`)?.sha256 !== expected?.checksumsSha256;
        })
      ) {
        throw new ProductPrError(`${target}/${profile} comparator evidence is incomplete or executed a build`);
      }
      reproCount += 1;
    }
  }

  const files = await evidenceFiles(root);
  const entries = await Promise.all(files.map(async (relativePath) => ({
    path: relativePath,
    sha256: sha256(await readFile(path.join(root, ...relativePath.split("/")))),
  })));
  const evidenceDigest = sha256(canonicalJsonBytes({ entries, schemaVersion: "1" }));
  const verdict = {
    candidateRevision: identity.candidateRevision,
    evidenceDigest,
    evidenceRetentionDays: "90",
    promotionState: "Verified Candidate",
    requiredEvidence: {
      compatibility: "2/2",
      producers: `${producerCount}/8`,
      reproducibility: `${reproCount}/4`,
      workspaceVerification: "1/1",
    },
    schemaVersion: "1",
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await atomicWrite(path.dirname(outputPath), path.basename(outputPath), jsonBytes(verdict));
}

async function main() {
  const [command, ...arguments_] = process.argv.slice(2);
  if (command === "identity") {
    const options = parseOptions(arguments_, new Set([
      "--manifest",
      "--manifest-name",
      "--manifest-revision",
      "--candidate-revision",
      "--agent-revision",
      "--out",
    ]));
    await writeCandidateIdentity(options);
  } else if (command === "plan") {
    await writePlan(parseOptions(arguments_, new Set(["--out"])));
  } else if (command === "verdict") {
    await writeVerdict(parseOptions(arguments_, new Set(["--evidence", "--job-results", "--out"])));
  } else {
    throw new ProductPrError(`unsupported command: ${command ?? "<missing>"}`);
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
