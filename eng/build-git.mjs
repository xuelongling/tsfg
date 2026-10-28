// SPDX-License-Identifier: MIT
import process from "node:process";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { WorkspaceMismatchError } from "./build-errors.mjs";

/**
 * @param {string} cwd
 * @param {string[]} arguments_
 * @param {BufferEncoding | "buffer"} encoding
 * @returns {any}
 */
export function gitOutput(cwd, arguments_, encoding = "utf8", input = undefined) {
  const gitExecutable = process.env.TSFG_GIT;
  if (!gitExecutable || !path.isAbsolute(gitExecutable)) {
    throw new WorkspaceMismatchError(
      "git-state",
      "Git inspection requires an absolute TSFG_GIT selected by the verified launcher",
    );
  }
  try {
    /** @type {NodeJS.ProcessEnv} */
    const environment = {};
    const allowed = [
      "PATH",
      "SystemRoot",
      "ComSpec",
      "PATHEXT",
      "HOME",
      "USERPROFILE",
      "HOMEDRIVE",
      "HOMEPATH",
      "TEMP",
      "TMP",
      "TMPDIR",
      "LANG",
      "LC_ALL",
    ];
    for (const requested of allowed) {
      const actual = Object.keys(process.env).find(
        (name) => name.toLowerCase() === requested.toLowerCase(),
      );
      if (actual && process.env[actual] !== undefined) {
        environment[requested] = process.env[actual];
      }
    }
    environment.GIT_CONFIG_NOSYSTEM = "1";
    environment.GIT_CONFIG_GLOBAL = process.platform === "win32" ? "NUL" : "/dev/null";
    environment.GIT_OPTIONAL_LOCKS = "0";
    environment.GIT_TERMINAL_PROMPT = "0";
    const bytes = execFileSync(gitExecutable, arguments_, {
      cwd,
      env: environment,
      input,
      maxBuffer: 256 * 1024 * 1024,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    return encoding === "buffer" ? bytes : bytes.toString(encoding);
  } catch (error) {
    const detail = Buffer.isBuffer(error.stderr)
      ? error.stderr.toString("utf8").trim()
      : String(error.stderr ?? error.message).trim();
    throw new WorkspaceMismatchError(
      "git-state",
      `cannot inspect Git state at ${cwd}: ${detail}`,
    );
  }
}

export function requireVisibleTrackedFiles(repositoryRoot) {
  const assumeUnchanged = gitOutput(repositoryRoot, ["ls-files", "-v", "-z"])
    .split("\0")
    .filter((entry) => /^[a-z] /.test(entry))
    .map((entry) => entry.slice(2));
  const skipWorktree = gitOutput(repositoryRoot, ["ls-files", "-t", "-z"])
    .split("\0")
    .filter((entry) => entry.startsWith("S "))
    .map((entry) => entry.slice(2));
  const hidden = [...new Set([...assumeUnchanged, ...skipWorktree])].sort(
    (left, right) => Buffer.from(left).compare(Buffer.from(right)),
  );
  if (hidden.length !== 0) {
    throw new WorkspaceMismatchError(
      "dirty-project",
      `tracked files are hidden from workspace status: ${hidden.join(",")}`,
    );
  }
}

function splitNullTerminated(bytes) {
  const entries = [];
  let start = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0) continue;
    if (index !== start) entries.push(bytes.subarray(start, index));
    start = index + 1;
  }
  if (start !== bytes.length) {
    throw new WorkspaceMismatchError("repository-tree", "Git returned a truncated tree entry");
  }
  return entries;
}

export function committedTree(repositoryRoot, revision, allowGitlinks = false) {
  const output = gitOutput(
    repositoryRoot,
    ["ls-tree", "-rz", "--full-tree", revision],
    "buffer",
  );
  return splitNullTerminated(output).map((record) => {
    const separator = record.indexOf(0x09);
    if (separator < 0) {
      throw new WorkspaceMismatchError("repository-tree", "Git returned an invalid tree entry");
    }
    const header = record.subarray(0, separator).toString("ascii").split(" ");
    if (header.length !== 3 || (header[1] !== "blob" && !(allowGitlinks && header[0] === "160000" && header[1] === "commit"))) {
      throw new WorkspaceMismatchError("repository-tree", "Git returned an unsupported tree entry");
    }
    return {
      mode: header[0],
      oid: header[2],
      pathBytes: record.subarray(separator + 1),
    };
  });
}

const committedBlobCache = new Map();

export function committedBlob(repositoryRoot, oid) {
  const key = `${repositoryRoot}\0${oid}`;
  let bytes = committedBlobCache.get(key);
  if (!bytes) {
    bytes = gitOutput(repositoryRoot, ["cat-file", "blob", oid], "buffer");
    committedBlobCache.set(key, bytes);
  }
  return bytes;
}
