// SPDX-License-Identifier: MIT
// R05 Compiler Bridge: Lowers REAL canonicalized Common20 Core MLIR
// (`tsfg-core-ir.exe --common-program --canonicalize`) directly into verified
// `TSFGR05B` binary bytecode executable by `runtime/r05-vm.zig` (`tsfg-r05-vm.exe`).
import { createHash } from 'node:crypto';
import { parseCommonCoreMlir } from './common-mlir-parser.mjs';

const OP = Object.freeze({
  nop: 0,
  fuel: 1,
  const_i32: 2,
  const_bool: 3,
  const_undef: 4,
  const_null: 5,
  const_f64: 6,
  mov: 7,
  add_i32: 10,
  sub_i32: 11,
  mul_i32: 12,
  div_i32: 13,
  rem_i32: 14,
  neg_i32: 15,
  bit_and: 16,
  bit_or: 17,
  bit_xor: 18,
  shl_i32: 19,
  shr_i32: 20,
  ushr_i32: 21,
  lt_i32: 22,
  le_i32: 23,
  gt_i32: 24,
  ge_i32: 25,
  add_f64: 26,
  sub_f64: 27,
  mul_f64: 28,
  div_f64: 29,
  lt_f64: 30,
  strict_eq: 31,
  bool_not: 32,
  narrow_i32: 33,
  br: 34,
  cond_br: 35,
  ret: 36,
  call_direct: 37,
  global_get: 40,
  global_set: 41,
  array_new: 47,
  array_len: 48,
  array_get: 49,
  array_set: 50,
  span_new: 51,
});

function sha256Raw(input) {
  return createHash('sha256').update(input).digest();
}

function writeU16(chunks, v) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v & 0xffff, 0);
  chunks.push(b);
}
function writeU32(chunks, v) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0, 0);
  chunks.push(b);
}
function writeI32(chunks, v) {
  const b = Buffer.alloc(4);
  b.writeInt32LE(v | 0, 0);
  chunks.push(b);
}
function writeU64(chunks, v) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt.asUintN(64, BigInt(v)), 0);
  chunks.push(b);
}

/**
 * Lower a canonicalized Common20 Core MLIR module into `TSFGR05B` binary bytecode.
 * Returns `{ bytes, exportsByName, functions, abiHash }`.
 */
export function lowerCommonCoreToR05Bytecode(mlirText, opts = {}) {
  const mod = typeof mlirText === 'string' ? parseCommonCoreMlir(mlirText) : mlirText;
  const f64Pool = [];
  const f64Map = new Map();
  const internF64 = (bitsBig) => {
    const key = bitsBig.toString(16);
    if (f64Map.has(key)) return f64Map.get(key);
    const idx = f64Pool.length;
    f64Pool.push(bitsBig);
    f64Map.set(key, idx);
    return idx;
  };

  const fnIdxById = new Map();
  for (let i = 0; i < mod.functions.length; i++) {
    fnIdxById.set(mod.functions[i].functionId, i);
  }

  const compiledFns = [];

  for (const fn of mod.functions) {
    const regMap = new Map();
    const cellRegMap = new Map();
    let nextReg = 0;

    // Assign param registers 0..paramCount-1 first
    const entryParams = fn.blocks[0].params;
    for (const p of entryParams) regMap.set(p.reg, nextReg++);
    const paramCount = entryParams.length;

    const allocReg = (ssaName) => {
      if (ssaName && regMap.has(ssaName)) return regMap.get(ssaName);
      const r = nextReg++;
      if (ssaName) regMap.set(ssaName, r);
      return r;
    };
    const getCellReg = (binding) => {
      if (cellRegMap.has(binding)) return cellRegMap.get(binding);
      const r = nextReg++;
      cellRegMap.set(binding, r);
      return r;
    };

    // Pre-assign block parameter registers so phi edges can target them
    for (let bi = 1; bi < fn.blocks.length; bi++) {
      for (const bp of fn.blocks[bi].params) allocReg(bp.reg);
    }

    const ops = [];
    const blockStartPc = new Map();
    const fixups = []; // { opIdx, targetLabel }

    const emit = (op, { dst = 0, a = 0, b = 0, imm32 = 0, start = 0, end = 1 } = {}) => {
      const idx = ops.length;
      ops.push({ op, dst, a, b, imm32, start, end: Math.max(end, start) });
      return idx;
    };

    const emitPhiMoves = (targetLabel, argSsaNames, anchor) => {
      const targetBlock = fn.blocks.find((b) => b.label === targetLabel);
      if (!targetBlock || targetBlock.params.length === 0) return;
      // Parallel phi transfer via temps so swaps never clobber!
      const temps = [];
      for (let i = 0; i < Math.min(targetBlock.params.length, argSsaNames.length); i++) {
        const tmp = nextReg++;
        emit(OP.mov, { dst: tmp, a: allocReg(argSsaNames[i]), start: anchor.start, end: anchor.end });
        temps.push(tmp);
      }
      for (let i = 0; i < temps.length; i++) {
        emit(OP.mov, { dst: allocReg(targetBlock.params[i].reg), a: temps[i], start: anchor.start, end: anchor.end });
      }
    };

    // Ensure entry fuel is at pc 0 (some module initializers omit explicit entry fuel)
    const firstOp = fn.blocks[0]?.ops[0];
    if (!firstOp || firstOp.name !== 'tsfg_program.fuel') {
      emit(OP.fuel, { a: 1, start: 0, end: 1 });
    }

    for (const blk of fn.blocks) {
      blockStartPc.set(blk.label, ops.length);
      for (const op of blk.ops) {
        const n = op.name;
        const p = op.properties;
        const anc = op.anchor ?? { start: 0, end: 1 };

        if (n === 'tsfg_program.fuel') {
          const ev = ops.length === 0 ? 1 : 2;
          emit(OP.fuel, { a: ev, start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.constant') {
          emit(OP.const_i32, { dst: allocReg(op.result), imm32: Number(p.decimal ?? p.value ?? 0) | 0, start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.boolean') {
          emit(OP.const_bool, { dst: allocReg(op.result), imm32: p.value ? 1 : 0, start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.undefined') {
          emit(OP.const_undef, { dst: allocReg(op.result), start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.null') {
          emit(OP.const_null, { dst: allocReg(op.result), start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.floating') {
          const idx = internF64(BigInt('0x' + (p.bits ?? '0')));
          emit(OP.const_f64, { dst: allocReg(op.result), imm32: idx, start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.cell') {
          const cr = getCellReg(p.binding ?? op.result);
          if (op.result) regMap.set(op.result, cr);
        } else if (n === 'tsfg_program.store') {
          const cr = getCellReg(p.binding ?? op.operands[0]);
          emit(OP.mov, { dst: cr, a: allocReg(op.operands[1]), start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.load') {
          const cr = getCellReg(p.binding ?? op.operands[0]);
          emit(OP.mov, { dst: allocReg(op.result), a: cr, start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.global_store') {
          const g = mod.globalsById.get(p.global);
          emit(OP.global_set, { a: allocReg(op.operands[0]), imm32: g.index, start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.global_load') {
          const g = mod.globalsById.get(p.global);
          emit(OP.global_get, { dst: allocReg(op.result), imm32: g.index, start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.carrier_cast' || n === 'tsfg_program.view' || n === 'tsfg_program.pack' || n === 'tsfg_program.value_copy') {
          emit(OP.mov, { dst: allocReg(op.result), a: allocReg(op.operands[0]), start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.assert') {
          const targetTy = mod.typesById.get(op.viewType);
          if (targetTy?.kind === 'scalar' && targetTy.name === 'i32') {
            emit(OP.narrow_i32, { dst: allocReg(op.result), a: allocReg(op.operands[0]), start: anc.start, end: anc.end });
          } else {
            emit(OP.mov, { dst: allocReg(op.result), a: allocReg(op.operands[0]), start: anc.start, end: anc.end });
          }
        } else if (n === 'tsfg_program.numeric_use') {
          const tmp = nextReg++;
          emit(OP.narrow_i32, { dst: tmp, a: allocReg(op.operands[0]), start: anc.start, end: anc.end });
          emitPhiMoves(op.successors[0], [op.operands[0]], anc);
          const brIdx = emit(OP.br, { imm32: 0, start: anc.start, end: anc.end });
          fixups.push({ opIdx: brIdx, targetLabel: op.successors[0] });
        } else if (n === 'tsfg_program.binary') {
          const l = allocReg(op.operands[0]);
          const r = allocReg(op.operands[1]);
          const d = allocReg(op.result);
          const binMap = {
            '+': OP.add_i32,
            '-': OP.sub_i32,
            '*': OP.mul_i32,
            '/': OP.div_i32,
            '%': OP.rem_i32,
            '&': OP.bit_and,
            '|': OP.bit_or,
            '^': OP.bit_xor,
            '<<': OP.shl_i32,
            '>>': OP.shr_i32,
            '>>>': OP.ushr_i32,
            '<': OP.lt_i32,
            '<=': OP.le_i32,
            '>': OP.gt_i32,
            '>=': OP.ge_i32,
          };
          if (p.operator === '===' || p.operator === '==' || p.operator === '!==' || p.operator === '!=') {
            emit(OP.strict_eq, { dst: d, a: l, b: r, imm32: p.operator.startsWith('!') ? 1 : 0, start: anc.start, end: anc.end });
          } else if (binMap[p.operator] !== undefined) {
            emit(binMap[p.operator], { dst: d, a: l, b: r, start: anc.start, end: anc.end });
          } else {
            throw new Error(`r05-lower: unsupported binary op ${p.operator}`);
          }
        } else if (n === 'tsfg_program.unary') {
          const v = allocReg(op.operands[0]);
          const d = allocReg(op.result);
          if (p.operator === '-') emit(OP.neg_i32, { dst: d, a: v, start: anc.start, end: anc.end });
          else if (p.operator === '!') emit(OP.bool_not, { dst: d, a: v, start: anc.start, end: anc.end });
          else emit(OP.mov, { dst: d, a: v, start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.strict_equal') {
          emit(OP.strict_eq, {
            dst: allocReg(op.result),
            a: allocReg(op.operands[0]),
            b: allocReg(op.operands[1]),
            imm32: p.operator === '!==' ? 1 : 0,
            start: anc.start,
            end: anc.end,
          });
        } else if (n === 'tsfg_program.array_create') {
          const base = nextReg;
          for (const r of op.operands) {
            emit(OP.mov, { dst: nextReg++, a: allocReg(r), start: anc.start, end: anc.end });
          }
          emit(OP.array_new, { dst: allocReg(op.result), a: base, b: op.operands.length, start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.array_length' || n === 'tsfg_program.readspan_length') {
          emit(OP.array_len, { dst: allocReg(op.result), a: allocReg(op.operands[0]), start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.readspan') {
          emit(OP.span_new, {
            dst: allocReg(op.result),
            a: allocReg(op.operands[0]),
            b: allocReg(op.operands[1]),
            imm32: allocReg(op.operands[2]),
            start: anc.start,
            end: anc.end,
          });
        } else if (n === 'tsfg_program.array_read') {
          emit(OP.array_get, { dst: allocReg(op.result), a: allocReg(op.operands[0]), b: allocReg(op.operands[1]), start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.array_store') {
          emit(OP.array_set, { a: allocReg(op.operands[0]), b: allocReg(op.operands[1]), dst: allocReg(op.operands[2]), start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.invoke') {
          const calleeIdx = fnIdxById.get(p.function_id);
          const argBase = nextReg;
          for (const r of op.operands) emit(OP.mov, { dst: nextReg++, a: allocReg(r), start: anc.start, end: anc.end });
          const resReg = nextReg++;
          emit(OP.call_direct, { dst: resReg, a: argBase, b: op.operands.length, imm32: calleeIdx, start: anc.start, end: anc.end });
          const targetBlk = fn.blocks.find((b) => b.label === op.successors[0]);
          if (targetBlk && targetBlk.params.length > 0) {
            emit(OP.mov, { dst: allocReg(targetBlk.params[0].reg), a: resReg, start: anc.start, end: anc.end });
          }
          const brIdx = emit(OP.br, { imm32: 0, start: anc.start, end: anc.end });
          fixups.push({ opIdx: brIdx, targetLabel: op.successors[0] });
        } else if (n === 'tsfg_program.route' || n === 'cf.br') {
          emitPhiMoves(op.successors[0], op.operands, anc);
          const brIdx = emit(OP.br, { imm32: 0, start: anc.start, end: anc.end });
          fixups.push({ opIdx: brIdx, targetLabel: op.successors[0] });
        } else if (n === 'cf.cond_br') {
          const cond = allocReg(op.operands[0]);
          const segs = op.operandSegmentSizes ?? [1, 0, 0];
          const tArgs = op.operands.slice(1, 1 + segs[1]);
          const fArgs = op.operands.slice(1 + segs[1], 1 + segs[1] + segs[2]);
          const cbrIdx = emit(OP.cond_br, { a: cond, imm32: 0, start: anc.start, end: anc.end });
          // False edge inline
          emitPhiMoves(op.successors[1], fArgs, anc);
          const fBr = emit(OP.br, { imm32: 0, start: anc.start, end: anc.end });
          fixups.push({ opIdx: fBr, targetLabel: op.successors[1] });
          // True edge trampoline
          ops[cbrIdx].imm32 = ops.length;
          emitPhiMoves(op.successors[0], tArgs, anc);
          const tBr = emit(OP.br, { imm32: 0, start: anc.start, end: anc.end });
          fixups.push({ opIdx: tBr, targetLabel: op.successors[0] });
        } else if (n === 'func.return') {
          const rv = op.operands.length > 0 ? allocReg(op.operands[0]) : 0xffff;
          emit(OP.ret, { a: rv, start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.enter_handler' || n === 'tsfg_program.finally_enter') {
          // Structural marker
        } else {
          throw new Error(`r05-lower: unsupported op ${n}`);
        }
      }
    }

    // Resolve all branch target PCs
    for (const fx of fixups) {
      const targetPc = blockStartPc.get(fx.targetLabel);
      if (targetPc === undefined) throw new Error(`r05-lower: missing target block ${fx.targetLabel}`);
      ops[fx.opIdx].imm32 = targetPc;
    }

    // Ensure function ends cleanly with a terminator
    const last = ops[ops.length - 1];
    if (!last || (last.op !== OP.ret && last.op !== OP.br)) {
      emit(OP.ret, { a: 0xffff, start: 0, end: 1 });
    }

    compiledFns.push({
      functionId: sha256Raw(fn.functionId),
      name: fn.name,
      ops,
      paramCount,
      regCount: Math.max(1, nextReg),
    });
  }

  // Serialize to TSFGR05B binary wire format
  const moduleId = sha256Raw(opts.moduleId ?? 'tsfg.r05.module');
  const abiHash = sha256Raw(opts.abiHash ?? 'tsfg.r05.win64_c');
  const staticSchemaHash = sha256Raw(opts.staticSchemaHash ?? 'tsfg.r05.schema.v1');

  const payloadChunks = [moduleId, abiHash, staticSchemaHash];
  writeU64(payloadChunks, opts.codeVersion ?? 1);
  writeU16(payloadChunks, mod.globalsById.size);
  writeU16(payloadChunks, 0); // required capabilities
  writeU16(payloadChunks, f64Pool.length);
  for (const bits of f64Pool) writeU64(payloadChunks, bits);
  writeU16(payloadChunks, compiledFns.length);

  for (const f of compiledFns) {
    payloadChunks.push(f.functionId);
    writeU16(payloadChunks, f.paramCount);
    writeU16(payloadChunks, f.regCount);
    writeU64(payloadChunks, 0n); // ref_reg_mask
    writeU16(payloadChunks, 0); // handler count
    writeU32(payloadChunks, f.ops.length);
    for (const op of f.ops) {
      payloadChunks.push(Buffer.from([op.op, 0]));
      writeU16(payloadChunks, op.dst);
      writeU16(payloadChunks, op.a);
      writeU16(payloadChunks, op.b);
      writeI32(payloadChunks, op.imm32);
      writeU32(payloadChunks, op.start);
      writeU32(payloadChunks, op.end);
    }
  }

  const payload = Buffer.concat(payloadChunks);
  const digest = sha256Raw(payload);
  const headerChunks = [Buffer.from('TSFGR05B', 'ascii')];
  writeU32(headerChunks, 1); // version
  writeU32(headerChunks, 48 + payload.length);
  headerChunks.push(digest);
  const bytes = Buffer.concat([...headerChunks, payload]);

  const exportsByName = new Map();
  for (const [name, fid] of mod.exportsByName.entries()) {
    exportsByName.set(name, fnIdxById.get(fid));
  }
  return { abiHash, bytes, exportsByName, functions: compiledFns };
}
