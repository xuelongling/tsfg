// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";
import registry from "../../contracts/registry.json" with { type: "json" };
import schema from "../../contracts/bytecode.schema.json" with { type: "json" };
/** @param {string | Buffer} text */
const hash = text => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const at = "tsfg_source.start = 0 : i64, tsfg_source.end = 200 : i64";
const coreType = name => name === "i32" ? "i32" : name === "bool" ? "i1" : `!tsfg_core.integer<"${name}">`;
function fn(name, type, body) {
  const signature = hash(`tsfg.signature\0()->${type}`);
  const id = hash(`tsfg.function\0/src/main.ts\0${name}\0${signature.slice(7)}`);
  return `func.func @${name}() -> ${coreType(type)} attributes {tsfg_core.function_id = "${id}", tsfg_core.signature_hash = "${signature}", tsfg_core.type_id = "${hash(`tsfg.type\0${type}`)}", tsfg_core.function_start = 0 : i64, tsfg_core.function_end = 200 : i64} { "tsfg_core.fuel"() {event = 1 : i32, ${at}} : () -> () ${body} }`;
}
function module(...functions) {
  return `module attributes {tsfg_core.version = "0.8.0", tsfg_core.input_identity = "${hash("integer Core input")}", tsfg_core.source_hash = "${hash("integer Core source")}", tsfg_core.source_path = "/src/main.ts", tsfg_core.source_length = 200 : i64, tsfg_core.target = "${schema.target.target}", tsfg_core.triple = "${schema.target.triple}", tsfg_core.data_layout = "${schema.target.llvmDataLayout}", tsfg_core.bytecode_schema = "${registry["tsfg.bytecode"].schemaHash}"} {${functions.join("\n")}}`;
}
function returnConstant(type, decimal) {
  const spelling = type === "i32" ? `${decimal} : i32` : JSON.stringify(decimal);
  return `%v = "tsfg_core.constant"() {value = ${spelling}, ${at}} : () -> ${coreType(type)} "func.return"(%v) {${at}} : (${coreType(type)}) -> ()`;
}
/** @param {string} role @param {string[]} args @param {string | Buffer} bytes */
function invoke(role, args, bytes) {
  const executable = role === "core" ? process.env.TSFG_CORE_IR_EXE : process.env.TSFG_VM_EXE;
  assert.match(executable, /^E:[\\/]/i);
  const result = spawnSync(executable, args, { input: bytes, windowsHide: true, maxBuffer: 2 ** 20, timeout: 30000 });
  assert.ifError(result.error); return result;
}
const families = [["i8", "-128", "127"], ["i16", "-32768", "32767"], ["i64", "-9223372036854775808", "9223372036854775807"], ["u8", "0", "255"], ["u16", "0", "65535"], ["u32", "0", "4294967295"], ["u64", "0", "18446744073709551615"], ["isize", "-9223372036854775808", "9223372036854775807"], ["usize", "0", "18446744073709551615"]];

test("registered nominal integer Core verifies, canonically reads/prints and lowers exact extremes", async t => {
  for (const [type, minimum, maximum] of families) await t.test(type, () => {
    for (const decimal of [minimum, maximum]) {
      const input = module(fn("entry", type, returnConstant(type, decimal)));
      const printed = invoke("core", ["--canonicalize"], input);
      assert.equal(printed.status, 0, printed.stderr.toString());
      assert.match(printed.stdout.toString(), /tsfg_core\.integer/);
      const reread = invoke("core", ["--canonicalize"], printed.stdout);
      assert.equal(reread.status, 0, reread.stderr.toString()); assert.deepEqual(reread.stdout, printed.stdout);
      const packet = invoke("core", ["--emit-bytecode"], reread.stdout);
      assert.equal(packet.status, 0, packet.stderr.toString());
      const roundtrip = invoke("vm", ["--roundtrip"], packet.stdout);
      assert.equal(roundtrip.status, 0, roundtrip.stderr.toString()); assert.deepEqual(roundtrip.stdout, packet.stdout);
      const request = invoke("vm", ["--requests", "[{}]"], packet.stdout);
      assert.equal(request.status, 0, request.stderr.toString());
      assert.deepEqual(JSON.parse(request.stdout.toString())[0].result, { type, value: decimal });
    }
  });
});
test("public Core rejects each exact out-of-range/noncanonical constant and invalid unentered function", () => {
  for (const [type, minimum, maximum] of families) {
    for (const decimal of [(BigInt(minimum) - 1n).toString(), (BigInt(maximum) + 1n).toString(), "00", "-0", "+1", "1e0", "0x1"]) {
      const input = module(fn("entry", "i32", returnConstant("i32", "42")), fn("bad", type, returnConstant(type, decimal)));
      for (const mode of ["--canonicalize", "--emit-bytecode", "--optimize"]) {
        const rejected = invoke("core", [mode], input); assert.equal(rejected.status, 3, `${type} ${decimal}: ${rejected.stderr}`); assert.equal(rejected.stdout.length, 0);
      }
    }
  }
  const input = module(fn("entry", "u64", returnConstant("u64", "1")));
  for (const invalid of [input.replaceAll('integer<"u64">', 'integer<"usize">'), input.replace('integer<"u64">', 'integer<"i64">'), input.replace('integer<"u64">', 'integer<"u128">'), input.replace(schema.target.llvmDataLayout, "e-p:32:32")]) {
    const rejected = invoke("core", ["--emit-bytecode"], invalid); assert.equal(rejected.status, 3); assert.equal(rejected.stdout.length, 0);
  }
});
test("R04 independently rejects pointer layout, mixed identities and noncanonical width bits before execution", () => {
  const packet = invoke("core", ["--emit-bytecode"], module(fn("entry", "i8", returnConstant("i8", "127"))));
  assert.equal(packet.status, 0, packet.stderr.toString());
  let layout = 80; for (let index = 0; index < 3; index++) layout += 4 + packet.stdout.readUInt32LE(layout);
  const mutate = (change, code) => {
    const bytes = Buffer.from(packet.stdout); change(bytes); createHash("sha256").update(bytes.subarray(80)).digest().copy(bytes, 48);
    for (const mode of ["--inspect", "--roundtrip", "--requests"]) {
      const rejected = invoke("vm", mode === "--requests" ? [mode, "[{}]"] : [mode], bytes);
      assert.equal(rejected.status, 3, rejected.stderr.toString()); assert.match(rejected.stderr.toString(), new RegExp(code)); assert.equal(rejected.stdout.length, 0);
    }
  };
  mutate(bytes => bytes.writeUInt16LE(32, layout + 4), "r04-layout");
  mutate(bytes => bytes.writeUInt16LE(4, layout + 6), "r04-layout");
  mutate(bytes => bytes.writeUInt32LE(5, 8), "r04-version");
  mutate(bytes => Buffer.from("cd74db13611d560646a088766cad13e41bfabb2976cb6573cbe488cbcce4e975", "hex").copy(bytes, 12), "r04-schema");
  mutate(bytes => bytes.writeBigUInt64LE(0x17fn, bytes.length - 24), "r04-integer-range");
  mutate(bytes => { bytes[bytes.length - 39] = 6; }, "r04-type");
});
