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
  return producedInputEnd(bytecode,target,expectedCapability,expectedInputIdentity)!==null;
}

/**
 * @param {Buffer} bytecode
 * @param {{target: string, triple: string, llvmDataLayout: string}} target
 * @param {number} expectedCapability
 * @param {string} expectedInputIdentity
 */
function producedInputEnd(bytecode, target, expectedCapability, expectedInputIdentity) {
  let offset=80;
  for (const text of [target.target, target.triple, target.llvmDataLayout]) {
    const length=Buffer.byteLength(text);
    const start=offset+4, end=start+length;
    if (end>bytecode.length || bytecode.readUInt32LE(offset)!==length || bytecode.toString('utf8',start,end)!==text)
      return null;
    offset=end;
  }
  // Four u16 target geometry fields, the u32 capability, then the digest.
  const input=offset+12, end=input+32;
  return end<=bytecode.length && bytecode.readUInt16LE(offset)===4 && bytecode.readUInt16LE(offset+2)===4
    && bytecode.readUInt16LE(offset+4)===64 && bytecode.readUInt16LE(offset+6)===8
    && bytecode.readUInt32LE(offset+8)===expectedCapability
    && `sha256:${bytecode.subarray(input,end).toString('hex')}`===expectedInputIdentity ? end : null;
}

/** @param {Buffer} bytecode @param {number} inputEnd @param {string} expectedRoot */
function hasScalarDefaultRoot(bytecode, inputEnd, expectedRoot) {
  // The single-source scalar route has no module tables. Its first descriptor
  // begins with the function ID, after the Source row and function count.
  const sourcePathLength=inputEnd+32;
  if (sourcePathLength+4>bytecode.length) return false;
  const moduleMode=sourcePathLength+4+bytecode.readUInt32LE(sourcePathLength)+4;
  const first=moduleMode+3, end=first+32;
  if (end>bytecode.length || bytecode[moduleMode]!==0) return false;
  const count=bytecode.readUInt16LE(moduleMode+1);
  return count>=1 && count<=Number(schema.limits.maxFunctions)
    && `sha256:${bytecode.subarray(first,end).toString('hex')}`===expectedRoot;
}

// This validates the source-built producer's complete packet envelope. The
// formal C++ producer and Runtime reader retain full payload verification.
/** @param {Buffer} bytecode @param {string} [expectedInputIdentity] @param {string} [expectedDefaultRoot] */
export function verifyProducedPacket(bytecode, expectedInputIdentity, expectedDefaultRoot) {
  if (!Buffer.isBuffer(bytecode) || bytecode.length < 80 || bytecode.length > maxBytes || !bytecode.subarray(0,8).equals(magic)
      || bytecode.readUInt32LE(8) !== version || bytecode.readUInt32LE(44) !== bytecode.length
      || `sha256:${bytecode.subarray(12,44).toString('hex')}` !== registry['tsfg.bytecode'].schemaHash
      || `sha256:${bytecode.subarray(48,80).toString('hex')}` !== sha256(bytecode.subarray(80)))
    throw new TypeError('r04-producer-identity: C++ output differs from registered R04 packet');
  const end=expectedInputIdentity===undefined ? null : producedInputEnd(bytecode,schema.target,capability,expectedInputIdentity);
  if (expectedInputIdentity!==undefined && end===null)
    throw new TypeError('r04-producer-input-identity: packet target or input differs from the checked HIR');
  if (expectedDefaultRoot!==undefined && (end===null || !hasScalarDefaultRoot(bytecode,end,expectedDefaultRoot)))
    throw new TypeError('r04-producer-default-root: first scalar function differs from the checked default root');
}
