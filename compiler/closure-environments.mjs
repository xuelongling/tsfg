// SPDX-License-Identifier: MIT
import { verifyHir, printHir } from './hir.mjs';
import { canonical, sha256, own } from './identity.mjs';
import { readGenericJson } from './generic-json.mjs';
import { lowerEnvironmentGraph, environmentFailure as failure, environmentBudget as budget,
  limits } from './closure-environment-lowering.mjs';

/** Private typed operations, not physical heap layout or execution authority.
 * Layouts describe original binding slots; allocation stays in the owning
 * function body and creates a fresh environment on every dynamic invocation.
 * A closureCall saves its complete callee pair before left-to-right arguments.
 * All cold entrypoints recompute this same complete lowering from verified HIR.
 */
function serialize(program) {
  const text = canonical(program) + '\n';
  if (Buffer.byteLength(text, 'utf8') > limits.bytes) failure('limit', 'closure-explicit canonical bytes exceed budget');
  return text;
}

/** Lower the complete graph without inferring entrypoint assumptions.
 * @returns {any}
 */
export function lowerClosureEnvironments(hir) {
  const verified = verifyHir(hir);
  if (verified?.format?.family !== 'tsfg.closure-hir-candidate')
    failure('capability', 'environment lowering requires owned closure HIR');
  const program = lowerEnvironmentGraph(verified, sha256(printHir(verified)));
  // Include the final LF in the same byte limit enforced by the public reader.
  serialize(program);
  return own(program);
}
function matchProgram(program, expected) {
  budget(program);
  if (!program || typeof program !== 'object' || Array.isArray(program))
    failure('input', 'a closure-explicit program object is required');
  if (program.hirHash !== expected.hirHash) failure('identity', 'closure-explicit program belongs to different HIR bytes');
  if (canonical(program) !== canonical(expected)) failure('program', 'closure-explicit program differs from complete lowering');
  return expected;
}

/** Cold verification uses the same lowering, not a second semantic checker.
 * @returns {any}
 */
export function verifyClosureEnvironments(program, hir) {
  return matchProgram(program, lowerClosureEnvironments(hir));
}

/** @returns {string} */
export function printClosureEnvironments(program, hir) {
  return serialize(verifyClosureEnvironments(program, hir));
}

/** Own and bound untrusted bytes before parsing; then cold-recompute semantics.
 * @returns {any}
 */
export function readClosureEnvironments(bytes, hir) {
  const expected = lowerClosureEnvironments(hir);
  let input;
  try { input = readGenericJson(bytes, limits); }
  catch (error) {
    const category = error.code?.endsWith('-limit') ? 'limit'
      : error.code?.endsWith('-canonical') ? 'canonical' : 'input';
    failure(category, 'invalid closure-explicit JSON');
  }
  const program = matchProgram(input.value, expected);
  if (input.text !== serialize(program)) failure('canonical', 'closure-explicit program requires canonical JSON plus LF');
  return program;
}
