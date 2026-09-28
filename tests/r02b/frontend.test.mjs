// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
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
  assert.equal(result.snapshot.contractVersion, "1");
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

test("analysis rejects an undeclared source or declaration input", async () => {
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
  assert.equal(result.status, "error");
  assert.equal(result.snapshot, undefined);
  assert.equal(result.diagnostics[0].code, "r02b-d-input");
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
  assert.equal(result.diagnostics[0].code, "r01-d-unresolved-name");
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
    ["export function bad(value: bool): bool { if (value) return value; return value; }",
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
