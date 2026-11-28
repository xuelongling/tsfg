// SPDX-License-Identifier: MIT
// R05 Complete Compiler Lowering Bridge:
// Lowers REAL canonicalized Common20 Core MLIR (`tsfg-core-ir.exe --common-program --canonicalize`)
// — covering i32/f64/bool/null/undefined, lossless UTF-16 strings, classes & inheritance & TDZ,
// `@value` structs, closures & nested environments, `try/catch/finally` exception tables,
// dense arrays (`array_resize`), `ReadSpan`, unions/narrowing, and module globals (`$moduleInit`) —
// directly into verified `TSFGR05B` binary bytecode executable by `runtime/r05-vm.zig` (`tsfg-r05-vm.exe`).
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
  make_closure: 38,
  call_indirect: 39,
  global_get: 40,
  global_set: 41,
  new_obj: 42,
  clone_obj: 43,
  field_get: 44,
  field_set: 45,
  call_method: 46,
  array_new: 47,
  array_len: 48,
  array_get: 49,
  array_set: 50,
  span_new: 51,
  span_release: 52,
  throw_exc: 53,
  catch_take: 54,
  host_call: 55,
  gc_safepoint: 56,
  bit_not: 57,
  neg_f64: 58,
  le_f64: 59,
  gt_f64: 60,
  ge_f64: 61,
  assert_non_null: 62,
  array_resize: 63,
  get_type_id: 64,
  mark_uninit: 65,
  mark_init: 66,
  check_init: 67,
  new_obj_dyn: 68,
  unreachable_trap: 69,
  const_str: 70,
  str_len: 71,
  str_concat: 72,
  str_slice: 73,
  str_char_code_at: 74,
  add_dyn: 75,
  sub_dyn: 76,
  mul_dyn: 77,
  div_dyn: 78,
  lt_dyn: 79,
  le_dyn: 80,
  gt_dyn: 81,
  ge_dyn: 82,
  neg_dyn: 83,
});

function sha256Raw(input) {
  return createHash('sha256').update(input).digest();
}

function writeU8(chunks, v) {
  chunks.push(Buffer.from([v & 0xff]));
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

function stringToUtf16Units(str) {
  const units = [];
  for (let i = 0; i < str.length; i++) units.push(str.charCodeAt(i));
  return units;
}

function orderBlocksRpo(blocks) {
  if (blocks.length <= 1) return blocks;
  const byLabel = new Map(blocks.map((b) => [b.label, b]));
  const visited = new Set();
  const postorder = [];
  const dfs = (blk) => {
    if (!blk || visited.has(blk.label)) return;
    visited.add(blk.label);
    for (const op of blk.ops) {
      for (const succ of op.successors ?? []) {
        dfs(byLabel.get(succ));
      }
    }
    postorder.push(blk);
  };
  dfs(blocks[0]);
  for (const b of blocks) dfs(b);
  return postorder.reverse();
}

/**
 * Lower a canonicalized Common20 Core MLIR module into `TSFGR05B` binary bytecode.
 * Returns `{ bytes, exportsByName, initFnIndex, functions, abiHash }`.
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

  const strPool = []; // array of number[] (UTF-16 code units)
  const strMap = new Map();
  const internStr = (units) => {
    const key = units.join(',');
    if (strMap.has(key)) return strMap.get(key);
    const idx = strPool.length;
    strPool.push(units);
    strMap.set(key, idx);
    return idx;
  };

  const fnIdxById = new Map();
  let initFnIndex = null;
  for (let i = 0; i < mod.functions.length; i++) {
    fnIdxById.set(mod.functions[i].functionId, i);
    if (
      mod.functions[i].name === '$moduleInit' ||
      mod.functions[i].role === 'module-initializer' ||
      mod.functions[i].role === 'module-initialization'
    ) {
      initFnIndex = i;
    }
  }

  // Compute maximum field count across all classes so dynamic subclass allocation via `new_obj_dyn` always fits!
  let maxClassFields = 1;
  for (const fm of mod.classFieldMap.values()) {
    if (fm.size > maxClassFields) maxClassFields = fm.size;
  }

  let nextCacheSlot = 0;
  const compiledFns = [];

  for (const fn of mod.functions) {
    const regMap = new Map();
    const cellRegMap = new Map();
    const regKind = new Map(); // regIndex -> 'i32' | 'f64' | 'str' | 'dyn'
    let nextReg = 0;

    // Assign param registers 0..paramCount-1 first
    const entryParams = fn.blocks[0].params;
    for (let pi = 0; pi < entryParams.length; pi++) {
      const p = entryParams[pi];
      const r = nextReg++;
      regMap.set(p.reg, r);
      const pt = fn.paramTypes[pi] ?? p.type ?? '';
      if (pt.includes('f64') || pt.includes('float')) regKind.set(r, 'f64');
      else if (pt.includes('string')) regKind.set(r, 'str');
      else if (pt.includes('union') || pt.includes('any')) regKind.set(r, 'dyn');
      else regKind.set(r, 'i32');
    }
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
      for (const bp of fn.blocks[bi].params) {
        const r = allocReg(bp.reg);
        if (bp.type?.includes('f64')) regKind.set(r, 'f64');
        else if (bp.type?.includes('union')) regKind.set(r, 'dyn');
      }
    }

    const ops = [];
    const handlers = [];
    const blockStartPc = new Map();
    const fixups = []; // { opIdx, targetLabel }
    const deferredTrampolines = []; // { callPcs, unwindLabel, anc }

    const emit = (op, { dst = 0, a = 0, b = 0, imm32 = 0, start = 0, end = 1 } = {}) => {
      const idx = ops.length;
      ops.push({ op, dst, a, b, imm32, start, end: Math.max(end, start) });
      return idx;
    };

    const emitPhiMoves = (targetLabel, argRegs, anchor) => {
      const targetBlock = fn.blocks.find((b) => b.label === targetLabel);
      if (!targetBlock || targetBlock.params.length === 0) return;
      const count = Math.min(targetBlock.params.length, argRegs.length);
      if (count === 0) return;
      const temps = [];
      for (let i = 0; i < count; i++) {
        const tmp = nextReg++;
        emit(OP.mov, { dst: tmp, a: argRegs[i], start: anchor.start, end: anchor.end });
        temps.push(tmp);
      }
      for (let i = 0; i < count; i++) {
        emit(OP.mov, { dst: allocReg(targetBlock.params[i].reg), a: temps[i], start: anchor.start, end: anchor.end });
      }
    };

    const emitPhiSsa = (targetLabel, argSsaNames, anchor) => {
      emitPhiMoves(
        targetLabel,
        argSsaNames.map((n) => allocReg(n)),
        anchor,
      );
    };

    const orderedBlocks = orderBlocksRpo(fn.blocks);
    // Ensure entry fuel is at pc 0
    const firstOp = orderedBlocks[0]?.ops[0];
    if (!firstOp || firstOp.name !== 'tsfg_program.fuel') {
      emit(OP.fuel, { a: 1, start: 0, end: 1 });
    }

    for (const blk of orderedBlocks) {
      blockStartPc.set(blk.label, ops.length);
      for (const op of blk.ops) {
        const n = op.name;
        const p = op.properties;
        const anc = op.anchor ?? { start: 0, end: 1 };

        if (n === 'tsfg_program.fuel') {
          const ev = ops.length === 0 ? 1 : 2;
          emit(OP.fuel, { a: ev, start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.constant') {
          const dst = allocReg(op.result);
          regKind.set(dst, 'i32');
          emit(OP.const_i32, { dst, imm32: Number(p.decimal ?? p.value ?? 0) | 0, start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.boolean') {
          emit(OP.const_bool, { dst: allocReg(op.result), imm32: p.value ? 1 : 0, start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.undefined') {
          emit(OP.const_undef, { dst: allocReg(op.result), start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.null') {
          emit(OP.const_null, { dst: allocReg(op.result), start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.floating') {
          const dst = allocReg(op.result);
          regKind.set(dst, 'f64');
          const idx = internF64(BigInt('0x' + (p.bits ?? '0')));
          emit(OP.const_f64, { dst, imm32: idx, start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.string' || n === 'tsfg_program.string_literal') {
          const dst = allocReg(op.result);
          regKind.set(dst, 'str');
          const units = Array.isArray(p.codeUnits) ? p.codeUnits : stringToUtf16Units(String(p.value ?? ''));
          const idx = internStr(units);
          emit(OP.const_str, { dst, imm32: idx, start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.string_length') {
          const dst = allocReg(op.result);
          regKind.set(dst, 'i32');
          emit(OP.str_len, { dst, a: allocReg(op.operands[0]), start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.string_concat') {
          const dst = allocReg(op.result);
          regKind.set(dst, 'str');
          emit(OP.str_concat, { dst, a: allocReg(op.operands[0]), b: allocReg(op.operands[1]), start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.string_slice') {
          const dst = allocReg(op.result);
          regKind.set(dst, 'str');
          emit(OP.str_slice, {
            dst,
            a: allocReg(op.operands[0]),
            b: allocReg(op.operands[1]),
            imm32: allocReg(op.operands[2]),
            start: anc.start,
            end: anc.end,
          });
        } else if (n === 'tsfg_program.string_char_code_at') {
          const dst = allocReg(op.result);
          regKind.set(dst, 'i32');
          emit(OP.str_char_code_at, { dst, a: allocReg(op.operands[0]), b: allocReg(op.operands[1]), start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.cell') {
          const cr = getCellReg(p.binding ?? op.result);
          if (op.result) regMap.set(op.result, cr);
        } else if (n === 'tsfg_program.store') {
          const cr = getCellReg(p.binding ?? op.operands[0]);
          const src = allocReg(op.operands[1]);
          if (regKind.has(src)) regKind.set(cr, regKind.get(src));
          emit(OP.mov, { dst: cr, a: src, start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.load') {
          const cr = getCellReg(p.binding ?? op.operands[0]);
          const dst = allocReg(op.result);
          if (regKind.has(cr)) regKind.set(dst, regKind.get(cr));
          emit(OP.mov, { dst, a: cr, start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.global_store') {
          const g = mod.globalsById.get(p.global);
          emit(OP.global_set, { a: allocReg(op.operands[0]), imm32: g.index, start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.global_load') {
          const g = mod.globalsById.get(p.global);
          const dst = allocReg(op.result);
          regKind.set(dst, 'dyn');
          emit(OP.global_get, { dst, imm32: g.index, start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.carrier_cast' || n === 'tsfg_program.view' || n === 'tsfg_program.pack') {
          const src = allocReg(op.operands[0]);
          const dst = allocReg(op.result);
          if (regKind.has(src)) regKind.set(dst, regKind.get(src));
          emit(OP.mov, { dst, a: src, start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.value_copy') {
          const ty = mod.typesById.get(p.type);
          const src = allocReg(op.operands[0]);
          const dst = allocReg(op.result);
          if (ty?.kind === 'value') {
            emit(OP.clone_obj, { dst, a: src, start: anc.start, end: anc.end });
          } else {
            if (regKind.has(src)) regKind.set(dst, regKind.get(src));
            emit(OP.mov, { dst, a: src, start: anc.start, end: anc.end });
          }
        } else if (n === 'tsfg_program.assert') {
          const targetTy = mod.typesById.get(op.viewType);
          const dst = allocReg(op.result);
          const src = allocReg(op.operands[0]);
          if (targetTy?.kind === 'scalar' && targetTy.name === 'i32') {
            regKind.set(dst, 'i32');
            emit(OP.narrow_i32, { dst, a: src, start: anc.start, end: anc.end });
          } else if (p.operator === '!') {
            emit(OP.assert_non_null, { dst, a: src, start: anc.start, end: anc.end });
          } else {
            emit(OP.mov, { dst, a: src, start: anc.start, end: anc.end });
          }
        } else if (n === 'tsfg_program.numeric_use') {
          const tmp = nextReg++;
          emit(OP.narrow_i32, { dst: tmp, a: allocReg(op.operands[0]), start: anc.start, end: anc.end });
          emitPhiSsa(op.successors[0], [op.operands[0]], anc);
          const brIdx = emit(OP.br, { imm32: 0, start: anc.start, end: anc.end });
          fixups.push({ opIdx: brIdx, targetLabel: op.successors[0] });
        } else if (n === 'tsfg_program.binary') {
          const l = allocReg(op.operands[0]);
          const r = allocReg(op.operands[1]);
          const d = allocReg(op.result);
          const lk = regKind.get(l);
          const rk = regKind.get(r);
          const pureI32 = lk === 'i32' && rk === 'i32';
          const oper = p.operator;

          if (oper === '===' || oper === '==' || oper === '!==' || oper === '!=') {
            emit(OP.strict_eq, { dst: d, a: l, b: r, imm32: oper.startsWith('!') ? 1 : 0, start: anc.start, end: anc.end });
          } else if (pureI32 && ['+', '-', '*', '/', '<', '<=', '>', '>='].includes(oper)) {
            const i32Map = {
              '+': OP.add_i32, '-': OP.sub_i32, '*': OP.mul_i32, '/': OP.div_i32,
              '<': OP.lt_i32, '<=': OP.le_i32, '>': OP.gt_i32, '>=': OP.ge_i32,
            };
            if (['+', '-', '*', '/'].includes(oper)) regKind.set(d, 'i32');
            emit(i32Map[oper], { dst: d, a: l, b: r, start: anc.start, end: anc.end });
          } else if (['+', '-', '*', '/', '<', '<=', '>', '>='].includes(oper)) {
            const dynMap = {
              '+': OP.add_dyn, '-': OP.sub_dyn, '*': OP.mul_dyn, '/': OP.div_dyn,
              '<': OP.lt_dyn, '<=': OP.le_dyn, '>': OP.gt_dyn, '>=': OP.ge_dyn,
            };
            if (lk === 'f64' || rk === 'f64') regKind.set(d, 'f64');
            else if (lk === 'str' || rk === 'str') regKind.set(d, 'str');
            else regKind.set(d, 'dyn');
            emit(dynMap[oper], { dst: d, a: l, b: r, start: anc.start, end: anc.end });
          } else {
            const intOnlyMap = {
              '%': OP.rem_i32, '&': OP.bit_and, '|': OP.bit_or, '^': OP.bit_xor,
              '<<': OP.shl_i32, '>>': OP.shr_i32, '>>>': OP.ushr_i32,
            };
            if (intOnlyMap[oper] === undefined) {
              throw new Error(`r05-lower: unsupported binary op ${oper}`);
            }
            regKind.set(d, 'i32');
            emit(intOnlyMap[oper], { dst: d, a: l, b: r, start: anc.start, end: anc.end });
          }
        } else if (n === 'tsfg_program.unary') {
          const v = allocReg(op.operands[0]);
          const d = allocReg(op.result);
          if (p.operator === '-') {
            const vk = regKind.get(v);
            if (vk === 'i32') {
              regKind.set(d, 'i32');
              emit(OP.neg_i32, { dst: d, a: v, start: anc.start, end: anc.end });
            } else {
              regKind.set(d, vk === 'f64' ? 'f64' : 'dyn');
              emit(OP.neg_dyn, { dst: d, a: v, start: anc.start, end: anc.end });
            }
          } else if (p.operator === '!') {
            emit(OP.bool_not, { dst: d, a: v, start: anc.start, end: anc.end });
          } else if (p.operator === '~') {
            regKind.set(d, 'i32');
            emit(OP.bit_not, { dst: d, a: v, start: anc.start, end: anc.end });
          } else {
            emit(OP.mov, { dst: d, a: v, start: anc.start, end: anc.end });
          }
        } else if (n === 'tsfg_program.strict_equal') {
          emit(OP.strict_eq, {
            dst: allocReg(op.result),
            a: allocReg(op.operands[0]),
            b: allocReg(op.operands[1]),
            imm32: p.operator === '!==' ? 1 : 0,
            start: anc.start,
            end: anc.end,
          });
        } else if (n === 'tsfg_program.receiver_create') {
          // 2-field receiver frame: field 0 = newTarget numeric type_id, field 1 = bound object ref
          const frameReg = allocReg(op.result);
          const tidVal = mod.classNumId.get(p.new_target ?? p.owner) ?? 100;
          const tidReg = nextReg++;
          emit(OP.new_obj, { dst: frameReg, a: 2, b: 0, imm32: 999, start: anc.start, end: anc.end });
          emit(OP.const_i32, { dst: tidReg, imm32: tidVal, start: anc.start, end: anc.end });
          emit(OP.field_set, { a: frameReg, b: 0, dst: tidReg, imm32: (nextCacheSlot++) % 64, start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.receiver_child') {
          emit(OP.mov, { dst: allocReg(op.result), a: allocReg(op.operands[0]), start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.receiver_allocate') {
          const frameReg = allocReg(op.operands[0]);
          const tidReg = nextReg++;
          const objReg = allocReg(op.result);
          emit(OP.field_get, { dst: tidReg, a: frameReg, b: 0, imm32: (nextCacheSlot++) % 64, start: anc.start, end: anc.end });
          emit(OP.new_obj_dyn, { dst: objReg, a: maxClassFields, imm32: tidReg, start: anc.start, end: anc.end });
          emit(OP.mark_uninit, { a: objReg, start: anc.start, end: anc.end });
          emit(OP.field_set, { a: frameReg, b: 1, dst: objReg, imm32: (nextCacheSlot++) % 64, start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.receiver_bind') {
          const frameReg = allocReg(op.operands[0]);
          const objReg = allocReg(op.operands[1]);
          emit(OP.field_set, { a: frameReg, b: 1, dst: objReg, imm32: (nextCacheSlot++) % 64, start: anc.start, end: anc.end });
          emitPhiMoves(op.successors[0], [objReg], anc);
          const brIdx = emit(OP.br, { imm32: 0, start: anc.start, end: anc.end });
          fixups.push({ opIdx: brIdx, targetLabel: op.successors[0] });
        } else if (n === 'tsfg_program.initialize_begin') {
          emit(OP.mov, { dst: allocReg(op.result), a: allocReg(op.operands[1]), start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.initialize_field') {
          const tokReg = allocReg(op.operands[0]);
          const objReg = allocReg(op.operands[1]);
          const valReg = allocReg(op.operands[2]);
          const fMeta = mod.fieldsById.get(p.field);
          if (!fMeta) throw new Error(`r05-lower: unknown field ${p.field}`);
          emit(OP.field_set, { a: objReg, b: fMeta.fieldIndex, dst: valReg, imm32: (nextCacheSlot++) % 64, start: anc.start, end: anc.end });
          if (op.result) emit(OP.mov, { dst: allocReg(op.result), a: tokReg, start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.initialize_end') {
          emit(OP.mark_init, { a: allocReg(op.operands[1]), start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.receiver_result') {
          const frameReg = allocReg(op.operands[0]);
          const objReg = nextReg++;
          emit(OP.field_get, { dst: objReg, a: frameReg, b: 1, imm32: (nextCacheSlot++) % 64, start: anc.start, end: anc.end });
          emit(OP.mark_init, { a: objReg, start: anc.start, end: anc.end });
          emitPhiMoves(op.successors[0], [objReg], anc);
          const brIdx = emit(OP.br, { imm32: 0, start: anc.start, end: anc.end });
          fixups.push({ opIdx: brIdx, targetLabel: op.successors[0] });
        } else if (n === 'tsfg_program.receiver_get') {
          const frameReg = allocReg(op.operands[0]);
          const dst = allocReg(op.result);
          emit(OP.field_get, { dst, a: frameReg, b: 1, imm32: (nextCacheSlot++) % 64, start: anc.start, end: anc.end });
          emit(OP.assert_non_null, { dst, a: dst, start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.construct_value' || n === 'tsfg_program.allocate_reference') {
          const dst = allocReg(op.result);
          const fieldCount = Math.max(1, mod.classFieldMap.get(p.type)?.size ?? op.operands.length);
          const tid = mod.classNumId.get(p.type) ?? 100;
          emit(OP.new_obj, { dst, a: fieldCount, b: 0, imm32: tid, start: anc.start, end: anc.end });
          for (let fi = 0; fi < op.operands.length; fi++) {
            emit(OP.field_set, { a: dst, b: fi, dst: allocReg(op.operands[fi]), imm32: (nextCacheSlot++) % 64, start: anc.start, end: anc.end });
          }
          if (n === 'tsfg_program.allocate_reference') {
            emit(OP.mark_uninit, { a: dst, start: anc.start, end: anc.end });
          }
        } else if (n === 'tsfg_program.field_load') {
          const objReg = allocReg(op.operands[0]);
          const fMeta = mod.fieldsById.get(p.field);
          if (!fMeta) throw new Error(`r05-lower: unknown field_load ${p.field}`);
          const dst = allocReg(op.result);
          regKind.set(dst, 'dyn');
          emit(OP.check_init, { a: objReg, start: anc.start, end: anc.end });
          emit(OP.field_get, { dst, a: objReg, b: fMeta.fieldIndex, imm32: (nextCacheSlot++) % 64, start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.field_store') {
          const objReg = allocReg(op.operands[0]);
          const valReg = allocReg(op.operands[1]);
          const fMeta = mod.fieldsById.get(p.field);
          if (!fMeta) throw new Error(`r05-lower: unknown field_store ${p.field}`);
          if (!p.initialize) emit(OP.check_init, { a: objReg, start: anc.start, end: anc.end });
          emit(OP.field_set, { a: objReg, b: fMeta.fieldIndex, dst: valReg, imm32: (nextCacheSlot++) % 64, start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.env_alloc') {
          // Closure environment object: field 0 = parent env ref, fields 1..slotCount = captured vars
          const envMeta = mod.envsById.get(p.layout);
          const slotCount = Math.max(1, envMeta?.slotCount ?? 4);
          const dst = allocReg(op.result);
          emit(OP.new_obj, { dst, a: 1 + slotCount, b: 0, imm32: 900, start: anc.start, end: anc.end });
          if (op.operands.length > 0) {
            emit(OP.field_set, { a: dst, b: 0, dst: allocReg(op.operands[0]), imm32: (nextCacheSlot++) % 64, start: anc.start, end: anc.end });
          }
        } else if (n === 'tsfg_program.env_parent') {
          const dst = allocReg(op.result);
          emit(OP.field_get, { dst, a: allocReg(op.operands[0]), b: 0, imm32: (nextCacheSlot++) % 64, start: anc.start, end: anc.end });
          emit(OP.assert_non_null, { dst, a: dst, start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.env_init' || n === 'tsfg_program.env_store') {
          const envMeta = mod.envsById.get(p.layout);
          const slotIdx = envMeta?.slotMap.get(p.binding) ?? envMeta?.slotMap.get(p.key) ?? 0;
          emit(OP.field_set, {
            a: allocReg(op.operands[0]),
            b: 1 + slotIdx,
            dst: allocReg(op.operands[1]),
            imm32: (nextCacheSlot++) % 64,
            start: anc.start,
            end: anc.end,
          });
        } else if (n === 'tsfg_program.env_load') {
          const envMeta = mod.envsById.get(p.layout);
          const slotIdx = envMeta?.slotMap.get(p.binding) ?? envMeta?.slotMap.get(p.key) ?? 0;
          const dst = allocReg(op.result);
          regKind.set(dst, 'dyn');
          emit(OP.field_get, {
            dst,
            a: allocReg(op.operands[0]),
            b: 1 + slotIdx,
            imm32: (nextCacheSlot++) % 64,
            start: anc.start,
            end: anc.end,
          });
        } else if (n === 'tsfg_program.make_closure') {
          const targetFnId = p.function_id ?? p.function;
          const calleeIdx = fnIdxById.get(targetFnId);
          if (calleeIdx === undefined) throw new Error(`r05-lower: unknown closure target ${targetFnId}`);
          const envReg = op.operands.length > 0 ? allocReg(op.operands[0]) : 0xffff;
          emit(OP.make_closure, { dst: allocReg(op.result), a: envReg, imm32: calleeIdx, start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.array_create') {
          const base = nextReg;
          for (const r of op.operands) {
            emit(OP.mov, { dst: nextReg++, a: allocReg(r), start: anc.start, end: anc.end });
          }
          emit(OP.array_new, { dst: allocReg(op.result), a: base, b: op.operands.length, start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.array_length' || n === 'tsfg_program.readspan_length') {
          const dst = allocReg(op.result);
          regKind.set(dst, 'i32');
          emit(OP.array_len, { dst, a: allocReg(op.operands[0]), start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.array_resize') {
          const fillReg = op.operands.length > 2 ? allocReg(op.operands[2]) : 0xffff;
          emit(OP.array_resize, {
            a: allocReg(op.operands[0]),
            b: allocReg(op.operands[1]),
            dst: fillReg,
            start: anc.start,
            end: anc.end,
          });
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
          const dst = allocReg(op.result);
          regKind.set(dst, 'dyn');
          emit(OP.array_get, { dst, a: allocReg(op.operands[0]), b: allocReg(op.operands[1]), start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.array_store') {
          emit(OP.array_set, { a: allocReg(op.operands[0]), b: allocReg(op.operands[1]), dst: allocReg(op.operands[2]), start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.catch_bind') {
          const cr = getCellReg(p.binding ?? op.result);
          emit(OP.mov, { dst: cr, a: allocReg(op.operands[0]), start: anc.start, end: anc.end });
          if (op.result) regMap.set(op.result, cr);
        } else if (n === 'tsfg_program.return_throw') {
          emit(OP.throw_exc, { a: allocReg(op.operands[0]), start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.unreachable') {
          emit(OP.unreachable_trap, { start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.invoke' || n === 'tsfg_program.invoke_method' || n === 'tsfg_program.invoke_indirect') {
          const resReg = nextReg++;
          const callPcs = [];

          if (n === 'tsfg_program.invoke') {
            const calleeIdx = fnIdxById.get(p.function_id);
            if (calleeIdx === undefined) throw new Error(`r05-lower: missing invoke target ${p.function_id}`);
            const argBase = nextReg;
            for (const r of op.operands) emit(OP.mov, { dst: nextReg++, a: allocReg(r), start: anc.start, end: anc.end });
            callPcs.push(emit(OP.call_direct, { dst: resReg, a: argBase, b: op.operands.length, imm32: calleeIdx, start: anc.start, end: anc.end }));
          } else if (n === 'tsfg_program.invoke_indirect') {
            const clBase = nextReg++;
            emit(OP.mov, { dst: clBase, a: allocReg(op.operands[0]), start: anc.start, end: anc.end });
            const argCount = op.operands.length - 1;
            for (let ai = 1; ai < op.operands.length; ai++) {
              emit(OP.mov, { dst: nextReg++, a: allocReg(op.operands[ai]), start: anc.start, end: anc.end });
            }
            callPcs.push(emit(OP.call_indirect, { dst: resReg, a: clBase, b: argCount, start: anc.start, end: anc.end }));
          } else {
            // `tsfg_program.invoke_method`: virtual dispatch by runtime receiver `type_id`
            const argBase = nextReg;
            for (const r of op.operands) emit(OP.mov, { dst: nextReg++, a: allocReg(r), start: anc.start, end: anc.end });
            const dispatchEntries = p.dispatch ?? [];
            const fallbackIdx = fnIdxById.get(p.function_id);
            if (dispatchEntries.length <= 1) {
              const targetIdx = dispatchEntries.length === 1 ? fnIdxById.get(dispatchEntries[0].target) : fallbackIdx;
              if (targetIdx === undefined) throw new Error(`r05-lower: missing method target ${p.function_id}`);
              callPcs.push(emit(OP.call_method, { dst: resReg, a: argBase, b: op.operands.length, imm32: targetIdx, start: anc.start, end: anc.end }));
            } else {
              const tidReg = nextReg++;
              const expReg = nextReg++;
              const eqReg = nextReg++;
              emit(OP.get_type_id, { dst: tidReg, a: argBase, start: anc.start, end: anc.end });
              const doneJumps = [];
              for (const d of dispatchEntries) {
                const wantTid = mod.classNumId.get(d.receiver_type) ?? 100;
                const tIdx = fnIdxById.get(d.target);
                if (tIdx === undefined) continue;
                emit(OP.const_i32, { dst: expReg, imm32: wantTid, start: anc.start, end: anc.end });
                emit(OP.strict_eq, { dst: eqReg, a: tidReg, b: expReg, imm32: 0, start: anc.start, end: anc.end });
                const brHit = emit(OP.cond_br, { a: eqReg, imm32: 0, start: anc.start, end: anc.end });
                const brNext = emit(OP.br, { imm32: 0, start: anc.start, end: anc.end });
                ops[brHit].imm32 = ops.length;
                callPcs.push(emit(OP.call_method, { dst: resReg, a: argBase, b: op.operands.length, imm32: tIdx, start: anc.start, end: anc.end }));
                doneJumps.push(emit(OP.br, { imm32: 0, start: anc.start, end: anc.end }));
                ops[brNext].imm32 = ops.length;
              }
              if (fallbackIdx !== undefined) {
                callPcs.push(emit(OP.call_method, { dst: resReg, a: argBase, b: op.operands.length, imm32: fallbackIdx, start: anc.start, end: anc.end }));
              } else {
                emit(OP.unreachable_trap, { start: anc.start, end: anc.end });
              }
              const afterDispatchPc = ops.length;
              for (const j of doneJumps) ops[j].imm32 = afterDispatchPc;
            }
          }

          const targetBlk = fn.blocks.find((b) => b.label === op.successors[0]);
          if (targetBlk && targetBlk.params.length > 0) {
            emit(OP.mov, { dst: allocReg(targetBlk.params[0].reg), a: resReg, start: anc.start, end: anc.end });
          }
          const brIdx = emit(OP.br, { imm32: 0, start: anc.start, end: anc.end });
          fixups.push({ opIdx: brIdx, targetLabel: op.successors[0] });

          // Emit exception catch/unwind trampoline INLINE right after normal branch so jumps to
          // downstream catch/finally blocks are always forward (never false backward loops)!
          if (op.successors[1]) {
            const handlerPc = ops.length;
            const excTmp = nextReg++;
            emit(OP.catch_take, { dst: excTmp, start: anc.start, end: anc.end });
            emitPhiMoves(op.successors[1], [excTmp], anc);
            const uBr = emit(OP.br, { imm32: 0, start: anc.start, end: anc.end });
            fixups.push({ opIdx: uBr, targetLabel: op.successors[1] });
            for (const cpc of callPcs) {
              handlers.push({ tryStart: cpc, tryEnd: cpc + 1, handlerPc, isFinally: false });
            }
          }
        } else if (n === 'tsfg_program.route' || n === 'cf.br') {
          emitPhiSsa(op.successors[0], op.operands, anc);
          const brIdx = emit(OP.br, { imm32: 0, start: anc.start, end: anc.end });
          fixups.push({ opIdx: brIdx, targetLabel: op.successors[0] });
        } else if (n === 'cf.cond_br') {
          const cond = allocReg(op.operands[0]);
          const segs = op.operandSegmentSizes ?? [1, 0, 0];
          const tArgs = op.operands.slice(1, 1 + segs[1]);
          const fArgs = op.operands.slice(1 + segs[1], 1 + segs[1] + segs[2]);
          const cbrIdx = emit(OP.cond_br, { a: cond, imm32: 0, start: anc.start, end: anc.end });
          emitPhiSsa(op.successors[1], fArgs, anc);
          const fBr = emit(OP.br, { imm32: 0, start: anc.start, end: anc.end });
          fixups.push({ opIdx: fBr, targetLabel: op.successors[1] });
          ops[cbrIdx].imm32 = ops.length;
          emitPhiSsa(op.successors[0], tArgs, anc);
          const tBr = emit(OP.br, { imm32: 0, start: anc.start, end: anc.end });
          fixups.push({ opIdx: tBr, targetLabel: op.successors[0] });
        } else if (n === 'func.return') {
          const rv = op.operands.length > 0 ? allocReg(op.operands[0]) : 0xffff;
          emit(OP.ret, { a: rv, start: anc.start, end: anc.end });
        } else if (n === 'tsfg_program.enter_handler' || n === 'tsfg_program.finally_enter') {
          // Structural handler markers
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
    if (!last || (last.op !== OP.ret && last.op !== OP.br && last.op !== OP.throw_exc && last.op !== OP.unreachable_trap)) {
      emit(OP.ret, { a: 0xffff, start: 0, end: 1 });
    }

    compiledFns.push({
      functionId: sha256Raw(fn.functionId),
      name: fn.name,
      ops,
      handlers,
      paramCount,
      regCount: Math.max(1, nextReg),
    });
  }

  // Serialize to TSFGR05B binary wire format (v1 if no string pool, v2 if string pool non-empty)
  const wireVer = strPool.length > 0 ? 2 : 1;
  const moduleId = sha256Raw(opts.moduleId ?? 'tsfg.r05.module');
  const abiHash = sha256Raw(opts.abiHash ?? 'tsfg.r05.win64_c');
  const staticSchemaHash = sha256Raw(opts.staticSchemaHash ?? 'tsfg.r05.schema.v1');

  const payloadChunks = [moduleId, abiHash, staticSchemaHash];
  writeU64(payloadChunks, opts.codeVersion ?? 1);
  writeU16(payloadChunks, mod.globalsById.size);
  writeU16(payloadChunks, 0); // required capabilities
  writeU16(payloadChunks, f64Pool.length);
  for (const bits of f64Pool) writeU64(payloadChunks, bits);
  if (wireVer === 2) {
    writeU16(payloadChunks, strPool.length);
    for (const units of strPool) {
      writeU32(payloadChunks, units.length);
      for (const cu of units) writeU16(payloadChunks, cu);
    }
  }
  writeU16(payloadChunks, compiledFns.length);

  for (const f of compiledFns) {
    payloadChunks.push(f.functionId);
    writeU16(payloadChunks, f.paramCount);
    writeU16(payloadChunks, f.regCount);
    writeU64(payloadChunks, 0n); // ref_reg_mask
    writeU16(payloadChunks, f.handlers.length);
    for (const h of f.handlers) {
      writeU32(payloadChunks, h.tryStart);
      writeU32(payloadChunks, h.tryEnd);
      writeU32(payloadChunks, h.handlerPc);
      writeU8(payloadChunks, h.isFinally ? 1 : 0);
    }
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
  writeU32(headerChunks, wireVer);
  writeU32(headerChunks, 48 + payload.length);
  headerChunks.push(digest);
  const bytes = Buffer.concat([...headerChunks, payload]);

  const exportsByName = new Map();
  for (const [name, fid] of mod.exportsByName.entries()) {
    exportsByName.set(name, fnIdxById.get(fid));
  }
  return { abiHash, bytes, exportsByName, initFnIndex, functions: compiledFns };
}
