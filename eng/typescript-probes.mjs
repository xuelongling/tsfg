// SPDX-License-Identifier: MIT
// Fixed acceptance inputs for the existing source-built AST consumer.
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir, rm } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import { astGit } from "./typescript-ast-inputs.mjs";
import { IntakeLedgerError } from "./intake-ledger.mjs";

const hash = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fail = message => { throw new IntakeLedgerError("typescript-probe-input", message); };
const manifestPath = "eng/probes/typescript.json";
const required = ["positive", "syntax-error", "type-error"];

// Independent worked expectation for the admitted positive.ts: its 61-byte
// copyright line plus LF precedes `export const answer: number = 42;` (33 bytes).
// The one statement includes leading trivia and ends after ';', before the final
// LF. `number` is a keyword, leaving `answer` as the only identifier.
const positiveAst = {
  statements: [{ kind: "KindVariableStatement", start: 0, end: 95 }],
  identifiers: ["answer"],
  parseDiagnosticCount: 0,
};

export async function readTypeScriptProbes(controlRoot, gitExecutable) {
  const inputs = [];
  const committed = async relative => {
    const tree = astGit(gitExecutable, controlRoot, ["ls-tree", "HEAD", "--", relative]).toString("utf8");
    if (!/^100(644|755) blob /.test(tree)) fail(`probe input must be a committed regular file: ${relative}`);
    const bytes = await readFile(path.join(controlRoot, relative)).catch(() => fail(`missing required probe input: ${relative}`));
    if (!bytes.equals(astGit(gitExecutable, controlRoot, ["show", `HEAD:${relative}`]))) fail(`probe input differs from committed identity: ${relative}`);
    inputs.push({ projectId: "tsfg", path: relative, sha256: hash(bytes), role: "build-only", consumer: "tsfg-ast", license: "MIT" });
    return bytes;
  };
  const bytes = await committed(manifestPath);
  let manifest;
  try { manifest = JSON.parse(bytes.toString("utf8")); }
  catch { fail("invalid fixed probe manifest JSON"); }
  if (manifest.schemaVersion !== "1" || manifest.languageBaseline !== "TypeScript 7.0.2"
      || !Array.isArray(manifest.cases) || !isDeepStrictEqual(manifest.cases.map(item => item?.id), required)) fail("all fixed TypeScript probes are required in order");
  for (const item of manifest.cases) {
    const diagnostics = ["syntaxDiagnostics", "semanticDiagnostics", "programDiagnostics", "globalDiagnostics"];
    if (!item.expected || diagnostics.some(key => !Array.isArray(item.expected[key]))
        || Object.keys(item.expected).some(key => ![...diagnostics, "types"].includes(key))) fail(`invalid fixed expectation: ${item.id}`);
    if (item.id !== "syntax-error" && (!Array.isArray(item.expected.types) || !item.expected.types.length)) fail(`required type query missing: ${item.id}`);
    if (item.id === "syntax-error" && !item.expected.syntaxDiagnostics.length
        || item.id === "type-error" && !item.expected.semanticDiagnostics.length) fail(`required negative diagnostic missing: ${item.id}`);
    if (item.id === "positive") {
      if (item.projectId !== "TypeScript.git" || item.path !== "tsc/cmd/tsfg-ast/testdata/positive.ts") fail("positive must reuse the admitted AST input");
    } else {
      if (item.projectId !== "tsfg" || item.path !== `eng/probes/${item.id}.ts`) fail(`invalid probe source: ${item.id}`);
      item.bytes = await committed(item.path);
    }
  }
  const legal = { path: "LICENSE", sha256: hash(await committed("LICENSE")) };
  const review = JSON.parse((await committed("eng/probes/js-isolation.json")).toString("utf8"));
  if (review.schemaVersion !== "1" || review.entry !== "tsc/cmd/tsfg-ast/main.go"
      || !/^sha256:[a-f0-9]{64}$/.test(review.entrySha256) || !/^[a-f0-9]{40}$/.test(review.forkOid)) fail("invalid JS isolation source review");
  return { manifest, review, sha256: hash(bytes), inputs: inputs.map(input => ({ ...input, legal })) };
}

// Reuse the same reconstructed executable and positive source bytes. This is
// evidence for this fixed analysis-only entry, not arbitrary upstream binaries.
export async function runJsIsolation({ probes, ledger, plan, executable, invoke, run, positiveInput }) {
  const review = probes.review;
  const entry = ledger.files.find(file => file.path === review.entry);
  if (ledger.sources[0]?.forkOid !== review.forkOid || entry?.sha256 !== review.entrySha256) fail("JS isolation source review is stale");
  const bytes = await readFile(positiveInput);
  const cases = [];
  const snapshot = async () => (await readdir(plan.moduleRoot, { recursive: true })).sort();
  const before = await snapshot();
  /** @type {{id: string, category: string, extension?: string, args?: string[]}[]} */
  const attempts = [
    ...["js", "mjs", "cjs", "jsx", "JS", "mJs", "CJS"].map(extension => ({ id: `input-${extension}`, category: "js-input", extension })),
    { id: "allow-js", category: "js-input", args: ["--allowJs", "true"] },
    { id: "emit", category: "js-emit", args: ["--emit"] },
    { id: "disable-no-emit", category: "js-emit", args: ["--noEmit", "false"] },
    { id: "output-file", category: "js-emit", args: ["--outFile", "forbidden.js"] },
    { id: "runtime", category: "runtime-fallback", args: ["--runtime", "javascript"] },
    { id: "fallback", category: "runtime-fallback", args: ["--fallback", "javascript"] },
    { id: "eval", category: "runtime-fallback", args: ["--eval", "1+1"] },
  ];
  for (const attempt of attempts) {
    const source = attempt.extension ? path.join(path.dirname(positiveInput), `rejected.${attempt.extension}`) : positiveInput;
    if (attempt.extension) await writeFile(source, bytes, { flag: "wx" });
    try {
      const args = attempt.extension ? [source] : [source, ...attempt.args];
      const child = invoke(executable, args);
      const unchanged = (await readFile(source)).equals(bytes);
      const passed = !child.error && child.status === 2 && child.stdout === ""
        && child.stderr.trim() === "expected one TypeScript source file" && unchanged;
      cases.push({ id: attempt.id, category: attempt.category, status: passed ? "passed" : "failed",
        arguments: args.map(arg => arg === source ? path.basename(source) : arg), sourceSha256: hash(bytes),
        exitCode: child.status, stdout: child.stdout, stderr: child.stderr, error: child.error?.message ?? null });
    } finally {
      if (attempt.extension) await rm(source);
    }
  }
  const noCreatedFiles = isDeepStrictEqual(before, await snapshot());
  // Read metadata from the actual executable using the already locked Go tool.
  const metadata = run(plan.go, ["version", "-m", executable]).split(/\r?\n/).slice(1).filter(Boolean).map(line => line.trim());
  const artifactMatched = metadata.includes("path\tgithub.com/microsoft/typescript-go/cmd/tsfg-ast")
    && ["CGO_ENABLED=0", "GOOS=windows", "GOARCH=amd64", "-buildmode=exe"].every(value => metadata.includes(`build\t${value}`));
  return { schemaVersion: "1", status: cases.every(item => item.status === "passed") && noCreatedFiles && artifactMatched ? "passed" : "failed",
    sourceReview: review, cases, noCreatedFiles,
    artifact: { path: "tsfg-ast.exe", sha256: hash(await readFile(executable)), role: "compiler-probe", metadata, status: artifactMatched ? "matched" : "failed" },
    retainedCompilerDependencies: ledger.files.filter(file => /\/checker\/printer\.go$|\/compiler\/emitter\.go$|\/printer\/|\/transformers\//.test(file.path))
      .map(file => ({ path: file.path, sha256: file.sha256, role: file.role })),
    gameRuntime: { status: "not-applicable", reason: "This target publishes only a compiler-side probe and audit observations; no Zig game runtime is built or packaged." },
    limitations: "Shared emitter/printer source participates in compilation. No claim of complete linker removal or general upstream CLI isolation." };
}

export function matchesTypeScriptObservation(item, observation) {
  const sourceFiles = [`/cmd/tsfg-ast/testdata/${item.id}.ts`,
    "/internal/bundled/libs/lib.decorators.d.ts", "/internal/bundled/libs/lib.decorators.legacy.d.ts",
    "/internal/bundled/libs/lib.es5.d.ts"];
  return observation?.kind === "KindSourceFile" && Object.entries(item.expected)
    .every(([key, value]) => isDeepStrictEqual(observation[key], value))
    && (item.id !== "positive" || Object.entries(positiveAst)
      .every(([key, value]) => isDeepStrictEqual(observation[key], value)))
    && isDeepStrictEqual(observation.sourceFiles, sourceFiles);
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
      const matched = matchesTypeScriptObservation(item, observation);
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
