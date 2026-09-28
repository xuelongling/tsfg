// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { analyzeFrontend, resolveSymbol } from "../../src/frontend.mjs";
import sourceLock from "../../eng/frontend-source.lock.json" with { type: "json" };

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
  assert.equal(result.snapshot.contractVersion, "2");
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
