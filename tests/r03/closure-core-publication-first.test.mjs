// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { verifyHir, printHir, analyzeClosureCalls } from "../../compiler/hir.mjs";
import { lowerClosureEnvironments, verifyClosureEnvironments, printClosureEnvironments } from "../../compiler/closure-environments.mjs";
import { emitClosureCore } from "../../compiler/closure-core-emitter.mjs";

const fixture = JSON.parse(await readFile(new URL("./closure-core-publication-first.json", import.meta.url), "utf8"));
const clone = value => JSON.parse(JSON.stringify(value));
/** @param {any} value @returns {string} */
function jcs(value) {
  return Array.isArray(value) ? "[" + value.map(jcs).join(",") + "]"
    : value && typeof value === "object" ? "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + jcs(value[k])).join(",") + "}" : JSON.stringify(value);
}

test("23c FIRST: fixed Published state requirement survives a narrower body at the original closure creation", () => {
  assert.equal(fixture.provenance.syntheticStructuralOrigin, true);
  assert.equal(fixture.provenance.ownedGoResponse, false);
  assert.equal(fixture.provenance.sourceExecutable, false);
  assert.equal(fixture.hir.source.content.length, fixture.provenance.originalSource.length);
  const hir = verifyHir(clone(fixture.hir));
  assert.deepEqual(hir, fixture.hir);
  assert.equal(printHir(hir), jcs(fixture.hir) + "\n");
  const program = lowerClosureEnvironments(hir);
  assert.deepEqual(program, fixture.program);
  assert.deepEqual(verifyClosureEnvironments(clone(program), hir), fixture.program);
  assert.equal(printClosureEnvironments(program, hir), jcs(fixture.program) + "\n");
  assert.deepEqual(analyzeClosureCalls(hir, clone(fixture.context)), fixture.analysis);

  // The complete DEFAULT producer control must pass before the selected call.
  assert.equal(emitClosureCore(program, hir), fixture.defaultCore);

  // BASE ignores this existing public API's third argument. Its natural RED is
  // Missing expected exception, after all complete positive controls above.
  assert.throws(() => emitClosureCore(program, hir, clone(fixture.context)),
    /** @param {any} error */ error => {
      assert.ok(error instanceof TypeError);
      assert.deepEqual({ name: error.name, message: error.message,
        ...Object.fromEntries(Object.keys(error).map(k => [k, error[k]])) }, fixture.expectedFixedError);
      return true;
    });
});
