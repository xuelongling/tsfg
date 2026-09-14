// SPDX-License-Identifier: MIT
// Required upstream regressions of this specific typed source consumer.
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { astAuxiliaryInputs } from "./typescript-ast-inputs.mjs";

const hash = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const suites = [
  { path: "./internal/ast", tests: ["TestDeepCloneNodeSanityCheck", "TestPositionMapASCII", "TestPositionMapTwoByte",
    "TestPositionMapFourByte", "TestPositionMapMultipleNonASCII", "TestPositionMapLoneSurrogateSentinel", "TestPositionMapRoundtrip"] },
  { path: "./internal/diagnostics", tests: ["TestLocalize", "TestLocalize_ByKey"] },
  { path: "./internal/stringutil", tests: ["TestJSCasing", "TestEncodeURI", "TestContainsNonASCII"] },
];

export async function runRequiredTypeScriptTests(intake, plan, serialize) {
  const root = path.join(plan.workRoot, "required-tests");
  await cp(plan.moduleRoot, root, { recursive: true, errorOnExist: true, force: false });
  const inputs = [];
  for (const name of intake.generation?.declaration.testInputs ?? []) {
    const entry = intake.ledger.files.find(file => file.path === `tsc/${name}`);
    if (!entry || entry.role !== "build-only") throw new Error(`required test input is not admitted: ${name}`);
    const bytes = await readFile(path.join(intake.request.workspaceRoot, "typescript/tsc", name));
    if (hash(bytes) !== entry.sha256) throw new Error(`required test input changed: ${name}`);
    const destination = path.join(root, name);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
    inputs.push({ path: name, sha256: entry.sha256, role: "build-only" });
  }
  const audit = await astAuxiliaryInputs(intake, plan, root, [{ tests: true, targets: suites.map(suite => suite.path) }]);
  const args = ["test", "-json", "-count=1", "-vet=off", "-mod=readonly", "-buildvcs=false", "-pgo=off",
    "-trimpath", "-gcflags=all=-N -l", ...suites.map(suite => suite.path)];
  const child = spawnSync(plan.go, args, { cwd: root, env: { ...plan.environment, PATH: path.dirname(plan.go) },
    encoding: "utf8", timeout: 300000, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  const log = `${child.stdout ?? ""}${child.stderr ?? ""}`;
  await writeFile(path.join(plan.workRoot, "required-test-events.jsonstream"), log);
  let events = [], parseError;
  try { events = (child.stdout ?? "").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); }
  catch (error) { parseError = error.message; }
  const key = (item) => `${item.Package}\0${item.Test ?? ""}`;
  const ran = new Set(events.filter(item => item.Action === "run").map(key));
  const passed = events.filter(item => item.Action === "pass" && item.Test && ran.has(key(item)))
    .map(item => ({ package: item.Package, test: item.Test }));
  const skipped = events.filter(item => item.Action === "skip").map(item => ({ package: item.Package, test: item.Test ?? null }));
  const missing = [];
  for (const suite of suites) {
    const name = `github.com/microsoft/typescript-go/${suite.path.slice(2)}`;
    if (!events.some(item => item.Package === name && !item.Test && item.Action === "pass")) missing.push(`${name}: package did not pass`);
    for (const test of suite.tests) if (!passed.some(item => item.package === name && item.test === test)) missing.push(`${name}/${test}`);
  }
  const status = !child.error && child.status === 0 && !parseError && !skipped.length && !missing.length
    && !events.some(item => item.Action === "fail") ? "passed" : "failed";
  await audit.verify();
  const result = { schemaVersion: "1", status, inputs, passed, skipped, missing, intakeLedger: audit.ledger,
    command: { executable: plan.go, arguments: args, cwd: root, exitCode: child.status, error: child.error?.message ?? parseError ?? null },
    eventLog: { path: "required-test-events.jsonstream", sha256: hash(log) },
    excluded: [{ scope: "benchmarks", reason: "No performance claim; benchmark-only checker.ts data is not consumed." },
      { scope: "_tools, editor, API, server, package and release suites", reason: "Independent tools/entrypoints outside this generated AST/type/diagnostic consumer; no main-module lock coverage is claimed for _tools." }] };
  await writeFile(path.join(plan.workRoot, "required-tests.json"), serialize(result));
  return result;
}
