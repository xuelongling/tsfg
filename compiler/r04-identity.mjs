// SPDX-License-Identifier: MIT
// Canonical R04 identity, digest, and envelope single source of truth.
// Mirrors `runtime/r04-identity.zig` bit-for-bit.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonical, sha256 } from './identity.mjs';

export { canonical, sha256 };

export const CONTRACT_REGISTRY = Object.freeze(
  JSON.parse(readFileSync(new URL('../contracts/registry.json', import.meta.url), 'utf8')),
);

export const WINDOWS_X64_TARGET = Object.freeze({
  llvmDataLayout: 'e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128',
  pointerBits: 64,
  target: 'windows-x86_64-msvc',
  triple: 'x86_64-pc-windows-msvc',
});

export const HANDLE_LAYOUT = Object.freeze({
  align: 4,
  fields: [
    { name: 'index', offset: 0, type: 'u32' },
    { name: 'generation', offset: 4, type: 'u32' },
  ],
  size: 8,
  stride: 8,
});

export function digestHex(prefix, body) {
  return sha256(Buffer.concat([Buffer.from(prefix, 'utf8'), Buffer.from([0]), Buffer.from(body, 'utf8')]));
}

export function typeIdScalar(name) {
  return digestHex('tsfg.type', name);
}

export function typeIdNominal(kind, sourcePath, name) {
  return sha256(`tsfg.type\0${kind}\0${sourcePath}\0${name}`);
}

export function typeIdHandle(innerTypeId) {
  const hex = innerTypeId.startsWith('sha256:') ? innerTypeId.slice(7) : innerTypeId;
  return sha256(`tsfg.handle\0${hex}`);
}

export function typeIdSpan(mutable, elementTypeId) {
  const hex = elementTypeId.startsWith('sha256:') ? elementTypeId.slice(7) : elementTypeId;
  return sha256(`tsfg.${mutable ? 'span' : 'read_span'}\0${hex}`);
}

export function typeIdStringView() {
  return sha256('tsfg.type\0StringView');
}

export function signatureHash(returnType, paramTypes = []) {
  return sha256(`tsfg.signature\0(${paramTypes.join(',')})->${returnType}`);
}

export function functionId(sourcePath, name, returnType, paramTypes = []) {
  const sigHex = signatureHash(returnType, paramTypes).slice(7);
  return sha256(`tsfg.function\0${sourcePath}\0${name}\0${sigHex}`);
}

export function typeIdFnPtr(sigHash) {
  const hex = sigHash.startsWith('sha256:') ? sigHash.slice(7) : sigHash;
  return sha256(`tsfg.fn_ptr\0${hex}`);
}

export function effectHash(contract) {
  const normalized = {
    capabilities: [...(contract.capabilities ?? [])].sort(),
    mayAllocate: Boolean(contract.mayAllocate),
    mayCallHost: Boolean(contract.mayCallHost),
    mayThrow: Boolean(contract.mayThrow),
    reads: [...(contract.reads ?? [])].sort(),
    writes: [...(contract.writes ?? [])].sort(),
  };
  return digestHex('tsfg.effect.v1', canonical(normalized));
}

export function schemaHash(schemaObj) {
  return sha256(canonical(schemaObj));
}

export function contractSetId(registry = CONTRACT_REGISTRY) {
  const proj = Object.fromEntries(
    Object.entries(registry)
      .sort(([a], [b]) => Buffer.from(a).compare(Buffer.from(b)))
      .map(([k, v]) => [k, { schemaHash: v.schemaHash, semver: v.semver }]),
  );
  return sha256(canonical(proj));
}

export function abiHash(abiCore) {
  return digestHex('tsfg.abi-hash.v1', canonical({
    callingConvention: abiCore.callingConvention,
    functions: abiCore.functions,
    target: abiCore.target,
    types: abiCore.types,
  }));
}

export function reflectionDigest(tmetaCore) {
  return digestHex('tsfg.reflection.v1', canonical({
    abiHash: tmetaCore.abiHash,
    components: tmetaCore.components,
    functions: tmetaCore.functions,
    queries: tmetaCore.queries,
    target: tmetaCore.target,
    types: tmetaCore.types,
  }));
}

export function payloadHash(family, version, canonicalPayloadText) {
  return sha256(`${family}.v${version}\0${canonicalPayloadText}`);
}

export function sealEnvelope(family, version, payloadObj, registry = CONTRACT_REGISTRY) {
  const regEntry = registry[family];
  if (!regEntry) throw new TypeError(`r04-unknown-family: ${family}`);
  const payloadText = canonical(payloadObj);
  const pHash = payloadHash(family, version, payloadText);
  const envelope = {
    family,
    payload: payloadText,
    payloadHash: pHash,
    schemaHash: regEntry.schemaHash,
    version,
  };
  const bytes = Buffer.from(`${canonical(envelope)}\n`, 'utf8');
  return { bytes, envelope, payload: payloadObj, payloadText };
}

function scanJsonBounds(bytes, maxBytes, maxDepth) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
    throw new TypeError('r04-invalid-input: expected bytes');
  }
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buf.length === 0 || buf.length > maxBytes) {
    throw new TypeError(`r04-size-limit: payload size ${buf.length} outside 1..${maxBytes}`);
  }
  if (buf[buf.length - 1] !== 0x0a) {
    throw new TypeError('r04-format-lf: canonical envelope must end with LF');
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf);
  } catch {
    throw new TypeError('r04-invalid-utf8: envelope contains invalid UTF-8 bytes');
  }
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
    } else if (ch === '{' || ch === '[') {
      depth++;
      if (depth > maxDepth) throw new TypeError(`r04-depth-limit: JSON depth exceeded ${maxDepth}`);
    } else if (ch === '}' || ch === ']') {
      if (depth === 0) throw new TypeError('r04-malformed-json: unmatched closing bracket');
      depth--;
    }
  }
  if (depth !== 0 || inStr) throw new TypeError('r04-malformed-json: truncated JSON envelope');
  return { buf, text };
}

export function verifyEnvelope(bytes, expectedFamily, expectedVersion, opts = {}) {
  const maxBytes = opts.maxBytes ?? 8388608;
  const maxDepth = opts.maxDepth ?? 64;
  const registry = opts.registry ?? CONTRACT_REGISTRY;
  const regEntry = registry[expectedFamily];
  if (!regEntry) throw new TypeError(`r04-unknown-family: ${expectedFamily}`);

  const { text } = scanJsonBounds(bytes, maxBytes, maxDepth);
  let env;
  try {
    env = JSON.parse(text);
  } catch {
    throw new TypeError('r04-malformed-json: failed to parse envelope');
  }
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    throw new TypeError('r04-invalid-envelope: root must be a JSON object');
  }
  const keys = Object.keys(env).sort();
  if (keys.join(',') !== 'family,payload,payloadHash,schemaHash,version') {
    throw new TypeError('r04-invalid-envelope: unexpected envelope fields');
  }
  if (env.family !== expectedFamily) {
    throw new TypeError(`r04-family-mismatch: expected ${expectedFamily}, got ${env.family}`);
  }
  if (env.version !== expectedVersion) {
    throw new TypeError(`r04-version-mismatch: expected version ${expectedVersion}, got ${env.version}`);
  }
  if (env.schemaHash !== regEntry.schemaHash) {
    throw new TypeError(`r04-schema-mismatch: expected ${regEntry.schemaHash}, got ${env.schemaHash}`);
  }
  if (typeof env.payload !== 'string') {
    throw new TypeError('r04-invalid-envelope: payload must be canonical JCS string');
  }
  if (`${canonical(env)}\n` !== text) {
    throw new TypeError('r04-noncanonical-envelope: envelope bytes are not canonical JCS');
  }
  const actualHash = payloadHash(expectedFamily, expectedVersion, env.payload);
  if (env.payloadHash !== actualHash) {
    throw new TypeError(`r04-payload-corrupted: expected ${actualHash}, got ${env.payloadHash}`);
  }
  let payload;
  try {
    payload = JSON.parse(env.payload);
  } catch {
    throw new TypeError('r04-malformed-payload: failed to parse payload JSON');
  }
  if (canonical(payload) !== env.payload) {
    throw new TypeError('r04-noncanonical-payload: payload bytes are not canonical JCS');
  }
  return { envelope: env, payload };
}

export function sha256Bytes(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}
