// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";
import { compileProgram, sourceInput, runBytecode } from "../../compiler/pipeline.mjs";

const tools = () => ({ frontend: process.env.TSFG_FRONTEND_EXE,
  core: process.env.TSFG_CORE_IR_EXE, vm: process.env.TSFG_VM_EXE });
async function oracle(name, hash) {
  const bytes = await readFile(new URL(`./fixtures/${name}`, import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
  return JSON.parse(bytes);
}
const literalOracle = () => oracle("exact-float-oracle.PREPARED.json", "ac59c356703cd3e309b0e9f6ab076c0d06d823bc7830310384a8de819f438e94");
const arithmeticOracle = () => oracle("exact-arithmetic-oracle.CANONICAL-FROZEN.json", "f9acf7084d93c2b35eff537cb67e9ae01dfe9bffd25fd4c97de643881de4f386");
const remainderOracle = () => oracle("exact-remainder-oracle.CORRECTED-FROZEN.json", "12f13a0b503bc7eb52dd1a223d3c5ab022bb6eb2212bb5614b53b78f629c6471");

test("54 exact rational literal expectations reach declared float bits through the official source pipeline", async () => {
  const frozen = await literalOracle();
  for (const optimize of [false, true]) for (const item of frozen.cases) {
    const program = await compileProgram(await sourceInput(item.source), { ...tools(), optimize });
    if (item.expected.kind === "compile-reject-finite-overflow") {
      assert.equal(program.status, "error", item.id);
      assert.ok(program.diagnostics.some(d => d.code === "r01-d-float-range"), item.id);
      assert.equal(program.bytecode, undefined);
    } else {
      assert.equal(program.status, "ok", JSON.stringify({ id: item.id, program }));
      const [result] = await runBytecode(program.bytecode, tools());
      assert.equal(result.status, "returned", item.id);
      assert.deepEqual(result.result, { type: item.type, value: item.expected.rawBits }, item.id);
    }
  }
});

for (const [name, load, count] of [["arithmetic/comparison", arithmeticOracle, 672], ["truncating-quotient remainder", remainderOracle, 102]]) {
  test(`${count} independently frozen exact ${name} cases execute in both optimizer modes`, async () => {
    const frozen = await load();
    assert.equal(frozen.cases.length, count);
    for (const optimize of [false, true]) for (const source of frozen.programs) {
      const program = await compileProgram(await sourceInput(source.source), { ...tools(), optimize });
      assert.equal(program.status, "ok", JSON.stringify(program));
      const cases = frozen.cases.filter(item => item.programId === source.id);
      const requests = cases.map(item => ({ arguments: item.inputs.map(v => ({ type: v.type, value: v.rawBits })) }));
      const outcomes = await runBytecode(program.bytecode, { ...tools(), requests });
      assert.equal(outcomes.length, cases.length);
      for (const [index, item] of cases.entries()) {
        const actual = outcomes[index];
        assert.equal(actual.status, "returned", item.id);
        const expected = item.expected;
        const value = expected.kind === "arithmeticNaN" ? expected.canonicalRawBits : expected.rawBits ?? expected.value;
        assert.deepEqual(actual.result, { type: typeof value === "boolean" ? "bool" : source.type, value }, item.id);
        assert.equal(actual.activeRequests, "0", item.id);
      }
    }
  });
}
