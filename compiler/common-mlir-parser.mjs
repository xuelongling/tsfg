// SPDX-License-Identifier: MIT
// Parses canonicalized or optimized Common20 Core MLIR emitted by
// `tsfg-core-ir.exe --common-program --canonicalize` or `--optimize`.
// Extracts the embedded HIR metadata dictionary and every `func.func` SSA CFG.

export function decodeMlirString(raw) {
  const bytes = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '\\' && i + 1 < raw.length) {
      const next = raw[i + 1];
      if (next === 'n') { bytes.push(10); i++; continue; }
      if (next === 't') { bytes.push(9); i++; continue; }
      if (next === 'r') { bytes.push(13); i++; continue; }
      if (next === '"' || next === '\\') { bytes.push(next.charCodeAt(0)); i++; continue; }
      if (i + 2 < raw.length && /^[0-9a-fA-F]{2}$/.test(raw.slice(i + 1, i + 3))) {
        bytes.push(Number.parseInt(raw.slice(i + 1, i + 3), 16));
        i += 2;
        continue;
      }
    }
    const buf = Buffer.from(ch, 'utf8');
    for (const b of buf) bytes.push(b);
  }
  return Buffer.from(bytes).toString('utf8');
}

function splitTopLevel(s) {
  const parts = [];
  let depth = 0;
  let start = 0;
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' && (i === 0 || s[i - 1] !== '\\')) inStr = !inStr;
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

function extractQuotedField(text, key) {
  const needle = `${key} = "`;
  const idx = text.indexOf(needle);
  if (idx < 0) return null;
  let i = idx + needle.length;
  let out = '';
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\' && i + 1 < text.length) {
      out += ch + text[i + 1];
      i += 2;
      continue;
    }
    if (ch === '"') return decodeMlirString(out);
    out += ch;
    i++;
  }
  return null;
}

function parseAnchor(text) {
  const ms = text.match(/tsfg_source\.start\s*=\s*(\d+)/);
  const me = text.match(/tsfg_source\.end\s*=\s*(\d+)/);
  return { start: ms ? Number(ms[1]) : 0, end: me ? Number(me[1]) : 0 };
}

function parseOpLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('//')) return null;

  let result = null;
  let rest = trimmed;
  const eqIdx = trimmed.match(/^(%[\w$.-]+)\s*=\s*(.*)$/);
  if (eqIdx) {
    result = eqIdx[1];
    rest = eqIdx[2];
  }

  const head = rest.match(/^"([^"]+)"\(([^)]*)\)(?:\[([^\]]*)\])?(.*)$/);
  if (!head) return null;

  const name = head[1];
  const operands = head[2].trim() ? head[2].split(',').map((s) => s.trim()).filter(Boolean) : [];
  const successors = head[3]
    ? head[3].split(',').map((s) => s.trim().replace(/^\^/, '')).filter(Boolean)
    : [];
  const tail = head[4] ?? '';

  const propsRaw = extractQuotedField(tail, 'properties');
  const properties = propsRaw ? JSON.parse(propsRaw) : {};
  const viewType = extractQuotedField(tail, 'view_type');
  const anchor = parseAnchor(tail);

  let operandSegmentSizes = null;
  const segMatch = tail.match(/operandSegmentSizes\s*=\s*array<i32:\s*([^>]+)>/);
  if (segMatch) {
    operandSegmentSizes = segMatch[1].split(',').map((n) => Number(n.trim()));
  }

  const tyIdx = tail.lastIndexOf(') -> ');
  const resultType = tyIdx >= 0 ? tail.slice(tyIdx + 5).trim() : '()';

  return { name, result, operands, successors, properties, viewType, anchor, operandSegmentSizes, resultType };
}

/**
 * Parse canonicalized or optimized `tsfg-core-ir --common-program` MLIR text.
 */
export function parseCommonCoreMlir(mlirText) {
  const lines = mlirText.split(/\r?\n/);
  const functions = [];
  let moduleTail = '';

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fnMatch = line.match(/"func\.func"\(\)\s*<\{function_type\s*=\s*\(([^)]*)\)\s*->\s*([^,]+),\s*sym_name\s*=\s*"([^"]+)"\}>\s*\(\{/);
    if (!fnMatch) {
      if (line.includes('tsfg_program.program = {')) {
        moduleTail = line;
      }
      i++;
      continue;
    }

    const paramTypes = fnMatch[1].trim() ? splitTopLevel(fnMatch[1]) : [];
    const returnType = fnMatch[2].trim();
    const symName = fnMatch[3];
    const blocks = [];
    let currentBlock = null;
    let attrsRaw = '';
    i++;

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
        if (currentBlock) blocks.push(currentBlock);
        const params = [];
        if (bbMatch[2] && bbMatch[2].trim()) {
          for (const part of splitTopLevel(bbMatch[2])) {
            const pm = part.match(/^(%[\w$.-]+)\s*:\s*(.+)$/);
            if (pm) params.push({ reg: pm[1], type: pm[2].trim() });
          }
        }
        currentBlock = { label: bbMatch[1], params, ops: [] };
      } else {
        if (!currentBlock) currentBlock = { label: 'bb0', params: [], ops: [] };
        const op = parseOpLine(l);
        if (op) currentBlock.ops.push(op);
      }
      i++;
    }
    if (currentBlock) blocks.push(currentBlock);

    const functionId = extractQuotedField(attrsRaw, 'tsfg_program.function_id') ?? symName;
    const role = extractQuotedField(attrsRaw, 'tsfg_program.role') ?? 'source';
    const sourcePath = extractQuotedField(attrsRaw, 'tsfg_program.source_path') ?? '';
    functions.push({
      symName,
      functionId,
      role,
      sourcePath,
      paramTypes,
      returnType,
      blocks,
    });
  }

  let hir = null;
  let representation = null;
  if (moduleTail) {
    const markerIdx = moduleTail.indexOf('tsfg_program.program = {');
    const markerSlice = moduleTail.slice(markerIdx);
    const hirRaw = extractQuotedField(markerSlice, 'hir');
    if (hirRaw) hir = JSON.parse(hirRaw);
    const reprRaw = extractQuotedField(markerSlice, 'representation');
    if (reprRaw) representation = JSON.parse(reprRaw);
  }

  // Build concise indexed tables from HIR + parsed functions
  const typesById = new Map();
  const classesById = new Map();
  const fieldsById = new Map();
  const globalsById = new Map();
  const envsById = new Map();
  const functionsById = new Map();
  const exportsByName = new Map();

  let nextClassNum = 100;
  let nextFieldIdxByClass = new Map();
  const classFieldMap = new Map(); // classTypeId -> Map<fieldId, fieldIdx>
  const classNumId = new Map(); // classTypeId -> numeric u64

  if (hir) {
    for (const t of hir.types ?? []) {
      typesById.set(t.id, t);
      if (t.kind === 'value' || t.kind === 'reference') {
        classesById.set(t.id, t);
        classNumId.set(t.id, nextClassNum++);
      }
    }
    // Assign deterministic field indices across inheritance chains (base fields first)
    const assignClassFields = (typeId) => {
      if (classFieldMap.has(typeId)) return classFieldMap.get(typeId);
      const cls = classesById.get(typeId);
      const map = new Map();
      if (cls?.base && classesById.has(cls.base)) {
        for (const [fid, idx] of assignClassFields(cls.base)) {
          map.set(fid, idx);
        }
      }
      for (const f of cls?.fields ?? []) {
        const idx = map.size;
        map.set(f.id, idx);
        fieldsById.set(f.id, { ...f, ownerType: typeId, fieldIndex: idx });
      }
      classFieldMap.set(typeId, map);
      nextFieldIdxByClass.set(typeId, map.size);
      return map;
    };
    for (const typeId of classesById.keys()) assignClassFields(typeId);

    // Globals
    let gIdx = 0;
    for (const g of hir.globals ?? []) {
      const id = g.id ?? g.binding?.id;
      if (id && !globalsById.has(id)) {
        globalsById.set(id, { ...g, id, index: gIdx++ });
      }
    }

    // Environments & slot indices
    for (const env of hir.environments ?? []) {
      const slotMap = new Map();
      for (const [si, slot] of (env.slots ?? []).entries()) {
        slotMap.set(slot.binding, si);
        if (slot.key) slotMap.set(slot.key, si);
      }
      envsById.set(env.id, { ...env, slotMap, slotCount: (env.slots ?? []).length });
    }

    // Map HIR function metadata & exports
    const hirFnById = new Map();
    for (const f of hir.functions ?? []) hirFnById.set(f.id, f);
    for (const m of hir.modules ?? []) {
      for (const e of m.exports ?? []) {
        if (e.kind === 'function') exportsByName.set(e.name, e.target);
      }
    }
    for (const ex of hir.exports ?? []) {
      if (ex.functionId) exportsByName.set(ex.name, ex.functionId);
    }

    for (const [fnIdx, fn] of functions.entries()) {
      const hfn = hirFnById.get(fn.functionId) ?? null;
      fn.index = fnIdx + 1; // 1-based numeric function id for C-ABI closures
      fn.name = hfn?.name ?? (fn.role === 'module-initializer' || fn.role === 'module-initialization' ? '$moduleInit' : fn.symName);
      fn.hirMeta = hfn;
      functionsById.set(fn.functionId, fn);
    }
  } else {
    for (const [fnIdx, fn] of functions.entries()) {
      fn.index = fnIdx + 1;
      fn.name = fn.symName;
      functionsById.set(fn.functionId, fn);
    }
  }

  return {
    hir,
    representation,
    functions,
    functionsById,
    exportsByName,
    typesById,
    classesById,
    classNumId,
    classFieldMap,
    fieldsById,
    globalsById,
    envsById,
  };
}
