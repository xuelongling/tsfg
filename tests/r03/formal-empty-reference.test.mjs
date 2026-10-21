// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cpp=process.env.TSFG_FORMAL_STRING_CORE;
test('empty private reference profile retains complete verification without formal fallback',{skip:!cpp},()=>{
  const fixture=spawnSync(process.execPath,[fileURLToPath(new URL('./reference-core-scalar-artifact.mjs',import.meta.url))],{windowsHide:true,maxBuffer:2*1024*1024});
  assert.equal(fixture.status,0,fixture.stderr.toString());
  const text=fixture.stdout.toString();assert.ok(text.startsWith('TSFG_REFERENCE_CORE_SCALAR_V1 '));
  const data=JSON.parse(text.slice('TSFG_REFERENCE_CORE_SCALAR_V1 '.length));
  const scalar=Buffer.from(data.scalar.coreBase64,'base64').toString();
  const extended=Buffer.from(data.extended.coreBase64,'base64').toString();
  const run=(input,command='--canonicalize')=>spawnSync(cpp,[command],{input,windowsHide:true,maxBuffer:2*1024*1024});
  assert.match(scalar,/tsfg_core.version = "0.11.0"/);
  assert.match(extended,/tsfg_core.version = "0.9.0"/);
  assert.equal(run(scalar).status,0);
  const valid=run(extended);assert.equal(valid.status,0,valid.stderr.toString());
  assert.match(valid.stdout.toString(),/tsfg_core.reference/);assert.match(valid.stdout.toString(),/tsfg_core.version = "0.9.0"/);
  assert.equal(run(valid.stdout).status,0);
  const invalid=[extended.replace('version = "0.9.0"','version = "0.11.0"'),
    extended.replace('version = 6 : i64','version = 5 : i64'),
    extended.replace('classes = []','classes = [{}]'),
    extended.replace('event = 1 : i32','event = 9 : i32'),
    scalar.replace('version = "0.11.0"','version = "0.9.0"')];
  for(const [index,input] of invalid.entries()) {
    assert.notEqual(input,index===invalid.length-1?scalar:extended,"negative changes actual current input");
    const result=run(input);assert.equal(result.status,3,result.stderr.toString());assert.equal(result.stdout.length,0);
  }
  const packet=run(extended,'--emit-bytecode');assert.equal(packet.status,3);assert.equal(packet.stdout.length,0);
});
