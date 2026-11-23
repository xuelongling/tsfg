// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import test from "node:test";
import { canonical, sha256 } from "../../compiler/identity.mjs";
import { runBytecode, runModuleRequests, runRequestSequence, runStaticProgram } from "../../compiler/pipeline.mjs";
import { createCounterHostContract } from "../../eng/host-semantic-contract.mjs";
import declarations from "../../eng/build-inputs.json" with { type: "json" };
import oracle from "./host-counter-semantic-oracle.json" with { type: "json" };
import { aotMetadataObject } from "./aot-compiler-coff.mjs";
import { expectedStringCore, expectedStringPacket, stringCases } from "./formal-string-gold.mjs";

test("request transports own their input while Runtime admission is pending", async t => {
  const captured = process.env.TSFG_R03_RUNTIME_TRANSPORT_CAPTURE;
  const cases = stringCases();
  const first = cases.find(row => row.name === "lossless");
  const concatCase = cases.find(row => row.name === "concat");
  assert.ok(first && concatCase);
  let lossless = expectedStringPacket(first.hir);
  let concat = expectedStringPacket(concatCase.hir);
  let core = Buffer.from(expectedStringCore(first.hir));
  let packet = lossless;
  const tableDigest = bytes => sha256(Buffer.concat([Buffer.from("tsfg.aot-compiled-module.v4\0"), bytes]));
  let object = aotMetadataObject(first.hir.inputIdentity, tableDigest(packet));
  if (captured) {
    const strings = path.join(captured, "M24l-formal-string-runtime-checks-20261021", "c75-wire12-originals-20261121");
    const scalar = path.join(captured, "M18-conversions-aot-checks-20261021");
    [lossless, concat, core, packet, object] = await Promise.all([
      fs.readFile(path.join(strings, "lossless", "lossless.wire12.tbc")),
      fs.readFile(path.join(strings, "concat", "concat.wire12.tbc")),
      fs.readFile(path.join(scalar, "production-program-cli-FIRST01-children", "0002", "stdin.bin")),
      fs.readFile(path.join(scalar, "module-consumer-GREEN01-children", "0003", "stdout.bin")),
      fs.readFile(path.join(scalar, "production-program-cli-FIRST01-children", "0002", "stdout.bin")),
    ]).then(files => files.map(bytes => Buffer.from(bytes)));
    assert.deepEqual([lossless, concat, core, packet, object].map(sha256), [
      "sha256:9da3c924f25a12105731bedb7bcd269b9a9e982692c3fcd169d202ef4c0ff3c6",
      "sha256:df7464e352e41be20a7e416f8415ee8efb905f92d85e75249338d1c59c2aef4a",
      "sha256:4a66bf059d690f25e9e3202473e971cd98151bf585af674f981b24a4e5d49aad",
      "sha256:4f6a0466214a34b6eb4ddc4c049411cd26a4cb5a3f3a655ac41fb38f770f1c03",
      "sha256:77a593418f3c642b1f806760ca4e65ae8f7c4c9009e464cde3811fb4eeecf576",
    ]);
  }

  const product = new URL("../../", import.meta.url);
  const paths = declarations.entries.filter(row => row.projectId === "tsfg").map(row => row.path).sort();
  const entries = await Promise.all(paths.map(async name => ({
    projectId: "tsfg", repositoryRelativePath: name, normalizedMode: "100644",
    sha256: sha256(await fs.readFile(new URL(name, product))),
  })));
  const inputs = { schemaVersion: "1", entries };
  const buildInputSet = { ...inputs, digest: sha256(canonical(inputs)) };
  const directory = path.join(import.meta.dirname, "runtime-transport-fixture");
  /** @param {"tsfg-vm" | "tsfg-aot"} sourceTarget */
  function admissionFixture(sourceTarget) {
    const aot = sourceTarget === "tsfg-aot";
    const name = sourceTarget + ".exe";
    const executable = Buffer.from("inert request transport fixture");
    const { digest: oldDigest, ...template } = oracle.identity.buildIdentity;
    const options = { sourceTarget, simdDispatch: "runtime-detected", ...(aot ? { programCore: sha256(core) } : {}) };
    const body = { ...template, options, buildInputSetDigest: buildInputSet.digest };
    const buildIdentity = { ...body, digest: sha256(canonical(body)) };
    const host = createCounterHostContract({ buildIdentity, buildInputSet });
    const files = new Map([[name, executable], ["host-semantic-contract.json", Buffer.from(host.contractText)]]);
    if (aot) {
      files.set("program.mlir", core);
      files.set("program.tbc", packet);
      files.set("program.obj", object);
    } else {
      files.set("host-cost-summary.json", Buffer.from(JSON.stringify({
        summaryVersion: "tsfg-host-cost-v1", linkedRuntimeHash: sha256(executable),
      })));
    }
    const manifest = {
      buildIdentity, buildInputSet, outputs: [...files].map(([file, bytes]) => ({ path: file, sha256: sha256(bytes) })),
      ...(aot ? { executionBackend: "aot-v4", program: {
        core: sha256(core), bytecode: sha256(packet), object: sha256(object), compiledTableId: tableDigest(packet),
      } } : {}),
    };
    const folder = path.join(directory, sourceTarget);
    return { folder, executable: path.join(folder, name), files, manifest };
  }
  const vm = admissionFixture("tsfg-vm");
  const aot = admissionFixture("tsfg-aot");
  let pendingManifest;
  let transport;
  let output = Buffer.from("[]");
  const readFile = fs.readFile;
  t.mock.method(fs, "readFile", async (file, ...args) => {
    const fixture = typeof file === "string" && [vm, aot].find(row => row.folder === path.dirname(file));
    if (!fixture) return Reflect.apply(readFile, fs, [file, ...args]);
    if (path.basename(file) === "artifact-manifest.json") {
      assert.ok(pendingManifest, "the request must begin paused");
      const gate = pendingManifest;
      pendingManifest = undefined;
      await gate;
      return JSON.stringify(fixture.manifest);
    }
    const bytes = fixture.files.get(path.basename(file));
    assert.ok(bytes);
    return bytes;
  });
  t.mock.method(childProcess, "spawnSync", (executable, args, { input }) => {
    assert.ok(executable === vm.executable || executable === aot.executable);
    assert.equal(transport, undefined);
    const bytes = ArrayBuffer.isView(input)
      ? Buffer.from(new Uint8Array(input.buffer, input.byteOffset, input.byteLength)) : input;
    transport = { executable, args, input: bytes };
    return { stdout: output, stderr: Buffer.alloc(0), status: 0, signal: null, output: [null, output, Buffer.alloc(0)], pid: 0 };
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });

  async function paused(invoke, mutate = () => {}) {
    transport = undefined;
    const gate = Promise.withResolvers();
    pendingManifest = gate.promise;
    const request = invoke();
    try {
      assert.equal(pendingManifest, undefined, "the manifest read must be waiting");
      assert.equal(transport, undefined, "transport must wait for admission");
      mutate();
    } finally {
      gate.resolve(undefined);
      await Promise.allSettled([request]);
    }
    return request;
  }

  await t.test("ordinary and persistent VM requests keep the original String arguments and sliced input bytes", async () => {
    for (const persistent of [false, true]) {
      const buffer = new ArrayBuffer(lossless.length + 9);
      const region = new Uint8Array(buffer, 5, lossless.length);
      region.set(lossless);
      const view = new DataView(buffer, 5, lossless.length);
      const units = [0, 0xd800, 0x65];
      const requests = [{ stringOutput: "strict", arguments: [{ type: "string", value: units }] }];
      const original = JSON.stringify(requests);
      const invoke = persistent ? runModuleRequests : runBytecode;
      assert.deepEqual(await paused(() => invoke(view, { vm: vm.executable, requests }), () => {
        requests[0].stringOutput = "lossy";
        units.splice(0, units.length, 0x61);
        region.fill(0);
        region.set(concat);
      }), []);
      assert.deepEqual(transport.args, [persistent ? "--module-requests" : "--requests", original]);
      assert.deepEqual(transport.input, lossless);
    }
  });

  await t.test("a non-byte typed view keeps its original byte range during admission", async () => {
    const buffer = new ArrayBuffer(concat.length + 8);
    const region = new Uint8Array(buffer, 4, concat.length);
    region.set(concat);
    const view = new Uint16Array(buffer, 4, concat.length / 2);
    await paused(() => runBytecode(view, { vm: vm.executable, requestJson: "[{}]" }), () => region.fill(0));
    assert.equal(sha256(transport.input), sha256(concat));
    assert.equal(transport.input.length, concat.length);
  });

  await t.test("ordinary and persistent requests use the view's native byte range", async () => {
    for (const [makeView, invoke] of [
      [buffer => new DataView(buffer, 4, concat.length), runModuleRequests],
      [buffer => new Uint16Array(buffer, 4, concat.length / 2), runBytecode],
      [buffer => Buffer.from(buffer, 4, concat.length), runBytecode],
    ]) {
      const buffer = new ArrayBuffer(concat.length + 8);
      const region = new Uint8Array(buffer, 4, concat.length);
      region.set(concat);
      const view = makeView(buffer);
      Object.defineProperties(view, {
        buffer: { value: new ArrayBuffer(concat.length) },
        byteOffset: { value: 0 },
        byteLength: { value: concat.length },
      });
      await paused(() => invoke(view, { vm: vm.executable, requests: [{}] }), () => region.fill(0));
      assert.equal(sha256(transport.input), sha256(concat));
      assert.equal(transport.input.length, concat.length);
    }
  });

  await t.test("static AOT keeps the original request JSON for both instance modes", async () => {
    for (const persistent of [false, true]) {
      const requests = [{ semanticFuel: 7, stringOutput: "strict" }];
      const expected = JSON.stringify(requests);
      assert.deepEqual(await paused(() => runStaticProgram({ executable: aot.executable, requests, persistent }), () => {
        requests[0].semanticFuel = 0;
        requests[0].stringOutput = "lossy";
      }), []);
      assert.deepEqual(transport, {
        executable: aot.executable, args: [persistent ? "--module-requests" : "--requests", expected], input: undefined,
      });
    }
  });

  await t.test("a request sequence keeps all original requests paired with the retained packets", async () => {
    const packets = [Buffer.from(lossless), Buffer.from(concat)];
    const requests = [{ stringOutput: "strict" }, { stringOutput: "lossy" }];
    const expected = JSON.stringify(requests);
    assert.deepEqual(await paused(() => runRequestSequence(packets, { vm: vm.executable, requests }), () => {
      requests.reverse().pop();
      packets[0].fill(0);
      packets.reverse();
    }), []);
    assert.deepEqual(transport.args, ["--request-sequence", expected]);
    const { input } = transport;
    assert.equal(input.subarray(0, 8).toString("ascii"), "TSFGREQ1");
    assert.equal(input.readUInt32LE(8), 2);
    assert.equal(input.readUInt32LE(12), lossless.length);
    assert.deepEqual(input.subarray(16, 16 + lossless.length), lossless);
    assert.equal(input.readUInt32LE(16 + lossless.length), concat.length);
    assert.deepEqual(input.subarray(20 + lossless.length), concat);
  });

  await t.test("frame lengths use the Buffer's native byte range", async () => {
    const bytes = Buffer.alloc(concat.length + 8, 0xff);
    const view = bytes.subarray(4, 4 + concat.length);
    concat.copy(view);
    Object.defineProperty(view, "length", { value: 0 });
    await paused(() => runRequestSequence([view], { vm: vm.executable }), () => bytes.fill(0));
    assert.equal(transport.input.readUInt32LE(12), concat.length);
    assert.equal(sha256(transport.input.subarray(16)), sha256(concat));
  });

  await t.test("sequence modules pair with requests in array index order", async () => {
    const packets = [lossless, concat];
    packets[Symbol.iterator] = function* () {
      yield packets[1];
      yield packets[0];
    };
    const requests = [{ semanticFuel: 11 }, { semanticFuel: 17 }];
    await paused(() => runRequestSequence(packets, { vm: vm.executable, requests }));
    const { input, args } = transport;
    assert.deepEqual(args, ["--request-sequence", JSON.stringify(requests)]);
    assert.equal(input.readUInt32LE(8), 2);
    assert.equal(input.readUInt32LE(12), lossless.length);
    assert.deepEqual(input.subarray(16, 16 + lossless.length), lossless);
    assert.equal(input.readUInt32LE(16 + lossless.length), concat.length);
    assert.deepEqual(input.subarray(20 + lossless.length), concat);
  });

  await t.test("explicit request JSON and nonrequest command bytes retain their existing transport", async () => {
    const requests = { toJSON: () => assert.fail("unused requests were serialized") };
    const requestJson = '[{"semanticFuel":18446744073709551615,"stringOutput":"strict"}]';
    await paused(() => runBytecode(concat, { vm: vm.executable, requests, requestJson }));
    assert.deepEqual(transport.args, ["--requests", requestJson]);
    await paused(() => runBytecode("text input", { vm: vm.executable, requests, command: "--inspect" }));
    assert.deepEqual(transport.args, ["--inspect"]);
    assert.equal(transport.input, "text input");
    output = Buffer.from([0xff, 0x00, 0x01]);
    const returned = await paused(() => runBytecode(concat, { vm: vm.executable, requests, command: "--roundtrip" }));
    assert.strictEqual(returned, output);
    assert.deepEqual(transport.args, ["--roundtrip"]);
    assert.deepEqual(transport.input, concat);
  });
});
