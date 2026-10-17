// SPDX-License-Identifier: MIT
import { ownedExceptionSnapshot } from './exception-frontend.mjs';
import { projectExceptionHirModel } from './exception-hir-model.mjs';
import { budget, check, failure, canonical, own, hirFormat } from './exception-hir-common.mjs';

export function buildExceptionHir(snapshot) {
  budget(snapshot);
  let ownedSnapshot;
  try { ownedSnapshot = ownedExceptionSnapshot(snapshot); }
  catch (error) { failure('snapshot', 'cold exception snapshot validation failed'); }
  const model = projectExceptionHirModel(ownedSnapshot);
  budget({ format: hirFormat, ...model }, true);
  // Separate the provenance DTO and the semantic DTO before the final owned copy.
  const derived = own(model), hir = { format: hirFormat, snapshot: ownedSnapshot, ...derived };
  budget(hir);
  return own(hir);
}
export function verifyExceptionHir(hir) {
  budget(hir);
  check(hir && Object.keys(hir).length === 9 && ['format','snapshot','inputIdentity','sources','target',
    'types','functions','modules','exports'].every(key => Object.hasOwn(hir, key)), 'schema');
  check(canonical(hir.format) === canonical(hirFormat), 'schema', 'exception HIR format differs');
  const { snapshot, ...derived } = hir;
  budget(derived, true);
  const rebuilt = buildExceptionHir(snapshot);
  check(canonical(hir) === canonical(rebuilt), 'reconstruct', 'complete cold exception HIR differs');
  return rebuilt;
}
