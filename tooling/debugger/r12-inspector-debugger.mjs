// SPDX-License-Identifier: MIT
// R12 Unified Artifact Inspector (`.tbc` / `.tmeta` / `.tsfgabi` / Core IR),
// Source-Mapped VM/AOT Unified Debugger, and Hot-Reload / GC / Jobs / GPU Tracing Collector.
import { validateAbiArtifact } from '../../compiler/r04-abi.mjs';
import { validateTmetaArtifact } from '../../compiler/r04-protocols.mjs';

const R05_OP_NAMES = Object.freeze({
  1: 'fuel',
  2: 'const_i32',
  6: 'const_f64',
  10: 'add_i32',
  11: 'sub_i32',
  12: 'mul_i32',
  13: 'div_i32',
  14: 'rem_i32',
  26: 'add_f64',
  27: 'sub_f64',
  28: 'mul_f64',
  29: 'div_f64',
  36: 'ret',
});

/**
 * Inspect a binary `TSFGR05B` `.tbc` bytecode artifact, decoding header, version,
 * functions, instruction opcodes, registers, and source spans.
 */
export function inspectTbcBytecode(bytes) {
  const buf = Buffer.from(bytes);
  const magic = buf.subarray(0, 8).toString('ascii');
  if (magic !== 'TSFGR05B') throw new TypeError(`r12-inspect-tbc: invalid magic ${magic}`);
  const formatVersion = buf.readUInt32LE(8);
  const totalBytes = buf.readUInt32LE(12);
  const payload = buf.subarray(48);

  let off = 96; // mod_id(32) + abi_hash(32) + schema_hash(32)
  const codeVersion = Number(payload.readBigUInt64LE(off));
  off += 8;
  const globalCount = payload.readUInt16LE(off);
  off += 2;
  const capCount = payload.readUInt16LE(off);
  off += 2;
  const f64Count = payload.readUInt16LE(off);
  off += 2 + f64Count * 8;
  const fnCount = payload.readUInt16LE(off);
  off += 2;

  const functions = [];
  for (let f = 0; f < fnCount; f++) {
    const fnIdHex = payload.subarray(off, off + 32).toString('hex');
    off += 32;
    const paramCount = payload.readUInt16LE(off);
    off += 2;
    const regCount = payload.readUInt16LE(off);
    off += 2;
    off += 8; // ref_reg_mask
    const handlerCount = payload.readUInt16LE(off);
    off += 2 + handlerCount * 16;
    const opCount = payload.readUInt32LE(off);
    off += 4;
    const instructions = [];
    for (let i = 0; i < opCount; i++) {
      const opcode = payload[off];
      const dst = payload.readUInt16LE(off + 2);
      const a = payload.readUInt16LE(off + 4);
      const b = payload.readUInt16LE(off + 6);
      const imm32 = payload.readInt32LE(off + 8);
      const spanStart = payload.readUInt32LE(off + 12);
      const spanEnd = payload.readUInt32LE(off + 16);
      off += 20;
      instructions.push({
        pc: i,
        op: R05_OP_NAMES[opcode] ?? `op_${opcode}`,
        dst,
        a,
        b,
        imm32,
        span: { start: spanStart, end: spanEnd },
      });
    }
    functions.push({ fnIdHex, paramCount, regCount, instructions });
  }

  return { formatVersion, magic, totalBytes, codeVersion, globalCount, capCount, functions };
}

/**
 * Inspect `.tmeta` or `.tsfgabi` artifacts in human/tool-readable structured form.
 */
export function inspectTmeta(bytes) {
  const { payload } = validateTmetaArtifact(bytes);
  return {
    abiHash: payload.abiHash,
    components: payload.components,
    queries: payload.queries,
    reflectionDigest: payload.reflectionDigest,
    target: payload.target.target,
  };
}

export function inspectAbi(bytes) {
  const { payload } = validateAbiArtifact(bytes);
  return {
    abiHash: payload.abiHash,
    functions: payload.functions.map((f) => f.name),
    target: payload.target.target,
    types: payload.types.map((t) => ({ name: t.name, size: t.size, align: t.align })),
  };
}

/**
 * Unified VM & AOT Source-Mapped Debugger Session.
 * Maps source lines to IR/bytecode/AOT PCs so breakpoints pause with identical
 * `{ tier, functionName, sourceLine, locals, callStack }` shape across both execution tiers!
 */
export class UnifiedDebugSession {
  constructor(sourceMap) {
    this.sourceMap = sourceMap; // Map<pc, { file, line }>
    this.breakpoints = new Set(); // "file:line"
    this.pausedEvents = [];
  }

  setBreakpoint(file, line) {
    this.breakpoints.add(`${file}:${line}`);
  }

  clearBreakpoint(file, line) {
    this.breakpoints.delete(`${file}:${line}`);
  }

  /** Called by either VM or AOT debug hook at a mapped PC. */
  onStep({ tier, functionName, pc, locals, callStack }) {
    const loc = this.sourceMap.get(pc);
    if (!loc) return null;
    const key = `${loc.file}:${loc.line}`;
    if (!this.breakpoints.has(key)) return null;
    const frame = {
      tier, // 'bytecode' | 'native'
      functionName,
      file: loc.file,
      line: loc.line,
      pc,
      locals: { ...locals },
      callStack: [...callStack],
    };
    this.pausedEvents.push(frame);
    return frame;
  }
}

/**
 * Structured Runtime Tracing & Profiling Collector for Hot-Reload, GC, CPU Jobs, and GPU Dispatches.
 * Exports standard Chrome Trace Event JSON (`traceEvents`).
 */
export class TsfgTraceProfiler {
  constructor() {
    this.events = [];
    this.seq = 0;
  }

  record(category, name, durationUs, args = {}, tid = 1) {
    const ts = this.seq * 100;
    this.seq += 1;
    this.events.push({
      cat: category, // 'hot_reload' | 'gc' | 'cpu_jobs' | 'gpu_vulkan'
      name,
      ph: 'X',
      pid: 1,
      tid,
      ts,
      dur: durationUs,
      args,
    });
  }

  summary() {
    const byCategory = {};
    for (const ev of this.events) {
      byCategory[ev.cat] = (byCategory[ev.cat] ?? 0) + 1;
    }
    return { totalEvents: this.events.length, byCategory };
  }

  toChromeTraceJson() {
    return JSON.stringify({ traceEvents: this.events });
  }
}
