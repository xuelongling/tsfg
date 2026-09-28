// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
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

const scalarDeclarations = `${declarations}declare const __tsfg_i32: unique symbol;
type i32 = number & { readonly [__tsfg_i32]: true };
type f64 = number;
`;

const analyzeScalar = source => analyzeFrontend({
  sourceRoot: "/src", rootFile: "/src/main.ts",
  files: [
    { path: "/src/main.ts", content: source },
    { path: "/src/minimal-scalars-v2.d.ts", content: scalarDeclarations },
  ],
  declarations: { version: "minimal-scalars-v2", paths: ["/src/minimal-scalars-v2.d.ts"] },
  config: { strict: true, noEmit: true, allowJs: false },
}, { executable: process.env.TSFG_FRONTEND_EXE });

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
  assert.equal(result.snapshot.capability, "scalar-operators-v3");
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
  assert.equal(result.snapshot.contractVersion, "3");
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
