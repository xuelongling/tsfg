// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test from "node:test";
import { readRuntimeOutput } from "../../compiler/pipeline.mjs";

for (const encoding of ["strict", "lossy"]) {
  test(`Runtime JSON preserves valid UTF-8 and original byte length in ${encoding} mode`, () => {
    const result = { type: "string", value: "\0e\u0301\u{1f600}\ufffd", byteLength: 11, encoding };
    const outcomes = [{ status: "returned", result }];
    assert.deepEqual(readRuntimeOutput(Buffer.from(JSON.stringify(outcomes)), "--requests"), outcomes);
  });

  test(`Runtime JSON rejects malformed UTF-8 in ${encoding} mode`, () => {
    const prefix = Buffer.from('[{"status":"returned","result":{"type":"string","value":"');
    const suffix = Buffer.from(`","byteLength":2,"encoding":"${encoding}"}}]`);
    for (const invalid of [[0xc3, 0x28], [0xf0, 0x9f], [0xed, 0xa0, 0x80]]) {
      const bytes = Buffer.concat([prefix, Buffer.from(invalid), suffix]);
      assert.throws(() => readRuntimeOutput(bytes), /r03-tool-runtime: invalid UTF-8 in Runtime output/);
    }
  });
}

test("Runtime keeps JSON syntax checks and preserves raw roundtrip bytes", () => {
  assert.throws(() => readRuntimeOutput(Buffer.from("[{")), SyntaxError);
  const bytes = Buffer.from([0x00, 0xff, 0xed, 0xa0, 0x80]);
  assert.strictEqual(readRuntimeOutput(bytes, "--roundtrip"), bytes);
});
