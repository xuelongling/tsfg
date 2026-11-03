// SPDX-License-Identifier: MIT
import {canonical,sha256} from './identity.mjs';
import binding from '../contracts/common-program-wire-development.json' with {type:'json'};
import schema from '../contracts/common-program-bytecode-development.schema.json' with {type:'json'};
import privateCore from '../contracts/common-program-core-development.json' with {type:'json'};

// This closed development binding does not change the registered producer or loader.
const expected={"consumer":"passive prospective reader only; owned sourcePlan and independent correspondence remain OPEN; runtime/root.zig:load unchanged","family":"tsfg.common-program-wire-development","privateCore":{"family":"tsfg.core-program-development","schema":"contracts/common-program-core-development.json","schemaHash":"sha256:db46cd091d08f951a4a1564e8cf24702dca6137fe0585bbfe256c522e6ee3332","version":5,"work":4000000},"producer":"compiler/core-ir/common-program-command.cpp:runCoreModule --common-program --emit-bytecode","status":"Prospective Common-only producer; no active Runtime loader, VM or registered-format adoption","version":1,"wire":{"capability":1018,"schema":"contracts/common-program-bytecode-development.schema.json","schemaHash":"sha256:cd560f1da0e1d809fb2ffa907baf7a27b86e3ccecb8323e0e46ce1570a8a1b65","version":18}};
const schemaIdentity=sha256(canonical(schema));
if(canonical(binding)!==canonical(expected)||schemaIdentity!==expected.wire.schemaHash||
    sha256(canonical(privateCore))!==expected.privateCore.schemaHash||privateCore.family!==expected.privateCore.family||
    privateCore.version!==5||privateCore.limits.work!==4000000||
    schema.header.find(field=>field[0]==='version')?.[1]!=='u32:18'||schema.capabilities.exact!==1018)
  throw new TypeError('r04-common-producer-schema: exact Core5/Common18 development binding required');
export const commonProgramExchangeFormat=Object.freeze({version:'0.18.0',bytecodeSchema:schemaIdentity});

// Only the exact Common-development envelope; no caller-selected identity or fallback.
export function verifyCommonProducedPacket(bytecode){
  if(!Buffer.isBuffer(bytecode)||bytecode.length<80||bytecode.length>8388608||!bytecode.subarray(0,8).equals(Buffer.from('TSFGTBC0','ascii'))||
      bytecode.readUInt32LE(8)!==18||bytecode.readUInt32LE(44)!==bytecode.length||
      'sha256:'+bytecode.subarray(12,44).toString('hex')!==schemaIdentity||
      'sha256:'+bytecode.subarray(48,80).toString('hex')!==sha256(bytecode.subarray(80)))
    throw new TypeError('r04-common-producer-identity: output differs from exact Common18 development envelope');
}
