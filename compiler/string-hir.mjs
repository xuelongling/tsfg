// SPDX-License-Identifier: MIT
// The only new HIR producer is an owned projection of one selected complete facts package.
import { writeStringFactsCandidate } from './string-facts.mjs';
import { writeStringFactsV2Candidate } from './string-facts-v2.mjs';
import { functionIdentity, signatureHash } from './identity.mjs';
import { readStringFactsContext, stringHirFailure, stringHirFormat, stringHirType,
  stringHirTarget, verifyStringHir } from './string-hir-model.mjs';

function stringLeaf(value) {
  return { kind: 'stringConstant', type: stringHirType.id, codeUnits: [...value.codeUnits], range: { ...value.range } };
}
function stringValue(value, factsVersion) {
  return factsVersion === 1 ? stringLeaf(value) : { kind: 'stringConcat', type: stringHirType.id,
    range: { ...value.range }, operatorRange: { ...value.operatorRange },
    left: stringLeaf(value.left), right: stringLeaf(value.right) };
}

export function buildStringHir(input, context) {
  try {
    const { facts, bytes, factsVersion } = readStringFactsContext(context);
    let inputBytes;
    try { inputBytes = factsVersion === 2 ? writeStringFactsV2Candidate(input) : writeStringFactsCandidate(input); }
    catch (cause) { stringHirFailure(cause?.code === 'r03-string-facts-limit' ? 'limit' : 'invalid', cause); }
    if (!inputBytes.equals(bytes)) stringHirFailure('context');
    const source = facts.payload.files.find(file => file.path === facts.payload.rootFile);
    const hir = { ...stringHirFormat, inputIdentity: facts.packageId,
      source: { path: source.path, content: source.content, hash: 'sha256:' + source.sha256 },
      target: stringHirTarget,
      functions: facts.payload.functions.map(fn => ({
        id: functionIdentity(source.path, fn.name, 'string', []), name: fn.name,
        signatureHash: signatureHash('string', []), returnType: stringHirType, parameters: [],
        range: { ...fn.declarationRange }, body: [{ kind: 'return', range: { ...fn.body[0].range },
          value: stringValue(fn.body[0].value, factsVersion) }],
      })) };
    return { status: 'ok', hir: verifyStringHir(hir, context) };
  } catch (error) {
    return { status: 'error', diagnostics: [{ code: error.code ?? 'r03-hir-invalid',
      ruleId: error.ruleId ?? 'r01-input-boundary', phase: 'hir', message: error.message,
      ...(error.primary ? { primary: error.primary } : {}) }] };
  }
}
