// SPDX-License-Identifier: MIT
import { verifyHir, printHir } from './hir.mjs';
import { canonical, sha256 } from './identity.mjs';
import { readGenericJson } from './generic-json.mjs';
import { targetLimits as limits, targetFailure as failure, targetBudget as budget } from './closure-target-domain.mjs';
import { solveClosureTargets } from './closure-target-solver.mjs';

/** Code targets only; no closure instance or environment identity is implied.
 * TOP is independent of the known owned IDs. An empty finite set is bottom,
 * never evidence that an unresolved reachable call has no possible target.
 * @typedef {{top: boolean, functions: string[]}} ClosureTargetSet
 */
/** @typedef {{binding: string, targets: ClosureTargetSet}} ClosureBindingTargets */
/** @typedef {{id: string, parameters: ClosureBindingTargets[], returns: ClosureTargetSet | null,
 * writes: ClosureBindingTargets[], unknownEffects: boolean}} ClosureFunctionTargets */
/** The expression path starts at its owning function (for example
 * ['body', 2, 'initializer']); range and kind refer to that exact HIR expression.
 * @typedef {{function: string, expressionPath: (string | number)[], range: {start: number, end: number},
 * kind: 'call' | 'indirectCall', targets: ClosureTargetSet}} ClosureCallTargets
 */
/** Roots are caller assumptions, never inferred from a function name/signature.
 * Only reached functions/calls and relevant captured callable bindings appear.
 * Parameter summaries contain callable parameters in declaration order; scalar
 * returns use null. Writes summarize captured callable writes across calls.
 * IDs sort by UTF-8 bytes, calls by function then canonical expressionPath bytes.
 * complete is false for any TOP, unknownEffects or unresolved reachable bottom;
 * true establishes no termination, path-feasibility or environment/GC proof.
 * @typedef {{format: {family: 'tsfg.closure-targets-candidate', version: 1}, hirHash: string,
 * roots: string[], precision: 'context-insensitive-may', complete: boolean,
 * functions: ClosureFunctionTargets[], capturedBindings: ClosureBindingTargets[],
 * calls: ClosureCallTargets[]}} ClosureTargetsReport
 */
function context(hir, rootFunctionIds) {
  const verified = verifyHir(hir);
  budget(rootFunctionIds);
  const functions = new Set(verified.functions.map(fn => fn.id));
  if (!Array.isArray(rootFunctionIds) || rootFunctionIds.length === 0 || rootFunctionIds.length > functions.size
      || new Set(rootFunctionIds).size !== rootFunctionIds.length
      || rootFunctionIds.some(id => typeof id !== 'string' || !functions.has(id)))
    failure('roots', 'explicit nonempty unique owned root FunctionIds are required');
  return { hir: verified, hirHash: sha256(printHir(verified)),
    roots: [...rootFunctionIds].sort((a,b) => Buffer.from(a).compare(Buffer.from(b))) };
}
/** @returns {ClosureTargetsReport} */
export function analyzeClosureTargets(hir, rootFunctionIds) {
  const input = context(hir, rootFunctionIds);
  return solveClosureTargets(input.hir, input.roots, input.hirHash);
}
/** Cold verification recomputes the same analysis. Two arguments validate the
 * recorded root assumption; an optional third argument binds the caller's own
 * explicit root configuration. Neither form establishes entrypoint authority.
 * @returns {ClosureTargetsReport}
 */
export function verifyClosureTargets(report, hir, expectedRootFunctionIds = undefined) {
  budget(report);
  if (!report || typeof report !== 'object' || Array.isArray(report) || !Object.hasOwn(report, 'roots'))
    failure('input', 'a target report with explicit roots is required');
  const input = context(hir, expectedRootFunctionIds === undefined ? report.roots : expectedRootFunctionIds);
  if (expectedRootFunctionIds !== undefined && canonical(report.roots) !== canonical(input.roots))
    failure('roots', 'target report roots differ from the explicit caller assumptions');
  if (report.hirHash !== input.hirHash) failure('identity', 'target report belongs to different HIR bytes');
  const expected = solveClosureTargets(input.hir, input.roots, input.hirHash);
  if (canonical(report) !== canonical(expected)) failure('report', 'target report differs from complete recomputation');
  return expected;
}
export function printClosureTargets(report, hir, expectedRootFunctionIds = undefined) {
  return canonical(verifyClosureTargets(report, hir, expectedRootFunctionIds)) + '\n';
}
export function readClosureTargets(bytes, hir, expectedRootFunctionIds = undefined) {
  let input;
  try { input = readGenericJson(bytes, limits); budget(input.value); }
  catch (error) { failure(error.code?.split('-').at(-1) ?? 'json', 'invalid target analysis JSON'); }
  const report = verifyClosureTargets(input.value, hir, expectedRootFunctionIds);
  if (input.text !== printClosureTargets(report, hir, expectedRootFunctionIds)) failure('canonical', 'target report must use canonical JSON plus LF');
  return report;
}
