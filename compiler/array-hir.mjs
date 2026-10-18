// SPDX-License-Identifier: MIT
// Public Array construction consumes a whole separately selected cold facts package.
import { writeArrayFactsCandidate } from './array-facts.mjs';
import { readArrayFactsContext, projectArrayFacts, verifyArrayHir, arrayHirFailure } from './array-hir-model.mjs';

export function buildArrayHir(input, context) {
  try {
    const { bytes, facts } = readArrayFactsContext(context);
    let supplied;
    try { supplied = writeArrayFactsCandidate(input); }
    catch (cause) { arrayHirFailure(cause?.code?.endsWith('-limit') ? 'limit' : 'invalid', cause); }
    if (!supplied.equals(bytes)) arrayHirFailure('context');
    return { status: 'ok', hir: verifyArrayHir(projectArrayFacts(facts), context) };
  } catch (error) {
    return { status: 'error', diagnostics: [{
      code: error.code ?? 'r03-array-hir-invalid', ruleId: error.ruleId ?? 'r01-input-boundary',
      phase: error.phase ?? 'hir', message: error.message,
      ...(error.primary ? { primary: error.primary } : {}),
    }] };
  }
}

/** The complete Array consumer ends at HIR; no Core fallback is allowed. */
export function rejectArrayCore(hir, context) {
  const checked = verifyArrayHir(hir, context), fn = checked.functions[0];
  const range = fn.body.at(-1).value.range;
  throw Object.assign(new TypeError('r03-d-capability: Array Core lowering is not implemented'),
    { code: 'r03-d-capability', ruleId: 'r01-ts-baseline', phase: 'lowering',
      primary: { sourceId: fn.sourcePath, ...range } });
}
