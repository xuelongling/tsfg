// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fn,ret,moduleOf} from './strict-floating-aot-fixtures.mjs';
import {accepted,invokeCore,rejected} from './generic-core-package-capture.mjs';

const hash=text=>'sha256:'+createHash('sha256').update(text).digest('hex');
function presenceModule(count,mask='05') {
 const physical=Array(count*2).fill('i32'),name='presence_capacity';
 const signature=hash('tsfg.signature\0('+Array(count).fill('i32@'+mask).join(',')+')->i32');
 const identity=hash('tsfg.function\0/src/main.ts\0'+name+'\0'+signature.slice(7));
 const item=fn(name,physical,'i32',ret('%a'+(count*2-2),'i32'));
 item.text=item.text.replace(/tsfg_core.signature_hash = "[^"]+"/,'tsfg_core.signature_hash = "'+signature+'"')
  .replace(/tsfg_core.function_id = "[^"]+"/,'tsfg_core.function_id = "'+identity+'"')
  .replace('attributes {','attributes {tsfg_core.parameter_presence = "'+mask.repeat(count)+'", ');
 return moduleOf([item]).input;
}

test('presence contract accepts64 logical parameters with128 physical carriers through all compiler outputs',async()=>{
 const input=presenceModule(64),first=await invokeCore(input);accepted(first);
 const second=await invokeCore(first.stdout);accepted(second);assert.deepEqual(first.stdout,second.stdout);
 for(const command of ['--emit-bytecode','--emit-native-llvm','--emit-native-object'])accepted(await invokeCore(input,command));
});

test('presence contract rejects logical overflow and malformed mask grammar before every output',async()=>{
 const valid=presenceModule(1);
 const invalid=[presenceModule(65),presenceModule(1,'04'),presenceModule(1,'08'),
  valid.replace('parameter_presence = "05"','parameter_presence = "5"'),
  valid.replace('parameter_presence = "05"','parameter_presence = "05FF"')];
 for(const input of invalid)for(const command of ['--canonicalize','--emit-bytecode','--emit-native-llvm','--emit-native-object'])
  rejected(await invokeCore(input,command));
});
