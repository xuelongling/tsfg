// SPDX-License-Identifier: MIT
import path from "node:path";
import { validateSourceAdmission } from "./source-admission.mjs";
import { readFile } from "node:fs/promises";
import { verifyAgentPrivateState, verifyGeneratedProvenance } from "./build-agent-policy.mjs";
import { canonicalize, digest } from "./build-data.mjs";
import { verifyBuildInputLicenses, verifyDependencyProvenance } from "./build-dependency-policy.mjs";
import { ConfigurationError, WorkspaceMismatchError } from "./build-errors.mjs";
import { committedTree, gitOutput } from "./build-git.mjs";
import { repositoryRoot } from "./build-product.mjs";
import { licenseMapping, verifyFirstPartyLicense, verifyLineEndingAttributes, verifyPortablePaths, verifyTrackedText, verifyUpstreamProvenance } from "./build-source-policy.mjs";

export async function verifyWorkspacePolicy(manifestsRoot, manifestRevision, expectedProjects, workspace, manifestName) {
  const definition = JSON.parse(
    await readFile(path.join(repositoryRoot, "eng", "workspace-policy.json"), "utf8"),
  );
  if (
    definition.schemaVersion !== "1" ||
    !/^[a-z0-9._-]+$/.test(definition.agentMcpSourceDirectory) ||
    !Array.isArray(definition.agentMcpSourceExtensions) ||
    !definition.agentMcpSourceExtensions.every((entry) => /^\.[a-z0-9]+$/.test(entry)) ||
    !/^[1-9][0-9]*$/.test(definition.maxRelativePathLength) ||
    !Array.isArray(definition.approvedLicenseExpressions) ||
    !definition.approvedLicenseExpressions.every((entry) => typeof entry === "string") ||
    !/^sha256:[0-9a-f]{64}$/.test(definition.firstPartyLicenseSha256) ||
    !Array.isArray(definition.pathCasingWhitelist) ||
    !definition.pathCasingWhitelist.every((entry) => typeof entry === "string") ||
    !Array.isArray(definition.controlPathCasingWhitelist) ||
    !definition.controlPathCasingWhitelist.every(
      (entry) => typeof entry?.projectId === "string" && typeof entry.path === "string",
    ) ||
    !Array.isArray(definition.licenseMappings) ||
    !definition.licenseMappings.every(
      (entry) =>
        typeof entry?.pattern === "string" &&
        (entry.contentKind === "text" || entry.contentKind === "binary"),
    ) ||
    !Array.isArray(definition.nonAnnotatablePaths) ||
    !definition.nonAnnotatablePaths.every((entry) => typeof entry === "string") ||
    !Array.isArray(definition.spdxSourceExtensions) ||
    !Array.isArray(definition.spdxSourceNames)
  ) {
    throw new ConfigurationError("invalid workspace policy definition");
  }
  const repositories = [
    {
      id: "manifests",
      workspacePath: ".repo/manifests",
      root: manifestsRoot,
      revision: manifestRevision,
    },
    ...expectedProjects.map((project) => ({
      id: project.id,
      workspacePath: project.path,
      root: path.resolve(workspace, ...project.path.split("/")),
      revision: project.revision,
    })),
  ];
  const result = [];
  const upstreamForks = [];
  const productProject = expectedProjects.find((project) => project.id === "tsfg.git");
  function admissionFile(root, revision, filePath) {
    const files = gitOutput(root, ["ls-tree", "--name-only", revision, "--", filePath]).trim();
    if (!files) return { schemaVersion: "1", sources: [] };
    try { return JSON.parse(gitOutput(root, ["show", `${revision}:${filePath}`])); } catch {
      throw new WorkspaceMismatchError("source-admission", `${filePath} is not a valid source admission document`);
    }
  }
  const sourceAdmission = admissionFile(manifestsRoot, manifestRevision, `${manifestName}.sources.json`);
  try { validateSourceAdmission(sourceAdmission, definition); } catch (error) {
    throw new WorkspaceMismatchError("source-admission", error.message);
  }
  if (sourceAdmission.sources.length > 0 &&
      !/^candidates\/tsfg-v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.xml$/.test(manifestName)) {
    throw new WorkspaceMismatchError("source-admission", "sources require an explicitly versioned candidate combination");
  }
  const productAdmission = productProject ? admissionFile(path.join(workspace, productProject.path), productProject.revision, "eng/source-admissions.json") : undefined;
  if (!["1", "2"].includes(sourceAdmission.schemaVersion) || !Array.isArray(sourceAdmission.sources) ||
      new Set(sourceAdmission.sources.map((source) => source.projectId)).size !== sourceAdmission.sources.length ||
      canonicalize(sourceAdmission) !== canonicalize(productAdmission)) {
    throw new WorkspaceMismatchError("source-admission", "product and manifest source admission records disagree");
  }
  for (const source of sourceAdmission.sources) {
    const project = expectedProjects.find((entry) => entry.id === source.projectId);
    if (!project || source.remoteUrl !== `https://github.com/xuelongling/${source.projectId}` ||
        project.remoteUrl !== source.remoteUrl || project.path !== source.path ||
        project.revision !== source.forkOid || project.branch !== source.branch) {
      throw new WorkspaceMismatchError("source-admission", "source approval does not match the exact manifest project");
    }
  }
  let covered = 0;
  let product;
  let productEntries;
  let productCoverage;
  for (const repository of repositories) {
    const firstParty = ["manifests", "tsfg.git", ".agents.git"].includes(repository.id);
    const approval = firstParty ? undefined : sourceAdmission.sources.find((source) => source.projectId === repository.id);
    const entries = committedTree(repository.root, repository.revision, Boolean(approval) && sourceAdmission.schemaVersion === "2");
    const repositoryPolicy = approval ? {
      ...definition,
      maxRelativePathLength: sourceAdmission.schemaVersion === "2" ? "4096" : definition.maxRelativePathLength,
      controlPathCasingWhitelist: [...definition.controlPathCasingWhitelist,
        ...approval.files.map((file) => ({ projectId: repository.id, path: file.path }))],
    } : definition;
    verifyPortablePaths(repository, entries, repositoryPolicy);
    if (!approval) {
      verifyLineEndingAttributes(repository, entries);
      for (const entry of entries) {
        const relativePath = entry.pathBytes.toString("ascii");
        verifyTrackedText(repository, entry, licenseMapping(relativePath, definition));
      }
      verifyAgentPrivateState(repository, entries, definition);
      verifyGeneratedProvenance(repository, entries, definition);
    }
    const coverage = firstParty ? verifyFirstPartyLicense(repository, entries, definition) : [];
    let repositoryLicense = "MIT";
    if (firstParty) {
      covered += coverage.length;
      if (repository.id === "tsfg.git") {
        product = repository;
        productEntries = entries;
        productCoverage = coverage;
      }
    } else {
      upstreamForks.push(verifyUpstreamProvenance(repository, entries, definition, approval));
      repositoryLicense = approval.license;
      covered += entries.length;
    }
    result.push({
      files: entries.length,
      id: repository.id,
      license: repositoryLicense,
      path: repository.workspacePath,
    });
  }
  result.sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
  if (!product || !productEntries || !productCoverage) {
    throw new WorkspaceMismatchError("dependency-coverage", "workspace has no tsfg product project");
  }
  return {
    licenseReport: {
      coverage: { covered, percent: "100", total: covered },
      dependencies: verifyDependencyProvenance(product, productEntries, definition),
      inputs: verifyBuildInputLicenses(product, productEntries, productCoverage),
    },
    repositories: result,
    upstreamForks,
    sourceAdmission: {
      schemaVersion: "1", digest: digest(Buffer.from(canonicalize(sourceAdmission))), sources: sourceAdmission.sources,
      stages: { sourcePolicy: "passed", generation: "not-run", build: "not-run", interface: "not-run", jsIsolation: "not-run", reproducibility: "not-run" },
      intakeComplete: false,
    },
  };
}
