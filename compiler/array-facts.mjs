// SPDX-License-Identifier: MIT
// One complete private ArrayFacts frame. Self-consistency is not Source admission.
import descriptor from '../contracts/array-facts-candidate.schema.json' with { type: 'json' };
import { canonical, own, sha256 } from './identity.mjs';
import { copyGenericJsonBytes, readGenericJson, checkGenericJsonValueBudget } from './generic-json.mjs';
import { arrayFactsLimits as policy, arrayFactsFailure as failure, arrayCheck as check,
  arrayRecord as record, validateArrayFactsPayload } from './array-facts-model.mjs';

const schemaHash = 'sha256:1364677f060da070ab1e14a589c1957d9ece10eaf8eb81744cea2a99e410a373';
export const arrayFactsFormat = own({ family: 'tsfg.array-facts-package-candidate', version: 4, schemaHash });
check(sha256(canonical(descriptor) + '\n') === schemaHash, 'identity');
const valuePolicy = Object.freeze({ ...policy, bytes: policy.bytes - 1 });

function mapped(error, fallback = 'input') {
  if (error?.code?.startsWith('r03-array-facts-')) throw error;
  const suffix = error?.code?.split('-').at(-1);
  failure(['json','utf8','canonical','schema','limit','input'].includes(suffix) ? suffix : fallback, error);
}
function budget(value) {
  try { checkGenericJsonValueBudget(value, valuePolicy); } catch (error) { mapped(error, 'schema'); }
}
function verify(value) {
  budget(value);
  record(value, ['family','version','schemaHash','requestId','packageId','payload']);
  check(value.family === arrayFactsFormat.family && value.version === 4, 'schema');
  check(value.schemaHash === schemaHash, 'identity');
  validateArrayFactsPayload(value.payload);
  const payload = value.payload;
  const request = { family: 'tsfg.array-facts-request-candidate', version: 4, input: {
    sourceRoot: payload.sourceRoot, rootFile: payload.rootFile,
    files: payload.files.map(({path, content, sha256: hash}) => ({path, content, sha256: hash})),
    declarations: payload.declarations, config: payload.config,
  } };
  check(value.requestId === sha256('tsfg.array-facts.request.v4\0' + canonical(request) + '\n'), 'identity');
  check(value.packageId === sha256('tsfg.array-facts.package.v4\0' + schemaHash + '\0' + canonical(payload)), 'identity');
  return value;
}
/** Snapshot bytes before inspecting untrusted properties or decoding any JSON graph. */
export function readArrayFactsCandidate(bytes) {
  let input;
  try { input = readGenericJson(copyGenericJsonBytes(bytes, policy), policy); } catch (error) { mapped(error); }
  let value;
  try { value = verify(input.value); } catch (error) { mapped(error); }
  check(input.text === canonical(value) + '\n', 'canonical');
  return own(value);
}
/** Preserve the complete frame; safe graph/budget checks run before any copy/hash. */
export function writeArrayFactsCandidate(value) {
  let checked;
  try { checked = verify(value); } catch (error) { mapped(error); }
  const result = Buffer.from(canonical(checked) + '\n');
  check(result.length <= policy.bytes, 'limit');
  return result;
}
