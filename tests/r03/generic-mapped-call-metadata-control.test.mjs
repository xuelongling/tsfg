// SPDX-License-Identifier: MIT
// Actual private6 records from explicitly passing Source35864 leaf/conditional tests.
// Their aggregate run had a separately retained stale assertion; this grants no full-run credit.
// Metadata control only: no Source, C++, Core CLI, VM or native process is launched.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { decodeGenericPackage,encodeGenericPackage } from '../../compiler/generic-package.mjs';
import { validateGenericInstanceResult } from '../../compiler/generic-instance.mjs';

/** @param {string|Uint8Array} value */
const hash=value=>createHash('sha256').update(value).digest('hex');
/** @param {any} value @returns {string} */
function jcs(value) {
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(jcs).join(',')+']';
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+jcs(value[key])).join(',')+'}';
}
const rows=[
  {
    "name": "mapped-leaf",
    "stem": "generic-mapped-signature",
    "packageBytes": 2165,
    "packageSHA": "ef3d3858feb524909a5fcebd3024c7b4c4ace19701386cec0bc3cf94351364fd",
    "instanceBytes": 1485,
    "instanceSHA": "7a04de74add85eddac1ce3dce00307b98d10b66b61afa765ad068af7b9ad91bd",
    "instances": 2
  },
  {
    "name": "conditional-call",
    "stem": "generic-conditional-call",
    "packageBytes": 3097,
    "packageSHA": "6600f1e9f20865e4e2abc92a3f281fa8dd18b1766d9ac848b21193ebedbbc35f",
    "instanceBytes": 2722,
    "instanceSHA": "644cec181a838ab74daa98ca6945afa4403ea53dc94cca2dea6609dd61a8d303",
    "instances": 4
  }
];
for(const row of rows)test('fresh private6 metadata control: '+row.name,async()=>{
  const packageBytes=await readFile(new URL('./fixtures/'+row.stem+'-package-v6.json',import.meta.url));
  const instanceBytes=await readFile(new URL('./fixtures/'+row.stem+'-instance-v6.json',import.meta.url));
  assert.equal(packageBytes.length,row.packageBytes);assert.equal(hash(packageBytes),row.packageSHA);
  assert.equal(instanceBytes.length,row.instanceBytes);assert.equal(hash(instanceBytes),row.instanceSHA);
  const raw=JSON.parse(packageBytes.toString('utf8')),record=JSON.parse(instanceBytes.toString('utf8'));
  const snapshot=jcs({raw,record});
  assert.equal(raw.version,6);assert.equal(raw.schemaHash,'c6b6baa76be25f6ac4f619867273208c9adb595030f12e7c54a200ed8c677789');
  assert.equal(raw.payload.semanticProfile,'tsfg-owned-scalar-generics-host-v6');
  assert.equal(raw.packageId,'sha256:'+hash('tsfg-owned-generic-package/v6\n'+jcs(raw.payload)));
  assert.equal(record.result.packageId,raw.packageId);assert.equal(record.result.instances.length,row.instances);
  assert.equal(record.requests.length,2);assert.equal(record.result.roots.length,2);
  const pkg=decodeGenericPackage(packageBytes);assert.deepEqual(pkg,raw);
  assert.deepEqual(Buffer.from(encodeGenericPackage(pkg)),packageBytes);
  assert.deepEqual(validateGenericInstanceResult(packageBytes,record.result,record.requests),record.result);
  assert.equal(jcs({raw,record}),snapshot);
  assert.equal(hash(packageBytes),row.packageSHA);assert.equal(hash(instanceBytes),row.instanceSHA);
});
