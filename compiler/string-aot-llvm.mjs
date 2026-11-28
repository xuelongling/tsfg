// SPDX-License-Identifier: MIT
// Lowers canonicalized Core IR modules (`tsfg-core-ir --canonicalize` generic form)
// containing `tsfg_string.*` operations, multi-block CFGs, and module string globals
// into Windows x86-64 LLVM IR targeting `runtime/aot-string-runtime.zig`.

function mlirTypeToLlvm(mlirTy) {
  const t = mlirTy.trim();
  if (t === '!tsfg_string.string') return 'i64';
  if (t === '!tsfg_core.integer<"usize">' || t === '!tsfg_core.integer<"isize">' || t === '!tsfg_core.integer<"u64">' || t === '!tsfg_core.integer<"i64">' || t === 'i64') return 'i64';
  if (t === '!tsfg_core.integer<"u16">' || t === '!tsfg_core.integer<"i16">' || t === 'i16') return 'i16';
  if (t === '!tsfg_core.integer<"u8">' || t === '!tsfg_core.integer<"i8">' || t === 'i8') return 'i8';
  if (t === 'i1') return 'i1';
  return 'i32';
}

function parseAnchor(line) {
  const ms = line.match(/tsfg_source\.start\s*=\s*(\d+)/);
  const me = line.match(/tsfg_source\.end\s*=\s*(\d+)/);
  return { start: ms ? Number(ms[1]) : 0, end: me ? Number(me[1]) : 0 };
}

function sanitizeSym(sym) {
  return 'aot_fn_' + sym.replace(/[^a-zA-Z0-9_]/g, '_');
}

function sanitizeReg(reg) {
  return '%r_' + reg.slice(1).replace(/[^a-zA-Z0-9_]/g, '_');
}

function splitTopLevel(s) {
  const parts = [];
  let depth = 0, start = 0, inStr = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === '(' || ch === '<' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === '>' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = s.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

/**
 * Emit Windows x86-64 LLVM IR for a canonicalized Core IR module with `tsfg_string.*` ops.
 * @param {string} canonMlirText - Output of `tsfg-core-ir --canonicalize`
 */
export function lowerStringCoreToLlvm(canonMlirText) {
  const globals = [];
  const fnDefs = [];
  const functions = [];
  const lines = canonMlirText.split(/\r?\n/);
  let i = 0;
  let strIdx = 0;

  while (i < lines.length) {
    const line = lines[i];
    const fnMatch = line.match(/"func\.func"\(\)\s*<\{function_type\s*=\s*\(([^)]*)\)\s*->\s*([^,]+),\s*sym_name\s*=\s*"([^"]+)"\}>\s*\(\{/);
    if (!fnMatch) {
      i++;
      continue;
    }
    const paramTysMlir = fnMatch[1].trim() ? splitTopLevel(fnMatch[1]) : [];
    const retMlir = fnMatch[2].trim();
    const rawSym = fnMatch[3];
    const retLlvm = mlirTypeToLlvm(retMlir);
    const llvmSym = sanitizeSym(rawSym);

    // Collect blocks until `}) {attrs...} : () -> ()`
    const blocks = [];
    let currentBlock = { label: 'bb0', params: [], ops: [] };
    i++;
    let attrsRaw = '';
    while (i < lines.length) {
      const l = lines[i];
      const closeMatch = l.match(/^\s*\}\)\s*(\{.*\})\s*:\s*\(\)\s*->\s*\(\)\s*$/);
      if (closeMatch) {
        attrsRaw = closeMatch[1];
        i++;
        break;
      }
      const bbMatch = l.match(/^\s*\^(\w+)(?:\(([^)]*)\))?:\s*(?:\/\/.*)?$/);
      if (bbMatch) {
        if (blocks.length === 0 && currentBlock.ops.length === 0 && currentBlock.params.length === 0 && bbMatch[1] === 'bb0') {
          currentBlock.label = bbMatch[1];
        } else {
          blocks.push(currentBlock);
          currentBlock = { label: bbMatch[1], params: [], ops: [] };
        }
        if (bbMatch[2] && bbMatch[2].trim()) {
          for (const part of splitTopLevel(bbMatch[2])) {
            const pm = part.match(/^(%[\w$.-]+)\s*:\s*(.+)$/);
            if (pm) currentBlock.params.push({ reg: pm[1], mlir: pm[2].trim(), llvm: mlirTypeToLlvm(pm[2]) });
          }
        }
      } else {
        const trimmed = l.trim();
        if (trimmed) currentBlock.ops.push(trimmed);
      }
      i++;
    }
    blocks.push(currentBlock);

    const fidMatch = attrsRaw.match(/tsfg_core\.function_id\s*=\s*"([^"]+)"/);
    const logNameMatch = attrsRaw.match(/tsfg_core\.logical_name\s*=\s*"([^"]+)"/);
    const isInit = /tsfg_core\.initializer\s*=\s*true/.test(attrsRaw);
    const functionId = fidMatch ? fidMatch[1] : rawSym;
    const logicalName = logNameMatch ? logNameMatch[1] : rawSym;

    // Collect incoming edges for phi nodes: targetLabel -> [{ fromLabel, args: [llvmReg, ...] }]
    const incoming = new Map();
    for (const blk of blocks) incoming.set(blk.label, []);

    const regTypes = new Map();
    for (const blk of blocks) {
      for (const p of blk.params) regTypes.set(p.reg, p.llvm);
    }

    // Pre-scan incoming branch operands
    for (const blk of blocks) {
      for (const s of blk.ops) {
        if (s.startsWith('"cf.br"')) {
          const bm = s.match(/^"cf\.br"\(([^)]*)\)\[\^(\w+)\]/);
          if (bm) {
            const args = bm[1].trim() ? bm[1].split(',').map((x) => x.trim()) : [];
            incoming.get(bm[2]).push({ from: blk.label, args });
          }
        } else if (s.startsWith('"cf.cond_br"')) {
          const cm = s.match(/^"cf\.cond_br"\(([^)]*)\)\[\^(\w+),\s*\^(\w+)\]\s*<\{operandSegmentSizes\s*=\s*array<i32:\s*1,\s*(\d+),\s*(\d+)>\}>/);
          if (cm) {
            const allOps = cm[1].split(',').map((x) => x.trim());
            const tCount = Number(cm[4]);
            const fCount = Number(cm[5]);
            incoming.get(cm[2]).push({ from: blk.label, args: allOps.slice(1, 1 + tCount) });
            incoming.get(cm[3]).push({ from: blk.label, args: allOps.slice(1 + tCount, 1 + tCount + fCount) });
          }
        }
      }
    }

    const llBlocks = [];
    const blockEndLabel = new Map();
    let tmpCounter = 0;
    let hasFuelAbort = false;
    const tmp = () => `%_t${tmpCounter++}`;

    for (let bi = 0; bi < blocks.length; bi++) {
      const blk = blocks[bi];
      let curLabel = blk.label;
      const llOps = [];
      // Emit phi nodes for non-entry blocks with parameters (using deferred end-label token)
      if (bi > 0 && blk.params.length > 0) {
        const edges = incoming.get(blk.label);
        for (let pi = 0; pi < blk.params.length; pi++) {
          const p = blk.params[pi];
          const pairs = edges.map((e) => `[ ${sanitizeReg(e.args[pi])}, %__END_OF_${e.from}__ ]`).join(', ');
          llOps.push(`  ${sanitizeReg(p.reg)} = phi ${p.llvm} ${pairs}`);
        }
      }

      for (const s of blk.ops) {
        const anc = parseAnchor(s);
        if (s.includes('"tsfg_core.fuel"')) {
          const ok = tmp();
          const bad = tmp();
          const cont = `fuel_ok_${tmpCounter++}`;
          hasFuelAbort = true;
          llOps.push(`  ${ok} = call i32 @tsfg_aot_str_fuel(ptr %ctx, i32 ${anc.start}, i32 ${anc.end})`);
          llOps.push(`  ${bad} = icmp eq i32 ${ok}, 0`);
          llOps.push(`  br i1 ${bad}, label %fn_fuel_abort, label %${cont}`);
          llOps.push(`${cont}:`);
          curLabel = cont;
          continue;
        }
        if (s.includes('"tsfg_core.global_store"')) {
          const om = s.match(/\((%[\w$.-]+)\)/);
          const gm = s.match(/global\s*=\s*(\d+)/);
          const im = /initialize\s*=\s*true/.test(s) ? 1 : 0;
          llOps.push(`  call void @tsfg_aot_str_global_store(ptr %ctx, i32 ${gm[1]}, i64 ${sanitizeReg(om[1])}, i32 ${im})`);
          continue;
        }
        if (s.includes('"func.return"')) {
          const om = s.match(/\((%[\w$.-]+)\)/);
          llOps.push(`  ret ${retLlvm} ${sanitizeReg(om[1])}`);
          continue;
        }
        if (s.startsWith('"cf.br"')) {
          const bm = s.match(/^"cf\.br"\([^)]*\)\[\^(\w+)\]/);
          llOps.push(`  br label %${bm[1]}`);
          continue;
        }
        if (s.startsWith('"cf.cond_br"')) {
          const cm = s.match(/^"cf\.cond_br"\(([^)]*)\)\[\^(\w+),\s*\^(\w+)\]/);
          const condReg = cm[1].split(',')[0].trim();
          llOps.push(`  br i1 ${sanitizeReg(condReg)}, label %${cm[2]}, label %${cm[3]}`);
          continue;
        }

        const resMatch = s.match(/^(%[\w$.-]+)\s*=\s*"([^"]+)"\(([^)]*)\)(.*)$/);
        if (!resMatch) continue;
        const dstMlir = resMatch[1];
        const opName = resMatch[2];
        const opsRaw = resMatch[3].trim();
        const ops = opsRaw ? opsRaw.split(',').map((x) => x.trim()) : [];
        const rest = resMatch[4];
        const tyMatch = rest.match(/->\s*([^\s]+)\s*$/);
        const dstLlvmTy = tyMatch ? mlirTypeToLlvm(tyMatch[1]) : 'i64';
        const dstLlvm = sanitizeReg(dstMlir);
        regTypes.set(dstMlir, dstLlvmTy);

        if (opName === 'tsfg_core.constant') {
          let val = '0';
          const bm = rest.match(/value\s*=\s*(true|false)\b/);
          const sm = rest.match(/value\s*=\s*"(-?\d+)"/);
          const nm = rest.match(/value\s*=\s*(-?\d+)/);
          if (bm) val = bm[1] === 'true' ? '1' : '0';
          else if (sm) val = sm[1];
          else if (nm) val = nm[1];
          llOps.push(`  ${dstLlvm} = add ${dstLlvmTy} 0, ${val}`);
        } else if (opName === 'tsfg_string.constant') {
          let units = [];
          const am = rest.match(/code_units\s*=\s*array<i32:\s*([^>]*)>/);
          if (am && am[1].trim()) {
            units = am[1].split(',').map((x) => Number(x.trim()));
          }
          const gName = `@.str_u16_${strIdx++}`;
          if (units.length === 0) {
            globals.push(`${gName} = private unnamed_addr constant [1 x i16] [i16 0]`);
            llOps.push(`  ${dstLlvm} = call i64 @tsfg_aot_str_from_u16(ptr %ctx, ptr ${gName}, i64 0)`);
          } else {
            const elems = units.map((u) => `i16 ${u & 0xffff}`).join(', ');
            globals.push(`${gName} = private unnamed_addr constant [${units.length} x i16] [${elems}]`);
            llOps.push(`  ${dstLlvm} = call i64 @tsfg_aot_str_from_u16(ptr %ctx, ptr ${gName}, i64 ${units.length})`);
          }
        } else if (opName === 'tsfg_string.length') {
          llOps.push(`  ${dstLlvm} = call i64 @tsfg_aot_str_length(ptr %ctx, i64 ${sanitizeReg(ops[0])}, i32 ${anc.start}, i32 ${anc.end})`);
        } else if (opName === 'tsfg_string.codeunit') {
          llOps.push(`  ${dstLlvm} = call i16 @tsfg_aot_str_codeunit(ptr %ctx, i64 ${sanitizeReg(ops[0])}, i64 ${sanitizeReg(ops[1])}, i32 ${anc.start}, i32 ${anc.end})`);
        } else if (opName === 'tsfg_string.concat') {
          llOps.push(`  ${dstLlvm} = call i64 @tsfg_aot_str_concat(ptr %ctx, i64 ${sanitizeReg(ops[0])}, i64 ${sanitizeReg(ops[1])}, i32 ${anc.start}, i32 ${anc.end})`);
        } else if (opName === 'tsfg_string.slice') {
          llOps.push(`  ${dstLlvm} = call i64 @tsfg_aot_str_slice(ptr %ctx, i64 ${sanitizeReg(ops[0])}, i64 ${sanitizeReg(ops[1])}, i64 ${sanitizeReg(ops[2])}, i32 ${anc.start}, i32 ${anc.end})`);
        } else if (opName === 'tsfg_string.compare') {
          llOps.push(`  ${dstLlvm} = call i32 @tsfg_aot_str_compare(ptr %ctx, i64 ${sanitizeReg(ops[0])}, i64 ${sanitizeReg(ops[1])}, i32 ${anc.start}, i32 ${anc.end})`);
        } else if (opName === 'tsfg_core.global_load') {
          const gm = rest.match(/global\s*=\s*(\d+)/);
          llOps.push(`  ${dstLlvm} = call i64 @tsfg_aot_str_global_load(ptr %ctx, i32 ${gm[1]}, i32 ${anc.start}, i32 ${anc.end})`);
        } else if (opName === 'func.call') {
          const cm = rest.match(/callee\s*=\s*@(?:"([^"]+)"|([a-zA-Z0-9_$.]+))/);
          const calleeSym = sanitizeSym(cm[1] ?? cm[2]);
          const argStrs = ['ptr %ctx', ...ops.map((o) => `${regTypes.get(o) ?? 'i64'} ${sanitizeReg(o)}`)];
          llOps.push(`  ${dstLlvm} = call ${dstLlvmTy} @${calleeSym}(${argStrs.join(', ')})`);
        } else {
          throw new Error(`unsupported string AOT op: ${opName}`);
        }
      }
      blockEndLabel.set(blk.label, curLabel);
      llBlocks.push(`${blk.label}:\n${llOps.join('\n')}`);
    }

    if (hasFuelAbort) {
      llBlocks.push(`fn_fuel_abort:\n  ret ${retLlvm} 0`);
    }
    const resolvedBlocks = llBlocks.map((b) =>
      b.replace(/%__END_OF_(\w+)__/g, (_, name) => `%${blockEndLabel.get(name) ?? name}`),
    );

    const entryParams = blocks[0].params;
    const sigParams = ['ptr %ctx', ...entryParams.map((p) => `${p.llvm} ${sanitizeReg(p.reg)}`)];
    fnDefs.push(`define ${retLlvm} @${llvmSym}(${sigParams.join(', ')}) {\n${resolvedBlocks.join('\n')}\n}`);
    functions.push({
      name: logicalName,
      sym: rawSym,
      llvmSym,
      functionId,
      params: paramTysMlir,
      ret: retMlir,
      initializer: isInit,
    });
  }

  const header = [
    'target datalayout = "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"',
    'target triple = "x86_64-pc-windows-msvc"',
    '',
    'declare i32 @tsfg_aot_str_fuel(ptr, i32, i32)',
    'declare i64 @tsfg_aot_str_from_u16(ptr, ptr, i64)',
    'declare i64 @tsfg_aot_str_length(ptr, i64, i32, i32)',
    'declare i16 @tsfg_aot_str_codeunit(ptr, i64, i64, i32, i32)',
    'declare i64 @tsfg_aot_str_concat(ptr, i64, i64, i32, i32)',
    'declare i64 @tsfg_aot_str_slice(ptr, i64, i64, i64, i32, i32)',
    'declare i32 @tsfg_aot_str_compare(ptr, i64, i64, i32, i32)',
    'declare void @tsfg_aot_str_global_store(ptr, i32, i64, i32)',
    'declare i64 @tsfg_aot_str_global_load(ptr, i32, i32, i32)',
    '',
  ];

  return {
    llvm: [...header, ...globals, '', ...fnDefs, ''].join('\n'),
    functions,
  };
}
