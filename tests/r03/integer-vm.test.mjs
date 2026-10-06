// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test from "node:test";
import { compileAndRun, compileProgram, compileHir, sourceInput, runBytecode, runRequestSequence, createCompilerSession } from "../../compiler/pipeline.mjs";
import { printHir, readHir, lowerHir, verifyHir } from "../../compiler/hir.mjs";

const tools = () => ({ frontend: process.env.TSFG_FRONTEND_EXE, core: process.env.TSFG_CORE_IR_EXE, vm: process.env.TSFG_VM_EXE });
// Independently authored powers-of-two boundaries from R01 §4; target integers
// use the admitted Windows x86_64 DataLayout, not JavaScript host arithmetic.
const families = [
  ["i8", "-128", "127", "8"], ["i16", "-32768", "32767", "16"],
  ["i32", "-2147483648", "2147483647", "32"], ["i64", "-9223372036854775808", "9223372036854775807", "64"],
  ["u8", "0", "255", "8"], ["u16", "0", "65535", "16"],
  ["u32", "0", "4294967295", "32"], ["u64", "0", "18446744073709551615", "64"],
  ["isize", "-9223372036854775808", "9223372036854775807", "64"], ["usize", "0", "18446744073709551615", "64"],
];
const value = (type, number) => ({ type, value: number });
async function compiled(source) {
  const result = await compileProgram(await sourceInput(source), tools());
  assert.equal(result.status, "ok", JSON.stringify(result));
  return result;
}
test("complete integer widths retain exact literals and wrapping values through formal consumers", async t => {
  for (const [type, minimum, maximum] of families) await t.test(type, async () => {
    for (const literal of [minimum, maximum]) {
      const outcome = await compileAndRun(`export function entry(): ${type} { return ${literal}; }`, tools());
      assert.equal(outcome.status, "ok", JSON.stringify(outcome));
      assert.deepEqual(outcome.requests[0].result, value(type, literal));
    }
    const source = `export function entry(a: ${type}, b: ${type}): ${type} { return a + b; }`;
    const program = await compiled(source);
    const [outcome] = await runBytecode(program.bytecode, { ...tools(), requests: [{ arguments: [value(type, maximum), value(type, "1")] }] });
    assert.deepEqual(outcome.result, value(type, minimum));
    assert.equal(outcome.activeRequests, "0");
  });
});

test("each integer has finite mathematical arithmetic, division, comparison and shift oracles", async t => {
  for (const [type, minimum, maximum, width] of families) await t.test(type, async () => {
    const signed = minimum.startsWith("-");
    const arithmetic = [["-", minimum, "1", maximum], ["*", maximum, "2", signed ? "-2" : (BigInt(maximum) - 1n).toString()],
      ["/", signed ? "-7" : "7", "3", signed ? "-2" : "2"], ["%", signed ? "-7" : "7", "3", signed ? "-1" : "1"],
      ["&", "5", "3", "1"], ["|", "5", "3", "7"], ["^", "5", "3", "6"]];
    if (signed) arithmetic.push(["/", minimum, "-1", minimum], ["%", minimum, "-1", "0"]);
    for (const [operator, left, right, expected] of arithmetic) {
      const program = await compiled(`export function entry(a: ${type}, b: ${type}): ${type} { return a ${operator} b; }`);
      const [outcome] = await runBytecode(program.bytecode, { ...tools(), requests: [{ arguments: [value(type, left), value(type, right)] }] });
      assert.deepEqual(outcome.result, value(type, expected), `${type} ${left}${operator}${right}`);
    }
    for (const [operator, left, expected] of [[">>", signed ? minimum : maximum, signed ? (BigInt(minimum) / 2n).toString() : (BigInt(maximum) / 2n).toString()],
      [">>>", signed ? minimum : maximum, (1n << (BigInt(width) - 2n)).toString()], ["<<", "1", "2"]]) {
      // Unsigned maximum shifted once is 2^(w-1)-1; signed MIN zero-filled
      // once is 2^(w-2). This finite oracle is independent of VM/lowering.
      const expectedValue = operator === ">>>" && !signed ? (BigInt(maximum) / 2n).toString() : expected;
      const program = await compiled(`export function entry(a: ${type}, n: i32): ${type} { return a ${operator} n; }`);
      const [outcome] = await runBytecode(program.bytecode, { ...tools(), requests: [{ arguments: [value(type, left), value("i32", "1")] }] });
      assert.deepEqual(outcome.result, value(type, expectedValue));
    }
    const program = await compiled(`export function entry(a: ${type}, b: ${type}): bool { return a < b; }`);
    const [outcome] = await runBytecode(program.bytecode, { ...tools(), requests: [{ arguments: [value(type, minimum), value(type, maximum)] }] });
    assert.deepEqual(outcome.result, { type: "bool", value: true });
    const unary = await compiled(`export function entry(a: ${type}): ${type} { return -a; }`);
    const [negated] = await runBytecode(unary.bytecode, { ...tools(), requests: [{ arguments: [value(type, minimum)] }] });
    assert.deepEqual(negated.result, value(type, minimum));
  });
});

test("all integer traps retain original source anchors and clean the same request host", async t => {
  for (const [type, , , width] of families) await t.test(type, async () => {
    for (const [operator, right, code, ruleId] of [["/", "0", "r01-t-divide-zero", "r01-division"], ["%", "0", "r01-t-remainder-zero", "r01-division"], ["<<", width, "r01-t-shift-count", "r01-shifts"], [">>", "-1", "r01-t-shift-count", "r01-shifts"]]) {
      const source = `/*😀*/ export function entry(a: ${type}): ${type} { return a ${operator} ${right}; }`;
      const failed = await compiled(source), good = await compiled(`export function entry(a: ${type}): ${type} { return a; }`);
      const outcomes = await runRequestSequence([failed.bytecode, good.bytecode], { ...tools(), requests: [{ arguments: [value(type, "1")] }, { arguments: [value(type, "7")] }] });
      assert.equal(outcomes[0].code, code); assert.deepEqual(outcomes[0].ruleIds, [ruleId]);
      assert.equal(source.slice(Number(outcomes[0].source.start), Number(outcomes[0].source.end)), `a ${operator} ${right}`);
      assert.deepEqual(outcomes[1].result, value(type, "7"));
      for (const outcome of outcomes) assert.equal(outcome.activeRequests, "0");
    }
  });
});

test("integer calls, CFG, owned roundtrips and current incremental/optimized equivalence", async t => {
  for (const [type] of families) await t.test(type, async () => {
    const source = `export function entry(a: ${type}): ${type} { let n: i32 = 0; let sum: ${type} = 0; while (n < 3) { sum = add(sum, a); n = n + 1; } if (sum === 0) return a; else return sum; } export function add(a: ${type}, b: ${type}): ${type} { return a + b; }`;
    const input = await sourceInput(source), session = createCompilerSession(tools());
    const first = await session.compile(input), second = await session.compile(input), full = await compileProgram(input, tools()), optimized = await compileProgram(input, { ...tools(), optimize: true });
    for (const result of [first, second, full, optimized]) assert.equal(result.status, "ok", JSON.stringify(result));
    assert.deepEqual(first.bytecode, second.bytecode); assert.deepEqual(first.bytecode, full.bytecode);
    const hir = readHir(Buffer.from(printHir(first.hir))); assert.equal(lowerHir(hir), lowerHir(first.hir));
    const bad = structuredClone(hir); bad.functions[1].returnType.id = hir.functions[0].signatureHash;
    assert.throws(() => verifyHir(bad), /r03-hir-invalid/);
    const options = { ...tools(), requests: [{ arguments: [value(type, "7")], depth: 2, semanticFuel: 8 }] };
    for (const program of [first, optimized]) {
      const [outcome] = await runBytecode(program.bytecode, options);
      assert.deepEqual(outcome.result, value(type, "21")); assert.equal(outcome.fuelConsumed, "8");
      assert.deepEqual(await runBytecode(program.bytecode, { ...tools(), command: "--roundtrip" }), program.bytecode);
    }
  });
});

test("integer contextual range and same-type source negatives include unentered functions", async t => {
  for (const [type, minimum, maximum] of families) await t.test(type, async () => {
    for (const literal of [(BigInt(minimum) - 1n).toString(), (BigInt(maximum) + 1n).toString()]) {
      const result = await compileHir(await sourceInput(`export function entry(): i32 { return 0; } export function bad(): ${type} { return ${literal}; }`), tools());
      assert.equal(result.status, "error", JSON.stringify(result));
      assert.equal(result.diagnostics[0].code, "r01-d-integer-range");
    }
    if (type !== "i32") {
      for (const source of [`export function entry(a: ${type}, b: i32): ${type} { return a + b; }`, `export function entry(a: ${type}, n: ${type}): ${type} { return a << n; }`]) {
        const result = await compileHir(await sourceInput(source), tools()); assert.equal(result.status, "error", JSON.stringify(result));
      }
    }
  });
});

test("default i32 range failures survive dependent return, alias and call contexts", async () => {
  for (const [body, literal] of [
    ["let a = 2147483648; return a;", "2147483648"],
    ["let a = (2147483648); return a;", "2147483648"],
    ["let a = -2147483649; return a;", "-2147483649"],
    ["let a = 2147483648 + 0; return a;", "2147483648"],
    ["let a = 2147483648; let b = a; return b;", "2147483648"],
    ["let a = 2147483648; return identity(a);", "2147483648"],
  ]) {
    const source = `/*😀*/ export function entry(): i32 { ${body} } function identity(a: i32): i32 { return a; }`;
    const result = await compileHir(await sourceInput(source), tools());
    assert.equal(result.status, "error", JSON.stringify(result));
    const diagnostic = result.diagnostics[0];
    assert.equal(diagnostic.code, "r01-d-integer-range");
    assert.deepEqual(diagnostic.ruleIds, ["r01-literals"]);
    assert.equal(diagnostic.phase, "types");
    assert.equal(source.slice(diagnostic.primary.start, diagnostic.primary.end), literal);
  }
});

test("typed integer requests reject noncanonical, range and nominal inputs before zero budgets, then recover", async t => {
  for (const [type, minimum, maximum] of families) await t.test(type, async () => {
    const program = await compiled(`export function entry(a: ${type}): ${type} { return a; }`);
    const wrongType = type === "u64" ? "usize" : type === "usize" ? "u64" : "bool";
    const invalid = [value(type, (BigInt(maximum) + 1n).toString()), value(type, (BigInt(minimum) - 1n).toString()), value(type, "+1"), value(type, "01"), value(type, "-0"), value(type, "1e0"), value(type, "0x1"), { type, value: 1 }, { type: wrongType, value: wrongType === "bool" ? true : "1" }];
    const requests = invalid.map(argument => ({ arguments: [argument], depth: 0, semanticFuel: 0, instructionBudget: 0 }));
    requests.push({ arguments: [value(type, maximum)], depth: 1, semanticFuel: 1, instructionBudget: 4097 });
    const outcomes = await runBytecode(program.bytecode, { ...tools(), requests });
    for (const outcome of outcomes.slice(0, -1)) {
      assert.equal(outcome.code, "r05-request-arguments"); assert.equal(outcome.category, "request"); assert.equal(outcome.fuelConsumed, "0"); assert.equal(outcome.activeRequests, "0");
    }
    assert.deepEqual(outcomes.at(-1).result, value(type, maximum));
    const [memory, good] = await runBytecode(program.bytecode, { ...tools(), requests: [{ arguments: [value(type, "1")], memoryBytes: 0 }, { arguments: [value(type, "1")] }] });
    assert.equal(memory.code, "r05-execution-abort"); assert.equal(memory.activeRequests, "0"); assert.deepEqual(good.result, value(type, "1"));
  });
});

test("exact large source tokens and trivia/group metamorphisms survive owned facts without f64", async () => {
  for (const [token, expected] of [["9007199254740993", "9007199254740993"], ["0xffff_ffff_ffff_ffff", "18446744073709551615"], ["0b100000000000000000000000000000000000000000000000000001", "9007199254740993"]]) {
    for (const expression of [token, `(/*precision😀*/ ${token})`]) {
      const result = await compileAndRun(`export function entry(): u64 { return ${expression}; }`, tools());
      assert.equal(result.status, "ok", JSON.stringify(result)); assert.deepEqual(result.requests[0].result, value("u64", expected));
      const printed = printHir(result.hir); assert.equal(printHir(readHir(Buffer.from(printed))), printed);
    }
  }
  const input = await sourceInput("export function entry(): usize { return 1; }");
  for (const change of [{ pointerBits: "32" }, { llvmDataLayout: "e-p:32:32" }, { target: "linux-x86_64-gnu" }]) {
    const wrong = structuredClone(input); Object.assign(wrong.target, change);
    const result = await compileHir(wrong, tools()); assert.equal(result.status, "error"); assert.equal(result.diagnostics[0].code, "r02b-d-input");
  }
});
