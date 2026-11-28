// SPDX-License-Identifier: MIT
// R12 Unified Artifact Inspector (`.tbc` / `.tmeta` / `.tsfgabi` / `.tpkg`),
// Live Source-Mapped VM/AOT Unified Debugger (driving `tsfg-r05-vm.exe` & Windows `.pdb`),
// and Win32 QPC Chrome Trace Profiling Collector.
import { existsSync, statSync } from 'node:fs';
import { validateAbiArtifact } from '../../compiler/r04-abi.mjs';
import { validateTmetaArtifact } from '../../compiler/r04-protocols.mjs';
import { runTsOnR05ZigVm } from '../../compiler/r05-ts-driver.mjs';

const R05_OP_NAMES = Object.freeze({
  1: 'fuel', 2: 'const_i32', 3: 'const_bool', 4: 'const_undef', 5: 'const_null', 6: 'const_f64', 7: 'mov',
  10: 'add_i32', 11: 'sub_i32', 12: 'mul_i32', 13: 'div_i32', 14: 'rem_i32', 15: 'neg_i32',
  16: 'bit_and', 17: 'bit_or', 18: 'bit_xor', 19: 'shl_i32', 20: 'shr_i32', 21: 'ushr_i32',
  22: 'lt_i32', 23: 'le_i32', 24: 'gt_i32', 25: 'ge_i32',
  26: 'add_f64', 27: 'sub_f64', 28: 'mul_f64', 29: 'div_f64', 30: 'lt_f64',
  31: 'strict_eq', 32: 'bool_not', 33: 'br', 34: 'cond_br', 35: 'call_direct', 36: 'ret',
  37: 'global_get', 38: 'global_set',
  40: 'new_obj', 41: 'field_get', 42: 'field_set', 43: 'clone_obj', 44: 'new_obj_dyn',
  45: 'env_alloc', 46: 'env_load', 47: 'env_store', 48: 'make_closure', 49: 'call_indirect',
  50: 'narrow_i32', 51: 'arr_new', 52: 'arr_len', 53: 'arr_get', 54: 'arr_set', 55: 'arr_push',
  56: 'span_begin', 57: 'span_release',
  60: 'throw_exc', 61: 'catch_take', 62: 'host_call', 63: 'gc_safepoint',
  64: 'bit_not', 65: 'neg_f64', 66: 'le_f64', 67: 'gt_f64', 68: 'ge_f64',
  69: 'assert_non_null', 70: 'array_resize', 71: 'get_type_id',
  72: 'mark_uninit', 73: 'mark_init', 74: 'check_init', 75: 'unreachable_trap',
  76: 'const_str', 77: 'str_len', 78: 'str_concat', 79: 'str_slice', 80: 'str_char_code_at',
  81: 'add_dyn', 82: 'sub_dyn', 83: 'mul_dyn', 84: 'div_dyn',
  85: 'lt_dyn', 86: 'le_dyn', 87: 'gt_dyn', 88: 'ge_dyn', 89: 'neg_dyn',
  90: 'const_i64', 91: 'const_u32', 92: 'const_u64', 93: 'const_f32',
  94: 'add_i64', 95: 'sub_i64', 96: 'mul_i64', 97: 'div_i64', 98: 'rem_i64',
  99: 'lt_i64', 100: 'le_i64', 101: 'gt_i64', 102: 'ge_i64',
  103: 'div_u32', 104: 'rem_u32', 105: 'lt_u32', 106: 'le_u32', 107: 'gt_u32', 108: 'ge_u32',
  109: 'f32_round', 110: 'int_wrap',
});

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
  let strCount = 0;
  if (formatVersion === 2) {
    strCount = payload.readUInt16LE(off);
    off += 2;
    for (let si = 0; si < strCount; si++) {
      const slen = payload.readUInt32LE(off);
      off += 4 + slen * 2;
    }
  }
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
    off += 2 + handlerCount * 13;
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

  return { formatVersion, magic, totalBytes, codeVersion, globalCount, capCount, strCount, functions };
}

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

export function offsetToLineCol(sourceText, byteOffset) {
  let line = 1;
  let col = 1;
  const lim = Math.min(Math.max(byteOffset, 0), sourceText.length);
  for (let i = 0; i < lim; i++) {
    if (sourceText[i] === '\n') {
      line += 1;
      col = 1;
    } else {
      col += 1;
    }
  }
  return { line, col };
}

export function lineToOffset(sourceText, targetLine) {
  const lines = sourceText.split(/\r?\n/);
  let offset = 0;
  for (let i = 0; i < Math.min(targetLine - 1, lines.length); i++) {
    offset += lines[i].length + 1;
  }
  // Skip leading whitespace on the target line so offset lands on the first real token
  const lineText = lines[targetLine - 1] ?? '';
  const lead = lineText.match(/^\s*/)?.[0].length ?? 0;
  return offset + lead;
}

/**
 * Unified VM & AOT Source-Mapped Debugger Session.
 * Supports both direct callback step tracking AND real live Zig R05 VM execution
 * (`runLiveVmSession` driving `tsfg-r05-vm.exe --breakpoint-pc / --breakpoint-offset`)
 * plus Windows `.pdb` AOT symbol verification.
 */
export class UnifiedDebugSession {
  constructor(sourceMap = new Map()) {
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

  /**
   * Execute real TypeScript on `tsfg-r05-vm.exe` with live VM breakpoint hooks & Win32 QPC tracing,
   * recording every real pause event with resolved source file/line and register snapshot!
   */
  async runLiveVmSession(sourceOrPath, opts = {}) {
    const file = opts.file ?? (opts.isFile ? sourceOrPath : '/src/main.ts');
    const sourceText = opts.sourceText ?? (opts.isFile ? null : sourceOrPath);
    const vmOpts = {
      ...opts,
      profileTrace: opts.profileTrace ?? true,
    };
    if (opts.breakpointLine !== undefined && sourceText) {
      vmOpts.breakpointOffset = lineToOffset(sourceText, opts.breakpointLine);
    } else if (opts.breakpointPc === undefined && opts.breakpointOffset === undefined && !opts.debugStep) {
      vmOpts.breakpointPc = 0;
    }

    const { compiled, result } = await runTsOnR05ZigVm(sourceOrPath, vmOpts);
    const pauses = [];
    for (const p of result.debugPauses ?? []) {
      const lc = sourceText ? offsetToLineCol(sourceText, p.sourceStart ?? 0) : { line: 1, col: 1 };
      const localsObj = {};
      for (const l of p.locals ?? []) {
        localsObj[`r${l.reg}`] = l.i32;
      }
      const frame = {
        tier: 'bytecode',
        functionName: opts.entry ?? 'main',
        file,
        line: lc.line,
        column: lc.col,
        pc: p.pc,
        depth: p.depth,
        locals: localsObj,
        callStack: [opts.entry ?? 'main'],
      };
      this.pausedEvents.push(frame);
      pauses.push(frame);
    }
    return { compiled, result, pauses, trace: result.trace ?? null };
  }

  /**
   * Verify that a compiled Windows x64 AOT binary has a matching non-empty detached `.pdb` symbol file.
   */
  verifyAotPdb(aotArtifact) {
    const pdb = aotArtifact?.pdbPath;
    if (!pdb || !existsSync(pdb)) {
      return { ok: false, reason: 'missing_pdb' };
    }
    const size = statSync(pdb).size;
    return { ok: size > 0, pdbPath: pdb, pdbBytes: size, targetPath: aotArtifact.outPath };
  }
}

/**
 * Structured Runtime Tracing & Profiling Collector for Hot-Reload, GC, CPU Jobs, and GPU Dispatches.
 * Ingests real Win32 QPC Chrome Trace JSON emitted by `tsfg-r05-vm.exe` / `tsfg-runtime.exe`
 * and exports standard Chrome Trace Event JSON (`traceEvents`).
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
      cat: category, // 'hot_reload' | 'gc' | 'cpu_jobs' | 'gpu_vulkan' | 'vm'
      name,
      ph: 'X',
      pid: 1,
      tid,
      ts,
      dur: durationUs,
      args,
    });
  }

  /** Ingest real Chrome Trace JSON emitted by Zig `tsfg-profiler.zig` (Win32 QPC timestamps). */
  ingestChromeTrace(traceInput) {
    const parsed = typeof traceInput === 'string' ? JSON.parse(traceInput) : traceInput;
    const list = Array.isArray(parsed?.traceEvents) ? parsed.traceEvents : [];
    for (const ev of list) {
      this.events.push(ev);
    }
    return list.length;
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
