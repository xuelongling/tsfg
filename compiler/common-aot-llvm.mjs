// SPDX-License-Identifier: MIT
// Production Common20 Core IR -> Windows x86-64 LLVM IR compiler.
// Lowers canonicalized or optimized `tsfg-core-ir.exe --common-program` MLIR
// directly to native LLVM IR linking against `runtime/common-execution-engine.zig`
// (`tsfg_common_engine.lib`, backed by `ManagedHeap` moving GC).
import { parseCommonCoreMlir } from './common-mlir-parser.mjs';

const LLVM_HEADER = `target datalayout = "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-pc-windows-msvc"

declare i32 @tsfg_eng_fuel(ptr)
declare i32 @tsfg_eng_enter(ptr)
declare void @tsfg_eng_exit(ptr)
declare i32 @tsfg_eng_trap(ptr)
declare void @tsfg_eng_set_trap(ptr, i32)
declare i32 @tsfg_eng_reg_class(ptr, i64, i64, i16, i16, i32, i32)
declare i64 @tsfg_eng_alloc_obj(ptr, i64)
declare void @tsfg_eng_mark_init(ptr, i64)
declare i64 @tsfg_eng_clone_obj(ptr, i64)
declare i64 @tsfg_eng_obj_type_id(ptr, i64)
declare void @tsfg_eng_obj_set_scalar(ptr, i64, i32, i64, i32)
declare i64 @tsfg_eng_obj_get_scalar(ptr, i64, i32)
declare void @tsfg_eng_obj_set_field(ptr, i64, i32, i16, i64, i32)
declare i16 @tsfg_eng_obj_get_field_tag(ptr, i64, i32)
declare i64 @tsfg_eng_obj_get_field_payload(ptr, i64, i32)
declare void @tsfg_eng_global_set(ptr, i32, i16, i64)
declare i16 @tsfg_eng_global_get_tag(ptr, i32)
declare i64 @tsfg_eng_global_get_payload(ptr, i32)
declare i64 @tsfg_eng_gc(ptr)
declare i64 @tsfg_eng_env_alloc(ptr, i64, i32)
declare i64 @tsfg_eng_env_parent(ptr, i64)
declare void @tsfg_eng_env_init_admitted(ptr, i64, i32, i16, i64)
declare void @tsfg_eng_env_store_admitted(ptr, i64, i32, i16, i64)
declare i16 @tsfg_eng_env_load_tag(ptr, i64, i32)
declare i64 @tsfg_eng_env_load_payload(ptr, i64, i32)
declare i64 @tsfg_eng_closure_make(ptr, i32, i64)
declare i32 @tsfg_eng_closure_fn(ptr, i64)
declare i64 @tsfg_eng_closure_env(ptr, i64)
declare i32 @tsfg_eng_union_eq(ptr, i16, i64, i16, i64)
declare void @tsfg_eng_throw(ptr, i16, i64)
declare i32 @tsfg_eng_has_exc(ptr)
declare i16 @tsfg_eng_take_exc_tag(ptr)
declare i64 @tsfg_eng_take_exc_payload(ptr)
declare i64 @tsfg_eng_arr_create(ptr, i32)
declare i32 @tsfg_eng_arr_len(ptr, i64)
declare i32 @tsfg_eng_recv_len(ptr, i16, i64)
declare i32 @tsfg_eng_arr_push(ptr, i64, i16, i64)
declare void @tsfg_eng_arr_set(ptr, i64, i32, i16, i64)
declare void @tsfg_eng_arr_resize(ptr, i64, i32, i16, i64)
declare i64 @tsfg_eng_span_begin(ptr, i64, i32, i32, i32)
declare void @tsfg_eng_span_release(ptr, i64)
declare i16 @tsfg_eng_read_elem_tag(ptr, i16, i64, i32)
declare i64 @tsfg_eng_read_elem_payload(ptr, i16, i64, i32)
declare i64 @tsfg_eng_str_from_u16(ptr, ptr, i32)
declare i32 @tsfg_eng_str_len(ptr, i64)
declare i64 @tsfg_eng_str_concat(ptr, i64, i64)
declare i64 @tsfg_eng_str_slice(ptr, i64, i32, i32)
declare i32 @tsfg_eng_str_char_code_at(ptr, i64, i32)
`;

const sanitizeSym = (s) => 'aot_cmn_' + s.replace(/[^a-zA-Z0-9_]/g, '_');
const regSlot = (r) => r.slice(1).replace(/[^a-zA-Z0-9_]/g, '_');

/**
 * Compile a canonicalized or optimized Common20 Core MLIR module into Windows x86-64 LLVM IR.
 * Returns `{ llvmIr, mod, initSym, exports }`.
 */
export function lowerCommonCoreToLlvm(mlirText) {
  const mod = typeof mlirText === 'string' ? parseCommonCoreMlir(mlirText) : mlirText;
  const fnLines = [];
  const strGlobals = [];
  const strGlobalByKey = new Map();
  const internUtf16Global = (units) => {
    const key = units.join(',');
    if (strGlobalByKey.has(key)) return strGlobalByKey.get(key);
    const sym = `@.tsfg_u16_${strGlobals.length}`;
    if (units.length > 0) {
      const elems = units.map((u) => `i16 ${u & 0xffff}`).join(', ');
      strGlobals.push(`${sym} = private unnamed_addr constant [${units.length} x i16] [${elems}], align 2`);
    }
    const entry = { sym, len: units.length };
    strGlobalByKey.set(key, entry);
    return entry;
  };

  // Map every functionId -> { sym, index, paramCount, expectsEnv, fn }
  const fnInfoById = new Map();
  for (const fn of mod.functions) {
    const sym = sanitizeSym(fn.symName);
    const expectsEnv = fn.paramTypes.length > 0 && fn.paramTypes[0].includes('env:');
    fnInfoById.set(fn.functionId, { sym, index: fn.index, paramCount: fn.paramTypes.length, expectsEnv, fn });
  }

  // Emit class registration + topological module initialization function `@aot_cmn_bootstrap(ptr %e)`
  const bootLines = ['define void @aot_cmn_bootstrap(ptr %e) {', 'entry:'];
  // Reserved class id 1: receiver frame { scalar[0] = new_target_type_id, scalar[1] = allocated_obj_id }
  bootLines.push('  %_rc0 = call i32 @tsfg_eng_reg_class(ptr %e, i64 1, i64 0, i16 2, i16 0, i32 0, i32 0)');
  let rcIdx = 1;
  for (const [typeId, cls] of mod.classesById.entries()) {
    const numId = mod.classNumId.get(typeId);
    const parentNum = cls.base && mod.classNumId.has(cls.base) ? mod.classNumId.get(cls.base) : 0;
    const fMap = mod.classFieldMap.get(typeId);
    const nFields = Math.max(1, fMap ? fMap.size : 0);
    bootLines.push(`  %_rc${rcIdx++} = call i32 @tsfg_eng_reg_class(ptr %e, i64 ${numId}, i64 ${parentNum}, i16 ${nFields}, i16 ${nFields}, i32 0, i32 0)`);
  }
  const initFns = mod.functions.filter((f) => f.role === 'module-initializer' || f.role === 'module-initialization');
  const initOrder = [];
  if (mod.hir?.modules) {
    const byPath = new Map(initFns.map((f) => [f.sourcePath, f]));
    const modByPath = new Map(mod.hir.modules.map((m) => [m.sourcePath, m]));
    const visited = new Set();
    const visit = (p) => {
      if (visited.has(p)) return;
      visited.add(p);
      for (const imp of modByPath.get(p)?.imports ?? []) if (imp.sourcePath) visit(imp.sourcePath);
      const f = byPath.get(p);
      if (f) initOrder.push(f);
    };
    for (const f of initFns) visit(f.sourcePath);
  } else {
    initOrder.push(...initFns);
  }
  bootLines.push('  %bt = alloca i16');
  bootLines.push('  %bp = alloca i64');
  for (const [idx, f] of initOrder.entries()) {
    const info = fnInfoById.get(f.functionId);
    bootLines.push(`  call void @${info.sym}(ptr %e, ptr %bt, ptr %bp)`);
    bootLines.push(`  %btr${idx} = call i32 @tsfg_eng_trap(ptr %e)`);
    bootLines.push(`  %bex${idx} = call i32 @tsfg_eng_has_exc(ptr %e)`);
    bootLines.push(`  %bbad${idx} = or i32 %btr${idx}, %bex${idx}`);
    bootLines.push(`  %bstop${idx} = icmp ne i32 %bbad${idx}, 0`);
    bootLines.push(`  br i1 %bstop${idx}, label %boot_abort, label %boot_next_${idx}`);
    bootLines.push(`boot_next_${idx}:`);
  }
  bootLines.push('  ret void');
  bootLines.push('boot_abort:');
  bootLines.push('  ret void');
  bootLines.push('}');
  fnLines.push(bootLines.join('\n'));

  // Compile each Common20 function
  for (const fn of mod.functions) {
    const info = fnInfoById.get(fn.functionId);
    const paramDecls = ['ptr %e', 'ptr %out_tag', 'ptr %out_pay'];
    for (let pi = 0; pi < fn.blocks[0].params.length; pi++) {
      paramDecls.push(`i16 %p${pi}_tag`, `i64 %p${pi}_pay`);
    }

    const lines = [`define void @${info.sym}(${paramDecls.join(', ')}) {`];
    lines.push('alloc_entry:');

    // Collect every SSA register & local cell in this function
    const allRegs = new Set();
    const allCells = new Set();
    for (const blk of fn.blocks) {
      for (const bp of blk.params) allRegs.add(bp.reg);
      for (const op of blk.ops) {
        if (op.result) allRegs.add(op.result);
        if (op.name === 'tsfg_program.cell' || op.name === 'tsfg_program.catch_bind') {
          allCells.add(op.properties.binding ?? op.result);
        }
        if ((op.name === 'tsfg_program.store' || op.name === 'tsfg_program.load') && op.properties.binding) {
          allCells.add(op.properties.binding);
        }
      }
    }

    // Allocate stack slots for SSA registers and local cells (LLVM /O2 promotes to registers)
    for (const r of allRegs) {
      const s = regSlot(r);
      lines.push(`  %rt_${s} = alloca i16`);
      lines.push(`  %rp_${s} = alloca i64`);
      lines.push(`  store i16 0, ptr %rt_${s}`);
      lines.push(`  store i64 0, ptr %rp_${s}`);
    }
    const cellIdxMap = new Map();
    let ci = 0;
    for (const cid of allCells) {
      cellIdxMap.set(cid, ci);
      lines.push(`  %ct_${ci} = alloca i16`);
      lines.push(`  %cp_${ci} = alloca i64`);
      lines.push(`  store i16 0, ptr %ct_${ci}`);
      lines.push(`  store i64 0, ptr %cp_${ci}`);
      ci++;
    }
    lines.push('  %call_ot = alloca i16');
    lines.push('  %call_op = alloca i64');
    lines.push('  store i16 0, ptr %out_tag');
    lines.push('  store i64 0, ptr %out_pay');

    // Store entry parameters into their SSA slots and check call depth
    for (let pi = 0; pi < fn.blocks[0].params.length; pi++) {
      const s = regSlot(fn.blocks[0].params[pi].reg);
      lines.push(`  store i16 %p${pi}_tag, ptr %rt_${s}`);
      lines.push(`  store i64 %p${pi}_pay, ptr %rp_${s}`);
    }
    lines.push('  %ent_ok = call i32 @tsfg_eng_enter(ptr %e)');
    lines.push('  %ent_bad = icmp eq i32 %ent_ok, 0');
    lines.push(`  br i1 %ent_bad, label %fn_trap_noexit, label %${fn.blocks[0].label}`);

    const blockMap = new Map(fn.blocks.map((b) => [b.label, b]));
    const localSpanRegs = new Set();
    let tmpN = 0;
    const t = () => `%_v${tmpN++}`;
    const lbl = (prefix) => `${prefix}_${tmpN++}`;

    const emitTrapGuard = () => {
      const tr = t(), bad = t(), cont = lbl('ok');
      lines.push(`  ${tr} = call i32 @tsfg_eng_trap(ptr %e)`);
      lines.push(`  ${bad} = icmp ne i32 ${tr}, 0`);
      lines.push(`  br i1 ${bad}, label %fn_abort, label %${cont}`);
      lines.push(`${cont}:`);
    };

    const loadReg = (r) => {
      const s = regSlot(r);
      const tv = t(), pv = t();
      lines.push(`  ${tv} = load i16, ptr %rt_${s}`);
      lines.push(`  ${pv} = load i64, ptr %rp_${s}`);
      return { tag: tv, pay: pv };
    };

    const storeReg = (r, tagVal, payVal) => {
      if (!r) return;
      const s = regSlot(r);
      lines.push(`  store i16 ${tagVal}, ptr %rt_${s}`);
      lines.push(`  store i64 ${payVal}, ptr %rp_${s}`);
    };

    const emitBranchWithArgs = (targetLabel, argPairs) => {
      const target = blockMap.get(targetLabel);
      for (let i = 0; i < Math.min(target.params.length, argPairs.length); i++) {
        storeReg(target.params[i].reg, argPairs[i].tag, argPairs[i].pay);
      }
      lines.push(`  br label %${targetLabel}`);
    };

    for (const blk of fn.blocks) {
      lines.push(`${blk.label}:`);
      let terminated = false;

      for (const op of blk.ops) {
        const n = op.name;
        const p = op.properties;

        if (n === 'tsfg_program.fuel') {
          const ok = t(), bad = t(), cont = lbl('fuel_ok');
          lines.push(`  ${ok} = call i32 @tsfg_eng_fuel(ptr %e)`);
          lines.push(`  ${bad} = icmp eq i32 ${ok}, 0`);
          lines.push(`  br i1 ${bad}, label %fn_abort, label %${cont}`);
          lines.push(`${cont}:`);
        } else if (n === 'tsfg_program.constant') {
          const scalarName = mod.typesById.get(op.viewType)?.name ?? 'i32';
          const decStr = String(p.decimal ?? p.value ?? '0');
          if (scalarName === 'i64' || scalarName === 'isize') {
            storeReg(op.result, '10', BigInt.asUintN(64, BigInt(decStr)).toString());
          } else if (scalarName === 'u64' || scalarName === 'usize') {
            storeReg(op.result, '12', BigInt.asUintN(64, BigInt(decStr)).toString());
          } else if (scalarName === 'u32') {
            storeReg(op.result, '11', BigInt.asUintN(32, BigInt(decStr)).toString());
          } else {
            const v = Number(BigInt.asIntN(32, BigInt(decStr)));
            const u = BigInt(v >>> 0).toString();
            storeReg(op.result, '3', u);
          }
        } else if (n === 'tsfg_program.boolean') {
          storeReg(op.result, '2', p.value ? '1' : '0');
        } else if (n === 'tsfg_program.undefined') {
          storeReg(op.result, '0', '0');
        } else if (n === 'tsfg_program.null') {
          storeReg(op.result, '1', '0');
        } else if (n === 'tsfg_program.floating') {
          const bitsHex = String(p.bits ?? '0');
          const scalarName = mod.typesById.get(op.viewType)?.name ?? (bitsHex.length === 8 ? 'f32' : 'f64');
          if (scalarName === 'f32' || bitsHex.length === 8) {
            const bits32 = BigInt.asUintN(32, BigInt('0x' + bitsHex)).toString();
            storeReg(op.result, '13', bits32);
          } else {
            const bits = BigInt('0x' + bitsHex).toString();
            storeReg(op.result, '4', bits);
          }
        } else if (n === 'tsfg_program.string' || n === 'tsfg_program.string_literal') {
          const units = Array.isArray(p.codeUnits)
            ? p.codeUnits
            : (() => {
                const s = String(p.value ?? '');
                const arr = [];
                for (let si = 0; si < s.length; si++) arr.push(s.charCodeAt(si));
                return arr;
              })();
          const g = internUtf16Global(units);
          const sid = t();
          const ptrArg = g.len > 0 ? g.sym : 'null';
          lines.push(`  ${sid} = call i64 @tsfg_eng_str_from_u16(ptr %e, ptr ${ptrArg}, i32 ${g.len})`);
          emitTrapGuard();
          storeReg(op.result, '9', sid);
        } else if (n === 'tsfg_program.string_length') {
          const s = loadReg(op.operands[0]);
          const l32 = t(), l64 = t();
          lines.push(`  ${l32} = call i32 @tsfg_eng_str_len(ptr %e, i64 ${s.pay})`);
          emitTrapGuard();
          lines.push(`  ${l64} = zext i32 ${l32} to i64`);
          storeReg(op.result, '3', l64);
        } else if (n === 'tsfg_program.string_concat') {
          const sa = loadReg(op.operands[0]);
          const sb = loadReg(op.operands[1]);
          const sid = t();
          lines.push(`  ${sid} = call i64 @tsfg_eng_str_concat(ptr %e, i64 ${sa.pay}, i64 ${sb.pay})`);
          emitTrapGuard();
          storeReg(op.result, '9', sid);
        } else if (n === 'tsfg_program.string_slice') {
          const s = loadReg(op.operands[0]);
          const st = loadReg(op.operands[1]);
          const en = loadReg(op.operands[2]);
          const st32 = t(), en32 = t(), sid = t();
          lines.push(`  ${st32} = trunc i64 ${st.pay} to i32`);
          lines.push(`  ${en32} = trunc i64 ${en.pay} to i32`);
          lines.push(`  ${sid} = call i64 @tsfg_eng_str_slice(ptr %e, i64 ${s.pay}, i32 ${st32}, i32 ${en32})`);
          emitTrapGuard();
          storeReg(op.result, '9', sid);
        } else if (n === 'tsfg_program.string_char_code_at') {
          const s = loadReg(op.operands[0]);
          const idx = loadReg(op.operands[1]);
          const idx32 = t(), cc = t(), cc64 = t();
          lines.push(`  ${idx32} = trunc i64 ${idx.pay} to i32`);
          lines.push(`  ${cc} = call i32 @tsfg_eng_str_char_code_at(ptr %e, i64 ${s.pay}, i32 ${idx32})`);
          emitTrapGuard();
          lines.push(`  ${cc64} = zext i32 ${cc} to i64`);
          storeReg(op.result, '3', cc64);
        } else if (n === 'tsfg_program.cell') {
          const cIdx = cellIdxMap.get(p.binding ?? op.result);
          storeReg(op.result, '5', String(cIdx));
        } else if (n === 'tsfg_program.store') {
          const cIdx = cellIdxMap.get(p.binding ?? op.operands[0]);
          const v = loadReg(op.operands[1]);
          lines.push(`  store i16 ${v.tag}, ptr %ct_${cIdx}`);
          lines.push(`  store i64 ${v.pay}, ptr %cp_${cIdx}`);
        } else if (n === 'tsfg_program.load') {
          const cIdx = cellIdxMap.get(p.binding ?? op.operands[0]);
          const tv = t(), pv = t();
          lines.push(`  ${tv} = load i16, ptr %ct_${cIdx}`);
          lines.push(`  ${pv} = load i64, ptr %cp_${cIdx}`);
          storeReg(op.result, tv, pv);
        } else if (n === 'tsfg_program.global_store') {
          const g = mod.globalsById.get(p.global);
          const v = loadReg(op.operands[0]);
          lines.push(`  call void @tsfg_eng_global_set(ptr %e, i32 ${g.index}, i16 ${v.tag}, i64 ${v.pay})`);
        } else if (n === 'tsfg_program.global_load') {
          const g = mod.globalsById.get(p.global);
          const tv = t(), pv = t();
          lines.push(`  ${tv} = call i16 @tsfg_eng_global_get_tag(ptr %e, i32 ${g.index})`);
          lines.push(`  ${pv} = call i64 @tsfg_eng_global_get_payload(ptr %e, i32 ${g.index})`);
          emitTrapGuard();
          storeReg(op.result, tv, pv);
        } else if (n === 'tsfg_program.numeric_use') {
          const v = loadReg(op.operands[0]);
          const isI32 = t(), isF64 = t(), isI64 = t(), isU32 = t(), isU64 = t(), isF32 = t();
          const m1 = t(), m2 = t(), m3 = t(), m4 = t(), isNum = t(), badL = lbl('num_bad'), okL = lbl('num_ok');
          lines.push(`  ${isI32} = icmp eq i16 ${v.tag}, 3`);
          lines.push(`  ${isF64} = icmp eq i16 ${v.tag}, 4`);
          lines.push(`  ${isI64} = icmp eq i16 ${v.tag}, 10`);
          lines.push(`  ${isU32} = icmp eq i16 ${v.tag}, 11`);
          lines.push(`  ${isU64} = icmp eq i16 ${v.tag}, 12`);
          lines.push(`  ${isF32} = icmp eq i16 ${v.tag}, 13`);
          lines.push(`  ${m1} = or i1 ${isI32}, ${isF64}`);
          lines.push(`  ${m2} = or i1 ${isI64}, ${isU32}`);
          lines.push(`  ${m3} = or i1 ${isU64}, ${isF32}`);
          lines.push(`  ${m4} = or i1 ${m1}, ${m2}`);
          lines.push(`  ${isNum} = or i1 ${m4}, ${m3}`);
          lines.push(`  br i1 ${isNum}, label %${okL}, label %${badL}`);
          lines.push(`${badL}:`);
          lines.push('  call void @tsfg_eng_set_trap(ptr %e, i32 9)');
          lines.push('  br label %fn_abort');
          lines.push(`${okL}:`);
          emitBranchWithArgs(op.successors[0], [v]);
          terminated = true;
        } else if (n === 'tsfg_program.binary') {
          const l = loadReg(op.operands[0]);
          const r = loadReg(op.operands[1]);
          const oper = p.operator;
          if (oper === '===' || oper === '==' || oper === '!==' || oper === '!=') {
            const eq = t(), b = t(), p64 = t();
            lines.push(`  ${eq} = call i32 @tsfg_eng_union_eq(ptr %e, i16 ${l.tag}, i64 ${l.pay}, i16 ${r.tag}, i64 ${r.pay})`);
            lines.push(`  ${b} = icmp ${oper.startsWith('!') ? 'eq' : 'ne'} i32 ${eq}, 0`);
            lines.push(`  ${p64} = zext i1 ${b} to i64`);
            storeReg(op.result, '2', p64);
          } else {
            const binDone = lbl('bin_done');
            const f64Supported = oper === '+' || oper === '-' || oper === '*' || oper === '/' || oper === '<' || oper === '<=' || oper === '>' || oper === '>=';
            const u32Supported = oper === '/' || oper === '%' || oper === '<' || oper === '<=' || oper === '>' || oper === '>=';
            const i64Supported = f64Supported || oper === '%';

            if (oper === '+') {
              const isStr = t(), strL = lbl('bin_str'), notStrL = lbl('bin_nstr');
              lines.push(`  ${isStr} = icmp eq i16 ${l.tag}, 9`);
              lines.push(`  br i1 ${isStr}, label %${strL}, label %${notStrL}`);
              lines.push(`${strL}:`);
              const sRes = t();
              lines.push(`  ${sRes} = call i64 @tsfg_eng_str_concat(ptr %e, i64 ${l.pay}, i64 ${r.pay})`);
              emitTrapGuard();
              storeReg(op.result, '9', sRes);
              lines.push(`  br label %${binDone}`);
              lines.push(`${notStrL}:`);
            }

            if (f64Supported) {
              const isF64L = t(), isF64R = t(), isF64 = t();
              const f64L = lbl('bin_f64'), notF64L = lbl('bin_nf64');
              lines.push(`  ${isF64L} = icmp eq i16 ${l.tag}, 4`);
              lines.push(`  ${isF64R} = icmp eq i16 ${r.tag}, 4`);
              lines.push(`  ${isF64} = or i1 ${isF64L}, ${isF64R}`);
              lines.push(`  br i1 ${isF64}, label %${f64L}, label %${notF64L}`);
              lines.push(`${f64L}:`);
              // Convert either operand from f32/i32 if mixed with f64
              const lIsF32 = t(), lF32Tmp = t(), lF32Cast = t(), lF32Ext = t(), lF64Direct = t(), fa = t();
              const rIsF32 = t(), rF32Tmp = t(), rF32Cast = t(), rF32Ext = t(), rF64Direct = t(), fb = t();
              lines.push(`  ${lIsF32} = icmp eq i16 ${l.tag}, 13`);
              lines.push(`  ${lF32Tmp} = trunc i64 ${l.pay} to i32`);
              lines.push(`  ${lF32Cast} = bitcast i32 ${lF32Tmp} to float`);
              lines.push(`  ${lF32Ext} = fpext float ${lF32Cast} to double`);
              lines.push(`  ${lF64Direct} = bitcast i64 ${l.pay} to double`);
              lines.push(`  ${fa} = select i1 ${lIsF32}, double ${lF32Ext}, double ${lF64Direct}`);
              lines.push(`  ${rIsF32} = icmp eq i16 ${r.tag}, 13`);
              lines.push(`  ${rF32Tmp} = trunc i64 ${r.pay} to i32`);
              lines.push(`  ${rF32Cast} = bitcast i32 ${rF32Tmp} to float`);
              lines.push(`  ${rF32Ext} = fpext float ${rF32Cast} to double`);
              lines.push(`  ${rF64Direct} = bitcast i64 ${r.pay} to double`);
              lines.push(`  ${fb} = select i1 ${rIsF32}, double ${rF32Ext}, double ${rF64Direct}`);
              if (oper === '+' || oper === '-' || oper === '*' || oper === '/') {
                const fop = { '+': 'fadd', '-': 'fsub', '*': 'fmul', '/': 'fdiv' }[oper];
                const fr = t(), isNan = t(), rawBits = t(), canonBits = t();
                lines.push(`  ${fr} = ${fop} double ${fa}, ${fb}`);
                lines.push(`  ${isNan} = fcmp uno double ${fr}, ${fr}`);
                lines.push(`  ${rawBits} = bitcast double ${fr} to i64`);
                lines.push(`  ${canonBits} = select i1 ${isNan}, i64 9221120237041090560, i64 ${rawBits}`);
                storeReg(op.result, '4', canonBits);
              } else {
                const fpred = { '<': 'olt', '<=': 'ole', '>': 'ogt', '>=': 'oge' }[oper];
                const fc = t(), fp64 = t();
                lines.push(`  ${fc} = fcmp ${fpred} double ${fa}, ${fb}`);
                lines.push(`  ${fp64} = zext i1 ${fc} to i64`);
                storeReg(op.result, '2', fp64);
              }
              lines.push(`  br label %${binDone}`);
              lines.push(`${notF64L}:`);

              const isF32L = t(), isF32R = t(), isF32 = t();
              const f32L = lbl('bin_f32'), notF32L = lbl('bin_nf32');
              lines.push(`  ${isF32L} = icmp eq i16 ${l.tag}, 13`);
              lines.push(`  ${isF32R} = icmp eq i16 ${r.tag}, 13`);
              lines.push(`  ${isF32} = or i1 ${isF32L}, ${isF32R}`);
              lines.push(`  br i1 ${isF32}, label %${f32L}, label %${notF32L}`);
              lines.push(`${f32L}:`);
              const la32 = t(), rb32 = t(), f32a = t(), f32b = t();
              lines.push(`  ${la32} = trunc i64 ${l.pay} to i32`);
              lines.push(`  ${rb32} = trunc i64 ${r.pay} to i32`);
              lines.push(`  ${f32a} = bitcast i32 ${la32} to float`);
              lines.push(`  ${f32b} = bitcast i32 ${rb32} to float`);
              if (oper === '+' || oper === '-' || oper === '*' || oper === '/') {
                const fop = { '+': 'fadd', '-': 'fsub', '*': 'fmul', '/': 'fdiv' }[oper];
                const fr = t(), isNan = t(), raw32 = t(), canon32 = t(), canon64 = t();
                lines.push(`  ${fr} = ${fop} float ${f32a}, ${f32b}`);
                lines.push(`  ${isNan} = fcmp uno float ${fr}, ${fr}`);
                lines.push(`  ${raw32} = bitcast float ${fr} to i32`);
                lines.push(`  ${canon32} = select i1 ${isNan}, i32 2143289344, i32 ${raw32}`);
                lines.push(`  ${canon64} = zext i32 ${canon32} to i64`);
                storeReg(op.result, '13', canon64);
              } else {
                const fpred = { '<': 'olt', '<=': 'ole', '>': 'ogt', '>=': 'oge' }[oper];
                const fc = t(), fp64 = t();
                lines.push(`  ${fc} = fcmp ${fpred} float ${f32a}, ${f32b}`);
                lines.push(`  ${fp64} = zext i1 ${fc} to i64`);
                storeReg(op.result, '2', fp64);
              }
              lines.push(`  br label %${binDone}`);
              lines.push(`${notF32L}:`);
            }

            if (i64Supported) {
              const isI64L = t(), isI64R = t(), isI64 = t();
              const i64L = lbl('bin_i64'), notI64L = lbl('bin_ni64');
              lines.push(`  ${isI64L} = icmp eq i16 ${l.tag}, 10`);
              lines.push(`  ${isI64R} = icmp eq i16 ${r.tag}, 10`);
              lines.push(`  ${isI64} = or i1 ${isI64L}, ${isI64R}`);
              lines.push(`  br i1 ${isI64}, label %${i64L}, label %${notI64L}`);
              lines.push(`${i64L}:`);
              if (oper === '+' || oper === '-' || oper === '*') {
                const llOp = { '+': 'add', '-': 'sub', '*': 'mul' }[oper];
                const res64 = t();
                lines.push(`  ${res64} = ${llOp} i64 ${l.pay}, ${r.pay}`);
                storeReg(op.result, '10', res64);
              } else if (oper === '/' || oper === '%') {
                const isZ = t(), badL = lbl('div64_bad'), okL = lbl('div64_ok');
                lines.push(`  ${isZ} = icmp eq i64 ${r.pay}, 0`);
                lines.push(`  br i1 ${isZ}, label %${badL}, label %${okL}`);
                lines.push(`${badL}:`);
                lines.push('  call void @tsfg_eng_set_trap(ptr %e, i32 3)');
                lines.push('  br label %fn_abort');
                lines.push(`${okL}:`);
                const res64 = t();
                lines.push(`  ${res64} = ${oper === '/' ? 'sdiv' : 'srem'} i64 ${l.pay}, ${r.pay}`);
                storeReg(op.result, '10', res64);
              } else {
                const pred = { '<': 'slt', '<=': 'sle', '>': 'sgt', '>=': 'sge' }[oper];
                const c = t(), p64 = t();
                lines.push(`  ${c} = icmp ${pred} i64 ${l.pay}, ${r.pay}`);
                lines.push(`  ${p64} = zext i1 ${c} to i64`);
                storeReg(op.result, '2', p64);
              }
              lines.push(`  br label %${binDone}`);
              lines.push(`${notI64L}:`);
            }

            if (u32Supported) {
              const isU32L = t(), isU32R = t(), isU32 = t();
              const u32L = lbl('bin_u32'), notU32L = lbl('bin_nu32');
              lines.push(`  ${isU32L} = icmp eq i16 ${l.tag}, 11`);
              lines.push(`  ${isU32R} = icmp eq i16 ${r.tag}, 11`);
              lines.push(`  ${isU32} = or i1 ${isU32L}, ${isU32R}`);
              lines.push(`  br i1 ${isU32}, label %${u32L}, label %${notU32L}`);
              lines.push(`${u32L}:`);
              const ua = t(), ub = t();
              lines.push(`  ${ua} = trunc i64 ${l.pay} to i32`);
              lines.push(`  ${ub} = trunc i64 ${r.pay} to i32`);
              if (oper === '/' || oper === '%') {
                const isZ = t(), badL = lbl('udiv_bad'), okL = lbl('udiv_ok');
                lines.push(`  ${isZ} = icmp eq i32 ${ub}, 0`);
                lines.push(`  br i1 ${isZ}, label %${badL}, label %${okL}`);
                lines.push(`${badL}:`);
                lines.push('  call void @tsfg_eng_set_trap(ptr %e, i32 3)');
                lines.push('  br label %fn_abort');
                lines.push(`${okL}:`);
                const res32 = t(), res64 = t();
                lines.push(`  ${res32} = ${oper === '/' ? 'udiv' : 'urem'} i32 ${ua}, ${ub}`);
                lines.push(`  ${res64} = zext i32 ${res32} to i64`);
                storeReg(op.result, '11', res64);
              } else {
                const pred = { '<': 'ult', '<=': 'ule', '>': 'ugt', '>=': 'uge' }[oper];
                const cmp = t(), p64 = t();
                lines.push(`  ${cmp} = icmp ${pred} i32 ${ua}, ${ub}`);
                lines.push(`  ${p64} = zext i1 ${cmp} to i64`);
                storeReg(op.result, '2', p64);
              }
              lines.push(`  br label %${binDone}`);
              lines.push(`${notU32L}:`);
            }

            const a = t(), b = t();
            lines.push(`  ${a} = trunc i64 ${l.pay} to i32`);
            lines.push(`  ${b} = trunc i64 ${r.pay} to i32`);
            if (oper === '+' || oper === '-' || oper === '*' || oper === '&' || oper === '|' || oper === '^' || oper === '<<' || oper === '>>' || oper === '>>>') {
              const res32 = t(), res64 = t();
              const llvmOp = { '+': 'add', '-': 'sub', '*': 'mul', '&': 'and', '|': 'or', '^': 'xor', '<<': 'shl', '>>': 'ashr', '>>>': 'lshr' }[oper];
              if (oper === '<<' || oper === '>>' || oper === '>>>') {
                const m = t();
                lines.push(`  ${m} = and i32 ${b}, 31`);
                lines.push(`  ${res32} = ${llvmOp} i32 ${a}, ${m}`);
              } else {
                lines.push(`  ${res32} = ${llvmOp} i32 ${a}, ${b}`);
              }
              lines.push(`  ${res64} = zext i32 ${res32} to i64`);
              storeReg(op.result, '3', res64);
            } else if (oper === '/' || oper === '%') {
              const isZ = t(), isMin = t(), isNeg1 = t(), isOv = t(), isBad = t();
              const badL = lbl('div_bad'), okL = lbl('div_ok');
              lines.push(`  ${isZ} = icmp eq i32 ${b}, 0`);
              lines.push(`  ${isMin} = icmp eq i32 ${a}, -2147483648`);
              lines.push(`  ${isNeg1} = icmp eq i32 ${b}, -1`);
              lines.push(`  ${isOv} = and i1 ${isMin}, ${isNeg1}`);
              if (oper === '/') {
                lines.push(`  ${isBad} = or i1 ${isZ}, ${isOv}`);
                lines.push(`  br i1 ${isBad}, label %${badL}, label %${okL}`);
                lines.push(`${badL}:`);
                lines.push('  call void @tsfg_eng_set_trap(ptr %e, i32 3)');
                lines.push('  br label %fn_abort');
                lines.push(`${okL}:`);
                const res32 = t(), res64 = t();
                lines.push(`  ${res32} = sdiv i32 ${a}, ${b}`);
                lines.push(`  ${res64} = zext i32 ${res32} to i64`);
                storeReg(op.result, '3', res64);
              } else {
                const remOvL = lbl('rem_ov'), remRunL = lbl('rem_run'), remDoneL = lbl('rem_done');
                lines.push(`  br i1 ${isZ}, label %${badL}, label %${okL}`);
                lines.push(`${badL}:`);
                lines.push('  call void @tsfg_eng_set_trap(ptr %e, i32 3)');
                lines.push('  br label %fn_abort');
                lines.push(`${okL}:`);
                lines.push(`  br i1 ${isOv}, label %${remOvL}, label %${remRunL}`);
                lines.push(`${remOvL}:`);
                storeReg(op.result, '3', '0');
                lines.push(`  br label %${remDoneL}`);
                lines.push(`${remRunL}:`);
                const res32 = t(), res64 = t();
                lines.push(`  ${res32} = srem i32 ${a}, ${b}`);
                lines.push(`  ${res64} = zext i32 ${res32} to i64`);
                storeReg(op.result, '3', res64);
                lines.push(`  br label %${remDoneL}`);
                lines.push(`${remDoneL}:`);
              }
            } else if (oper === '<' || oper === '<=' || oper === '>' || oper === '>=') {
              const cmp = t(), p64 = t();
              const pred = { '<': 'slt', '<=': 'sle', '>': 'sgt', '>=': 'sge' }[oper];
              lines.push(`  ${cmp} = icmp ${pred} i32 ${a}, ${b}`);
              lines.push(`  ${p64} = zext i1 ${cmp} to i64`);
              storeReg(op.result, '2', p64);
            } else {
              throw new Error(`Unsupported AOT binary op: ${oper}`);
            }
            if (f64Supported || i64Supported || u32Supported || oper === '+') {
              lines.push(`  br label %${binDone}`);
              lines.push(`${binDone}:`);
            }
          }
        } else if (n === 'tsfg_program.unary') {
          const v = loadReg(op.operands[0]);
          const oper = p.operator;
          if (oper === '-') {
            const isF = t(), fL = lbl('uneg_f'), iL = lbl('uneg_i'), dL = lbl('uneg_d');
            lines.push(`  ${isF} = icmp eq i16 ${v.tag}, 4`);
            lines.push(`  br i1 ${isF}, label %${fL}, label %${iL}`);
            lines.push(`${fL}:`);
            const fx = t(), fneg = t(), fb = t();
            lines.push(`  ${fx} = bitcast i64 ${v.pay} to double`);
            lines.push(`  ${fneg} = fneg double ${fx}`);
            lines.push(`  ${fb} = bitcast double ${fneg} to i64`);
            storeReg(op.result, '4', fb);
            lines.push(`  br label %${dL}`);
            lines.push(`${iL}:`);
            const a = t(), neg = t(), z = t();
            lines.push(`  ${a} = trunc i64 ${v.pay} to i32`);
            lines.push(`  ${neg} = sub i32 0, ${a}`);
            lines.push(`  ${z} = zext i32 ${neg} to i64`);
            storeReg(op.result, '3', z);
            lines.push(`  br label %${dL}`);
            lines.push(`${dL}:`);
          } else if (oper === '!') {
            const isZ = t(), z = t();
            lines.push(`  ${isZ} = icmp eq i64 ${v.pay}, 0`);
            lines.push(`  ${z} = zext i1 ${isZ} to i64`);
            storeReg(op.result, '2', z);
          } else if (oper === '~') {
            const a = t(), x = t(), z = t();
            lines.push(`  ${a} = trunc i64 ${v.pay} to i32`);
            lines.push(`  ${x} = xor i32 ${a}, -1`);
            lines.push(`  ${z} = zext i32 ${x} to i64`);
            storeReg(op.result, '3', z);
          } else {
            storeReg(op.result, v.tag, v.pay);
          }
        } else if (n === 'tsfg_program.strict_equal') {
          const l = loadReg(op.operands[0]);
          const r = loadReg(op.operands[1]);
          const eq = t(), b = t(), p64 = t();
          lines.push(`  ${eq} = call i32 @tsfg_eng_union_eq(ptr %e, i16 ${l.tag}, i64 ${l.pay}, i16 ${r.tag}, i64 ${r.pay})`);
          lines.push(`  ${b} = icmp ${p.operator === '!==' ? 'eq' : 'ne'} i32 ${eq}, 0`);
          lines.push(`  ${p64} = zext i1 ${b} to i64`);
          storeReg(op.result, '2', p64);
        } else if (n === 'tsfg_program.value_copy') {
          const v = loadReg(op.operands[0]);
          const ty = mod.typesById.get(p.type);
          if (ty?.kind === 'value') {
            const cloned = t();
            lines.push(`  ${cloned} = call i64 @tsfg_eng_clone_obj(ptr %e, i64 ${v.pay})`);
            emitTrapGuard();
            storeReg(op.result, '5', cloned);
          } else {
            storeReg(op.result, v.tag, v.pay);
          }
        } else if (n === 'tsfg_program.assert') {
          const v = loadReg(op.operands[0]);
          const targetTy = mod.typesById.get(op.viewType);
          if (targetTy?.kind === 'scalar' && targetTy.name === 'i32') {
            const ok = t(), badL = lbl('as_bad'), okL = lbl('as_ok');
            lines.push(`  ${ok} = icmp eq i16 ${v.tag}, 3`);
            lines.push(`  br i1 ${ok}, label %${okL}, label %${badL}`);
            lines.push(`${badL}:`);
            lines.push('  call void @tsfg_eng_set_trap(ptr %e, i32 11)');
            lines.push('  br label %fn_abort');
            lines.push(`${okL}:`);
          }
          if (p.operator === '!') {
            const isU = t(), isN = t(), isBad = t(), badL = lbl('nn_bad'), okL = lbl('nn_ok');
            lines.push(`  ${isU} = icmp eq i16 ${v.tag}, 0`);
            lines.push(`  ${isN} = icmp eq i16 ${v.tag}, 1`);
            lines.push(`  ${isBad} = or i1 ${isU}, ${isN}`);
            lines.push(`  br i1 ${isBad}, label %${badL}, label %${okL}`);
            lines.push(`${badL}:`);
            lines.push('  call void @tsfg_eng_set_trap(ptr %e, i32 11)');
            lines.push('  br label %fn_abort');
            lines.push(`${okL}:`);
          }
          storeReg(op.result, v.tag, v.pay);
        } else if (n === 'tsfg_program.carrier_cast' || n === 'tsfg_program.view' || n === 'tsfg_program.pack') {
          const v = loadReg(op.operands[0]);
          const targetTy = p.target ? mod.typesById.get(p.target) : null;
          const isNonNullView = n === 'tsfg_program.view' && targetTy && targetTy.kind !== 'union' && targetTy.kind !== 'unknown' && targetTy.kind !== 'undefined' && targetTy.kind !== 'null';
          if (isNonNullView) {
            const isU = t(), isN = t(), isBad = t(), badL = lbl('vn_bad'), okL = lbl('vn_ok');
            lines.push(`  ${isU} = icmp eq i16 ${v.tag}, 0`);
            lines.push(`  ${isN} = icmp eq i16 ${v.tag}, 1`);
            lines.push(`  ${isBad} = or i1 ${isU}, ${isN}`);
            lines.push(`  br i1 ${isBad}, label %${badL}, label %${okL}`);
            lines.push(`${badL}:`);
            lines.push('  call void @tsfg_eng_set_trap(ptr %e, i32 11)');
            lines.push('  br label %fn_abort');
            lines.push(`${okL}:`);
          }
          storeReg(op.result, v.tag, v.pay);
        } else if (n === 'tsfg_program.receiver_create') {
          const ntNum = mod.classNumId.get(p.new_target ?? p.owner);
          const fObj = t();
          lines.push(`  ${fObj} = call i64 @tsfg_eng_alloc_obj(ptr %e, i64 1)`);
          lines.push(`  call void @tsfg_eng_mark_init(ptr %e, i64 ${fObj})`);
          lines.push(`  call void @tsfg_eng_obj_set_scalar(ptr %e, i64 ${fObj}, i32 0, i64 ${ntNum}, i32 1)`);
          lines.push(`  call void @tsfg_eng_obj_set_scalar(ptr %e, i64 ${fObj}, i32 1, i64 0, i32 1)`);
          storeReg(op.result, '5', fObj);
        } else if (n === 'tsfg_program.receiver_child') {
          const v = loadReg(op.operands[0]);
          storeReg(op.result, v.tag, v.pay);
        } else if (n === 'tsfg_program.receiver_allocate') {
          const fr = loadReg(op.operands[0]);
          const nt = t(), obj = t();
          lines.push(`  ${nt} = call i64 @tsfg_eng_obj_get_scalar(ptr %e, i64 ${fr.pay}, i32 0)`);
          lines.push(`  ${obj} = call i64 @tsfg_eng_alloc_obj(ptr %e, i64 ${nt})`);
          emitTrapGuard();
          lines.push(`  call void @tsfg_eng_obj_set_scalar(ptr %e, i64 ${fr.pay}, i32 1, i64 ${obj}, i32 1)`);
          storeReg(op.result, '5', obj);
        } else if (n === 'tsfg_program.receiver_bind') {
          const fr = loadReg(op.operands[0]);
          const obj = loadReg(op.operands[1]);
          lines.push(`  call void @tsfg_eng_obj_set_scalar(ptr %e, i64 ${fr.pay}, i32 1, i64 ${obj.pay}, i32 1)`);
          emitBranchWithArgs(op.successors[0], [obj]);
          terminated = true;
        } else if (n === 'tsfg_program.initialize_begin') {
          const obj = loadReg(op.operands[1]);
          storeReg(op.result, obj.tag, obj.pay);
        } else if (n === 'tsfg_program.initialize_field') {
          const initV = loadReg(op.operands[0]);
          const obj = loadReg(op.operands[1]);
          const val = loadReg(op.operands[2]);
          const fMeta = mod.fieldsById.get(p.field);
          lines.push(`  call void @tsfg_eng_obj_set_field(ptr %e, i64 ${obj.pay}, i32 ${fMeta.fieldIndex}, i16 ${val.tag}, i64 ${val.pay}, i32 1)`);
          emitTrapGuard();
          storeReg(op.result, initV.tag, initV.pay);
        } else if (n === 'tsfg_program.initialize_end') {
          const obj = loadReg(op.operands[1]);
          lines.push(`  call void @tsfg_eng_mark_init(ptr %e, i64 ${obj.pay})`);
        } else if (n === 'tsfg_program.receiver_result') {
          const fr = loadReg(op.operands[0]);
          const obj = t();
          lines.push(`  ${obj} = call i64 @tsfg_eng_obj_get_scalar(ptr %e, i64 ${fr.pay}, i32 1)`);
          lines.push(`  call void @tsfg_eng_mark_init(ptr %e, i64 ${obj})`);
          emitBranchWithArgs(op.successors[0], [{ tag: '5', pay: obj }]);
          terminated = true;
        } else if (n === 'tsfg_program.receiver_get') {
          const fr = loadReg(op.operands[0]);
          const obj = t(), isZ = t(), badL = lbl('rg_bad'), okL = lbl('rg_ok');
          lines.push(`  ${obj} = call i64 @tsfg_eng_obj_get_scalar(ptr %e, i64 ${fr.pay}, i32 1)`);
          emitTrapGuard();
          lines.push(`  ${isZ} = icmp eq i64 ${obj}, 0`);
          lines.push(`  br i1 ${isZ}, label %${badL}, label %${okL}`);
          lines.push(`${badL}:`);
          lines.push('  call void @tsfg_eng_set_trap(ptr %e, i32 10)');
          lines.push('  br label %fn_abort');
          lines.push(`${okL}:`);
          storeReg(op.result, '5', obj);
        } else if (n === 'tsfg_program.construct_value' || n === 'tsfg_program.allocate_reference') {
          const numId = mod.classNumId.get(p.type);
          const obj = t();
          lines.push(`  ${obj} = call i64 @tsfg_eng_alloc_obj(ptr %e, i64 ${numId})`);
          emitTrapGuard();
          for (let fi = 0; fi < op.operands.length; fi++) {
            const fv = loadReg(op.operands[fi]);
            lines.push(`  call void @tsfg_eng_obj_set_field(ptr %e, i64 ${obj}, i32 ${fi}, i16 ${fv.tag}, i64 ${fv.pay}, i32 1)`);
            emitTrapGuard();
          }
          if (n === 'tsfg_program.construct_value') {
            lines.push(`  call void @tsfg_eng_mark_init(ptr %e, i64 ${obj})`);
          }
          storeReg(op.result, '5', obj);
        } else if (n === 'tsfg_program.field_load') {
          const obj = loadReg(op.operands[0]);
          const fMeta = mod.fieldsById.get(p.field);
          const tv = t(), pv = t();
          lines.push(`  ${tv} = call i16 @tsfg_eng_obj_get_field_tag(ptr %e, i64 ${obj.pay}, i32 ${fMeta.fieldIndex})`);
          lines.push(`  ${pv} = call i64 @tsfg_eng_obj_get_field_payload(ptr %e, i64 ${obj.pay}, i32 ${fMeta.fieldIndex})`);
          emitTrapGuard();
          storeReg(op.result, tv, pv);
        } else if (n === 'tsfg_program.field_store') {
          const obj = loadReg(op.operands[0]);
          const val = loadReg(op.operands[1]);
          const fMeta = mod.fieldsById.get(p.field);
          lines.push(`  call void @tsfg_eng_obj_set_field(ptr %e, i64 ${obj.pay}, i32 ${fMeta.fieldIndex}, i16 ${val.tag}, i64 ${val.pay}, i32 ${p.initialize ? 1 : 0})`);
          emitTrapGuard();
        } else if (n === 'tsfg_program.env_alloc') {
          const envMeta = mod.envsById.get(p.layout);
          const slots = Math.max(1, envMeta?.slotCount ?? 4);
          const parentPay = op.operands.length > 0 ? loadReg(op.operands[0]).pay : '0';
          const eid = t();
          lines.push(`  ${eid} = call i64 @tsfg_eng_env_alloc(ptr %e, i64 ${parentPay}, i32 ${slots})`);
          emitTrapGuard();
          storeReg(op.result, '5', eid);
        } else if (n === 'tsfg_program.env_parent') {
          const env = loadReg(op.operands[0]);
          const pid = t();
          lines.push(`  ${pid} = call i64 @tsfg_eng_env_parent(ptr %e, i64 ${env.pay})`);
          emitTrapGuard();
          storeReg(op.result, '5', pid);
        } else if (n === 'tsfg_program.env_init' || n === 'tsfg_program.env_store') {
          const env = loadReg(op.operands[0]);
          const val = loadReg(op.operands[1]);
          const envMeta = mod.envsById.get(p.layout);
          const slotIdx = envMeta?.slotMap.get(p.binding) ?? envMeta?.slotMap.get(p.key) ?? 0;
          const cFn = n === 'tsfg_program.env_init' ? '@tsfg_eng_env_init_admitted' : '@tsfg_eng_env_store_admitted';
          lines.push(`  call void ${cFn}(ptr %e, i64 ${env.pay}, i32 ${slotIdx}, i16 ${val.tag}, i64 ${val.pay})`);
          emitTrapGuard();
        } else if (n === 'tsfg_program.env_load') {
          const env = loadReg(op.operands[0]);
          const envMeta = mod.envsById.get(p.layout);
          const slotIdx = envMeta?.slotMap.get(p.binding) ?? envMeta?.slotMap.get(p.key) ?? 0;
          const tv = t(), pv = t();
          lines.push(`  ${tv} = call i16 @tsfg_eng_env_load_tag(ptr %e, i64 ${env.pay}, i32 ${slotIdx})`);
          lines.push(`  ${pv} = call i64 @tsfg_eng_env_load_payload(ptr %e, i64 ${env.pay}, i32 ${slotIdx})`);
          emitTrapGuard();
          storeReg(op.result, tv, pv);
        } else if (n === 'tsfg_program.make_closure') {
          const targetId = p.function_id ?? p.function;
          const targetInfo = fnInfoById.get(targetId);
          const envPay = op.operands.length > 0 ? loadReg(op.operands[0]).pay : '0';
          const cid = t();
          lines.push(`  ${cid} = call i64 @tsfg_eng_closure_make(ptr %e, i32 ${targetInfo.index}, i64 ${envPay})`);
          emitTrapGuard();
          storeReg(op.result, '6', cid);
        } else if (n === 'tsfg_program.array_create') {
          const arr = t();
          lines.push(`  ${arr} = call i64 @tsfg_eng_arr_create(ptr %e, i32 0)`);
          emitTrapGuard();
          for (const r of op.operands) {
            const ev = loadReg(r);
            const nl = t();
            lines.push(`  ${nl} = call i32 @tsfg_eng_arr_push(ptr %e, i64 ${arr}, i16 ${ev.tag}, i64 ${ev.pay})`);
          }
          emitTrapGuard();
          storeReg(op.result, '7', arr);
        } else if (n === 'tsfg_program.array_length' || n === 'tsfg_program.readspan_length') {
          const recv = loadReg(op.operands[0]);
          const l32 = t(), l64 = t();
          lines.push(`  ${l32} = call i32 @tsfg_eng_recv_len(ptr %e, i16 ${recv.tag}, i64 ${recv.pay})`);
          emitTrapGuard();
          lines.push(`  ${l64} = zext i32 ${l32} to i64`);
          storeReg(op.result, '3', l64);
        } else if (n === 'tsfg_program.array_resize') {
          const recv = loadReg(op.operands[0]);
          const nl = loadReg(op.operands[1]);
          const nl32 = t();
          lines.push(`  ${nl32} = trunc i64 ${nl.pay} to i32`);
          if (op.operands.length > 2) {
            const fv = loadReg(op.operands[2]);
            lines.push(`  call void @tsfg_eng_arr_resize(ptr %e, i64 ${recv.pay}, i32 ${nl32}, i16 ${fv.tag}, i64 ${fv.pay})`);
          } else {
            const cur = t(), grow = t(), badL = lbl('rsz_bad'), okL = lbl('rsz_ok');
            lines.push(`  ${cur} = call i32 @tsfg_eng_arr_len(ptr %e, i64 ${recv.pay})`);
            emitTrapGuard();
            lines.push(`  ${grow} = icmp ugt i32 ${nl32}, ${cur}`);
            lines.push(`  br i1 ${grow}, label %${badL}, label %${okL}`);
            lines.push(`${badL}:`);
            lines.push('  call void @tsfg_eng_set_trap(ptr %e, i32 4)');
            lines.push('  br label %fn_abort');
            lines.push(`${okL}:`);
            lines.push(`  call void @tsfg_eng_arr_resize(ptr %e, i64 ${recv.pay}, i32 ${nl32}, i16 0, i64 0)`);
          }
          emitTrapGuard();
        } else if (n === 'tsfg_program.readspan') {
          const arr = loadReg(op.operands[0]);
          const st = loadReg(op.operands[1]);
          const ln = loadReg(op.operands[2]);
          const st32 = t(), ln32 = t(), sp = t();
          lines.push(`  ${st32} = trunc i64 ${st.pay} to i32`);
          lines.push(`  ${ln32} = trunc i64 ${ln.pay} to i32`);
          lines.push(`  ${sp} = call i64 @tsfg_eng_span_begin(ptr %e, i64 ${arr.pay}, i32 ${st32}, i32 ${ln32}, i32 0)`);
          emitTrapGuard();
          if (op.result) localSpanRegs.add(op.result);
          storeReg(op.result, '8', sp);
        } else if (n === 'tsfg_program.array_read') {
          const recv = loadReg(op.operands[0]);
          const idx = loadReg(op.operands[1]);
          const idx32 = t(), tv = t(), pv = t();
          lines.push(`  ${idx32} = trunc i64 ${idx.pay} to i32`);
          lines.push(`  ${tv} = call i16 @tsfg_eng_read_elem_tag(ptr %e, i16 ${recv.tag}, i64 ${recv.pay}, i32 ${idx32})`);
          lines.push(`  ${pv} = call i64 @tsfg_eng_read_elem_payload(ptr %e, i16 ${recv.tag}, i64 ${recv.pay}, i32 ${idx32})`);
          emitTrapGuard();
          storeReg(op.result, tv, pv);
        } else if (n === 'tsfg_program.array_store') {
          const recv = loadReg(op.operands[0]);
          const idx = loadReg(op.operands[1]);
          const val = loadReg(op.operands[2]);
          const idx32 = t();
          lines.push(`  ${idx32} = trunc i64 ${idx.pay} to i32`);
          lines.push(`  call void @tsfg_eng_arr_set(ptr %e, i64 ${recv.pay}, i32 ${idx32}, i16 ${val.tag}, i64 ${val.pay})`);
          emitTrapGuard();
        } else if (n === 'tsfg_program.enter_handler' || n === 'tsfg_program.finally_enter') {
          // Structural handler markers
        } else if (n === 'tsfg_program.route') {
          const argPairs = op.operands.map((r) => loadReg(r));
          emitBranchWithArgs(op.successors[0], argPairs);
          terminated = true;
        } else if (n === 'tsfg_program.catch_bind') {
          const cIdx = cellIdxMap.get(p.binding ?? op.result);
          const v = loadReg(op.operands[0]);
          lines.push(`  store i16 ${v.tag}, ptr %ct_${cIdx}`);
          lines.push(`  store i64 ${v.pay}, ptr %cp_${cIdx}`);
          storeReg(op.result, '5', String(cIdx));
        } else if (n === 'tsfg_program.return_throw') {
          const v = loadReg(op.operands[0]);
          lines.push(`  call void @tsfg_eng_throw(ptr %e, i16 ${v.tag}, i64 ${v.pay})`);
          lines.push('  call void @tsfg_eng_exit(ptr %e)');
          lines.push('  ret void');
          terminated = true;
        } else if (n === 'tsfg_program.unreachable') {
          lines.push('  call void @tsfg_eng_set_trap(ptr %e, i32 13)');
          lines.push('  br label %fn_abort');
          terminated = true;
        } else if (n === 'tsfg_program.invoke' || n === 'tsfg_program.invoke_method' || n === 'tsfg_program.invoke_indirect') {
          const argVals = op.operands.map((r) => loadReg(r));
          const afterCall = lbl('after_call');
          if (n === 'tsfg_program.invoke') {
            const callee = fnInfoById.get(p.function_id);
            const cArgs = ['ptr %e', 'ptr %call_ot', 'ptr %call_op'];
            for (const av of argVals) cArgs.push(`i16 ${av.tag}`, `i64 ${av.pay}`);
            lines.push(`  call void @${callee.sym}(${cArgs.join(', ')})`);
            lines.push(`  br label %${afterCall}`);
          } else if (n === 'tsfg_program.invoke_method') {
            const actualTid = t(), isBad = t(), badL = lbl('mbad'), okL = lbl('mok');
            lines.push(`  ${actualTid} = call i64 @tsfg_eng_obj_type_id(ptr %e, i64 ${argVals[0].pay})`);
            emitTrapGuard();
            lines.push(`  ${isBad} = icmp eq i64 ${actualTid}, 0`);
            lines.push(`  br i1 ${isBad}, label %${badL}, label %${okL}`);
            lines.push(`${badL}:`);
            lines.push('  call void @tsfg_eng_set_trap(ptr %e, i32 13)');
            lines.push('  br label %fn_abort');
            lines.push(`${okL}:`);
            const entries = (p.dispatch ?? []).length > 0
              ? p.dispatch
              : [{ receiver_type: null, target: p.function_id }];
            for (let di = 0; di < entries.length; di++) {
              const entry = entries[di];
              const callee = fnInfoById.get(entry.target);
              const hitL = lbl('mhit');
              const nextL = di + 1 < entries.length ? lbl('mnext') : hitL;
              if (di + 1 < entries.length && entry.receiver_type && mod.classNumId.has(entry.receiver_type)) {
                const eq = t();
                lines.push(`  ${eq} = icmp eq i64 ${actualTid}, ${mod.classNumId.get(entry.receiver_type)}`);
                lines.push(`  br i1 ${eq}, label %${hitL}, label %${nextL}`);
              } else {
                lines.push(`  br label %${hitL}`);
              }
              lines.push(`${hitL}:`);
              const cArgs = ['ptr %e', 'ptr %call_ot', 'ptr %call_op'];
              for (const av of argVals) cArgs.push(`i16 ${av.tag}`, `i64 ${av.pay}`);
              lines.push(`  call void @${callee.sym}(${cArgs.join(', ')})`);
              lines.push(`  br label %${afterCall}`);
              if (di + 1 < entries.length) lines.push(`${nextL}:`);
            }
          } else {
            // invoke_indirect
            const clPay = argVals[0].pay;
            const fid32 = t(), envId = t();
            lines.push(`  ${fid32} = call i32 @tsfg_eng_closure_fn(ptr %e, i64 ${clPay})`);
            lines.push(`  ${envId} = call i64 @tsfg_eng_closure_env(ptr %e, i64 ${clPay})`);
            emitTrapGuard();
            const restArgs = argVals.slice(1);
            const candidates = (p.targets?.functions ?? []).map((x) => fnInfoById.get(x.function_id)).filter(Boolean);
            const list = candidates.length > 0 ? candidates : [...fnInfoById.values()].filter((c) => c.paramCount === restArgs.length || (c.expectsEnv && c.paramCount === restArgs.length + 1));
            const missL = lbl('imiss');
            for (let ci2 = 0; ci2 < list.length; ci2++) {
              const callee = list[ci2];
              const hitL = lbl('ihit');
              const nextL = ci2 + 1 < list.length ? lbl('inext') : missL;
              const eq = t();
              lines.push(`  ${eq} = icmp eq i32 ${fid32}, ${callee.index}`);
              lines.push(`  br i1 ${eq}, label %${hitL}, label %${nextL}`);
              lines.push(`${hitL}:`);
              const cArgs = ['ptr %e', 'ptr %call_ot', 'ptr %call_op'];
              if (callee.expectsEnv) cArgs.push('i16 5', `i64 ${envId}`);
              for (const av of restArgs) cArgs.push(`i16 ${av.tag}`, `i64 ${av.pay}`);
              lines.push(`  call void @${callee.sym}(${cArgs.join(', ')})`);
              lines.push(`  br label %${afterCall}`);
              if (ci2 + 1 < list.length) lines.push(`${nextL}:`);
            }
            lines.push(`${missL}:`);
            lines.push('  call void @tsfg_eng_set_trap(ptr %e, i32 13)');
            lines.push('  br label %fn_abort');
          }

          lines.push(`${afterCall}:`);
          emitTrapGuard();
          const hasExc = t(), isExc = t(), excL = lbl('call_exc'), normL = lbl('call_norm');
          lines.push(`  ${hasExc} = call i32 @tsfg_eng_has_exc(ptr %e)`);
          lines.push(`  ${isExc} = icmp ne i32 ${hasExc}, 0`);
          lines.push(`  br i1 ${isExc}, label %${excL}, label %${normL}`);
          lines.push(`${excL}:`);
          const et = t(), ep = t();
          lines.push(`  ${et} = call i16 @tsfg_eng_take_exc_tag(ptr %e)`);
          lines.push(`  ${ep} = call i64 @tsfg_eng_take_exc_payload(ptr %e)`);
          emitBranchWithArgs(op.successors[1], [{ tag: et, pay: ep }]);
          lines.push(`${normL}:`);
          const rt = t(), rp = t();
          lines.push(`  ${rt} = load i16, ptr %call_ot`);
          lines.push(`  ${rp} = load i64, ptr %call_op`);
          emitBranchWithArgs(op.successors[0], [{ tag: rt, pay: rp }]);
          terminated = true;
        } else if (n === 'cf.br') {
          const argPairs = op.operands.map((r) => loadReg(r));
          emitBranchWithArgs(op.successors[0], argPairs);
          terminated = true;
        } else if (n === 'cf.cond_br') {
          const cond = loadReg(op.operands[0]);
          const b1 = t(), trueL = lbl('br_t'), falseL = lbl('br_f');
          const segs = op.operandSegmentSizes ?? [1, 0, 0];
          const tArgs = op.operands.slice(1, 1 + segs[1]).map((r) => loadReg(r));
          const fArgs = op.operands.slice(1 + segs[1], 1 + segs[1] + segs[2]).map((r) => loadReg(r));
          lines.push(`  ${b1} = icmp ne i64 ${cond.pay}, 0`);
          lines.push(`  br i1 ${b1}, label %${trueL}, label %${falseL}`);
          lines.push(`${trueL}:`);
          emitBranchWithArgs(op.successors[0], tArgs);
          lines.push(`${falseL}:`);
          emitBranchWithArgs(op.successors[1], fArgs);
          terminated = true;
        } else if (n === 'func.return') {
          const retReg = op.operands.length > 0 ? op.operands[0] : null;
          for (const spReg of localSpanRegs) {
            if (spReg !== retReg) {
              const sv = loadReg(spReg);
              const isSp = t(), relL = lbl('srel'), skipL = lbl('sskip');
              lines.push(`  ${isSp} = icmp eq i16 ${sv.tag}, 8`);
              lines.push(`  br i1 ${isSp}, label %${relL}, label %${skipL}`);
              lines.push(`${relL}:`);
              lines.push(`  call void @tsfg_eng_span_release(ptr %e, i64 ${sv.pay})`);
              lines.push(`  br label %${skipL}`);
              lines.push(`${skipL}:`);
            }
          }
          if (retReg) {
            const rv = loadReg(retReg);
            lines.push(`  store i16 ${rv.tag}, ptr %out_tag`);
            lines.push(`  store i64 ${rv.pay}, ptr %out_pay`);
          }
          lines.push('  call void @tsfg_eng_exit(ptr %e)');
          lines.push('  ret void');
          terminated = true;
        } else {
          throw new Error(`Unsupported Common20 AOT op: ${n}`);
        }
      }

      if (!terminated) {
        lines.push('  call void @tsfg_eng_exit(ptr %e)');
        lines.push('  ret void');
      }
    }

    lines.push('fn_abort:');
    lines.push('  call void @tsfg_eng_exit(ptr %e)');
    lines.push('  ret void');
    lines.push('fn_trap_noexit:');
    lines.push('  ret void');
    lines.push('}');
    fnLines.push(lines.join('\n'));
  }

  const exports = {};
  for (const [name, fid] of mod.exportsByName.entries()) {
    const info = fnInfoById.get(fid);
    if (info) exports[name] = { sym: info.sym, functionId: fid, paramCount: info.paramCount };
  }

  const globalsBlock = strGlobals.length > 0 ? strGlobals.join('\n') + '\n\n' : '';
  return {
    llvmIr: LLVM_HEADER + '\n' + globalsBlock + fnLines.join('\n\n') + '\n',
    mod,
    initSym: 'aot_cmn_bootstrap',
    exports,
  };
}
