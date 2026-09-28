// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { analyzeFrontend, resolveNode, resolveSymbol, resolveType, validateFrontendSnapshot } from "../../src/frontend.mjs";
import sourceLock from "../../eng/frontend-source.lock.json" with { type: "json" };
import contractRegistry from "../../contracts/registry.json" with { type: "json" };

const declarations = `interface Object {}
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

const analyzeCalls = source => analyzeFrontend({
  sourceRoot: "/src", rootFile: "/src/main.ts",
  files: [
    { path: "/src/main.ts", content: source },
    { path: "/src/minimal-scalars-v2.d.ts", content: scalarDeclarations },
  ],
  declarations: { version: "minimal-scalars-v2", paths: ["/src/minimal-scalars-v2.d.ts"] },
  config: { strict: true, noEmit: true, allowJs: false },
}, { executable: process.env.TSFG_FRONTEND_EXE });

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
  assert.equal(JSON.stringify(result.snapshot).length < 10000, true);
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
  assert.equal(result.snapshot.contractVersion, "0.4.0");
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
    ["export function bad(value: bool): bool { if (value) return value; return value; }", "r02b-d-unsupported"],
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
  assert.equal(result.diagnostics[0].code, "r02b-d-type");
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
});
