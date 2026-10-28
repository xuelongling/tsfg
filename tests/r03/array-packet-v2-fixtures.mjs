// SPDX-License-Identifier: MIT
// Independent whole Core/packet data only; no producer output is sampled as an expectation.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
/** @param {{path:string,bytes:number,sha256:string}} entry */
async function leaf(entry){
 assert.match(entry.path,/^oracle\/[A-Za-z0-9_.-]+$/);
 const bytes=await readFile(new URL('./array-packet/'+entry.path,import.meta.url));
 assert.equal(bytes.length,entry.bytes);assert.equal(sha(bytes),entry.sha256);return bytes;
}
const corrections=JSON.parse((await leaf({path:'oracle/corrected-proof-core-map.json',bytes:17092,sha256:'8c4eeadc12df842f8b3667d6e440c2fd310880b620d62980e334c636d221d6f5'})).toString('utf8'));
assert.equal(corrections.cases.length,30);
const groups=[{"group":"main17","index":"oracle/array-core12-packet-v2-oracle.json","bytes":1203500,"sha256":"fcb6cd15af817512f37bdb65bdc5838f6c6985ea2003f6e2e4102c3e3c29561a","cases":17},{"group":"legacy10","index":"oracle/array-v2-supplement-whole-oracle.json","bytes":581963,"sha256":"9cc11fd8e57a531529847222a7e3c840f1ef45f3ff5c243b3e9e1e167877f00c","cases":10},{"group":"additional3","index":"oracle/array-v2-supplement-additional-whole-oracle.json","bytes":1892080,"sha256":"500bb3b09736f92c3d880766b1264e7b3b171bef6ce90e1cc8ecef7d616a2ae5","cases":3}];
export const inputs=[];
for(const group of groups){
 const gold=JSON.parse((await leaf({path:group.index,bytes:group.bytes,sha256:group.sha256})).toString('utf8'));
 assert.equal(gold.cases.length,group.cases);
 for(const row of gold.cases){
  const matches=corrections.cases.filter(item=>item.group===group.group&&item.name===row.name);
  assert.equal(matches.length,1);
  for(const key of ['path','bytes','sha256'])assert.equal(matches[0].originalCanonicalCore[key],row.canonicalCore[key]);
  const core=(await leaf(row.inputCore)).toString('utf8');
  const canonical=(await leaf(matches[0].correctedProofCore)).toString('utf8');
  const expected=await leaf({path:row.packetFile,bytes:row.packetBytes,sha256:row.packetSHA256});
  inputs.push({row,group:group.group,core,canonical,expected});
 }
}
assert.equal(inputs.length,30);
assert.equal(new Set(inputs.map(item=>item.group+'/'+item.row.name)).size,30);
