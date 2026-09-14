// SPDX-License-Identifier: MIT
// Fixed acceptance inputs for the existing source-built AST consumer.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import { astGit } from "./typescript-ast-inputs.mjs";
import { IntakeLedgerError } from "./intake-ledger.mjs";

const hash = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fail = message => { throw new IntakeLedgerError("typescript-probe-input", message); };
const manifestPath = "eng/probes/typescript.json";
const required = ["positive", "syntax-error"];

export async function readTypeScriptProbes(controlRoot, gitExecutable) {
  const inputs = [];
  const committed = async relative => {
    const bytes = await readFile(path.join(controlRoot, relative)).catch(() => fail(`missing required probe input: ${relative}`));
    if (!bytes.equals(astGit(gitExecutable, controlRoot, ["show", `HEAD:${relative}`]))) fail(`probe input differs from committed identity: ${relative}`);
    inputs.push({ projectId: "tsfg", path: relative, sha256: hash(bytes), role: "build-only", consumer: "tsfg-ast", license: "MIT" });
    return bytes;
  };
  const bytes = await committed(manifestPath);
  const manifest = JSON.parse(bytes.toString("utf8"));
  if (manifest.schemaVersion !== "1" || manifest.languageBaseline !== "TypeScript 7.0.2"
      || !Array.isArray(manifest.cases) || !isDeepStrictEqual(manifest.cases.map(item => item.id), required)) fail("all fixed TypeScript probes are required in order");
  for (const item of manifest.cases) {
    if (!item.expected || !Array.isArray(item.expected.syntaxDiagnostics)
        || Object.keys(item.expected).some(key => !["syntaxDiagnostics", "types"].includes(key))) fail(`invalid fixed expectation: ${item.id}`);
    if (item.id === "positive") {
      if (item.projectId !== "TypeScript.git" || item.path !== "tsc/cmd/tsfg-ast/testdata/positive.ts") fail("positive must reuse the admitted AST input");
    } else {
      if (item.projectId !== "tsfg" || item.path !== `eng/probes/${item.id}.ts`) fail(`invalid probe source: ${item.id}`);
      item.bytes = await committed(item.path);
    }
  }
  const legal = { path: "LICENSE", sha256: hash(await committed("LICENSE")) };
  return { manifest, sha256: hash(bytes), inputs: inputs.map(input => ({ ...input, legal })) };
}

export async function runTypeScriptProbes({ probes, plan, executable, run, positiveInput }) {
  const results = [];
  for (const item of probes.manifest.cases) {
    const source = item.id === "positive" ? positiveInput : path.join(plan.moduleRoot, "cmd/tsfg-ast/testdata", `${item.id}.ts`);
    if (item.bytes) await writeFile(source, item.bytes, { flag: "wx" });
    const sourceSha256 = hash(await readFile(source));
    let observation;
    try {
      observation = JSON.parse(run(executable, [source]));
      const matched = observation.kind === "KindSourceFile" && Object.entries(item.expected)
        .every(([key, value]) => isDeepStrictEqual(observation[key], value));
      results.push({ id: item.id, status: matched ? "passed" : "failed", source: { projectId: item.projectId, path: item.path, sha256: sourceSha256 },
        expected: item.expected, observation });
    } catch (error) {
      results.push({ id: item.id, status: "failed", source: { projectId: item.projectId, path: item.path, sha256: sourceSha256 }, message: error.message });
    }
    if (hash(await readFile(source)) !== sourceSha256) fail(`probe input changed during execution: ${item.id}`);
  }
  return { schemaVersion: "1", status: results.every(item => item.status === "passed") ? "passed" : "failed",
    languageBaseline: probes.manifest.languageBaseline, expectationSha256: probes.sha256,
    inputLedger: probes.inputs, cases: results };
}
