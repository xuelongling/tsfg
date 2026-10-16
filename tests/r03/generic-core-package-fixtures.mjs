// SPDX-License-Identifier: MIT
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { decodeGenericPackage, encodeGenericPackage, genericDefinitionKey, genericPackageId,
  genericPackageFormat } from '../../compiler/generic-package.mjs';
import { genericPackageContext, genericInstanceKey } from '../../compiler/generic-instance.mjs';
import { buildGenericHir } from '../../compiler/generic-hir.mjs';
import { encodeGenericPackageRequest, encodeGenericPackageResponse } from '../../compiler/generic-package-io.mjs';
import { readGenericPackageFrontendResponse } from '../../compiler/generic-package-frontend.mjs';
export const sha = value => createHash('sha256').update(value).digest('hex');
export const expectedSchema = '3dea6ce5de996dfa3e7141cced985243ea74ac9bb80f03636c6694343118f2a6';
const literal = JSON.parse(await readFile(new URL('./fixtures/generic-package-io-source-v1.json', import.meta.url), 'utf8'));
export function officialHir() {
  // This persisted six-case fixture has existing real Source qualification.
  // Re-encoding preserves the unmodified request/response value and identities.
  const witness = literal.cases.find(value => value.name === 'instantiate-ok');
  const request = encodeGenericPackageRequest(witness.request);
  const response = encodeGenericPackageResponse(witness.response, request);
  return readGenericPackageFrontendResponse(request, response).hir;
}
export function structuralClosure(count) {
  // Fresh structural data exercises only concrete allocation/closure limits.
  // It never changes the qualified source path/identity or claims Source checking.
  const source = { digest: sha('structural metadata only'), length: 100,
    path: '/structural/owned:scalar.ts', positionUnit: 'utf16', surrogateStarts: [] };
  const payload = { capabilities: [...genericPackageFormat.capabilities], definitions: [],
    environment: { files: [], profile: genericPackageFormat.declarationProfile },
    scope: 'structural-core-capacity', semanticProfile: genericPackageFormat.semanticProfile, source };
  // A declaration file is required by the package shape, but never executed.
  const declaration = 'type bool = boolean;';
  payload.environment.files.push({ path: '/structural/scalars.d.ts', content: declaration, digest: sha(declaration) });
  const origin = { start: 0, end: 100 }, parameterOrigin = { start: 10, end: 20 };
  const expressionOrigin = { start: 30, end: 40 };
  const parameter = () => ({ kind: 'parameter', parameter: 0, definition: '', arguments: [],
    typeArguments: [], origin: expressionOrigin });
  const definition = name => ({ name, exported: true, key: '', origin,
    typeParameters: Array.from({ length: 8 }, (_, index) => 'T' + index),
    parameters: [{ name: 'value', type: { kind: 'boolean', parameter: 0 }, origin: parameterOrigin }],
    returnType: { kind: 'boolean', parameter: 0 }, body: parameter() });
  const leaf = definition('leaf'), caller = definition('caller');
  leaf.key = genericDefinitionKey(leaf, payload); caller.key = genericDefinitionKey(caller, payload);
  caller.body = { kind: 'call', parameter: 0, definition: leaf.key, arguments: [parameter()],
    typeArguments: Array.from({ length: 8 }, (_, index) => ({ kind: 'parameter', parameter: index })),
    origin: expressionOrigin };
  payload.definitions = [leaf, caller].sort((a, b) => a.key < b.key ? -1 : 1);
  const pkg = { family: genericPackageFormat.family, version: genericPackageFormat.version,
    schemaHash: genericPackageFormat.schemaHash, packageId: genericPackageId(payload), payload };
  const bytes = encodeGenericPackage(pkg), context = genericPackageContext(decodeGenericPackage(bytes));
  const requests = [], roots = [], instances = [];
  const typedParameter = () => ({ kind: 'parameter', parameter: 0, callee: '', arguments: [],
    type: 'bool', origin: expressionOrigin });
  for (let bits = 0; instances.length < count; bits++) {
    const args = Array.from({ length: 8 }, (_, bit) => ({ kind: bits & (1 << bit) ? 'number' : 'boolean', parameter: 0 }));
    const leafKey = genericInstanceKey(context, leaf.key, args), callerKey = genericInstanceKey(context, caller.key, args);
    const base = (def, key) => ({ key, definition: def.key, typeArguments: args, origin,
      parameters: [{ name: 'value', type: 'bool', origin: parameterOrigin }], returnType: 'bool' });
    instances.push({ ...base(leaf, leafKey), body: typedParameter() });
    const hasCaller = instances.length < count;
    if (hasCaller) instances.push({ ...base(caller, callerKey), body: { kind: 'call', parameter: 0,
      callee: leafKey, arguments: [typedParameter()], type: 'bool', origin: expressionOrigin } });
    requests.push({ definition: hasCaller ? caller.key : leaf.key, typeArguments: args });
    roots.push(hasCaller ? callerKey : leafKey);
  }
  instances.sort((a, b) => a.key < b.key ? -1 : 1);
  return buildGenericHir(bytes, { packageId: pkg.packageId, semanticProfile: payload.semanticProfile,
    roots, instances }, requests);
}
export function extraNativeFunction(path) {
  // Fresh native protocol witness for513; existing package functions stay intact.
  const signature = sha('tsfg.signature\0(bool)->bool');
  const id = sha('tsfg.function\0' + path + '\0capacityExtra\0' + signature);
  return 'func.func @capacityExtra(%arg: i1) -> i1 attributes {'
    + 'tsfg_core.function_id = "sha256:' + id + '", tsfg_core.signature_hash = "sha256:' + signature
    + '", tsfg_core.type_id = "sha256:' + sha('tsfg.type\0bool')
    + '", tsfg_core.function_start = 0 : i64, tsfg_core.function_end = 100 : i64} {'
    + '"tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 0 : i64, tsfg_source.end = 100 : i64} : () -> () '
    + '"func.return"(%arg) {tsfg_source.start = 30 : i64, tsfg_source.end = 40 : i64} : (i1) -> () }';
}
