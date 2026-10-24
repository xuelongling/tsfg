// SPDX-License-Identifier: MIT
import { inspectMlirSdkProvenance } from './mlir-sdk.mjs';
const integrity = message => Object.assign(new TypeError(message), {issueCode:'mlir-source-integrity'});
/** Select conservative headers from the authenticated SDK snapshot and declared physical inventory.
 * @param {{files:Array<{path:string,blob?:string,sha256?:string}>,sdk?:object|null,productRoot?:string}} input
 */
export function selectMlirPrecompilePaths({ files, sdk = null, productRoot }) {
  if (!sdk) return files.filter(file => /\.(?:h|hpp|inc|def|td)$/.test(file.path)).map(file => file.path);
  const proof = inspectMlirSdkProvenance(sdk, productRoot);
  const members = new Map(proof.files.map(file => [file.path, file.sha256]));
  const seen = new Map();
  const selected = [];
  for (const entry of proof.sourceEntries) {
    const name = entry.repositoryRelativePath;
    if (!/\.(?:h|hpp|inc|def|td)$/.test(name)) continue;
    const prior = seen.get(name);
    if (prior) {
      if (prior.blob !== entry.blob || prior.sha256 !== entry.sha256)
        throw integrity('Conflicting SDK precompile snapshot entries: ' + name);
      throw integrity('Duplicate SDK precompile snapshot path: ' + name);
    }
    seen.set(name, entry);
    const memberSHA = members.get('source/' + name);
    if (memberSHA === undefined) continue;
    if (memberSHA !== entry.sha256 || !/^[0-9a-f]{40}$/.test(entry.blob ?? ''))
      throw integrity('Authenticated SDK precompile member differs: ' + name);
    selected.push(name);
  }
  return selected;
}

/** Classify only selected source inputs for preconfigure legal verification.
 * Direct sources include configure-file templates; SDK kinds and physical membership stay fixed.
 * This does not register another source or grant execution authority.
 * @param {{sourceEntries:Array<{repositoryRelativePath:string,blob:string,sha256:string}>,sdk?:object|null,productRoot?:string}} input
 */
export function selectMlirConfigurationPaths({ sourceEntries, sdk = null, productRoot }) {
  const proof = sdk ? inspectMlirSdkProvenance(sdk, productRoot) : null;
  const entries = proof ? proof.sourceEntries : sourceEntries;
  const candidates = entries.filter(entry => /^(llvm|mlir|cmake)\//.test(entry.repositoryRelativePath) &&
    (/(?:^|\/)CMakeLists\.txt$|\.cmake$|\.cmake\.in$/.test(entry.repositoryRelativePath) ||
      (!proof && /\.in$|(?:^|\/)module\.modulemap\.build$/.test(entry.repositoryRelativePath))) &&
    !/(?:^|\/)(?:test|tests|examples|docs|benchmark|benchmarks)\//.test(entry.repositoryRelativePath));
  if (!proof) return candidates.map(entry => entry.repositoryRelativePath);
  const members = new Map(proof.files.map(file => [file.path, file.sha256]));
  const seen = new Map();
  const selected = [];
  for (const entry of candidates) {
    const name = entry.repositoryRelativePath;
    const prior = seen.get(name);
    if (prior) {
      if (prior.blob !== entry.blob || prior.sha256 !== entry.sha256)
        throw integrity("Conflicting SDK configuration snapshot entries: " + name);
      throw integrity("Duplicate SDK configuration snapshot path: " + name);
    }
    seen.set(name, entry);
    const memberSHA = members.get("source/" + name);
    if (memberSHA === undefined) continue;
    if (memberSHA !== entry.sha256 || !/^[0-9a-f]{40}$/.test(entry.blob ?? ""))
      throw integrity("Authenticated SDK configuration member differs: " + name);
    selected.push(name);
  }
  return selected;
}
