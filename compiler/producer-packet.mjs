// SPDX-License-Identifier: MIT
import {sha256} from './identity.mjs';
import registry from '../contracts/registry.json' with {type:'json'};
import schema from '../contracts/bytecode.schema.json' with {type:'json'};

const versionText=schema.header.find(field=>field[0]==='version')?.[1];
if (!versionText || !/^u32:[0-9]+$/.test(versionText)) throw new TypeError('r04-producer-schema: missing exact wire version');
const version=Number(versionText.slice(4));

// This validates the source-built producer's complete packet envelope. The
// formal C++ producer and Runtime reader retain full payload verification.
export function verifyProducedPacket(bytecode) {
  if (!Buffer.isBuffer(bytecode) || bytecode.length < 80 || bytecode.subarray(0,8).toString('ascii') !== 'TSFGTBC0'
      || bytecode.readUInt32LE(8) !== version || bytecode.readUInt32LE(44) !== bytecode.length
      || `sha256:${bytecode.subarray(12,44).toString('hex')}` !== registry['tsfg.bytecode'].schemaHash
      || `sha256:${bytecode.subarray(48,80).toString('hex')}` !== sha256(bytecode.subarray(80)))
    throw new TypeError('r04-producer-identity: C++ output differs from registered R04 packet');
}
