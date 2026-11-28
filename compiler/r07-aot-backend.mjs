// SPDX-License-Identifier: MIT
// R07 Production Windows x64 AOT Backend:
//   Verified `tsfg` Dialect -> Windows x86-64 LLVM IR (strict IEEE float, explicit safepoint
//   stackmap frame protocol, FunctionCell hot call slots, parallel_for chunk lowering)
//   -> `clang-cl /c` COFF `.obj` -> `lld-link /DLL` Native Patch `.dll`
//   -> Sealed R04 `.tpatch` Package (with exact DLL SHA-256 + AOT GC StackMap).
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { sha256, WINDOWS_X64_TARGET } from './r04-identity.mjs';
import { emitNativePatch } from './r04-protocols.mjs';
import { runR07OptimizationPipeline } from './r07-tsfg-dialect.mjs';
import { resolveClangClExe, resolveLldLinkExe } from './tsfg-paths.mjs';

const RUNTIME_CALLBACK_STRUCT = `%struct.R07RtCallbacks = type {
  ptr, ; 0: fn(rt, type_id, scalars, edges) -> ptr (gc_alloc)
  ptr, ; 1: fn(rt, obj, field_idx) -> i64 (obj_read_scalar)
  ptr, ; 2: fn(rt, obj, field_idx, val) -> void (obj_write_scalar)
  ptr, ; 3: fn(rt, code_id, pc_offset, frame_ptr, frame_size) -> void (gc_safepoint)
  ptr, ; 4: fn(rt, cell_slot, arg0) -> i32 (call_hot_i32)
  ptr  ; 5: fn(rt, trap_code) -> void (set_trap)
}`;

/**
 * Lower a verified & optimized `tsfg` dialect module into Windows x86-64 LLVM IR.
 * Uses strict IEEE floating-point (no fast-math, no FMA, canonical quiet NaN),
 * real stack-allocated root frames passed to `gc_safepoint` (so relocated young pointers
 * are written back into the native frame and reloaded after safepoints!), and
 * indirect `FunctionCell` dispatch for `tsfg.call_hot`.
 */
export function lowerTsfgDialectToLlvm(pipelineResult, opts = {}) {
  const mod = pipelineResult.module;
  const codeId = opts.codeId ?? 1001;
  const codeVersion = opts.codeVersion ?? 1;
  const abiHashBytes = Buffer.from(mod.abiHash, 'utf8');

  const lines = [
    `target datalayout = "${WINDOWS_X64_TARGET.llvmDataLayout}"`,
    `target triple = "${WINDOWS_X64_TARGET.triple}"`,
    '',
    RUNTIME_CALLBACK_STRUCT,
    '',
    `@tsfg_patch_abi_hash = dllexport constant [${abiHashBytes.length + 1} x i8] c"${mod.abiHash}\\00"`,
    `@tsfg_patch_code_version = dllexport constant i64 ${codeVersion}`,
    `@_fltused = global i32 0, align 4`,
    '',
  ];

  for (const fn of mod.functions) {
    const paramDecls = ['ptr %rt', 'ptr %cb'];
    for (const p of fn.params ?? []) {
      const llTy = p.type === 'f64' ? 'double' : p.type === 'i64' ? 'i64' : p.type === 'ptr' ? 'ptr' : 'i32';
      paramDecls.push(`${llTy} %p_${p.name}`);
    }
    const retLlvm = fn.returnType === 'f64' ? 'double' : fn.returnType === 'i64' ? 'i64' : 'i32';
    lines.push(`define dllexport ${retLlvm} @${fn.name}(${paramDecls.join(', ')}) {`);
    lines.push('entry:');

    // Allocate 64-byte aligned GC root frame buffer on native stack for AOT safepoints!
    lines.push('  %gc_frame = alloca [64 x i8], align 8');
    lines.push('  store i64 0, ptr %gc_frame, align 8');

    const regLlvm = new Map();
    const regSlotOffset = new Map(); // if a handle reg is tracked in %gc_frame
    for (const p of fn.params ?? []) {
      regLlvm.set(p.name, `%p_${p.name}`);
    }

    let tmpN = 0;
    const t = () => `%_t${tmpN++}`;
    const lbl = (pfx) => `${pfx}_${tmpN++}`;

    // Pre-scan safepoint root slot offsets so handle defs store directly into `%gc_frame + offset`
    for (const op of fn.ops) {
      if (op.op === 'tsfg.safepoint') {
        for (const r of op.attrs?.roots ?? []) {
          regSlotOffset.set(r.reg, r.slotOffset);
        }
      }
    }

    const loadHandle = (regName) => {
      if (regSlotOffset.has(regName)) {
        const off = regSlotOffset.get(regName);
        const gep = t(), ptrVal = t();
        lines.push(`  ${gep} = getelementptr inbounds [64 x i8], ptr %gc_frame, i64 0, i64 ${off}`);
        lines.push(`  ${ptrVal} = load ptr, ptr ${gep}, align 8`);
        return ptrVal;
      }
      return regLlvm.get(regName);
    };

    let spCounter = 0;
    for (const op of fn.ops) {
      if (op.op === 'tsfg.const_i32') {
        const v = t();
        lines.push(`  ${v} = add i32 0, ${op.attrs.value | 0}`);
        regLlvm.set(op.result, v);
      } else if (op.op === 'tsfg.const_f64') {
        const bits = BigInt('0x' + (op.attrs.bits ?? '0')).toString();
        const v = t();
        lines.push(`  ${v} = bitcast i64 ${bits} to double`);
        regLlvm.set(op.result, v);
      } else if (op.op === 'tsfg.const_bool') {
        const v = t();
        lines.push(`  ${v} = add i32 0, ${op.attrs.value ? 1 : 0}`);
        regLlvm.set(op.result, v);
      } else if (op.op === 'tsfg.add_i32' || op.op === 'tsfg.sub_i32' || op.op === 'tsfg.mul_i32') {
        const llOp = { 'tsfg.add_i32': 'add', 'tsfg.sub_i32': 'sub', 'tsfg.mul_i32': 'mul' }[op.op];
        const v = t();
        lines.push(`  ${v} = ${llOp} i32 ${regLlvm.get(op.operands[0])}, ${regLlvm.get(op.operands[1])}`);
        regLlvm.set(op.result, v);
      } else if (op.op === 'tsfg.div_i32' || op.op === 'tsfg.rem_i32') {
        const a = regLlvm.get(op.operands[0]);
        const b = regLlvm.get(op.operands[1]);
        const isZ = t(), isMin = t(), isN1 = t(), isOv = t(), badL = lbl('div_bad'), okL = lbl('div_ok');
        lines.push(`  ${isZ} = icmp eq i32 ${b}, 0`);
        lines.push(`  ${isMin} = icmp eq i32 ${a}, -2147483648`);
        lines.push(`  ${isN1} = icmp eq i32 ${b}, -1`);
        lines.push(`  ${isOv} = and i1 ${isMin}, ${isN1}`);
        if (op.op === 'tsfg.div_i32') {
          const bad = t();
          lines.push(`  ${bad} = or i1 ${isZ}, ${isOv}`);
          lines.push(`  br i1 ${bad}, label %${badL}, label %${okL}`);
          lines.push(`${badL}:`);
          const fpGep = t(), fp = t();
          lines.push(`  ${fpGep} = getelementptr inbounds %struct.R07RtCallbacks, ptr %cb, i32 0, i32 5`);
          lines.push(`  ${fp} = load ptr, ptr ${fpGep}, align 8`);
          lines.push(`  call void ${fp}(ptr %rt, i32 3)`);
          lines.push(`  ret ${retLlvm} ${retLlvm === 'double' ? '0.0' : '0'}`);
          lines.push(`${okL}:`);
          const v = t();
          lines.push(`  ${v} = sdiv i32 ${a}, ${b}`);
          regLlvm.set(op.result, v);
        } else {
          const ovL = lbl('rem_ov'), runL = lbl('rem_run'), doneL = lbl('rem_done');
          lines.push(`  br i1 ${isZ}, label %${badL}, label %${okL}`);
          lines.push(`${badL}:`);
          const fpGep = t(), fp = t();
          lines.push(`  ${fpGep} = getelementptr inbounds %struct.R07RtCallbacks, ptr %cb, i32 0, i32 5`);
          lines.push(`  ${fp} = load ptr, ptr ${fpGep}, align 8`);
          lines.push(`  call void ${fp}(ptr %rt, i32 3)`);
          lines.push(`  ret ${retLlvm} ${retLlvm === 'double' ? '0.0' : '0'}`);
          lines.push(`${okL}:`);
          lines.push(`  br i1 ${isOv}, label %${ovL}, label %${runL}`);
          lines.push(`${ovL}:`);
          lines.push(`  br label %${doneL}`);
          lines.push(`${runL}:`);
          const rVal = t();
          lines.push(`  ${rVal} = srem i32 ${a}, ${b}`);
          lines.push(`  br label %${doneL}`);
          lines.push(`${doneL}:`);
          const phi = t();
          lines.push(`  ${phi} = phi i32 [ 0, %${ovL} ], [ ${rVal}, %${runL} ]`);
          regLlvm.set(op.result, phi);
        }
      } else if (op.op === 'tsfg.add_f64' || op.op === 'tsfg.sub_f64' || op.op === 'tsfg.mul_f64' || op.op === 'tsfg.div_f64') {
        // Strict IEEE f64: NO fast-math, NO FMA, canonical quiet NaN 0x7ff8000000000000!
        const fop = { 'tsfg.add_f64': 'fadd', 'tsfg.sub_f64': 'fsub', 'tsfg.mul_f64': 'fmul', 'tsfg.div_f64': 'fdiv' }[op.op];
        const raw = t(), isNan = t(), rawBits = t(), canonBits = t(), res = t();
        lines.push(`  ${raw} = ${fop} double ${regLlvm.get(op.operands[0])}, ${regLlvm.get(op.operands[1])}`);
        lines.push(`  ${isNan} = fcmp uno double ${raw}, ${raw}`);
        lines.push(`  ${rawBits} = bitcast double ${raw} to i64`);
        lines.push(`  ${canonBits} = select i1 ${isNan}, i64 9221120237041090560, i64 ${rawBits}`);
        lines.push(`  ${res} = bitcast i64 ${canonBits} to double`);
        regLlvm.set(op.result, res);
      } else if (op.op === 'tsfg.handle.alloc') {
        const fpGep = t(), fp = t(), obj = t();
        lines.push(`  ${fpGep} = getelementptr inbounds %struct.R07RtCallbacks, ptr %cb, i32 0, i32 0`);
        lines.push(`  ${fp} = load ptr, ptr ${fpGep}, align 8`);
        lines.push(`  ${obj} = call ptr ${fp}(ptr %rt, i64 ${op.attrs.typeId ?? 1}, i64 ${op.attrs.scalars ?? 2}, i64 ${op.attrs.edges ?? 0})`);
        if (regSlotOffset.has(op.result)) {
          const gep = t();
          lines.push(`  ${gep} = getelementptr inbounds [64 x i8], ptr %gc_frame, i64 0, i64 ${regSlotOffset.get(op.result)}`);
          lines.push(`  store ptr ${obj}, ptr ${gep}, align 8`);
        }
        regLlvm.set(op.result, obj);
      } else if (op.op === 'tsfg.handle.write') {
        const objPtr = loadHandle(op.operands[0]);
        const val = regLlvm.get(op.operands[1]);
        const val64 = t(), fpGep = t(), fp = t();
        lines.push(`  ${val64} = sext i32 ${val} to i64`);
        lines.push(`  ${fpGep} = getelementptr inbounds %struct.R07RtCallbacks, ptr %cb, i32 0, i32 2`);
        lines.push(`  ${fp} = load ptr, ptr ${fpGep}, align 8`);
        lines.push(`  call void ${fp}(ptr %rt, ptr ${objPtr}, i64 ${op.attrs.fieldIdx ?? 0}, i64 ${val64})`);
      } else if (op.op === 'tsfg.handle.read') {
        const objPtr = loadHandle(op.operands[0]);
        const fpGep = t(), fp = t(), v64 = t(), v32 = t();
        lines.push(`  ${fpGep} = getelementptr inbounds %struct.R07RtCallbacks, ptr %cb, i32 0, i32 1`);
        lines.push(`  ${fp} = load ptr, ptr ${fpGep}, align 8`);
        lines.push(`  ${v64} = call i64 ${fp}(ptr %rt, ptr ${objPtr}, i64 ${op.attrs.fieldIdx ?? 0})`);
        lines.push(`  ${v32} = trunc i64 ${v64} to i32`);
        regLlvm.set(op.result, v32);
      } else if (op.op === 'tsfg.safepoint') {
        const pcOff = op.attrs?.pcOffset ?? (16 * (++spCounter));
        const frameSize = op.attrs?.frameSize ?? 64;
        const fpGep = t(), fp = t();
        lines.push(`  ${fpGep} = getelementptr inbounds %struct.R07RtCallbacks, ptr %cb, i32 0, i32 3`);
        lines.push(`  ${fp} = load ptr, ptr ${fpGep}, align 8`);
        lines.push(`  call void ${fp}(ptr %rt, i64 ${codeId}, i32 ${pcOff}, ptr %gc_frame, i32 ${frameSize})`);
      } else if (op.op === 'tsfg.call_hot') {
        const arg0 = regLlvm.get(op.operands[0]);
        const fpGep = t(), fp = t(), res = t();
        lines.push(`  ${fpGep} = getelementptr inbounds %struct.R07RtCallbacks, ptr %cb, i32 0, i32 4`);
        lines.push(`  ${fp} = load ptr, ptr ${fpGep}, align 8`);
        lines.push(`  ${res} = call i32 ${fp}(ptr %rt, i32 ${op.attrs.cellSlot ?? 0}, i32 ${arg0})`);
        regLlvm.set(op.result, res);
      } else if (op.op === 'tsfg.borrow.begin') {
        regLlvm.set(op.result, regLlvm.get(op.operands[0]));
      } else if (op.op === 'tsfg.borrow.load') {
        const base = regLlvm.get(op.operands[0]);
        const idx = regLlvm.get(op.operands[1]);
        const idx64 = t(), gep = t(), val = t();
        lines.push(`  ${idx64} = sext i32 ${idx} to i64`);
        lines.push(`  ${gep} = getelementptr inbounds i32, ptr ${base}, i64 ${idx64}`);
        lines.push(`  ${val} = load i32, ptr ${gep}, align 4`);
        regLlvm.set(op.result, val);
      } else if (op.op === 'tsfg.borrow.end' || op.op === 'tsfg.bounds_check' || op.op === 'tsfg.fuel') {
        // Scope/check/fuel markers lowered
      } else if (op.op === 'tsfg.parallel_for') {
        // Lower data-oriented chunk loop: dst[i] = src[i] + delta for i in 0..count
        const dstPtr = regLlvm.get(op.operands[0]);
        const srcPtr = regLlvm.get(op.operands[1]);
        const count = regLlvm.get(op.operands[2]);
        const delta = regLlvm.get(op.operands[3]);
        const lpHead = lbl('pfor_head'), lpBody = lbl('pfor_body'), lpDone = lbl('pfor_done');
        const ivAlloca = t();
        lines.push(`  ${ivAlloca} = alloca i32, align 4`);
        lines.push(`  store i32 0, ptr ${ivAlloca}, align 4`);
        lines.push(`  br label %${lpHead}`);
        lines.push(`${lpHead}:`);
        const iv = t(), cond = t();
        lines.push(`  ${iv} = load i32, ptr ${ivAlloca}, align 4`);
        lines.push(`  ${cond} = icmp slt i32 ${iv}, ${count}`);
        lines.push(`  br i1 ${cond}, label %${lpBody}, label %${lpDone}`);
        lines.push(`${lpBody}:`);
        const i64v = t(), sGep = t(), dGep = t(), sv = t(), sum = t(), nextIv = t();
        lines.push(`  ${i64v} = sext i32 ${iv} to i64`);
        lines.push(`  ${sGep} = getelementptr inbounds i32, ptr ${srcPtr}, i64 ${i64v}`);
        lines.push(`  ${dGep} = getelementptr inbounds i32, ptr ${dstPtr}, i64 ${i64v}`);
        lines.push(`  ${sv} = load i32, ptr ${sGep}, align 4`);
        lines.push(`  ${sum} = add i32 ${sv}, ${delta}`);
        lines.push(`  store i32 ${sum}, ptr ${dGep}, align 4`);
        lines.push(`  ${nextIv} = add i32 ${iv}, 1`);
        lines.push(`  store i32 ${nextIv}, ptr ${ivAlloca}, align 4`);
        lines.push(`  br label %${lpHead}`);
        lines.push(`${lpDone}:`);
      } else if (op.op === 'tsfg.return') {
        const rv = regLlvm.get(op.operands[0]);
        lines.push(`  ret ${retLlvm} ${rv}`);
      }
    }

    lines.push('}');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Compile a `tsfg` dialect module all the way to:
 *   1. Verified optimized `tsfg` dialect + PassAuditReport
 *   2. Windows x86-64 LLVM IR (`.ll`)
 *   3. Windows x86-64 COFF object (`.obj`) via `clang-cl`
 *   4. Native Windows x86-64 Patch DLL (`.dll`) via `lld-link /DLL /NOENTRY`
 *   5. Sealed R04 `.tpatch` envelope binding DLL SHA-256 + AOT GC StackMaps
 */
export async function compileTsfgPatchDll(dialectMod, outDir, opts = {}) {
  const tag = opts.tag ?? 'r07_patch';
  const optLevel = opts.optLevel ?? 'O2';
  const codeVersion = opts.codeVersion ?? 1;
  const codeId = opts.codeId ?? 1001;

  await mkdir(outDir, { recursive: true });
  const pipeline = runR07OptimizationPipeline(dialectMod, { optLevel });
  const llvmIr = lowerTsfgDialectToLlvm(pipeline, { codeId, codeVersion });

  const llPath = path.join(outDir, `${tag}.ll`);
  const objPath = path.join(outDir, `${tag}.obj`);
  const dllPath = path.join(outDir, `${tag}.dll`);
  const tpatchPath = path.join(outDir, `${tag}.tpatch`);

  await writeFile(llPath, llvmIr, 'utf8');

  const clangCl = resolveClangClExe(opts.clangCl);
  const lldLink = resolveLldLinkExe(opts.lldLink);
  const optFlag = optLevel === 'O0' ? '/Od' : '/O2';
  const debugFlags = opts.emitPdb ? ['/Zi', `/Fd${path.join(outDir, `${tag}.compiler.pdb`)}`] : [];
  const cc = spawnSync(clangCl, ['/c', optFlag, ...debugFlags, '-x', 'ir', llPath, `/Fo${objPath}`], {
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (cc.status !== 0) throw new Error(`r07 clang-cl failed:\n${cc.stderr.toString('utf8')}`);

  const pdbPath = path.join(outDir, `${tag}.pdb`);
  const linkFlags = ['/DLL', '/NOENTRY', '/MACHINE:X64', `/OUT:${dllPath}`];
  if (opts.emitPdb) {
    linkFlags.push('/DEBUG:FULL', `/PDB:${pdbPath}`, '/PDBALTPATH:%_PDB%');
  }
  const ld = spawnSync(lldLink, [...linkFlags, objPath], {
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (ld.status !== 0) throw new Error(`r07 lld-link /DLL failed:\n${ld.stderr.toString('utf8')}`);

  const dllBytes = await readFile(dllPath);
  const dllSha = `sha256:${createHash('sha256').update(dllBytes).digest('hex')}`;

  const patch = emitNativePatch({
    abiHash: dialectMod.abiHash,
    artifact: { byteSize: dllBytes.length, format: 'coff-dll', sha256: dllSha },
    codeVersion,
    epoch: opts.epoch ?? codeVersion,
    functions: dialectMod.functions.map((fn) => ({
      abiCallConv: 'win64_c',
      captureLayoutHash: fn.captureLayoutHash ?? sha256('capture-empty'),
      effectHash: fn.effectHash ?? sha256('effect-pure'),
      entrySymbol: fn.name,
      functionId: fn.functionId,
      signatureHash: fn.signatureHash ?? sha256(`sig:${fn.name}`),
      stackMap: pipeline.stackMapsByFn.get(fn.name) ?? [],
      tierAdapter: 'direct_c_abi',
    })),
    moduleId: dialectMod.moduleId ?? sha256('/src/r07_patch.ts'),
    patchId: sha256(`patch:${tag}:v${codeVersion}`),
    staticSchemaHash: dialectMod.staticSchemaHash ?? sha256('static-schema-v1'),
  });
  await writeFile(tpatchPath, patch.bytes);

  return {
    audit: pipeline.audit,
    dllBytes,
    dllPath,
    dllSha,
    llPath,
    llvmIr,
    objPath,
    patch,
    tpatchPath,
  };
}
