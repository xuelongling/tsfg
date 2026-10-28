// SPDX-License-Identifier: MIT
// Fresh private7 leaf/conditional records match this ticket's official Source
// output in current-fixture-qualification.json; old execution records remain historical.
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
    "packageSHA": "2efb70895fcfae713b20d8b91310b7be218e90db14bee411679fff673f21564e",
    "instanceBytes": 1485,
    "instanceSHA": "67001dd982b5ddc61758b8aa14f4e43b88479273de5f67692a641a3ba2c216e8",
    "instances": 2
  },
  {
    "name": "conditional-call",
    "stem": "generic-conditional-call",
    "packageBytes": 3097,
    "packageSHA": "6f8f9eb9b09f4c6aebdd647f0a9cec5d2f9cfc13a771b13325f0949189a9f4cf",
    "instanceBytes": 2722,
    "instanceSHA": "e5d733e7ce89d55921d83aeb7532de91e5e1a1e116095aa53d4be28a1ce099b8",
    "instances": 4
  }
];
for(const row of rows)test('fresh private7 metadata control: '+row.name,async()=>{
  const packageBytes=await readFile(new URL('./fixtures/'+row.stem+'-package-v7.json',import.meta.url));
  const instanceBytes=await readFile(new URL('./fixtures/'+row.stem+'-instance-v7.json',import.meta.url));
  assert.equal(packageBytes.length,row.packageBytes);assert.equal(hash(packageBytes),row.packageSHA);
  assert.equal(instanceBytes.length,row.instanceBytes);assert.equal(hash(instanceBytes),row.instanceSHA);
  const raw=JSON.parse(packageBytes.toString('utf8')),record=JSON.parse(instanceBytes.toString('utf8'));
  const snapshot=jcs({raw,record});
  assert.equal(raw.version,7);assert.equal(raw.schemaHash,'2e9d1e07016b6f8ce5f48bf8a3508491eaf1ce7e6fd43bf497c133f65c8dff94');
  assert.equal(raw.payload.semanticProfile,'tsfg-owned-scalar-generics-host-v7');
  assert.equal(raw.packageId,'sha256:'+hash('tsfg-owned-generic-package/v7\n'+jcs(raw.payload)));
  assert.equal(record.result.packageId,raw.packageId);assert.equal(record.result.instances.length,row.instances);
  assert.equal(record.requests.length,2);assert.equal(record.result.roots.length,2);
  const pkg=decodeGenericPackage(packageBytes);assert.deepEqual(pkg,raw);
  assert.deepEqual(Buffer.from(encodeGenericPackage(pkg)),packageBytes);
  assert.deepEqual(validateGenericInstanceResult(packageBytes,record.result,record.requests),record.result);
  assert.equal(jcs({raw,record}),snapshot);
  assert.equal(hash(packageBytes),row.packageSHA);assert.equal(hash(instanceBytes),row.instanceSHA);
});
