// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { coreTestModule, sourceAttributes } from "./core-fixtures.mjs";

const executable = process.env.TSFG_CORE_IR_EXE;
const input = coreTestModule(`
    %value = "tsfg_core.constant"() {value = 42 : i32, ${sourceAttributes}} : () -> i32
    "func.return"(%value) {${sourceAttributes}} : (i32) -> ()
`);

function canonicalize(source) {
  assert.ok(executable, "TSFG_CORE_IR_EXE must name the real source-built consumer");
  const child = spawnSync(executable, ["--canonicalize"], { input: source, encoding: "utf8", windowsHide: true });
  assert.ifError(child.error);
  return child;
}

// Independent structural oracle: compare the owned literal and its SSA return
// against the source fixture. This does not call the consumer's verifier or
// claim execution of the function.
function constantReturnOracle(text, expected) {
  const headers = [...text.matchAll(/"func\.func"\(\)\s*<\{([^}]+)\}>\s*\(\s*\{/g)]
    .filter(header => /\bsym_name\s*=\s*"sample"/.test(header[1]));
  assert.equal(headers.length, 1, "the structural oracle requires exactly one @sample function");
  const header = headers[0];
  assert.match(header[1], /function_type\s*=\s*\(\)\s*->\s*i32/);
  const begin = header.index + header[0].length;
  let depth = 1, quoted = false, escaped = false, end = begin;
  for (; end < text.length && depth > 0; end++) {
    const character = text[end];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === "{") depth++;
    else if (character === "}") depth--;
  }
  assert.equal(depth, 0, "@sample region is unbalanced");
  const body = text.slice(begin, end - 1);
  const constant = body.match(/(%[\w]+)\s*=\s*"tsfg_core\.constant"\(\)\s*\{[^}]*value\s*=\s*(-?\d+)\s*:\s*i32[^}]*\}\s*:\s*\(\)\s*->\s*i32/);
  assert.ok(constant, `canonical constant missing: ${text}`);
  assert.equal(Number(constant[2]), expected);
  const returns = [...body.matchAll(/"func\.return"\((%[\w]+)\)\s*(?:\{[^}]*\})?\s*:\s*\(i32\)\s*->\s*\(\)/g)];
  assert.equal(returns.length, 1, "@sample must return one typed SSA value");
  assert.equal(returns[0][1], constant[1], "@sample must return its expected constant SSA value");
  assert.match(text, /tsfg_core\.version\s*=\s*"0\.8\.0"/);
}

test("structural oracle rejects a wrong sample result hidden by another function", () => {
  const functionText = (name, value) => `"func.func"() <{function_type = () -> i32, sym_name = "${name}"}> ({
    %0 = "tsfg_core.constant"() {value = ${value} : i32} : () -> i32
    "func.return"(%0) : (i32) -> ()
  }) : () -> ()`;
  const text = `"builtin.module"() ({${functionText("sample", 0)} ${functionText("other", 42)}}) {tsfg_core.version = "0.9.0"} : () -> ()`;
  assert.throws(() => constantReturnOracle(text, 42), { code: "ERR_ASSERTION", actual: 0, expected: 42 });
  assert.doesNotThrow(() => constantReturnOracle(text, 0));
  // This only checks the independent oracle; it is not native verifier or
  // source-consumption acceptance evidence.
});

test("admitted C++ Core IR consumer verifies typed SSA and canonically rereads it", () => {
  const first = canonicalize(input);
  assert.equal(first.status, 0, first.stderr);
  constantReturnOracle(first.stdout, 42);
  const second = canonicalize(first.stdout);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.stdout, first.stdout);
});

test("Core IR canonical form preserves boundary constants and ignores source spelling", () => {
  for (const value of [-2147483648, 0, 2147483647]) {
    const fixture = input.replace("42 : i32", `${value} : i32`);
    const first = canonicalize(fixture);
    assert.equal(first.status, 0, first.stderr);
    constantReturnOracle(first.stdout, value);
    const renamed = canonicalize(fixture.replaceAll("%value", "%renamed").replace("\n  func", "\n\n // source spelling\n  func"));
    assert.equal(renamed.status, 0, renamed.stderr);
    assert.equal(renamed.stdout, first.stdout);
  }
});

test("Core IR refuses a missing or different exchange identity", () => {
  for (const fixture of [input.replace("0.9.0", "0.3.0"), input.replace('tsfg_core.version = "0.9.0", ', "")]) {
    const child = canonicalize(fixture);
    assert.equal(child.status, 3);
    assert.match(child.stderr, /\[core-ir-identity\]/);
    assert.equal(child.stdout, "");
  }
});

test("Core IR refuses damaged syntax, undefined SSA, unknown operations and wrong result/value types", () => {
  for (const fixture of [input.slice(0, -3), input.replace("(%value)", "(%missing)"),
    input.replace("tsfg_core.constant", "tsfg_core.unknown"), input.replace("value = 42 : i32", "value = 42 : i64"),
    input.replace("value = 42 : i32, ", ""), input.replace(": () -> i32", ": () -> i64"),
    input.replace('"tsfg_core.constant"() {', '"tsfg_core.constant"() ({}) {'),
    input.replaceAll("i32", "si32"), input.replaceAll("i32", "ui32")]) {
    const child = canonicalize(fixture);
    assert.equal(child.status, 3, child.stderr);
    assert.match(child.stderr, /\[core-ir-invalid\]/);
    assert.equal(child.stdout, "");
  }
});

test("Core IR command failures have a stable machine identity", () => {
  assert.ok(executable, "TSFG_CORE_IR_EXE must name the real source-built consumer");
  const child = spawnSync(executable, ["--execute"], { encoding: "utf8", windowsHide: true });
  assert.ifError(child.error);
  assert.equal(child.status, 2);
  assert.match(child.stderr, /\[core-ir-command\]/);
  assert.equal(child.stdout, "");
});
