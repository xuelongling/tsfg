// SPDX-License-Identifier: MIT
import {sha256} from './identity.mjs';
import registry from '../contracts/registry.json' with {type:'json'};
import schema from '../contracts/bytecode.schema.json' with {type:'json'};

const versionText=schema.header.find(field=>field[0]==='version')?.[1];
if (!versionText || !/^u32:[0-9]+$/.test(versionText)) throw new TypeError('r04-producer-schema: missing exact wire version');
const version=Number(versionText.slice(4));
const maxBytes=Number(schema.limits.maxBytes);
const magic=Buffer.from('TSFGTBC0');
const capabilityText=schema.payload.find(field=>field[0]==='capabilities')?.[1];
if (!capabilityText || !/^u32:[0-9]+$/.test(capabilityText)) throw new TypeError('r04-producer-schema: missing exact payload capability');
const capability=Number(capabilityText.slice(4));

/**
 * The registered scalar and private Common envelopes use the same target and
 * input-identity prefix. Run this after the respective envelope check.
 * @param {Buffer} bytecode
 * @param {{target: string, triple: string, llvmDataLayout: string}} target
 * @param {number} expectedCapability
 * @param {string} expectedInputIdentity
 */
export function hasProducedInputIdentity(bytecode, target, expectedCapability, expectedInputIdentity) {
  let offset=80;
  for (const text of [target.target, target.triple, target.llvmDataLayout]) {
    const length=Buffer.byteLength(text);
    const start=offset+4, end=start+length;
    if (end>bytecode.length || bytecode.readUInt32LE(offset)!==length || bytecode.toString('utf8',start,end)!==text)
      return false;
    offset=end;
  }
  // Four u16 target geometry fields, the u32 capability, then the digest.
  const input=offset+12, end=input+32;
  return end<=bytecode.length && bytecode.readUInt16LE(offset)===4 && bytecode.readUInt16LE(offset+2)===4
    && bytecode.readUInt16LE(offset+4)===64 && bytecode.readUInt16LE(offset+6)===8
    && bytecode.readUInt32LE(offset+8)===expectedCapability
    && `sha256:${bytecode.subarray(input,end).toString('hex')}`===expectedInputIdentity;
}

// This validates the source-built producer's complete packet envelope. The
// formal C++ producer and Runtime reader retain full payload verification.
/** @param {Buffer} bytecode @param {string} [expectedInputIdentity] */
export function verifyProducedPacket(bytecode, expectedInputIdentity) {
  if (!Buffer.isBuffer(bytecode) || bytecode.length < 80 || bytecode.length > maxBytes || !bytecode.subarray(0,8).equals(magic)
      || bytecode.readUInt32LE(8) !== version || bytecode.readUInt32LE(44) !== bytecode.length
      || `sha256:${bytecode.subarray(12,44).toString('hex')}` !== registry['tsfg.bytecode'].schemaHash
      || `sha256:${bytecode.subarray(48,80).toString('hex')}` !== sha256(bytecode.subarray(80)))
    throw new TypeError('r04-producer-identity: C++ output differs from registered R04 packet');
  if (expectedInputIdentity !== undefined && !hasProducedInputIdentity(bytecode,schema.target,capability,expectedInputIdentity))
    throw new TypeError('r04-producer-input-identity: packet target or input differs from the checked HIR');
}
