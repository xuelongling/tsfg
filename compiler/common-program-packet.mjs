// SPDX-License-Identifier: MIT
import {canonical,sha256} from './identity.mjs';
import binding from '../contracts/common-program-wire-development.json' with {type:'json'};
import schema from '../contracts/common-program-bytecode-development.schema.json' with {type:'json'};
import privateCore from '../contracts/common-program-core-development.json' with {type:'json'};

// This closed development binding does not change the registered producer or loader.
const expected={"consumer":"passive prospective reader only; owned sourcePlan and independent correspondence remain OPEN; runtime/root.zig:load unchanged","family":"tsfg.common-program-wire-development","privateCore":{"family":"tsfg.core-program-development","schema":"contracts/common-program-core-development.json","schemaHash":"sha256:0d27cadc89ca5f59d0f6c721a81d6f9c42c74bfab597986c4627dfd9c823cd59","version":7,"work":4000000},"producer":"compiler/core-ir/common-program-command.cpp:runCoreModule --common-program --emit-bytecode","status":"Prospective Common-only producer; no active Runtime loader, VM or registered-format adoption","version":1,"wire":{"capability":1020,"schema":"contracts/common-program-bytecode-development.schema.json","schemaHash":"sha256:08b3b4b43f12a7b7a86fe89ebe0c16b1d0a5585bdcac6569f00cabd5fed4c775","version":20}};
const schemaIdentity=sha256(canonical(schema));
if(canonical(binding)!==canonical(expected)||schemaIdentity!==expected.wire.schemaHash||
    sha256(canonical(privateCore))!==expected.privateCore.schemaHash||privateCore.family!==expected.privateCore.family||
    privateCore.version!==7||privateCore.limits.work!==4000000||
    schema.header.find(field=>field[0]==='version')?.[1]!=='u32:20'||schema.capabilities.exact!==1020)
  throw new TypeError('r04-common-producer-schema: exact Core7/Common20 development binding required');
export const commonProgramExchangeFormat=Object.freeze({version:'0.20.0',bytecodeSchema:schemaIdentity});

// Only the exact Common-development envelope; no caller-selected identity or fallback.
export function verifyCommonProducedPacket(bytecode){
  if(!Buffer.isBuffer(bytecode)||bytecode.length<80||bytecode.length>8388608||!bytecode.subarray(0,8).equals(Buffer.from('TSFGTBC0','ascii'))||
      bytecode.readUInt32LE(8)!==20||bytecode.readUInt32LE(44)!==bytecode.length||
      'sha256:'+bytecode.subarray(12,44).toString('hex')!==schemaIdentity||
      'sha256:'+bytecode.subarray(48,80).toString('hex')!==sha256(bytecode.subarray(80)))
    throw new TypeError('r04-common-producer-identity: output differs from exact Common20 development envelope');
}
