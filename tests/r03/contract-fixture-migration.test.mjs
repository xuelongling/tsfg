// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { contractSetProjection, verifiedContractSet } from "../../eng/contract-set.mjs";
import { currentContractSetCanonical, currentContractSetId } from "../r00/contract-compatibility-fixtures.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = relative => readFile(new URL(relative, new URL("../../", import.meta.url)), "utf8");
const digest = value => createHash("sha256").update(value).digest("hex");
// Independent JCS encoding for these I-JSON contract records, rather than a product hash helper.
const canonical = value => Array.isArray(value)
  ? `[${value.map(canonical).join(",")}]`
  : value !== null && typeof value === "object"
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
    : JSON.stringify(value);
const currentBytecodeHash = "sha256:fec456a47f509480d96f65e5c03d465c7c204d60f09630e71b19c714d4aaafa7";
const previousBytecodeHash = "sha256:3dea6ce5de996dfa3e7141cced985243ea74ac9bb80f03636c6694343118f2a6";

test("registered global operations preserve scalars and add nominal managed String", async () => {
  const schema = JSON.parse(await read("contracts/bytecode.schema.json"));
  assert.deepEqual([schema.scalarCodes.f32, schema.scalarCodes.f64], ["12", "13"]);
  assert.equal(schema.typeCodes.string, "14");
  assert.deepEqual(schema.instructions.global_load.record[1], ["type", "u8:1..14"]);
  assert.deepEqual(schema.instructions.global_store.record[1], ["type", "u8:1..14"]);
  assert.equal(schema.semver, "0.12.0");
  assert.deepEqual(schema.header[1], ["version", "u32:12"]);
});

test("registry verifies all current schema bytes and keeps old identities distinct", async () => {
  const registry = JSON.parse(await read("contracts/registry.json"));
  const projection = await verifiedContractSet(root, registry, canonical);
  assert.equal(projection["tsfg.bytecode"].schemaHash, currentBytecodeHash);
  assert.notEqual(projection["tsfg.bytecode"].schemaHash, previousBytecodeHash);
  const mixed = structuredClone(registry);
  mixed["tsfg.bytecode"].schemaHash = previousBytecodeHash;
  await assert.rejects(verifiedContractSet(root, mixed, canonical), /invalid canonical Contract Registry/);
});

test("Core and Runtime consume the exact registered bytecode identity", async () => {
  const core = await read("compiler/core-ir/bytecode.cpp");
  const runtime = await read("runtime/contract.zig");
  assert.equal(/bytecodeSchema =\s*"([a-f0-9]{64})"/.exec(core)?.[1], currentBytecodeHash.slice(7));
  assert.equal(/schema_hash_hex = "([a-f0-9]{64})"/.exec(runtime)?.[1], currentBytecodeHash.slice(7));
});

test("R00 current Contract Set fixture is the canonical registered mapping", async () => {
  const registry = JSON.parse(await read("contracts/registry.json"));
  assert.equal(currentContractSetCanonical, canonical(contractSetProjection(registry)));
  assert.equal(currentContractSetId, `sha256:${digest(currentContractSetCanonical)}`);
});

test("independent Zig fixture has the current v12 header and explicit single-source mode byte", async () => {
  const source = await read("runtime/fixture.zig");
  const packet = Buffer.from([...source.matchAll(/0x([a-f0-9]{2})/g)].map(match => parseInt(match[1], 16)));
  assert.equal(packet.subarray(0, 8).toString(), "TSFGTBC0");
  assert.equal(packet.readUInt32LE(8), 12);
  assert.equal(packet.subarray(12, 44).toString("hex"), currentBytecodeHash.slice(7));
  assert.equal(packet.readUInt32LE(44), packet.length);
  assert.equal(packet.subarray(48, 80).toString("hex"), digest(packet.subarray(80)));
  let offset = 80;
  const string = () => {
    const size = packet.readUInt32LE(offset); offset += 4;
    const value = packet.subarray(offset, offset + size).toString(); offset += size;
    return value;
  };
  assert.equal(string(), "windows-x86_64-msvc");
  assert.equal(string(), "x86_64-pc-windows-msvc");
  assert.equal(string(), "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128");
  assert.deepEqual([0, 2, 4, 6].map(at => packet.readUInt16LE(offset + at)), [4, 4, 64, 8]);
  offset += 8;
  assert.equal(packet.readUInt32LE(offset), 119); offset += 4 + 64;
  assert.equal(string(), "/fixture.ts");
  assert.equal(packet.readUInt32LE(offset), 46); offset += 4;
  assert.equal(packet[offset++], 0, "moduleMode0 precedes even a single-source function table");
  assert.equal(packet.readUInt16LE(offset), 1); offset += 2 + 96;
  assert.equal(string(), "constant");
  assert.deepEqual([packet[packet.length - 48], packet[packet.length - 32], packet[packet.length - 16]], [26, 1, 2]);
  assert.equal(packet.readInt32LE(packet.length - 28), 42);
});
