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

