// SPDX-License-Identifier: MIT
// Root alone produces these qualified manifests; actual bytes never supply expected data.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sha } from './readspan-return-test-helpers.mjs';

/** @returns {Promise<Map<string,Buffer>>} */
export async function actualSccPackets() {
  const pins=JSON.parse(process.env.TSFG_ARRAY_SCC_SOURCE_MANIFESTS??'null');
  assert.ok(Array.isArray(pins)&&pins.length>0,'Root must bind complete qualified SCC Source manifest pins');
  const packets=new Map();
  for(const pin of pins) {
    const bytes=await readFile(pin.path);
    assert.equal(bytes.length,pin.bytes);assert.equal(sha(bytes),pin.sha256);
    const manifest=JSON.parse(bytes.toString('utf8'));
    assert.ok(Array.isArray(manifest.cases));
    for(const row of manifest.cases) {
      const name=row.name??row.id,record=row.packet;
      assert.equal(typeof name,'string');assert.ok(record);
      assert.ok(!packets.has(name),'duplicate actual Source case '+name);
      const raw=await readFile(record.path);
      assert.equal(raw.length,record.bytes);assert.equal(sha(raw),record.sha256);
      packets.set(name,raw);
    }
  }
  return packets;
}
