// SPDX-License-Identifier: MIT
import {canonical,sha256} from './identity.mjs';
import binding from '../contracts/common-program-wire-development.json' with {type:'json'};
import schema from '../contracts/common-program-bytecode-development.schema.json' with {type:'json'};
import privateCore from '../contracts/common-program-core-development.json' with {type:'json'};

// This closed development binding does not change the registered producer or loader.
const expected={"consumer":"passive prospective reader only; owned sourcePlan and independent correspondence remain OPEN; runtime/root.zig:load unchanged","family":"tsfg.common-program-wire-development","privateCore":{"family":"tsfg.core-program-development","schema":"contracts/common-program-core-development.json","schemaHash":"sha256:babde5d7b48bfd75f55c94349b9a56371702148be9188cbf86b62085d52b9f5f","version":6,"work":4000000},"producer":"compiler/core-ir/common-program-command.cpp:runCoreModule --common-program --emit-bytecode","status":"Prospective Common-only producer; no active Runtime loader, VM or registered-format adoption","version":1,"wire":{"capability":1019,"schema":"contracts/common-program-bytecode-development.schema.json","schemaHash":"sha256:fd9668dd9f938d5b4ec6e1b1d7d5e54e49109ea7d0fd9a07bd67875719f37009","version":19}};
const schemaIdentity=sha256(canonical(schema));
if(canonical(binding)!==canonical(expected)||schemaIdentity!==expected.wire.schemaHash||
    sha256(canonical(privateCore))!==expected.privateCore.schemaHash||privateCore.family!==expected.privateCore.family||
    privateCore.version!==6||privateCore.limits.work!==4000000||
    schema.header.find(field=>field[0]==='version')?.[1]!=='u32:19'||schema.capabilities.exact!==1019)
  throw new TypeError('r04-common-producer-schema: exact Core6/Common19 development binding required');
export const commonProgramExchangeFormat=Object.freeze({version:'0.19.0',bytecodeSchema:schemaIdentity});

// Only the exact Common-development envelope; no caller-selected identity or fallback.
export function verifyCommonProducedPacket(bytecode){
  if(!Buffer.isBuffer(bytecode)||bytecode.length<80||bytecode.length>8388608||!bytecode.subarray(0,8).equals(Buffer.from('TSFGTBC0','ascii'))||
      bytecode.readUInt32LE(8)!==19||bytecode.readUInt32LE(44)!==bytecode.length||
      'sha256:'+bytecode.subarray(12,44).toString('hex')!==schemaIdentity||
      'sha256:'+bytecode.subarray(48,80).toString('hex')!==sha256(bytecode.subarray(80)))
    throw new TypeError('r04-common-producer-identity: output differs from exact Common19 development envelope');
}
