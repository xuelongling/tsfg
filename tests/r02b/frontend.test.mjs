// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { analyzeFrontend, resolveNode, resolveSymbol, resolveType, validateFrontendSnapshot } from "../../compiler/frontend.mjs";
import sourceLock from "../../eng/frontend-source.lock.json" with { type: "json" };
import contractRegistry from "../../contracts/registry.json" with { type: "json" };

const declarations = `// SPDX-License-Identifier: MIT
interface Object {}
interface Function {}
interface CallableFunction {}
interface NewableFunction {}
interface IArguments {}
interface String {}
interface Number {}
interface Boolean {}
interface RegExp {}
interface Array<T> {}
type bool = boolean;
`;
const sha256 = content => `sha256:${createHash("sha256").update(content).digest("hex")}`;

test("frontend input identity rejects non-I-JSON source text", async () => {
  const source = `export function yes(value: bool): bool { return value; } //${String.fromCharCode(0xd800)}`;
  const result = await analyzeFrontend({ sourceRoot: "/src", rootFile: "/src/main.ts",
    files: [{ path: "/src/main.ts", content: source },
      { path: "/src/minimal-bool-v1.d.ts", content: declarations }],
    declarations: { version: "minimal-bool-v1", paths: ["/src/minimal-bool-v1.d.ts"] },
    config: { strict: true, noEmit: true, allowJs: false },
  });
  assert.equal(result.status, "error");
  assert.equal(result.diagnostics[0].code, "r02b-d-input");
});

test("official declaration references close and record the explicit input scope", async () => {
  const source = "export function yes(value: bool): bool { return value; }";
  const user = '/// <reference path="./alias.d.ts" />\n';
  const alias = "type Alias = bool;\n";
  const files = [
    { path: "/src/main.ts", content: source, sha256: sha256(source) },
    { path: "/src/minimal-bool-v1.d.ts", content: declarations, sha256: sha256(declarations) },
    { path: "/src/user.d.ts", content: user, sha256: sha256(user) },
    { path: "/src/alias.d.ts", content: alias, sha256: sha256(alias) },
  ];
  const input = { sourceRoot: "/src", rootFile: "/src/main.ts", files,
    declarations: { version: "minimal-bool-v1", paths: ["/src/minimal-bool-v1.d.ts", "/src/user.d.ts"] },
    config: { strict: true, noEmit: true, allowJs: false } };
  const result = await analyzeFrontend(input, { executable: process.env.TSFG_FRONTEND_EXE });
  assert.equal(result.status, "ok");
  assert.deepEqual(result.snapshot.inputs.map(file => file.path), files.map(file => file.path).sort());
  assert.equal(result.snapshot.inputs.find(file => file.path === "/src/alias.d.ts").sha256, sha256(alias));
  assert.equal(result.snapshot.functions[0].body[0].expression.type, "bool");
  const withoutClaimedHashes = await analyzeFrontend({ ...input,
    files: files.map(({ path, content }) => ({ path, content })) },
  { executable: process.env.TSFG_FRONTEND_EXE });
  assert.equal(withoutClaimedHashes.status, "ok");
  assert.equal(withoutClaimedHashes.snapshot.snapshotId, result.snapshot.snapshotId);
  assert.deepEqual(withoutClaimedHashes.snapshot.inputs, result.snapshot.inputs);
  for (const changed of [
    { ...input, files: files.filter(file => file.path !== "/src/alias.d.ts") },
    { ...input, files: files.map(file => file.path === "/src/alias.d.ts" ? { ...file, sha256: sha256("wrong") } : file) },
  ]) {
    const failure = await analyzeFrontend(changed, { executable: process.env.TSFG_FRONTEND_EXE });
    assert.equal(failure.status, "error");
    assert.equal(failure.snapshot, undefined);
    assert.equal(failure.diagnostics[0].code, "r02b-d-input");
  }
  input.files[3].content = "type Alias = number;";
  assert.equal(result.snapshot.inputs.find(file => file.path === "/src/alias.d.ts").sha256, sha256(alias));
});

test("input scope rejects logical conflicts, extra source roots, and host configuration", async () => {
  const source = "export function yes(value: bool): bool { return value; }";
  const base = {
    sourceRoot: "/src", rootFile: "/src/main.ts",
    files: [{ path: "/src/main.ts", content: source },
      { path: "/src/minimal-bool-v1.d.ts", content: declarations }],
    declarations: { version: "minimal-bool-v1", paths: ["/src/minimal-bool-v1.d.ts"] },
    config: { strict: true, noEmit: true, allowJs: false },
  };
  for (const change of [
    { files: [...base.files, { path: "/src/main.ts", content: source }] },
    { files: [...base.files, { path: "/src/other.ts", content: source }] },
    { files: [...base.files, { path: "/outside/lib.d.ts", content: "" }] },
    { config: { ...base.config, types: ["node"] } },
  ]) {
    const result = await analyzeFrontend({ ...base, ...change }, { executable: process.env.TSFG_FRONTEND_EXE });
    assert.equal(result.status, "error");
    assert.equal(result.snapshot, undefined);
    assert.equal(result.diagnostics[0].code, "r02b-d-input");
  }
  for (const globalName of ["document", "process"]) {
    const result = await analyzeFrontend({ ...base, files: [
      { path: "/src/main.ts", content: `export function yes(value: bool): bool { return ${globalName}; }` },
      base.files[1],
    ] }, { executable: process.env.TSFG_FRONTEND_EXE });
    assert.equal(result.status, "error");
    assert.equal(result.snapshot, undefined);
    assert.equal(result.diagnostics[0].code, "r02b-d-type");
  }
});

test("physical roots and later disk edits cannot change collected logical input", async () => {
  const tempRoot = process.env.TEMP;
  if (!tempRoot?.startsWith("E:\\")) throw new Error("test temporary root must be on E:");
  const root = await mkdtemp(path.join(tempRoot, "r02b-input-roots-"));
  const source = "export function yes(value: bool): bool { return value; }";
  try {
    const inputs = [];
    for (const location of ["first", "second"]) {
      const physical = path.join(root, location);
      await mkdir(physical);
      await writeFile(path.join(physical, "main.ts"), source);
      await writeFile(path.join(physical, "minimal-bool-v1.d.ts"), declarations);
      inputs.push({ sourceRoot: "/src", rootFile: "/src/main.ts", files: [
        { path: "/src/main.ts", content: await readFile(path.join(physical, "main.ts"), "utf8") },
        { path: "/src/minimal-bool-v1.d.ts", content: await readFile(path.join(physical, "minimal-bool-v1.d.ts"), "utf8") },
      ], declarations: { version: "minimal-bool-v1", paths: ["/src/minimal-bool-v1.d.ts"] },
      config: { strict: true, noEmit: true, allowJs: false } });
      await writeFile(path.join(physical, "main.ts"), "invalid changed source");
    }
    const [first, second] = await Promise.all(inputs.map(input =>
      analyzeFrontend(input, { executable: process.env.TSFG_FRONTEND_EXE })));
    assert.equal(first.status, "ok");
    assert.equal(second.status, "ok");
    assert.deepEqual(first.snapshot, second.snapshot);
    assert.equal(first.snapshot.inputs.find(file => file.path === "/src/main.ts").sha256, sha256(source));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const scalarDeclarations = `${declarations}declare const __tsfg_i32: unique symbol;
type i32 = number & { readonly [__tsfg_i32]: true };
type f64 = number;
`;

async function analyzeScalars(source) {
  return analyzeFrontend({
    sourceRoot: "/src", rootFile: "/src/main.ts",
    files: [
      { path: "/src/main.ts", content: source },
      { path: "/src/minimal-scalars-v2.d.ts", content: scalarDeclarations },
    ],
    declarations: { version: "minimal-scalars-v2", paths: ["/src/minimal-scalars-v2.d.ts"] },
    config: { strict: true, noEmit: true, allowJs: false },
  }, { executable: process.env.TSFG_FRONTEND_EXE });
}

test("if/else and while retain ordered branch bodies and owned references", async () => {
  const source = `export function count(flag: bool, limit: i32): i32 {
  let value: i32 = 0;
  if (flag) { const step: i32 = 1; value = value + step; }
  else { value = 2; }
  while (value < limit) { value = value + 1; }
  return value;
}`;
  const result = await analyzeScalars(source);
  assert.equal(result.status, "ok", JSON.stringify(result));
  const { snapshot } = result;
  const [initial, branch, loop, returned] = snapshot.functions[0].body;
  assert.equal(validateFrontendSnapshot(snapshot).functions, 1);
  assert.deepEqual([branch.kind, loop.kind], ["if", "while"]);
  assert.equal(resolveSymbol(snapshot, branch.condition.symbol).name, "flag");
  const [step, update] = branch.thenBody[0].body;
  assert.equal(resolveSymbol(snapshot, update.value.right.symbol).id, step.symbol.id);
  assert.equal(resolveSymbol(snapshot, branch.elseBody[0].body[0].target.symbol).id, initial.symbol.id);
  assert.equal(loop.condition.operator, "<");
  assert.equal(resolveSymbol(snapshot, loop.condition.right.symbol).name, "limit");
  assert.equal(resolveSymbol(snapshot, loop.body[0].body[0].target.symbol).id, initial.symbol.id);
  assert.equal(resolveSymbol(snapshot, returned.expression.symbol).id, initial.symbol.id);
  assert.ok(branch.range.start < loop.range.start && loop.range.end <= returned.range.start);
  assert.equal(Object.isFrozen(branch.thenBody[0].body), true);
});

test("R01 control corpus retains nested returns and branch ordering without execution", async () => {
  const source = await readFile(new URL("../r01/corpus/control/compare.ts", import.meta.url), "utf8");
  const result = await analyzeScalars(source);
  assert.equal(result.status, "ok", JSON.stringify(result));
  const { snapshot } = result;
  const outer = snapshot.functions[0].body[0];
  assert.equal(outer.kind, "if");
  assert.equal(outer.condition.operator, "<");
  assert.equal(resolveSymbol(snapshot, outer.condition.left.symbol).name, "a");
  assert.equal(outer.thenBody[0].body[0].expression.literal.decimal, "-1");
  const nested = outer.elseBody[0].body[0];
  assert.equal(nested.kind, "if");
  assert.equal(nested.condition.operator, "===");
  assert.equal(nested.thenBody[0].body[0].expression.literal.decimal, "0");
  assert.equal(nested.elseBody[0].body[0].expression.literal.decimal, "1");
  assert.ok(outer.thenBody[0].range.end <= outer.elseBody[0].range.start);
});

test("R01 local and loop corpus expose frontend structure, not execution results", async () => {
  const locals = await analyzeScalars(await readFile(new URL("../r01/corpus/control/locals.ts", import.meta.url), "utf8"));
  const loop = await analyzeScalars(await readFile(new URL("../r01/corpus/control/loop.ts", import.meta.url), "utf8"));
  assert.equal(locals.status, "ok", JSON.stringify(locals));
  assert.equal(loop.status, "ok", JSON.stringify(loop));
  const branch = locals.snapshot.functions[0].body[2];
  assert.equal(branch.kind, "if");
  assert.equal(branch.thenBody[0].body[0].value.operator, "+");
  assert.equal(branch.elseBody[0].body[0].value.operator, "-");
  const whileNode = loop.snapshot.functions[0].body[1];
  assert.equal(whileNode.kind, "while");
  assert.equal(whileNode.condition.operator, "<");
  assert.equal(resolveSymbol(loop.snapshot, whileNode.body[0].body[0].target.symbol).name, "count");
});

test("invalid control conditions, escaped locals, and branch returns have stable diagnostics", async () => {
  for (const [source, code] of [
    ["export function bad(value: i32): i32 { if (value) { return 1; } else { return 2; } }", "r01-d-scalar-type"],
    ["export function bad(value: i32): i32 { while (value) { value = value; } return value; }", "r01-d-scalar-type"],
    ["export function bad(flag: bool): i32 { if (flag) { const inside: i32 = 1; } return inside; }", "r01-d-unresolved-name"],
    ["export function bad(flag: bool): i32 { if (flag) { return true; } return 1; }", "r01-d-scalar-type"],
  ]) {
    const result = await analyzeScalars(source);
    assert.equal(result.status, "error", JSON.stringify(result));
    assert.equal(result.snapshot, undefined);
    assert.equal(result.diagnostics[0].code, code, JSON.stringify(result));
    assert.equal(result.diagnostics[0].primary.sourceId, "/src/main.ts");
  }
});

test("control conditions retain UTF-16 positions across CRLF and supplementary text", async () => {
  const source = "// 😀\r\nexport function choose(flag: bool): bool {\r\n  if (flag) { return flag; } else { return false; }\r\n}";
  const result = await analyzeScalars(source);
  assert.equal(result.status, "ok", JSON.stringify(result));
  const branch = result.snapshot.functions[0].body[0];
  const start = source.indexOf("flag)");
  assert.deepEqual(branch.condition.range, { start, end: start + 4 });
  assert.equal(branch.range.start, source.indexOf("if ("));
  assert.equal(branch.range.end, source.indexOf("\r\n}", branch.range.start));
});

test("an inferred i32 local returned inside a branch keeps its declaration identity", async () => {
  const source = "export function choose(flag: bool): i32 { if (flag) { const value = 1; return value; } return 2; }";
  const result = await analyzeScalars(source);
  assert.equal(result.status, "ok", JSON.stringify(result));
  const branch = result.snapshot.functions[0].body[0];
  const [variable, returned] = branch.thenBody[0].body;
  assert.equal(variable.symbol.type, "i32");
  assert.equal(resolveSymbol(result.snapshot, returned.expression.symbol).id, variable.symbol.id);
});

test("i32 operators in nested returns retain their typed structure", async () => {
  const source = "export function next(flag: bool, value: i32): i32 { if (flag) { const step: i32 = 1; return value + step; } return value; }";
  const result = await analyzeScalars(source);
  assert.equal(result.status, "ok", JSON.stringify(result));
  const [step, branchReturn] = result.snapshot.functions[0].body[0].thenBody[0].body;
  assert.equal(branchReturn.expression.kind, "binary");
  assert.equal(branchReturn.expression.type, "i32");
  assert.equal(resolveSymbol(result.snapshot, branchReturn.expression.left.symbol).name, "value");
  assert.equal(resolveSymbol(result.snapshot, branchReturn.expression.right.symbol).id, step.symbol.id);
});

test("initialized let, assignment, and reads bind to declarations in source order", async () => {
  const result = await analyzeScalars("export function update(seed: i32): i32 { let value: i32 = seed; value = 7; return value; }");
  assert.equal(result.status, "ok", JSON.stringify(result));
  const { snapshot } = result;
  const [variable, assignment, returned] = snapshot.functions[0].body;
  assert.deepEqual([variable.kind, assignment.kind, returned.kind], ["variable", "assignment", "return"]);
  assert.equal(resolveSymbol(snapshot, variable.initializer.symbol).id, snapshot.functions[0].parameters[0].id);
  assert.equal(resolveSymbol(snapshot, assignment.target.symbol).id, variable.symbol.id);
  assert.equal(resolveSymbol(snapshot, returned.expression.symbol).id, variable.symbol.id);
  assert.equal(assignment.value.literal.decimal, "7");
  assert.ok(variable.range.end <= assignment.range.start && assignment.range.end <= returned.range.start);
});

test("bool locals retain type and declaration identity through assignment", async () => {
  const result = await analyzeScalars("export function choose(flag: bool): bool { let value: bool = flag; value = true; return value; }");
  assert.equal(result.status, "ok", JSON.stringify(result));
  const { snapshot } = result;
  const [variable, assignment, returned] = snapshot.functions[0].body;
  assert.equal(variable.symbol.type, "bool");
  assert.equal(assignment.value.type, "bool");
  assert.equal(assignment.value.boolean, true);
  assert.equal(resolveSymbol(snapshot, assignment.target.symbol).id, variable.symbol.id);
  assert.equal(resolveSymbol(snapshot, returned.expression.symbol).id, variable.symbol.id);
});

test("nested block shadowing resolves each read to the checker declaration", async () => {
  const source = "export function choose(value: i32): i32 { { const value: i32 = 4; const inner: i32 = value; } return value; }";
  const result = await analyzeScalars(source);
  assert.equal(result.status, "ok", JSON.stringify(result));
  const { snapshot } = result;
  const [block, returned] = snapshot.functions[0].body;
  const [shadow, inner] = block.body;
  assert.equal(block.kind, "block");
  assert.notEqual(shadow.symbol.id, snapshot.functions[0].parameters[0].id);
  assert.equal(resolveSymbol(snapshot, inner.initializer.symbol).id, shadow.symbol.id);
  assert.equal(resolveSymbol(snapshot, returned.expression.symbol).id, snapshot.functions[0].parameters[0].id);
});

test("the consumer rejects a shadowed read linked to the outer declaration", async () => {
  const result = await analyzeScalars("export function choose(value: i32): i32 { { const value: i32 = 4; const inner: i32 = value; } return value; }");
  assert.equal(result.status, "ok", JSON.stringify(result));
  assert.equal(validateFrontendSnapshot(result.snapshot).functions, 1);
  const damaged = structuredClone(result.snapshot);
  damaged.functions[0].body[0].body[1].initializer.symbol = damaged.functions[0].parameters[0].ref;
  assert.throws(() => validateFrontendSnapshot(damaged), TypeError);
});

test("simple assignment inside a nested block retains its outer binding", async () => {
  const result = await analyzeScalars("export function update(): i32 { let value: i32 = 1; { value = 2; } return value; }");
  assert.equal(result.status, "ok", JSON.stringify(result));
  const { snapshot } = result;
  const [variable, block, returned] = snapshot.functions[0].body;
  assert.equal(resolveSymbol(snapshot, block.body[0].target.symbol).id, variable.symbol.id);
  assert.equal(resolveSymbol(snapshot, returned.expression.symbol).id, variable.symbol.id);
});

test("a nested unannotated integer local keeps its default i32 type", async () => {
  const result = await analyzeScalars("export function answer(): i32 { { const value = 1; return value; } }");
  assert.equal(result.status, "ok", JSON.stringify(result));
  const { snapshot } = result;
  const [variable, returned] = snapshot.functions[0].body[0].body;
  assert.equal(variable.symbol.type, "i32");
  assert.equal(resolveSymbol(snapshot, returned.expression.symbol).id, variable.symbol.id);
});

test("unannotated integer locals retain default i32 through a read chain", async () => {
  const result = await analyzeScalars("export function answer(): i32 { const seed = 3; const value = seed; return value; }");
  assert.equal(result.status, "ok", JSON.stringify(result));
  const { snapshot } = result;
  const [seed, value, returned] = snapshot.functions[0].body;
  assert.equal(seed.symbol.type, "i32");
  assert.equal(value.symbol.type, "i32");
  assert.equal(resolveSymbol(snapshot, value.initializer.symbol).id, seed.symbol.id);
  assert.equal(resolveSymbol(snapshot, returned.expression.symbol).id, value.symbol.id);
});

test("multiple initialized declarations preserve order and binding", async () => {
  const result = await analyzeScalars("export function answer(): i32 { const one: i32 = 1, two: i32 = one; return two; }");
  assert.equal(result.status, "ok", JSON.stringify(result));
  const { snapshot } = result;
  const [one, two, returned] = snapshot.functions[0].body;
  assert.deepEqual([one.kind, two.kind, returned.kind], ["variable", "variable", "return"]);
  assert.equal(resolveSymbol(snapshot, two.initializer.symbol).id, one.symbol.id);
  assert.equal(resolveSymbol(snapshot, returned.expression.symbol).id, two.symbol.id);
  assert.ok(one.range.end <= two.range.start);
});

test("invalid local writes and out-of-scope reads never produce a snapshot", async () => {
  for (const [source, code] of [
    ["export function bad(): i32 { const value: i32 = 1; value = 2; return value; }", "r02b-d-type"],
    ["export function bad(): i32 { let value: i32 = 1; value = true; return value; }", "r01-d-scalar-type"],
    ["export function bad(): i32 { { const value: i32 = 1; } return value; }", "r01-d-unresolved-name"],
  ]) {
    const result = await analyzeScalars(source);
    assert.equal(result.status, "error", JSON.stringify(result));
    assert.equal(result.snapshot, undefined);
    assert.equal(result.diagnostics[0].code, code, JSON.stringify(result));
    assert.equal(result.diagnostics[0].primary.sourceId, "/src/main.ts");
  }
});

test("the R01 invalid-local corpus keeps its scalar diagnostic", async () => {
  const source = await readFile(new URL("../r01/corpus/control/invalid-local.ts", import.meta.url), "utf8");
  const result = await analyzeScalars(source);
  assert.equal(result.status, "error");
  assert.equal(result.snapshot, undefined);
  assert.equal(result.diagnostics[0].code, "r01-d-scalar-type", JSON.stringify(result));
});

test("uninitialized locals are reported as pending capability", async () => {
  const result = await analyzeScalars("export function pending(): i32 { let value: i32; return value; }");
  assert.equal(result.status, "error");
  assert.equal(result.snapshot, undefined);
  assert.equal(result.diagnostics[0].code, "r02b-d-unsupported");
});

test("compound assignment and increment remain pending capabilities", async () => {
  for (const source of [
    "export function pending(): i32 { let value: i32 = 1; value += 1; return value; }",
    "export function pending(): i32 { let value: i32 = 1; value++; return value; }",
    "export function pending(value: i32): i32 { return value += 1; }",
    "export function pending(value: i32): i32 { return value &= value; }",
    "export function pending(value: i32): i32 { return value **= 2; }",
    "export function pending(value: i32): i32 { return ++value; }",
    "export function pending(value: i32): i32 { return value++; }",
    "export function pending(value: i32): i32 { const next: i32 = value += 1; return next; }",
  ]) {
    const result = await analyzeScalars(source);
    assert.equal(result.status, "error");
    assert.equal(result.snapshot, undefined);
    assert.equal(result.diagnostics[0].code, "r02b-d-unsupported", JSON.stringify(result));
  }
});

const analyzeScalar = source => analyzeFrontend({
  sourceRoot: "/src", rootFile: "/src/main.ts",
  files: [
    { path: "/src/main.ts", content: source },
    { path: "/src/minimal-scalars-v2.d.ts", content: scalarDeclarations },
  ],
  declarations: { version: "minimal-scalars-v2", paths: ["/src/minimal-scalars-v2.d.ts"] },
  config: { strict: true, noEmit: true, allowJs: false },
}, { executable: process.env.TSFG_FRONTEND_EXE });

const analyzeCalls = analyzeScalar;

test("arithmetic snapshot preserves precedence, operand order, types, and source ranges", async () => {
  const source = "export function calc(a: i32, b: i32): i32 { return a + b * 2; }";
  const result = await analyzeFrontend({
    sourceRoot: "/src", rootFile: "/src/main.ts",
    files: [
      { path: "/src/main.ts", content: source },
      { path: "/src/minimal-scalars-v2.d.ts", content: scalarDeclarations },
    ],
    declarations: { version: "minimal-scalars-v2", paths: ["/src/minimal-scalars-v2.d.ts"] },
    config: { strict: true, noEmit: true, allowJs: false },
  }, { executable: process.env.TSFG_FRONTEND_EXE });
  assert.equal(result.status, "ok");
  const expression = result.snapshot.functions[0].body[0].expression;
  assert.equal(result.snapshot.capability, "minimal-scalars-v2");
  assert.equal(expression.kind, "binary");
  assert.equal(expression.operator, "+");
  assert.equal(expression.type, "i32");
  assert.deepEqual(expression.range, { start: source.indexOf("a +"), end: source.indexOf("; }") });
  assert.equal(resolveSymbol(result.snapshot, expression.left.symbol).name, "a");
  assert.equal(expression.right.operator, "*");
  assert.equal(expression.right.type, "i32");
  assert.equal(resolveSymbol(result.snapshot, expression.right.left.symbol).name, "b");
  assert.deepEqual(expression.right.right.literal, { decimal: "2", token: "2" });
});

test("bitwise and shift operators retain their operation and i32 operands", async () => {
  for (const operator of ["&", "|", "^", "<<", ">>", ">>>"]) {
    const result = await analyzeScalar(`export function op(a: i32, b: i32): i32 { return a ${operator} b; }`);
    assert.equal(result.status, "ok", operator);
    const expression = result.snapshot.functions[0].body[0].expression;
    assert.equal(expression.operator, operator);
    assert.equal(expression.type, "i32");
    assert.equal(expression.left.type, "i32");
    assert.equal(expression.right.type, "i32");
    assert.equal(resolveSymbol(result.snapshot, expression.left.symbol).name, "a");
    assert.equal(resolveSymbol(result.snapshot, expression.right.symbol).name, "b");
  }
  const invalid = await analyzeScalar("export function op(a: i32, b: bool): i32 { return a << b; }");
  assert.equal(invalid.status, "error");
  assert.equal(invalid.snapshot, undefined);
  assert.equal(invalid.diagnostics[0].code, "r01-d-shift-count-type");
  assert.equal(invalid.diagnostics[0].ruleId, "r01-shifts");
});

test("arithmetic operators retain runtime trap candidates without compile rejection", async () => {
  for (const operator of ["-", "/", "%"]) {
    const result = await analyzeScalar(`export function op(a: i32): i32 { return a ${operator} 0; }`);
    assert.equal(result.status, "ok", operator);
    assert.equal(result.snapshot.functions[0].body[0].expression.operator, operator);
  }
  const shift = await analyzeScalar("export function op(a: i32): i32 { return a << 32; }");
  assert.equal(shift.status, "ok");
  assert.equal(shift.snapshot.functions[0].body[0].expression.right.literal.decimal, "32");
  const wrong = await analyzeScalar("export function op(a: i32, b: bool): i32 { return a + b; }");
  assert.equal(wrong.status, "error");
  assert.equal(wrong.snapshot, undefined);
  assert.equal(wrong.diagnostics[0].code, "r01-d-scalar-type");
});

test("comparison and strict equality produce bool from same-type operands", async () => {
  for (const operator of ["<", "<=", ">", ">=", "===", "!=="]) {
    const result = await analyzeScalar(`export function compare(a: i32, b: i32): bool { return a ${operator} b; }`);
    assert.equal(result.status, "ok", operator);
    const expression = result.snapshot.functions[0].body[0].expression;
    assert.equal(expression.operator, operator);
    assert.equal(expression.type, "bool");
    assert.equal(expression.left.type, "i32");
    assert.equal(expression.right.type, "i32");
  }
  const boolEquality = await analyzeScalar("export function same(a: bool, b: boolean): bool { return a === b; }");
  assert.equal(boolEquality.status, "ok");
  assert.equal(boolEquality.snapshot.functions[0].body[0].expression.left.type, "bool");
  const mismatch = await analyzeScalar("export function wrong(a: i32, b: bool): bool { return a === b; }");
  assert.equal(mismatch.status, "error");
  assert.equal(mismatch.diagnostics[0].code, "r01-d-scalar-type");
});

test("logical negation and short circuit retain conditional nesting", async () => {
  const nested = await analyzeScalar("export function choose(a: bool, b: bool, c: bool): bool { return a && (b || !c); }");
  assert.equal(nested.status, "ok");
  const outer = nested.snapshot.functions[0].body[0].expression;
  assert.equal(outer.kind, "shortCircuit");
  assert.equal(outer.operator, "&&");
  assert.equal(resolveSymbol(nested.snapshot, outer.left.symbol).name, "a");
  assert.equal(outer.right.kind, "group");
  assert.equal(outer.right.operand.kind, "shortCircuit");
  assert.equal(outer.right.operand.operator, "||");
  assert.equal(outer.right.operand.right.kind, "unary");
  assert.equal(outer.right.operand.right.operator, "!");
  assert.equal(resolveSymbol(nested.snapshot, outer.right.operand.right.operand.symbol).name, "c");
  const dormantTrap = await analyzeScalar("export function guard(a: bool, x: i32): bool { return a && (x / 0 > 1); }");
  assert.equal(dormantTrap.status, "ok");
  assert.equal(dormantTrap.snapshot.functions[0].body[0].expression.right.operand.left.operator, "/");
  const wrong = await analyzeScalar("export function wrong(a: bool, x: i32): bool { return a && x; }");
  assert.equal(wrong.status, "error");
  assert.equal(wrong.diagnostics[0].code, "r01-d-scalar-type");
});

test("direct unary operators and prohibited loose equality are classified", async () => {
  for (const [operator, type] of [["!", "bool"], ["~", "i32"], ["-", "i32"], ["+", "i32"]]) {
    const result = await analyzeScalar(`export function unary(value: ${type}): ${type} { return ${operator}value; }`);
    assert.equal(result.status, "ok", operator);
    const expression = result.snapshot.functions[0].body[0].expression;
    assert.equal(expression.kind, "unary");
    assert.equal(expression.operator, operator);
    assert.equal(expression.type, type);
    assert.equal(resolveSymbol(result.snapshot, expression.operand.symbol).name, "value");
  }
  for (const operator of ["==", "!="]) {
    const result = await analyzeScalar(`export function wrong(a: i32, b: i32): bool { return a ${operator} b; }`);
    assert.equal(result.status, "error", operator);
    assert.equal(result.snapshot, undefined);
    assert.equal(result.diagnostics[0].code, "r02b-d-prohibited");
    assert.equal(result.diagnostics[0].category, "prohibited");
  }
});

test("typed f64 operands do not convert into i32 operator results", async () => {
  for (const source of [
    "export function wrong(a: i32, b: f64): i32 { return a + b; }",
    "export function wrong(a: f64, b: i32): bool { return a < b; }",
  ]) {
    const result = await analyzeScalar(source);
    assert.equal(result.status, "error", source);
    assert.equal(result.snapshot, undefined);
    assert.equal(result.diagnostics[0].code, "r01-d-scalar-type");
  }
});

test("parentheses do not change an invalid operand diagnostic", async () => {
  for (const expression of ["a + b", "(a + b)"]) {
    const result = await analyzeScalar(`export function wrong(a: i32, b: bool): i32 { return ${expression}; }`);
    assert.equal(result.status, "error", expression);
    assert.equal(result.snapshot, undefined);
    assert.equal(result.diagnostics[0].code, "r01-d-scalar-type", expression);
  }
});

test("parentheses preserve a valid i32 arithmetic return", async () => {
  const result = await analyzeScalar("export function sum(a: i32, b: i32): i32 { return (a + b); }");
  assert.equal(result.status, "ok");
  const expression = result.snapshot.functions[0].body[0].expression;
  assert.equal(expression.kind, "group");
  assert.equal(expression.operand.operator, "+");
});

test("loose equality stays prohibited even when official typing also rejects it", async () => {
  for (const operator of ["==", "!="]) {
    const result = await analyzeScalar(`export function wrong(a: i32, b: bool): bool { return a ${operator} b; }`);
    assert.equal(result.status, "error", operator);
    assert.equal(result.snapshot, undefined);
    assert.equal(result.diagnostics[0].code, "r02b-d-prohibited", operator);
    assert.equal(result.diagnostics[0].category, "prohibited", operator);
  }
});

test("same-type f64 arithmetic is a pending capability, not a language error", async () => {
  const result = await analyzeScalar("export function later(a: f64, b: f64): f64 { return a + b; }");
  assert.equal(result.status, "error");
  assert.equal(result.snapshot, undefined);
  assert.equal(result.diagnostics[0].code, "r02b-d-unsupported");
  assert.equal(result.diagnostics[0].category, "unsupported");
});

test("valid f64 unary arithmetic remains a pending capability", async () => {
  const result = await analyzeScalar("export function later(a: f64): f64 { return -a; }");
  assert.equal(result.status, "error");
  assert.equal(result.snapshot, undefined);
  assert.equal(result.diagnostics[0].code, "r02b-d-unsupported");
  assert.equal(result.diagnostics[0].category, "unsupported");
});

test("integer literal can take a typed f64 operator context", async () => {
  for (const source of [
    "export function later(a: f64): f64 { return a + 1; }",
    "export function later(a: f64): f64 { return a + 2147483648; }",
    "export function later(a: f64): f64 { return (2147483648) + a; }",
    "export function later(a: f64): f64 { return a + -2147483649; }",
    "export function later(a: f64): bool { return a < (2147483648); }",
    "export function later(a: f64): bool { return a === 2147483648; }",
  ]) {
    const result = await analyzeScalar(source);
    assert.equal(result.status, "error", source);
    assert.equal(result.snapshot, undefined);
    assert.equal(result.diagnostics[0].code, "r02b-d-unsupported", source);
    assert.equal(result.diagnostics[0].category, "unsupported", source);
  }
});

test("numeric truthiness is pending rather than an invalid source expression", async () => {
  for (const type of ["f64", "i32"]) {
    const result = await analyzeScalar(`export function later(a: ${type}): bool { return !a; }`);
    assert.equal(result.status, "error", type);
    assert.equal(result.snapshot, undefined);
    assert.equal(result.diagnostics[0].code, "r02b-d-unsupported", type);
    assert.equal(result.diagnostics[0].category, "unsupported", type);
  }
});

test("numeric short circuit outside the bool slice remains pending", async () => {
  for (const [left, right, operator] of [
    ["f64", "f64", "&&"], ["i32", "i32", "&&"],
    ["i32", "f64", "&&"], ["f64", "i32", "||"],
  ]) {
    const resultType = left === "i32" && right === "i32" ? "i32" : "f64";
    const source = `export function later(a: ${left}, b: ${right}): ${resultType} { return a ${operator} b; }`;
    const result = await analyzeScalar(source);
    assert.equal(result.status, "error", source);
    assert.equal(result.snapshot, undefined);
    assert.equal(result.diagnostics[0].code, "r02b-d-unsupported", source);
    assert.equal(result.diagnostics[0].category, "unsupported", source);
  }
});

test("an uncontextualized wide integer in arithmetic still fails i32 range", async () => {
  const result = await analyzeScalar("export function wrong(): i32 { return 1 + 2147483648; }");
  assert.equal(result.status, "error");
  assert.equal(result.snapshot, undefined);
  assert.equal(result.diagnostics[0].code, "r01-d-integer-range");
});

test("legal exponentiation outside the first operator slice remains pending", async () => {
  for (const expression of ["a ** 2", "(a ** b)"]) {
    const source = `export function later(a: i32, b: i32): i32 { return ${expression}; }`;
    const result = await analyzeScalar(source);
    assert.equal(result.status, "error", expression);
    assert.equal(result.snapshot, undefined);
    assert.equal(result.diagnostics[0].code, "r02b-d-unsupported", expression);
    assert.equal(result.diagnostics[0].category, "unsupported", expression);
  }
});

test("invalid exponent operands do not become pending capability", async () => {
  const result = await analyzeScalar("export function wrong(a: i32): i32 { return a ** true; }");
  assert.equal(result.status, "error");
  assert.equal(result.snapshot, undefined);
  assert.notEqual(result.diagnostics[0].code, "r02b-d-unsupported");
});

test("fractional f64 operand cannot implicitly join i32 arithmetic", async () => {
  const result = await analyzeScalar("export function wrong(a: i32): i32 { return a + 1.5; }");
  assert.equal(result.status, "error");
  assert.equal(result.snapshot, undefined);
  assert.equal(result.diagnostics[0].code, "r01-d-scalar-type");
});

test("nested fractional f64 operand reports the inner i32 mixing error", async () => {
  const result = await analyzeScalar("export function wrong(a: i32): bool { return a + 1.5 > 0; }");
  assert.equal(result.status, "error");
  assert.equal(result.snapshot, undefined);
  assert.equal(result.diagnostics[0].code, "r01-d-scalar-type");
});

test("operator operand diagnostics begin at the token after multiline trivia", async () => {
  const source = "export function wrong(a: i32): i32 { return a +\r\n  false; }";
  const result = await analyzeScalar(source);
  assert.equal(result.status, "error");
  assert.equal(result.diagnostics[0].code, "r01-d-scalar-type");
  assert.equal(result.diagnostics[0].primary.start, source.indexOf("false"));
  assert.equal(result.diagnostics[0].primary.startLine, 1);
  assert.equal(result.diagnostics[0].primary.startColumn, 2);
});

test("operator diagnostics anchor the invalid left operand when the right is valid", async () => {
  const source = "export function wrong(a: bool, b: i32): i32 { return a << b; }";
  const result = await analyzeScalar(source);
  assert.equal(result.status, "error");
  assert.equal(result.diagnostics[0].code, "r01-d-scalar-type");
  assert.equal(result.diagnostics[0].primary.start, source.indexOf("a <<"));
});
  test("i32 parameter and return retain a scalar fact and symbol relation", async () => {
  const source = "export function identity(value: i32): i32 { return value; }";
  const result = await analyzeFrontend({
    sourceRoot: "/src", rootFile: "/src/main.ts",
    files: [
      { path: "/src/main.ts", content: source },
      { path: "/src/minimal-scalars-v2.d.ts", content: scalarDeclarations },
    ],
    declarations: { version: "minimal-scalars-v2", paths: ["/src/minimal-scalars-v2.d.ts"] },
    config: { strict: true, noEmit: true, allowJs: false },
  }, { executable: process.env.TSFG_FRONTEND_EXE });
  assert.equal(result.status, "ok");
  const fn = result.snapshot.functions[0];
  assert.equal(fn.returnType, "i32");
  assert.equal(fn.parameters[0].type, "i32");
  assert.equal(fn.body[0].expression.type, "i32");
  assert.equal(resolveSymbol(result.snapshot, fn.body[0].expression.symbol).name, "value");
});

test("a forward call resolves its function symbol and ordered signature", async () => {
  const result = await analyzeFrontend({
    sourceRoot: "/src", rootFile: "/src/main.ts",
    files: [
      { path: "/src/main.ts", content: "export function entry(a: i32, b: bool): bool { return target(a, b); } export function target(x: i32, y: bool): bool { return y; }" },
      { path: "/src/minimal-scalars-v2.d.ts", content: scalarDeclarations },
    ],
    declarations: { version: "minimal-scalars-v2", paths: ["/src/minimal-scalars-v2.d.ts"] },
    config: { strict: true, noEmit: true, allowJs: false },
  }, { executable: process.env.TSFG_FRONTEND_EXE });
  assert.equal(result.status, "ok");
  const [entry, target] = result.snapshot.functions;
  const call = entry.body[0].expression;
  assert.equal(call.kind, "call");
  assert.equal(call.type, "bool");
  assert.equal(resolveSymbol(result.snapshot, call.target).id, target.symbol.id);
  assert.deepEqual(call.signature, { parameters: ["i32", "bool"], returnType: "bool" });
  assert.deepEqual(call.arguments.map(argument => argument.type), ["i32", "bool"]);
  assert.deepEqual(call.arguments.map(argument => resolveSymbol(result.snapshot, argument.symbol).name), ["a", "b"]);
});

test("the public consumer validates a real call graph and rejects foreign symbol links", async () => {
  const source = "export function entry(x: i32): i32 { return target(x); } export function target(y: i32): i32 { return y; }";
  const first = await analyzeCalls(source);
  const second = await analyzeCalls(source.replaceAll("target", "other"));
  assert.equal(first.status, "ok");
  assert.equal(second.status, "ok");
  assert.deepEqual(validateFrontendSnapshot(first.snapshot), {
    snapshotId: first.snapshot.snapshotId, functions: 2, calls: 1,
  });
  const mixed = structuredClone(first.snapshot);
  mixed.functions[0].body[0].expression.target = second.snapshot.functions[1].symbol;
  assert.throws(() => validateFrontendSnapshot(mixed), TypeError);
  const foreignDefinition = structuredClone(first.snapshot);
  foreignDefinition.symbols[0].ref = second.snapshot.symbols[0].ref;
  assert.throws(() => validateFrontendSnapshot(foreignDefinition), TypeError);
});

test("the consumer checks same-snapshot call targets against signature and arguments", async () => {
  const source = "export function entry(x: i32): i32 { return target(x); } export function target(y: i32): i32 { return y; } export function other(z: bool): i32 { return 1; }";
  const result = await analyzeCalls(source);
  assert.equal(result.status, "ok");
  const mixed = structuredClone(result.snapshot);
  mixed.functions[0].body[0].expression.target = mixed.functions[2].symbol;
  assert.throws(() => validateFrontendSnapshot(mixed), TypeError);
  const falseSignature = structuredClone(result.snapshot);
  falseSignature.functions[0].body[0].expression.signature.parameters[0] = "bool";
  assert.throws(() => validateFrontendSnapshot(falseSignature), TypeError);
  const missingTarget = structuredClone(result.snapshot);
  delete missingTarget.functions[0].body[0].expression.target;
  assert.throws(() => validateFrontendSnapshot(missingTarget), TypeError);
});

test("the consumer binds function node and symbol references to their declarations", async () => {
  const result = await analyzeCalls("export function first(x: i32): i32 { return x; } export function second(y: i32): i32 { return y; }");
  assert.equal(result.status, "ok");
  for (const field of ["node", "symbol"]) {
    const swapped = structuredClone(result.snapshot);
    swapped.functions[0][field] = swapped.functions[1][field];
    assert.throws(() => validateFrontendSnapshot(swapped), TypeError);
  }
});

test("the consumer rejects wrong same-snapshot parameter, use, and call links", async () => {
  const result = await analyzeCalls("export function entry(x: i32, y: i32): i32 { return first(x); } export function first(a: i32): i32 { return a; } export function second(b: i32): i32 { return b; }");
  assert.equal(result.status, "ok");
  const wrongParameter = structuredClone(result.snapshot);
  wrongParameter.functions[0].parameters[0].ref = wrongParameter.functions[0].parameters[1].ref;
  assert.throws(() => validateFrontendSnapshot(wrongParameter), TypeError);
  const wrongUse = structuredClone(result.snapshot);
  wrongUse.functions[0].body[0].expression.arguments[0].symbol = wrongUse.functions[0].parameters[1].ref;
  assert.throws(() => validateFrontendSnapshot(wrongUse), TypeError);
  const wrongTarget = structuredClone(result.snapshot);
  wrongTarget.functions[0].body[0].expression.target = wrongTarget.functions[2].symbol;
  assert.throws(() => validateFrontendSnapshot(wrongTarget), TypeError);
  const sameName = await analyzeCalls("export function first(x: i32): i32 { return x; } export function second(x: i32): i32 { return x; }");
  assert.equal(sameName.status, "ok");
  const foreignScope = structuredClone(sameName.snapshot);
  foreignScope.functions[0].body[0].expression.symbol = foreignScope.functions[1].parameters[0].ref;
  assert.throws(() => validateFrontendSnapshot(foreignScope), TypeError);
});

test("local declaration links and source-backed names cannot be reassigned", async () => {
  const result = await analyzeCalls("export function locals(x: i32): i32 { const value = 1; return value; }");
  assert.equal(result.status, "ok");
  const wrongLocal = structuredClone(result.snapshot);
  wrongLocal.functions[0].body[0].symbol.ref = wrongLocal.functions[0].parameters[0].ref;
  assert.throws(() => validateFrontendSnapshot(wrongLocal), TypeError);
  const changedSource = structuredClone(result.snapshot);
  changedSource.source.content = changedSource.source.content.replace("return value", "return other");
  assert.throws(() => validateFrontendSnapshot(changedSource), TypeError);
});

test("a call with whitespace before its argument list keeps its target link", async () => {
  const result = await analyzeCalls("export function entry(x: i32): i32 { return target (x); } export function target(y: i32): i32 { return y; }");
  assert.equal(result.status, "ok");
  assert.equal(validateFrontendSnapshot(result.snapshot).calls, 1);
});

test("node and type references are snapshot-owned and invalid local IDs reject", async () => {
  const first = await analyzeCalls("export function entry(x: i32): i32 { return target(x); } export function target(y: i32): i32 { return y; }");
  const second = await analyzeCalls("export function other(x: i32): i32 { return x; }");
  assert.equal(first.status, "ok");
  assert.equal(second.status, "ok");
  const fn = first.snapshot.functions[0];
  const call = fn.body[0].expression;
  assert.equal(resolveNode(first.snapshot, fn.node).kind, "function");
  assert.equal(resolveNode(first.snapshot, call.node).kind, "call");
  assert.deepEqual(resolveType(first.snapshot, call.typeRef), { id: call.typeRef.id, kind: "scalar", scalar: "i32" });
  assert.equal(resolveType(first.snapshot, first.snapshot.symbols[0].typeRef).scalar, first.snapshot.symbols[0].type);
  assert.throws(() => resolveNode(second.snapshot, fn.node), TypeError);
  assert.throws(() => resolveType(second.snapshot, call.typeRef), TypeError);
  assert.throws(() => resolveNode(first.snapshot, { snapshotId: first.snapshot.snapshotId, id: "n999" }), RangeError);
  assert.throws(() => resolveType(first.snapshot, { snapshotId: first.snapshot.snapshotId, id: "t999" }), RangeError);
  for (const ref of ["node", "typeRef"]) {
    const mixed = structuredClone(first.snapshot);
    mixed.functions[0].body[0].expression[ref] = second.snapshot.functions[0].body[0].expression[ref];
    assert.throws(() => validateFrontendSnapshot(mixed), TypeError);
  }
  const badSymbolType = structuredClone(first.snapshot);
  badSymbolType.symbols[0].typeRef = second.snapshot.symbols[0].typeRef;
  assert.throws(() => validateFrontendSnapshot(badSymbolType), TypeError);
  const old = structuredClone(first.snapshot);
  old.contractVersion = "2";
  assert.throws(() => validateFrontendSnapshot(old), TypeError);
});

test("snapshot and consumer share the registered exact contract", async () => {
  const result = await analyzeCalls("export function answer(): i32 { return 17; }");
  assert.equal(result.status, "ok");
  const contract = contractRegistry["tsfg.frontend-snapshot"];
  assert.equal(result.snapshot.contractVersion, contract.semver);
  assert.equal(result.snapshot.schemaHash, contract.schemaHash);
  const mismatched = structuredClone(result.snapshot);
  mismatched.schemaHash = `sha256:${"0".repeat(64)}`;
  assert.throws(() => validateFrontendSnapshot(mismatched), TypeError);
  const old = structuredClone(result.snapshot);
  delete old.schemaHash;
  assert.throws(() => validateFrontendSnapshot(old), TypeError);
});

test("cold replay preserves an old call snapshot after a new analysis and caller edit", async () => {
  const source = "export function entry(x: i32): i32 { return target(x); } export function target(y: i32): i32 { return y; }";
  const input = {
    sourceRoot: "/src", rootFile: "/src/main.ts",
    files: [{ path: "/src/main.ts", content: source },
      { path: "/src/minimal-scalars-v2.d.ts", content: scalarDeclarations }],
    declarations: { version: "minimal-scalars-v2", paths: ["/src/minimal-scalars-v2.d.ts"] },
    config: { strict: true, noEmit: true, allowJs: false },
  };
  const analyze = () => analyzeFrontend(input, { executable: process.env.TSFG_FRONTEND_EXE });
  const first = await analyze();
  const replay = await analyze();
  assert.equal(first.status, "ok");
  assert.equal(replay.status, "ok");
  assert.deepEqual(first.snapshot, replay.snapshot);
  const saved = JSON.stringify(first.snapshot);
  input.files[0].content = source.replaceAll("target", "other");
  const edited = await analyze();
  assert.equal(edited.status, "ok");
  assert.notEqual(edited.snapshot.snapshotId, first.snapshot.snapshotId);
  assert.equal(JSON.stringify(first.snapshot), saved);
  assert.equal(validateFrontendSnapshot(first.snapshot).calls, 1);
  assert.throws(() => resolveSymbol(edited.snapshot, first.snapshot.functions[0].body[0].expression.target), TypeError);
  const corrupted = structuredClone(first.snapshot);
  corrupted.inputIdentity = edited.snapshot.inputIdentity;
  assert.throws(() => validateFrontendSnapshot(corrupted), TypeError);
});

test("coordinated source and input-hash edits cannot retain an old input identity", async () => {
  const result = await analyzeCalls("export function entry(x: i32): i32 { return x; } // one");
  assert.equal(result.status, "ok");
  const changed = structuredClone(result.snapshot);
  changed.source.content = changed.source.content.replace("// one", "// two");
  changed.inputs.find(file => file.kind === "source").sha256 = sha256(changed.source.content);
  assert.throws(() => validateFrontendSnapshot(changed), TypeError);
  const changedDeclaration = structuredClone(result.snapshot);
  const declaration = changedDeclaration.identityInput.files.find(file => file.path.endsWith(".d.ts"));
  declaration.content += " ";
  changedDeclaration.inputs.find(file => file.path === declaration.path).sha256 = sha256(declaration.content);
  assert.throws(() => validateFrontendSnapshot(changedDeclaration), TypeError);
  const changedConfig = structuredClone(result.snapshot);
  changedConfig.identityInput.config.strict = false;
  assert.throws(() => validateFrontendSnapshot(changedConfig), TypeError);
});

test("direct and mutual recursion form finite snapshot-local symbol graphs", async () => {
  const source = "export function direct(x: bool): bool { return direct(x); } export function left(x: bool): bool { return right(x); } export function right(x: bool): bool { return left(x); }";
  const result = await analyzeCalls(source);
  assert.equal(result.status, "ok");
  const [direct, left, right] = result.snapshot.functions;
  for (const [fn, target] of [[direct, direct], [left, right], [right, left]]) {
    const call = fn.body[0].expression;
    assert.equal(resolveSymbol(result.snapshot, call.target).id, target.symbol.id);
    assert.equal(call.arguments.length, 1);
    assert.equal(resolveSymbol(result.snapshot, call.arguments[0].symbol).name, "x");
  }
  assert.deepEqual(JSON.parse(JSON.stringify(result.snapshot)), result.snapshot);
  const independent = await analyzeCalls(source.replaceAll("left", "first"));
  assert.equal(independent.status, "ok");
  assert.throws(() => resolveSymbol(independent.snapshot, direct.symbol), TypeError);
});

test("call errors reject wrong arity, argument type, unresolved target and return type", async () => {
  for (const [source, code] of [
    ["export function entry(x: bool): bool { return target(); } export function target(x: bool): bool { return x; }", "r02b-d-type"],
    ["export function entry(x: bool): bool { return target(x, x); } export function target(x: i32, y: bool): bool { return y; }", "r01-d-scalar-type"],
    ["export function entry(x: bool): bool { return missing(x); }", "r01-d-unresolved-name"],
    ["export function entry(x: bool): i32 { return target(x); } export function target(x: bool): bool { return x; }", "r01-d-scalar-type"],
  ]) {
    const result = await analyzeCalls(source);
    assert.equal(result.status, "error", source);
    assert.equal(result.snapshot, undefined, source);
    assert.equal(result.diagnostics[0].code, code, source);
    assert.equal(result.diagnostics[0].ruleId, "r01-calls", source);
  }
});

test("an i32 literal argument retains its exact value in a call", async () => {
  const result = await analyzeCalls("export function entry(): i32 { return identity(17); } export function identity(x: i32): i32 { return x; }");
  assert.equal(result.status, "ok");
  const call = result.snapshot.functions[0].body[0].expression;
  assert.equal(call.kind, "call");
  assert.deepEqual(call.arguments[0].literal, { decimal: "17", token: "17" });
  assert.equal(call.arguments[0].type, "i32");
});

test("nested i32 calls type contextual literals at the inner parameter", async () => {
  const functions = "export function outer(x: i32): i32 { return x; } export function inner(x: i32): i32 { return x; }";
  const accepted = await analyzeCalls(`export function entry(): i32 { return outer(inner(17)); } ${functions}`);
  assert.equal(accepted.status, "ok");
  const outer = accepted.snapshot.functions[0].body[0].expression;
  assert.equal(outer.arguments[0].kind, "call");
  assert.deepEqual(outer.arguments[0].arguments[0].literal, { decimal: "17", token: "17" });

  const rejected = await analyzeCalls(`export function entry(): i32 { return outer(inner(2147483648)); } ${functions}`);
  assert.equal(rejected.status, "error");
  assert.equal(rejected.snapshot, undefined);
  assert.equal(rejected.diagnostics[0].code, "r01-d-integer-range");
  assert.equal(rejected.diagnostics[0].ruleId, "r01-literals");
});

test("bool literal arguments remain typed call facts", async () => {
  for (const value of [true, false]) {
    const result = await analyzeCalls(`export function entry(): bool { return identity(${value}); } export function identity(x: bool): bool { return x; }`);
    assert.equal(result.status, "ok");
    const argument = result.snapshot.functions[0].body[0].expression.arguments[0];
    assert.equal(argument.kind, "boolean");
    assert.equal(argument.type, "bool");
    assert.equal(argument.boolean, value);
  }
});

test("zero-argument calls expose an empty ordered argument list", async () => {
  const result = await analyzeCalls("export function entry(): i32 { return zero(); } export function zero(): i32 { return 17; }");
  assert.equal(result.status, "ok");
  assert.deepEqual(result.snapshot.functions[0].body[0].expression.arguments, []);
});

test("ordinary and nested calls preserve their callee links across declaration order", async () => {
  const declarations = "function first(x: bool): bool { return x; } function second(y: bool): bool { return y; }";
  for (const source of [
    `export function entry(value: bool): bool { return first(second(value)); } ${declarations}`,
    `${declarations} export function entry(value: bool): bool { return first(second(value)); }`,
  ]) {
    const result = await analyzeCalls(source);
    assert.equal(result.status, "ok");
    const entry = result.snapshot.functions.find(fn => fn.name === "entry");
    const outer = entry.body[0].expression;
    const inner = outer.arguments[0];
    assert.equal(resolveSymbol(result.snapshot, outer.target).name, "first");
    assert.equal(resolveSymbol(result.snapshot, inner.target).name, "second");
    assert.equal(resolveSymbol(result.snapshot, inner.arguments[0].symbol).name, "value");
  }
});

test("an out-of-range i32 call argument keeps the R01 range diagnosis", async () => {
  const result = await analyzeCalls("export function entry(): i32 { return identity(2147483648); } export function identity(x: i32): i32 { return x; }");
  assert.equal(result.status, "error");
  assert.equal(result.snapshot, undefined);
  assert.equal(result.diagnostics[0].code, "r01-d-integer-range");
  assert.equal(result.diagnostics[0].ruleId, "r01-literals");
});

test("a contextual integer return carries its exact decimal value", async () => {
  const source = "export function answer(): i32 { return 17; }";
  const result = await analyzeFrontend({
    sourceRoot: "/src", rootFile: "/src/main.ts",
    files: [
      { path: "/src/main.ts", content: source },
      { path: "/src/minimal-scalars-v2.d.ts", content: scalarDeclarations },
    ],
    declarations: { version: "minimal-scalars-v2", paths: ["/src/minimal-scalars-v2.d.ts"] },
    config: { strict: true, noEmit: true, allowJs: false },
  }, { executable: process.env.TSFG_FRONTEND_EXE });
  assert.equal(result.status, "ok");
  assert.deepEqual(result.snapshot.functions[0].body[0].expression.literal,
    { decimal: "17", token: "17" });
  assert.equal(result.snapshot.functions[0].body[0].expression.type, "i32");
});

test("the minimum i32 value is checked after unary minus", async () => {
  const source = "export function minimum(): i32 { return -2147483648; }";
  const result = await analyzeFrontend({
    sourceRoot: "/src", rootFile: "/src/main.ts",
    files: [
      { path: "/src/main.ts", content: source },
      { path: "/src/minimal-scalars-v2.d.ts", content: scalarDeclarations },
    ],
    declarations: { version: "minimal-scalars-v2", paths: ["/src/minimal-scalars-v2.d.ts"] },
    config: { strict: true, noEmit: true, allowJs: false },
  }, { executable: process.env.TSFG_FRONTEND_EXE });
  assert.equal(result.status, "ok");
  assert.deepEqual(result.snapshot.functions[0].body[0].expression.literal,
    { decimal: "-2147483648", token: "-2147483648" });
});

test("fractional numeric tokens cannot be projected as i32 integers", async () => {
  for (const source of [
    "export function wrong(): i32 { return 1.5; }",
    "export function wrong(): i32 { const value = 1.5; return value; }",
  ]) {
    const result = await analyzeFrontend({
      sourceRoot: "/src", rootFile: "/src/main.ts",
      files: [
        { path: "/src/main.ts", content: source },
        { path: "/src/minimal-scalars-v2.d.ts", content: scalarDeclarations },
      ],
      declarations: { version: "minimal-scalars-v2", paths: ["/src/minimal-scalars-v2.d.ts"] },
      config: { strict: true, noEmit: true, allowJs: false },
    }, { executable: process.env.TSFG_FRONTEND_EXE });
    assert.equal(result.status, "error", source);
    assert.equal(result.snapshot, undefined, source);
  }
});

test("an exact out-of-range integer produces the R01 range code", async () => {
  const source = "export function overflow(): i32 { return 9007199254740993; }";
  const result = await analyzeFrontend({
    sourceRoot: "/src", rootFile: "/src/main.ts",
    files: [
      { path: "/src/main.ts", content: source },
      { path: "/src/minimal-scalars-v2.d.ts", content: scalarDeclarations },
    ],
    declarations: { version: "minimal-scalars-v2", paths: ["/src/minimal-scalars-v2.d.ts"] },
    config: { strict: true, noEmit: true, allowJs: false },
  }, { executable: process.env.TSFG_FRONTEND_EXE });
  assert.equal(result.status, "error");
  assert.equal(result.snapshot, undefined);
  assert.equal(result.diagnostics[0].code, "r01-d-integer-range");
  assert.equal(result.diagnostics[0].ruleId, "r01-literals");
  assert.equal(result.diagnostics[0].primary.sourceId, "/src/main.ts");
});

test("an uncontextualized initialized local defaults to i32", async () => {
  const source = "export function answer(): i32 { const value = 17; return value; }";
  const result = await analyzeFrontend({
    sourceRoot: "/src", rootFile: "/src/main.ts",
    files: [
      { path: "/src/main.ts", content: source },
      { path: "/src/minimal-scalars-v2.d.ts", content: scalarDeclarations },
    ],
    declarations: { version: "minimal-scalars-v2", paths: ["/src/minimal-scalars-v2.d.ts"] },
    config: { strict: true, noEmit: true, allowJs: false },
  }, { executable: process.env.TSFG_FRONTEND_EXE });
  assert.equal(result.status, "ok");
  const fn = result.snapshot.functions[0];
  assert.equal(fn.body[0].kind, "variable");
  assert.equal(fn.body[0].symbol.type, "i32");
  assert.deepEqual(fn.body[0].initializer.literal, { decimal: "17", token: "17" });
  assert.equal(fn.body[1].expression.type, "i32");
  assert.equal(resolveSymbol(result.snapshot, fn.body[1].expression.symbol).name, "value");
});

test("a default-i32 local cannot be returned as f64", async () => {
  const result = await analyzeFrontend({
    sourceRoot: "/src", rootFile: "/src/main.ts",
    files: [
      { path: "/src/main.ts", content: "export function wrong(): f64 { const value = 17; return value; }" },
      { path: "/src/minimal-scalars-v2.d.ts", content: scalarDeclarations },
    ],
    declarations: { version: "minimal-scalars-v2", paths: ["/src/minimal-scalars-v2.d.ts"] },
    config: { strict: true, noEmit: true, allowJs: false },
  }, { executable: process.env.TSFG_FRONTEND_EXE });
  assert.equal(result.status, "error");
  assert.equal(result.snapshot, undefined);
  assert.equal(result.diagnostics[0].code, "r01-d-scalar-type");
  assert.equal(result.diagnostics[0].ruleId, "r01-literals");
});

test("an explicit i32 local gives its integer initializer an i32 context", async () => {
  const source = "export function answer(): i32 { const value: i32 = 17; return value; }";
  const result = await analyzeFrontend({
    sourceRoot: "/src", rootFile: "/src/main.ts",
    files: [
      { path: "/src/main.ts", content: source },
      { path: "/src/minimal-scalars-v2.d.ts", content: scalarDeclarations },
    ],
    declarations: { version: "minimal-scalars-v2", paths: ["/src/minimal-scalars-v2.d.ts"] },
    config: { strict: true, noEmit: true, allowJs: false },
  }, { executable: process.env.TSFG_FRONTEND_EXE });
  assert.equal(result.status, "ok");
  assert.equal(result.snapshot.functions[0].body[0].symbol.type, "i32");
  assert.equal(result.snapshot.functions[0].body[0].initializer.literal.decimal, "17");
});

test("already typed f64 cannot implicitly become i32", async () => {
  const source = "export function wrong(value: number): i32 { return value; }";
  const result = await analyzeFrontend({
    sourceRoot: "/src", rootFile: "/src/main.ts",
    files: [
      { path: "/src/main.ts", content: source },
      { path: "/src/minimal-scalars-v2.d.ts", content: scalarDeclarations },
    ],
    declarations: { version: "minimal-scalars-v2", paths: ["/src/minimal-scalars-v2.d.ts"] },
    config: { strict: true, noEmit: true, allowJs: false },
  }, { executable: process.env.TSFG_FRONTEND_EXE });
  assert.equal(result.status, "error");
  assert.equal(result.snapshot, undefined);
  assert.equal(result.diagnostics[0].code, "r01-d-scalar-type");
});

test("a bool-to-i32 mismatch preserves the R01 oracle rule ID", async () => {
  const result = await analyzeFrontend({
    sourceRoot: "/src", rootFile: "/src/main.ts",
    files: [
      { path: "/src/main.ts", content: "export function wrong(value: bool): i32 { return value; }" },
      { path: "/src/minimal-scalars-v2.d.ts", content: scalarDeclarations },
    ],
    declarations: { version: "minimal-scalars-v2", paths: ["/src/minimal-scalars-v2.d.ts"] },
    config: { strict: true, noEmit: true, allowJs: false },
  }, { executable: process.env.TSFG_FRONTEND_EXE });
  assert.equal(result.status, "error");
  assert.equal(result.snapshot, undefined);
  assert.equal(result.diagnostics[0].code, "r01-d-scalar-type");
  assert.equal(result.diagnostics[0].ruleId, "r01-literals");
});

test("number is f64 and an i32 reference cannot implicitly become f64", async () => {
  const analyze = async source => analyzeFrontend({
    sourceRoot: "/src", rootFile: "/src/main.ts",
    files: [
      { path: "/src/main.ts", content: source },
      { path: "/src/minimal-scalars-v2.d.ts", content: scalarDeclarations },
    ],
    declarations: { version: "minimal-scalars-v2", paths: ["/src/minimal-scalars-v2.d.ts"] },
    config: { strict: true, noEmit: true, allowJs: false },
  }, { executable: process.env.TSFG_FRONTEND_EXE });
  const same = await analyze("export function same(value: number): f64 { return value; }");
  assert.equal(same.status, "ok");
  assert.equal(same.snapshot.functions[0].parameters[0].type, "f64");
  assert.equal(same.snapshot.functions[0].returnType, "f64");
  const wrong = await analyze("export function wrong(value: i32): number { return value; }");
  assert.equal(wrong.status, "error");
  assert.equal(wrong.diagnostics[0].code, "r01-d-scalar-type");
});

test("hexadecimal integer token is preserved with exact i32 value", async () => {
  const result = await analyzeFrontend({
    sourceRoot: "/src", rootFile: "/src/main.ts",
    files: [
      { path: "/src/main.ts", content: "export function max(): i32 { return 0x7fffffff; }" },
      { path: "/src/minimal-scalars-v2.d.ts", content: scalarDeclarations },
    ],
    declarations: { version: "minimal-scalars-v2", paths: ["/src/minimal-scalars-v2.d.ts"] },
    config: { strict: true, noEmit: true, allowJs: false },
  }, { executable: process.env.TSFG_FRONTEND_EXE });
  assert.equal(result.status, "ok");
  assert.deepEqual(result.snapshot.functions[0].body[0].expression.literal,
    { decimal: "2147483647", token: "0x7fffffff" });
});

test("applicable R01 literal corpus cases agree with the independent oracle", async () => {
  const cases = JSON.parse(await readFile(new URL("../r01/corpus/i32/cases.json", import.meta.url), "utf8"));
  const selected = new Set([
    "r01-literal-default", "r01-literal-min", "r01-literal-max", "r01-literal-overflow",
    "r01-literal-positive-reject", "r01-literal-hex", "r01-literal-exact",
  ]);
  const applicable = cases.filter(item => selected.has(item.caseId));
  assert.equal(applicable.length, selected.size);
  for (const sample of applicable) {
    const source = await readFile(new URL(`../r01/corpus/${sample.sourceId}`, import.meta.url), "utf8");
    const result = await analyzeFrontend({
      sourceRoot: "/src", rootFile: "/src/main.ts",
      files: [
        { path: "/src/main.ts", content: source },
        { path: "/src/minimal-scalars-v2.d.ts", content: scalarDeclarations },
      ],
      declarations: { version: "minimal-scalars-v2", paths: ["/src/minimal-scalars-v2.d.ts"] },
      config: { strict: true, noEmit: true, allowJs: false },
    }, { executable: process.env.TSFG_FRONTEND_EXE });
    if (sample.oracle.kind === "diagnostics") {
      assert.equal(result.status, "error", sample.caseId);
      assert.equal(result.snapshot, undefined, sample.caseId);
      assert.equal(result.diagnostics[0].code, sample.oracle.diagnostics[0].code, sample.caseId);
    } else {
      assert.equal(result.status, "ok", sample.caseId);
      const [first] = result.snapshot.functions[0].body;
      const literal = first.kind === "variable" ? first.initializer.literal : first.expression.literal;
      assert.equal(literal.decimal, sample.oracle.value.value, sample.caseId);
    }
  }
});

test("real bool function becomes an owned snapshot with declaration references", async () => {
  const source = "export function identity(value: bool): boolean { return value; }\n";
  const input = {
    sourceRoot: "/src",
    rootFile: "/src/main.ts",
    files: [
      { path: "/src/main.ts", content: source },
      { path: "/src/minimal-bool-v1.d.ts", content: declarations },
    ],
    declarations: { version: "minimal-bool-v1", paths: ["/src/minimal-bool-v1.d.ts"] },
    config: { strict: true, noEmit: true, allowJs: false },
  };
  const result = await analyzeFrontend(input, { executable: process.env.TSFG_FRONTEND_EXE });
  assert.equal(result.status, "ok");
  assert.equal(result.snapshot.contractVersion, "0.5.0");
  assert.equal(result.snapshot.frontendSource.forkOid, sourceLock.forkOid);
  assert.equal(result.snapshot.functions.length, 1);
  const fn = result.snapshot.functions[0];
  assert.equal(fn.name, "identity");
  assert.equal(fn.parameters.length, 1);
  assert.equal(fn.parameters[0].name, "value");
  assert.equal(fn.parameters[0].type, "bool");
  assert.equal(fn.returnType, "bool");
  assert.equal(fn.body.length, 1);
  assert.equal(fn.body[0].kind, "return");
  assert.equal(fn.body[0].expression.kind, "reference");
  assert.equal(fn.body[0].expression.type, "bool");
  assert.equal(resolveSymbol(result.snapshot, fn.body[0].expression.symbol).name, "value");
  assert.deepEqual(result.snapshot.source.content, source);
  assert.equal(Object.isFrozen(result.snapshot), true);
  input.files[0].content = "changed";
  assert.equal(result.snapshot.source.content, source);
});

test("minimal declaration version rejects changed declaration bytes", async () => {
  const result = await analyzeFrontend({
    sourceRoot: "/src", rootFile: "/src/main.ts",
    files: [
      { path: "/src/main.ts", content: "export function yes(value: bool): bool { return value; }" },
      { path: "/src/minimal-bool-v1.d.ts", content: `${declarations}\n` },
    ],
    declarations: { version: "minimal-bool-v1", paths: ["/src/minimal-bool-v1.d.ts"] },
    config: { strict: true, noEmit: true, allowJs: false },
  }, { executable: process.env.TSFG_FRONTEND_EXE });
  assert.equal(result.status, "error");
  assert.equal(result.snapshot, undefined);
  assert.equal(result.diagnostics[0].code, "r02b-d-input");
});

test("an explicit declaration scope can contain files outside the discovered closure", async () => {
  const result = await analyzeFrontend({
    sourceRoot: "/src", rootFile: "/src/main.ts",
    files: [
      { path: "/src/main.ts", content: "export function yes(value: bool): bool { return value; }" },
      { path: "/src/minimal-bool-v1.d.ts", content: declarations },
      { path: "/src/extra.d.ts", content: "declare const hidden: boolean;" },
    ],
    declarations: { version: "minimal-bool-v1", paths: ["/src/minimal-bool-v1.d.ts"] },
    config: { strict: true, noEmit: true, allowJs: false },
  }, { executable: process.env.TSFG_FRONTEND_EXE });
  assert.equal(result.status, "ok");
  assert.equal(result.snapshot.inputs.some(file => file.path === "/src/extra.d.ts"), false);
});

test("a declaration reference cannot pull a JavaScript implementation into the input closure", async () => {
  const source = "export function yes(value: bool): bool { return value; }";
  const result = await analyzeFrontend({
    sourceRoot: "/src", rootFile: "/src/main.ts",
    files: [
      { path: "/src/main.ts", content: source },
      { path: "/src/minimal-bool-v1.d.ts", content: declarations },
      { path: "/src/user.d.ts", content: '/// <reference path="./impl.js" />\n' },
    ],
    declarations: { version: "minimal-bool-v1", paths: ["/src/minimal-bool-v1.d.ts", "/src/user.d.ts"] },
    config: { strict: true, noEmit: true, allowJs: false },
  }, { executable: process.env.TSFG_FRONTEND_EXE });
  assert.equal(result.status, "error");
  assert.equal(result.snapshot, undefined);
  assert.equal(result.diagnostics[0].code, "r02b-d-input");
  assert.equal(result.diagnostics[0].ruleId, "r01-input-boundary");
  assert.equal(result.diagnostics[0].primary.sourceId, "/src/user.d.ts");
});

test("JavaScript roots, scoped files, and emit or runtime configuration cannot bypass the product entry", async () => {
  const source = "export function yes(value: bool): bool { return value; }";
  const base = {
    sourceRoot: "/src", rootFile: "/src/main.ts",
    files: [
      { path: "/src/main.ts", content: source },
      { path: "/src/minimal-bool-v1.d.ts", content: declarations },
    ],
    declarations: { version: "minimal-bool-v1", paths: ["/src/minimal-bool-v1.d.ts"] },
    config: { strict: true, noEmit: true, allowJs: false },
  };
  const cases = [
    ...["js", "mjs", "cjs"].map(extension => ({
      ...base, rootFile: `/src/main.${extension}`,
      files: [{ path: `/src/main.${extension}`, content: "module.exports = true;" }, base.files[1]],
    })),
    ...["js", "mjs", "cjs"].map(extension => ({
      ...base, files: [...base.files, { path: `/src/implementation.${extension}`, content: "module.exports = true;" }],
    })),
    { ...base, config: { ...base.config, allowJs: true } },
    { ...base, config: { ...base.config, noEmit: false } },
    { ...base, config: { ...base.config, emitDeclarationOnly: true } },
    { ...base, config: { ...base.config, runtime: "javascript" } },
  ];
  for (const input of cases) {
    const result = await analyzeFrontend(input, { executable: process.env.TSFG_FRONTEND_EXE });
    assert.equal(result.status, "error");
    assert.equal(result.snapshot, undefined);
    assert.equal(result.diagnostics[0].code, "r02b-d-input");
  }
  const valid = await analyzeFrontend(base, { executable: process.env.TSFG_FRONTEND_EXE });
  assert.equal(valid.status, "ok");
  assert.equal(valid.snapshot.functions[0].name, "yes");
});

test("runtime fallback configuration is an input rejection", async () => {
  const result = await analyzeFrontend({
    sourceRoot: "/src", rootFile: "/src/main.ts",
    files: [
      { path: "/src/main.ts", content: "export function yes(value: bool): bool { return value; }" },
      { path: "/src/minimal-bool-v1.d.ts", content: declarations },
    ],
    declarations: { version: "minimal-bool-v1", paths: ["/src/minimal-bool-v1.d.ts"] },
    config: { strict: true, noEmit: true, allowJs: false, runtime: "javascript" },
  }, { executable: process.env.TSFG_FRONTEND_EXE });
  assert.equal(result.status, "error");
  assert.equal(result.snapshot, undefined);
  assert.equal(result.diagnostics[0].code, "r02b-d-input");
});

test("syntax errors and unsupported structures never produce a snapshot", async () => {
  for (const [source, code] of [
    ["export function bad(value: bool): bool { return value;", "r02b-d-syntax"],
    ["export function bad(value: bool): bool { do { return value; } while (value); }", "r02b-d-unsupported"],
  ]) {
    const result = await analyzeFrontend({
      sourceRoot: "/src", rootFile: "/src/main.ts",
      files: [
        { path: "/src/main.ts", content: source },
        { path: "/src/minimal-bool-v1.d.ts", content: declarations },
      ],
      declarations: { version: "minimal-bool-v1", paths: ["/src/minimal-bool-v1.d.ts"] },
      config: { strict: true, noEmit: true, allowJs: false },
    }, { executable: process.env.TSFG_FRONTEND_EXE });
    assert.equal(result.status, "error");
    assert.equal(result.snapshot, undefined);
    assert.equal(result.diagnostics[0].code, code);
  }
});

test("a symbol reference cannot be resolved in a different snapshot", async () => {
  const analyze = async name => analyzeFrontend({
    sourceRoot: "/src", rootFile: "/src/main.ts",
    files: [
      { path: "/src/main.ts", content: `export function ${name}(value: bool): bool { return value; }` },
      { path: "/src/minimal-bool-v1.d.ts", content: declarations },
    ],
    declarations: { version: "minimal-bool-v1", paths: ["/src/minimal-bool-v1.d.ts"] },
    config: { strict: true, noEmit: true, allowJs: false },
  }, { executable: process.env.TSFG_FRONTEND_EXE });
  const a = await analyze("first");
  const b = await analyze("second");
  assert.equal(a.status, "ok");
  assert.equal(b.status, "ok");
  assert.throws(() => resolveSymbol(b.snapshot, a.snapshot.functions[0].body[0].expression.symbol), TypeError);
  assert.throws(() => resolveSymbol({ ...a.snapshot, contractVersion: "3" },
    a.snapshot.functions[0].body[0].expression.symbol), TypeError);
  assert.throws(() => resolveSymbol(a.snapshot, { snapshotId: a.snapshot.snapshotId, id: "s999" }), RangeError);
});

test("JavaScript inputs and semantic errors fail without snapshots", async () => {
  for (const [rootFile, source, code] of [
    ["/src/main.js", "export function yes(value) { return value; }", "r02b-d-input"],
    ["/src/main.ts", "export function yes(value: bool): bool { return 1; }", "r01-d-scalar-type"],
  ]) {
    const result = await analyzeFrontend({
      sourceRoot: "/src", rootFile,
      files: [
        { path: rootFile, content: source },
        { path: "/src/minimal-bool-v1.d.ts", content: declarations },
      ],
      declarations: { version: "minimal-bool-v1", paths: ["/src/minimal-bool-v1.d.ts"] },
      config: { strict: true, noEmit: true, allowJs: false },
    }, { executable: process.env.TSFG_FRONTEND_EXE });
    assert.equal(result.status, "error");
    assert.equal(result.snapshot, undefined);
    assert.equal(result.diagnostics[0].code, code);
  }
});

test("source positions use UTF-16 offsets and survive source mutation", async () => {
  const source = "// 😀\nexport function yes(value: bool): bool { return value; }";
  const result = await analyzeFrontend({
    sourceRoot: "/src", rootFile: "/src/main.ts",
    files: [
      { path: "/src/main.ts", content: source },
      { path: "/src/minimal-bool-v1.d.ts", content: declarations },
    ],
    declarations: { version: "minimal-bool-v1", paths: ["/src/minimal-bool-v1.d.ts"] },
    config: { strict: true, noEmit: true, allowJs: false },
  }, { executable: process.env.TSFG_FRONTEND_EXE });
  assert.equal(result.status, "ok");
  const fn = result.snapshot.functions[0];
  assert.equal(fn.range.start, 0);
  assert.equal(fn.range.end, source.length);
  assert.equal(fn.parameters[0].range.start, source.indexOf("value"));
  assert.equal(fn.body[0].expression.range.start, source.lastIndexOf("value") - 1);
});

test("missing input returns a structured rejection", async () => {
  const result = await analyzeFrontend(undefined, { executable: process.env.TSFG_FRONTEND_EXE });
  assert.equal(result.status, "error");
  assert.equal(result.snapshot, undefined);
  assert.equal(result.diagnostics[0].code, "r02b-d-input");
});

test("logical file order does not change snapshot identity", async () => {
  const files = [
    { path: "/src/main.ts", content: "export function yes(value: bool): bool { return value; }" },
    { path: "/src/minimal-bool-v1.d.ts", content: declarations },
  ];
  const analyze = ordered => analyzeFrontend({
    sourceRoot: "/src", rootFile: "/src/main.ts", files: ordered,
    declarations: { version: "minimal-bool-v1", paths: ["/src/minimal-bool-v1.d.ts"] },
    config: { strict: true, noEmit: true, allowJs: false },
  }, { executable: process.env.TSFG_FRONTEND_EXE });
  const first = await analyze(files);
  const second = await analyze([...files].reverse());
  assert.equal(first.status, "ok");
  assert.equal(second.status, "ok");
  assert.equal(first.snapshot.inputIdentity, second.snapshot.inputIdentity);
  assert.equal(first.snapshot.snapshotId, second.snapshot.snapshotId);
});

test("semantic diagnostics retain the R01 machine contract", async () => {
  const result = await analyzeFrontend({
    sourceRoot: "/src", rootFile: "/src/main.ts",
    files: [
      { path: "/src/main.ts", content: "export function bad(value: bool): bool { return 1; }" },
      { path: "/src/minimal-bool-v1.d.ts", content: declarations },
    ],
    declarations: { version: "minimal-bool-v1", paths: ["/src/minimal-bool-v1.d.ts"] },
    config: { strict: true, noEmit: true, allowJs: false },
  }, { executable: process.env.TSFG_FRONTEND_EXE });
  assert.equal(result.status, "error");
  assert.equal(result.snapshot, undefined);
  const diagnostic = result.diagnostics[0];
  assert.equal(diagnostic.code, "r01-d-scalar-type");
  assert.equal(diagnostic.phase, "types");
  assert.equal(diagnostic.severity, "error");
  assert.equal(diagnostic.primary.sourceId, "/src/main.ts");
  assert.equal(diagnostic.primary.startLine, 0);
  assert.ok(diagnostic.primary.startColumn > 0);
});

test("unresolved names are not mislabeled as scalar type failures", async () => {
  const result = await analyzeFrontend({
    sourceRoot: "/src", rootFile: "/src/main.ts",
    files: [
      { path: "/src/main.ts", content: "export function bad(value: bool): bool { return missing; }" },
      { path: "/src/minimal-bool-v1.d.ts", content: declarations },
    ],
    declarations: { version: "minimal-bool-v1", paths: ["/src/minimal-bool-v1.d.ts"] },
    config: { strict: true, noEmit: true, allowJs: false },
  }, { executable: process.env.TSFG_FRONTEND_EXE });
  assert.equal(result.status, "error");
  assert.equal(result.diagnostics[0].code, "r01-d-unresolved-name");
  assert.equal(result.diagnostics[0].phase, "types");
});

test("an unadmitted executable cannot claim the locked fork identity", async () => {
  const result = await analyzeFrontend({
    sourceRoot: "/src", rootFile: "/src/main.ts",
    files: [
      { path: "/src/main.ts", content: "export function yes(value: bool): bool { return value; }" },
      { path: "/src/minimal-bool-v1.d.ts", content: declarations },
    ],
    declarations: { version: "minimal-bool-v1", paths: ["/src/minimal-bool-v1.d.ts"] },
    config: { strict: true, noEmit: true, allowJs: false },
  }, { executable: process.execPath });
  assert.equal(result.status, "tool-error");
  assert.equal(result.snapshot, undefined);
  assert.match(result.message, /differs from locked source build/);
});

test("a TypeScript assignment error outside the bool slice keeps a generic code", async () => {
  const result = await analyzeFrontend({
    sourceRoot: "/src", rootFile: "/src/main.ts",
    files: [
      { path: "/src/main.ts", content: "export function bad(): number { return 'x'; }" },
      { path: "/src/minimal-bool-v1.d.ts", content: declarations },
    ],
    declarations: { version: "minimal-bool-v1", paths: ["/src/minimal-bool-v1.d.ts"] },
    config: { strict: true, noEmit: true, allowJs: false },
  }, { executable: process.env.TSFG_FRONTEND_EXE });
  assert.equal(result.status, "error");
  assert.equal(result.diagnostics[0].code, "r02b-d-type");
  assert.equal(result.diagnostics[0].phase, "types");
});

function request(source, rootFile = "/src/main.ts") {
  return {
    sourceRoot: "/src", rootFile,
    files: [
      { path: rootFile, content: source },
      { path: "/src/minimal-bool-v1.d.ts", content: declarations },
    ],
    declarations: { version: "minimal-bool-v1", paths: ["/src/minimal-bool-v1.d.ts"] },
    config: { strict: true, noEmit: true, allowJs: false },
  };
}

test("name failures retain the R01 code and logical UTF-16 location", async () => {
  const source = "// 😀\r\nexport function bad(value: bool): bool { return missing; }";
  const result = await analyzeFrontend(request(source, "/src/nested/main.ts"),
    { executable: process.env.TSFG_FRONTEND_EXE });
  assert.equal(result.status, "error");
  assert.equal(result.snapshot, undefined);
  const diagnostic = result.diagnostics.find(item => item.code === "r01-d-unresolved-name");
  assert.ok(diagnostic);
  assert.equal(diagnostic.phase, "types");
  assert.equal(diagnostic.severity, "error");
  assert.deepEqual(diagnostic.ruleIds, ["r01-ts-baseline"]);
  assert.equal(diagnostic.primary.sourceId, "/src/nested/main.ts");
  assert.deepEqual([diagnostic.primary.start, diagnostic.primary.end],
    [source.indexOf("missing"), source.indexOf("missing") + "missing".length]);
  assert.deepEqual([diagnostic.primary.startLine, diagnostic.primary.startColumn,
    diagnostic.primary.endLine, diagnostic.primary.endColumn],
    [1, source.split("\r\n")[1].indexOf("missing"), 1,
      source.split("\r\n")[1].indexOf("missing") + "missing".length]);
});

test("unsupported and prohibited syntax have distinct machine categories", async () => {
  const cases = [
    ["export function bad(value: bool): bool { for (;;) { return value; } return value; }",
      "r02b-d-unsupported", "unsupported", "capability", "r01-ts-baseline"],
    ["export function bad(value: any): bool { return value; }",
      "r02b-d-prohibited", "prohibited", "types", "r01-input-boundary"],
    ["export function bad(value: bool): bool { return value == true; }",
      "r02b-d-prohibited", "prohibited", "types", "r01-input-boundary"],
  ];
  for (const [source, code, category, phase, ruleId] of cases) {
    const result = await analyzeFrontend(request(source), { executable: process.env.TSFG_FRONTEND_EXE });
    assert.equal(result.status, "error");
    assert.equal(result.snapshot, undefined);
    assert.equal(result.diagnostics[0].code, code);
    assert.equal(result.diagnostics[0].category, category);
    assert.equal(result.diagnostics[0].phase, phase);
    assert.deepEqual(result.diagnostics[0].ruleIds, [ruleId]);
    assert.equal(result.diagnostics[0].severity, "error");
  }
});

test("a later failed request cannot return a previous success", async () => {
  const good = await analyzeFrontend(request("export function yes(value: bool): bool { return value; }"),
    { executable: process.env.TSFG_FRONTEND_EXE });
  assert.equal(good.status, "ok");
  const bad = await analyzeFrontend(request("export function bad(value: bool): bool { return missing; }"),
    { executable: process.env.TSFG_FRONTEND_EXE });
  assert.equal(bad.status, "error");
  assert.equal(bad.snapshot, undefined);
  const missing = await analyzeFrontend(request("export function yes(value: bool): bool { return value; }"),
    { executable: "E:\\ws\\pro_tsfg\\.tmp\\no-such-frontend.exe" });
  assert.equal(missing.status, "tool-error");
  assert.equal(missing.snapshot, undefined);
  assert.equal(good.snapshot.functions[0].name, "yes");
});

test("diagnostics preserve escaped source spans and distinct logical file identities", async () => {
  const source = "// é😀\r\nexport function bad(value: bool): bool { return \\u006dissing; }";
  const paths = ["/src/one/main.ts", "/src/two/main.ts"];
  const results = [];
  for (const rootFile of paths) {
    const result = await analyzeFrontend(request(source, rootFile),
      { executable: process.env.TSFG_FRONTEND_EXE });
    assert.equal(result.status, "error");
    assert.equal(result.snapshot, undefined);
    const diagnostic = result.diagnostics.find(item => item.code === "r01-d-unresolved-name");
    assert.ok(diagnostic);
    const start = source.indexOf("\\u006dissing");
    assert.deepEqual([diagnostic.primary.start, diagnostic.primary.end],
      [start, start + "\\u006dissing".length]);
    assert.equal(diagnostic.primary.sourceId, rootFile);
    assert.equal(diagnostic.primary.startLine, 1);
    assert.equal(diagnostic.primary.startColumn, source.split("\r\n")[1].indexOf("\\u006dissing"));
    results.push(result);
  }
  assert.notEqual(results[0].inputIdentity, results[1].inputIdentity);
});

test("multiple language diagnostics have stable source-position order", async () => {
  const source = "export function bad(value: bool): bool { return absent && missing; }";
  const result = await analyzeFrontend(request(source), { executable: process.env.TSFG_FRONTEND_EXE });
  assert.equal(result.status, "error");
  assert.equal(result.snapshot, undefined);
  const names = result.diagnostics.filter(item => item.code === "r01-d-unresolved-name");
  assert.equal(names.length, 2);
  assert.deepEqual(names.map(item => item.primary.start),
    [source.indexOf("absent"), source.indexOf("missing")]);
});

test("a prohibition does not hide independent TypeScript diagnostics", async () => {
  const source = "export function bad(value: any): bool { return missing; }";
  const result = await analyzeFrontend(request(source), { executable: process.env.TSFG_FRONTEND_EXE });
  assert.equal(result.status, "error");
  assert.equal(result.snapshot, undefined);
  assert.deepEqual(result.diagnostics.map(item => item.code),
    ["r02b-d-prohibited", "r01-d-unresolved-name"]);
});

test("dynamic architecture prohibitions remain distinct from missing names", async () => {
  for (const expression of [
    'eval("value")',
    'Function("return true")',
    'new Function("return true")',
    'new Proxy({}, {})',
    'delete value.x',
    'value["newProperty"] = true',
    'value.__proto__ = true',
    'Object.setPrototypeOf(value, {})',
  ]) {
    const source = `export function bad(value: bool): bool { ${expression}; return value; }`;
    const result = await analyzeFrontend(request(source), { executable: process.env.TSFG_FRONTEND_EXE });
    assert.equal(result.status, "error", expression);
    assert.equal(result.snapshot, undefined, expression);
    assert.ok(result.diagnostics.some(item => item.code === "r02b-d-prohibited"
      && item.category === "prohibited" && item.ruleIds.includes("r01-input-boundary")), expression);
  }
});

test("an unresolved call keeps the R01 calls rule association", async () => {
  const source = "export function bad(value: bool): bool { return missing(value); }";
  const result = await analyzeFrontend(request(source), { executable: process.env.TSFG_FRONTEND_EXE });
  assert.equal(result.status, "error");
  assert.equal(result.snapshot, undefined);
  const diagnostic = result.diagnostics.find(item => item.code === "r01-d-unresolved-name");
  assert.ok(diagnostic);
  assert.deepEqual(diagnostic.ruleIds, ["r01-calls"]);
  assert.equal(diagnostic.primary.start, source.indexOf("missing"));
});
