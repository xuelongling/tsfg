// SPDX-License-Identifier: MIT

function validBranch(value) {
  return typeof value === "string" && value.startsWith("refs/heads/") &&
    !/[\x00-\x20\x7f~^:?*\[\\]/.test(value) && !value.includes("@{") &&
    !value.includes("..") && !value.endsWith(".") && value.split("/").every((part) =>
      part !== "" && !part.startsWith(".") && !part.endsWith(".lock"));
}

export function validateSourceAdmission(record, definition) {
  const keys = (value, expected) => value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === expected.split(",").sort().join(",");
  const safePath = (value) => typeof value === "string" && value.length <= 180 &&
    value.length > 0 && !/[^A-Za-z0-9._/-]/.test(value) && value.split("/").every((part) => part !== "" &&
      ![".", "..", ".git"].includes(part.toLowerCase()) && !/[. ]$/.test(part) &&
      !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
  if (!keys(record, "schemaVersion,sources") || record.schemaVersion !== "1" || !Array.isArray(record.sources) ||
      record.sources.some((source) => !keys(source, "projectId,path,remoteUrl,canonicalUrl,baseOid,forkOid,branch,license,files,legal") ||
        ["projectId", "path", "remoteUrl", "canonicalUrl", "baseOid", "forkOid", "branch", "license"].some((key) =>
          typeof source[key] !== "string" || /[\x00-\x1f\x7f]/.test(source[key])) ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]*\.git$/.test(source.projectId) || ["tsfg.git", ".agents.git", "manifests.git"].includes(source.projectId.toLowerCase()) ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source.path) || source.path.startsWith("tsfg-upstream-") || !safePath(source.path) ||
        source.remoteUrl !== `https://github.com/xuelongling/${source.projectId}` ||
        !/^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+\.git$/.test(source.canonicalUrl) ||
        source.canonicalUrl.split("/").at(-1) !== source.projectId ||
        source.baseOid.length !== 40 || source.forkOid.length !== 40 ||
        !/^[0-9a-f]{40}$/.test(source.baseOid) || !/^[0-9a-f]{40}$/.test(source.forkOid) ||
        !validBranch(source.branch) ||
        !definition.approvedLicenseExpressions.includes(source.license) || !Array.isArray(source.files) || source.files.length === 0 ||
        source.files.some((file) => !keys(file, "path,sha256,contentKind") || !safePath(file.path) ||
          typeof file.sha256 !== "string" || !/^sha256:[0-9a-f]{64}$/.test(file.sha256) || file.sha256.length !== 71 || !["text", "binary"].includes(file.contentKind)) ||
        new Set(source.files.map((file) => file.path.toLowerCase())).size !== source.files.length ||
        !keys(source.legal, "license,notice,copyright") || Object.values(source.legal).some((filePath) =>
          !source.files.some((file) => file.path === filePath && file.contentKind === "text")))) {
    throw new Error("invalid source admission record or license mapping");
  }
  if (new Set(record.sources.map((source) => source.projectId.toLowerCase())).size !== record.sources.length ||
      new Set(record.sources.map((source) => source.path)).size !== record.sources.length) {
    throw new Error("source admission project identities must be unique");
  }
}
