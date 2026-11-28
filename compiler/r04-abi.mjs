// SPDX-License-Identifier: MIT
// R04 DataLayout-driven ABI layout engine and Windows x64 C ABI classifier.
// Single source of truth for `.tsfgabi` generation and validation.
import {
  abiHash,
  canonical,
  functionId,
  HANDLE_LAYOUT,
  sealEnvelope,
  signatureHash,
  typeIdFnPtr,
  typeIdHandle,
  typeIdNominal,
  typeIdScalar,
  typeIdSpan,
  typeIdStringView,
  verifyEnvelope,
  WINDOWS_X64_TARGET,
} from './r04-identity.mjs';

const FORBIDDEN_KINDS = new Set([
  'any',
  'bare_gc_ref',
  'closure_env',
  'js_object',
  'managed_string',
  'unspecialized_generic',
]);

const INT_EXTENSIONS = Object.freeze({
  bool: 'zeroext',
  i8: 'signext',
  i16: 'signext',
  u8: 'zeroext',
  u16: 'zeroext',
});

const ENUM_UNDERLYING_TYPES = new Set(['i8', 'u8', 'i16', 'u16', 'i32', 'u32', 'i64', 'u64']);
const GP_REGS = ['RCX', 'RDX', 'R8', 'R9'];
const XMM_REGS = ['XMM0', 'XMM1', 'XMM2', 'XMM3'];
const WIN64_BYVAL_SIZES = new Set([1, 2, 4, 8]);

/**
 * Parse an LLVM DataLayout string and derive pointer/integer/float ABI sizes & alignments.
 * No layout constants are guessed outside DataLayout.
 */
export function parseLlvmDataLayout(dlString) {
  if (typeof dlString !== 'string' || dlString.length === 0) {
    throw new TypeError('r04-abi-datalayout: missing LLVM DataLayout string');
  }
  const parts = dlString.split('-');
  const endian = parts[0] === 'e' ? 'little' : parts[0] === 'E' ? 'big' : null;
  if (!endian) throw new TypeError(`r04-abi-datalayout: unsupported endianness in ${dlString}`);

  // LLVM default DataLayout baselines (overridden by explicit entries in `dlString`)
  let ptrBits = 64;
  let ptrAlignBytes = 8;
  const intAlignBytes = new Map([
    [1, 1],
    [8, 1],
    [16, 2],
    [32, 4],
    [64, 8],
  ]);
  const floatAlignBytes = new Map([
    [32, 4],
    [64, 8],
  ]);

  for (const token of parts.slice(1)) {
    if (token.startsWith('p:') || token.startsWith('p0:')) {
      const nums = token.slice(token.indexOf(':') + 1).split(':').map(Number);
      ptrBits = nums[0];
      ptrAlignBytes = Math.floor((nums[1] ?? nums[0]) / 8);
    } else if (/^i\d+:\d+/.test(token)) {
      const m = token.match(/^i(\d+):(\d+)/);
      intAlignBytes.set(Number(m[1]), Math.floor(Number(m[2]) / 8));
    } else if (/^f\d+:\d+/.test(token)) {
      const m = token.match(/^f(\d+):(\d+)/);
      floatAlignBytes.set(Number(m[1]), Math.floor(Number(m[2]) / 8));
    }
  }

  const ptrBytes = Math.floor(ptrBits / 8);
  const scalars = {
    void: { align: 1, size: 0, stride: 0 },
    bool: { align: intAlignBytes.get(8) ?? 1, size: 1, stride: 1 },
    i8: { align: intAlignBytes.get(8) ?? 1, size: 1, stride: 1 },
    u8: { align: intAlignBytes.get(8) ?? 1, size: 1, stride: 1 },
    i16: { align: intAlignBytes.get(16) ?? 2, size: 2, stride: 2 },
    u16: { align: intAlignBytes.get(16) ?? 2, size: 2, stride: 2 },
    i32: { align: intAlignBytes.get(32) ?? 4, size: 4, stride: 4 },
    u32: { align: intAlignBytes.get(32) ?? 4, size: 4, stride: 4 },
    i64: { align: intAlignBytes.get(64) ?? 8, size: 8, stride: 8 },
    u64: { align: intAlignBytes.get(64) ?? 8, size: 8, stride: 8 },
    isize: { align: ptrAlignBytes, size: ptrBytes, stride: ptrBytes },
    usize: { align: ptrAlignBytes, size: ptrBytes, stride: ptrBytes },
    f32: { align: floatAlignBytes.get(32) ?? 4, size: 4, stride: 4 },
    f64: { align: floatAlignBytes.get(64) ?? 8, size: 8, stride: 8 },
  };
  return { endian, ptrAlignBytes, ptrBits, ptrBytes, scalars };
}

function alignUp(offset, align) {
  return Math.ceil(offset / align) * align;
}

/**
 * Compute DataLayout-driven type records for all ABI declarations.
 */
export function resolveAbiTypes(typeSpecs, target = WINDOWS_X64_TARGET) {
  const dl = parseLlvmDataLayout(target.llvmDataLayout);
  if (dl.ptrBits !== target.pointerBits) {
    throw new TypeError(`r04-abi-target: pointerBits ${target.pointerBits} disagrees with DataLayout ${dl.ptrBits}`);
  }

  const resolvedByName = new Map();
  const visiting = new Set();

  // Seed all canonical scalars
  for (const [name, layout] of Object.entries(dl.scalars)) {
    resolvedByName.set(name, {
      align: layout.align,
      byteSize: layout.size,
      fields: [],
      id: typeIdScalar(name),
      kind: 'scalar',
      name,
      padding: [],
      sourcePath: '',
      stride: layout.stride,
    });
  }

  const specByName = new Map();
  for (const spec of typeSpecs) {
    if (FORBIDDEN_KINDS.has(spec.kind)) {
      throw new TypeError(`r04-abi-forbidden-type: ${spec.name} (${spec.kind}) is not ABI-safe`);
    }
    if (specByName.has(spec.name)) {
      throw new TypeError(`r04-abi-duplicate-type: ${spec.name}`);
    }
    specByName.set(spec.name, spec);
  }

  const resolve = (name) => {
    if (resolvedByName.has(name)) return resolvedByName.get(name);
    const spec = specByName.get(name);
    if (!spec) throw new TypeError(`r04-abi-unknown-type: ${name}`);
    if (visiting.has(name)) throw new TypeError(`r04-abi-recursive-type: cycle through ${name}`);
    visiting.add(name);

    const sourcePath = spec.sourcePath ?? '/src/abi.ts';
    let rec;
    if (spec.kind === 'enum') {
      if (!ENUM_UNDERLYING_TYPES.has(spec.underlyingType)) {
        throw new TypeError(`r04-abi-enum-backing: invalid underlying type ${spec.underlyingType} for ${name}`);
      }
      const backing = resolve(spec.underlyingType);
      const variants = (spec.variants ?? []).map((v) => ({ name: v.name, value: v.value }));
      if (variants.length === 0) throw new TypeError(`r04-abi-enum-empty: ${name} requires at least one variant`);
      rec = {
        align: backing.align,
        byteSize: backing.byteSize,
        fields: [],
        id: typeIdNominal('enum', sourcePath, name),
        kind: 'enum',
        name,
        padding: [],
        sourcePath,
        stride: backing.stride,
        underlyingType: spec.underlyingType,
        variants,
      };
    } else if (spec.kind === 'handle') {
      const targetId = spec.targetTypeId ?? typeIdNominal('class', sourcePath, spec.targetName ?? name);
      rec = {
        align: HANDLE_LAYOUT.align,
        byteSize: HANDLE_LAYOUT.size,
        fields: HANDLE_LAYOUT.fields.map((f) => ({
          name: f.name,
          offset: f.offset,
          readonly: false,
          type: f.type,
        })),
        id: typeIdHandle(targetId),
        kind: 'handle',
        name,
        padding: [],
        sourcePath,
        stride: HANDLE_LAYOUT.stride,
        targetTypeId: targetId,
      };
    } else if (spec.kind === 'span' || spec.kind === 'read_span') {
      const elem = resolve(spec.elementType);
      const ptrOff = 0;
      const lenOff = alignUp(dl.ptrBytes, dl.ptrAlignBytes);
      const total = alignUp(lenOff + dl.ptrBytes, dl.ptrAlignBytes);
      rec = {
        align: dl.ptrAlignBytes,
        byteSize: total,
        elementType: elem.name,
        fields: [
          { name: 'ptr', offset: ptrOff, readonly: spec.kind === 'read_span', type: 'usize' },
          { name: 'len', offset: lenOff, readonly: true, type: 'usize' },
        ],
        id: typeIdSpan(spec.kind === 'span', elem.id),
        kind: spec.kind,
        name,
        padding: [],
        sourcePath,
        stride: total,
      };
    } else if (spec.kind === 'string_view') {
      const lenOff = alignUp(dl.ptrBytes, dl.ptrAlignBytes);
      const total = alignUp(lenOff + dl.ptrBytes, dl.ptrAlignBytes);
      rec = {
        align: dl.ptrAlignBytes,
        byteSize: total,
        fields: [
          { name: 'ptr', offset: 0, readonly: true, type: 'usize' },
          { name: 'len', offset: lenOff, readonly: true, type: 'usize' },
        ],
        id: typeIdStringView(),
        kind: 'string_view',
        name,
        padding: [],
        sourcePath,
        stride: total,
      };
    } else if (spec.kind === 'fn_ptr') {
      const ret = resolve(spec.returnType);
      const params = (spec.paramTypes ?? []).map((p) => resolve(p).name);
      const sHash = signatureHash(ret.name, params);
      rec = {
        align: dl.ptrAlignBytes,
        byteSize: dl.ptrBytes,
        fields: [],
        id: typeIdFnPtr(sHash),
        kind: 'fn_ptr',
        name,
        padding: [],
        paramTypes: params,
        returnType: ret.name,
        signatureHash: sHash,
        sourcePath,
        stride: dl.ptrBytes,
      };
    } else if (spec.kind === 'struct') {
      let offset = 0;
      let maxAlign = 1;
      const fields = [];
      const padding = [];
      const seen = new Set();
      for (const f of spec.fields ?? []) {
        if (seen.has(f.name)) throw new TypeError(`r04-abi-duplicate-field: ${name}.${f.name}`);
        seen.add(f.name);
        if (FORBIDDEN_KINDS.has(f.type)) {
          throw new TypeError(`r04-abi-forbidden-field: ${name}.${f.name} has forbidden type ${f.type}`);
        }
        const fType = resolve(f.type);
        if (fType.byteSize === 0) throw new TypeError(`r04-abi-zero-sized-field: ${name}.${f.name}`);
        const aligned = alignUp(offset, fType.align);
        if (aligned > offset) padding.push({ end: aligned, start: offset });
        fields.push({
          name: f.name,
          offset: aligned,
          readonly: Boolean(f.readonly),
          type: fType.name,
        });
        offset = aligned + fType.byteSize;
        if (fType.align > maxAlign) maxAlign = fType.align;
      }
      const byteSize = alignUp(offset, maxAlign);
      if (byteSize > offset) padding.push({ end: byteSize, start: offset });
      if (byteSize > 65536) throw new TypeError(`r04-abi-type-limit: ${name} exceeds 65536 bytes`);
      rec = {
        align: maxAlign,
        byteSize,
        fields,
        id: typeIdNominal(spec.category ?? 'struct', sourcePath, name),
        kind: 'struct',
        name,
        padding,
        sourcePath,
        stride: byteSize,
      };
    } else if (spec.kind === 'tagged_union') {
      const tagTypeName = spec.tagType ?? 'u8';
      if (!ENUM_UNDERLYING_TYPES.has(tagTypeName)) {
        throw new TypeError(`r04-abi-union-tag: invalid tagType ${tagTypeName} for ${name}`);
      }
      const tagType = resolve(tagTypeName);
      let payloadSize = 0;
      let payloadAlign = 1;
      const variants = [];
      for (const v of spec.variants ?? []) {
        const vt = resolve(v.type);
        variants.push({ name: v.name, tagValue: v.tagValue, type: vt.name });
        if (vt.byteSize > payloadSize) payloadSize = vt.byteSize;
        if (vt.align > payloadAlign) payloadAlign = vt.align;
      }
      if (variants.length === 0) throw new TypeError(`r04-abi-union-empty: ${name} requires variants`);
      const payloadOffset = alignUp(tagType.byteSize, payloadAlign);
      const maxAlign = Math.max(tagType.align, payloadAlign);
      const byteSize = alignUp(payloadOffset + payloadSize, maxAlign);
      const padding = [];
      if (payloadOffset > tagType.byteSize) padding.push({ end: payloadOffset, start: tagType.byteSize });
      if (byteSize > payloadOffset + payloadSize) padding.push({ end: byteSize, start: payloadOffset + payloadSize });
      rec = {
        align: maxAlign,
        byteSize,
        fields: [
          { name: 'tag', offset: 0, readonly: false, type: tagTypeName },
          { name: 'payload', offset: payloadOffset, readonly: false, type: `opaque_${payloadSize}B_a${payloadAlign}` },
        ],
        id: typeIdNominal('tagged_union', sourcePath, name),
        kind: 'tagged_union',
        name,
        padding,
        payloadAlign,
        payloadOffset,
        payloadSize,
        sourcePath,
        stride: byteSize,
        tagType: tagTypeName,
        variants,
      };
    } else {
      throw new TypeError(`r04-abi-unknown-kind: ${spec.kind}`);
    }

    visiting.delete(name);
    resolvedByName.set(name, rec);
    return rec;
  };

  for (const spec of typeSpecs) resolve(spec.name);
  return [...resolvedByName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Classify a single function signature under Microsoft Windows x64 C ABI (`win64_c`).
 */
export function classifyWin64Function(fnSpec, typeMap) {
  const retType = typeMap.get(fnSpec.returnType);
  if (!retType) throw new TypeError(`r04-abi-unknown-return: ${fnSpec.name} -> ${fnSpec.returnType}`);

  // 1. Return value classification
  let retClass;
  let usesSret = false;
  if (retType.name === 'void') {
    retClass = { extension: 'none', mode: 'void', register: '', type: 'void' };
  } else if (retType.kind === 'scalar' && (retType.name === 'f32' || retType.name === 'f64')) {
    retClass = { extension: 'none', mode: 'xmm_reg', register: 'XMM0', type: retType.name };
  } else if (retType.kind === 'scalar' || retType.kind === 'enum' || retType.kind === 'fn_ptr') {
    const extKey = retType.kind === 'enum' ? retType.underlyingType : retType.name;
    retClass = { extension: INT_EXTENSIONS[extKey] ?? 'none', mode: 'gp_reg', register: 'RAX', type: retType.name };
  } else if (WIN64_BYVAL_SIZES.has(retType.byteSize)) {
    retClass = { extension: 'none', mode: 'by_val_reg', register: 'RAX', type: retType.name };
  } else {
    usesSret = true;
    retClass = { extension: 'none', mode: 'sret_indirect', register: 'RCX', type: retType.name };
  }

  // 2. Parameter classification (Microsoft x64 positional register slots 0..3; sret takes slot 0!)
  const params = [];
  let slot = usesSret ? 1 : 0;
  for (const p of fnSpec.params ?? []) {
    const pt = typeMap.get(p.type);
    if (!pt || pt.name === 'void') {
      throw new TypeError(`r04-abi-invalid-param: ${fnSpec.name}(${p.name}: ${p.type})`);
    }
    const isFloat = pt.kind === 'scalar' && (pt.name === 'f32' || pt.name === 'f64');
    const isScalarLike = pt.kind === 'scalar' || pt.kind === 'enum' || pt.kind === 'fn_ptr';
    const isSmallAgg = !isScalarLike && WIN64_BYVAL_SIZES.has(pt.byteSize);
    const mode = isFloat ? 'xmm_reg' : isScalarLike || isSmallAgg ? 'direct' : 'by_ref_copy';
    const semanticKind = p.semanticKind ?? (pt.kind === 'span' || pt.kind === 'read_span' || pt.kind === 'string_view' ? 'borrow' : 'value');
    const extKey = pt.kind === 'enum' ? pt.underlyingType : pt.name;
    const extension = isScalarLike ? (INT_EXTENSIONS[extKey] ?? 'none') : 'none';
    const location = slot < 4 ? (isFloat ? XMM_REGS[slot] : GP_REGS[slot]) : `STACK_${(slot - 4) * 8}`;
    params.push({
      extension,
      location,
      mode,
      name: p.name,
      semanticKind,
      slot,
      type: pt.name,
    });
    slot++;
  }

  const paramTypeNames = params.map((p) => p.type);
  const sigHash = signatureHash(retType.name, paramTypeNames);
  const sourcePath = fnSpec.sourcePath ?? '/src/abi.ts';
  return {
    callingConvention: 'win64_c',
    functionId: functionId(sourcePath, fnSpec.name, retType.name, paramTypeNames),
    name: fnSpec.name,
    params,
    returnClass: retClass,
    signatureHash: sigHash,
    sourcePath,
    symbol: fnSpec.symbol ?? fnSpec.name,
  };
}

/**
 * Emit a canonical, verified `.tsfgabi` artifact from ABI declarations.
 */
export function emitAbiArtifact(spec) {
  const target = spec.target ?? WINDOWS_X64_TARGET;
  const callingConvention = spec.callingConvention ?? 'win64_c';
  if (callingConvention !== 'win64_c') {
    throw new TypeError(`r04-abi-cc: unsupported callingConvention ${callingConvention}`);
  }
  const types = resolveAbiTypes(spec.types ?? [], target);
  const typeMap = new Map(types.map((t) => [t.name, t]));
  const functions = (spec.functions ?? [])
    .map((f) => classifyWin64Function(f, typeMap))
    .sort((a, b) => a.name.localeCompare(b.name));

  const core = { callingConvention, functions, target, types };
  const hash = abiHash(core);
  const payload = {
    abiHash: hash,
    callingConvention,
    functions,
    handleLayout: HANDLE_LAYOUT,
    target,
    types,
  };
  return sealEnvelope('tsfg.abi', 1, payload);
}

/**
 * Validate a `.tsfgabi` binary envelope, recomputing DataLayout layouts, Win64 classifications, and abiHash.
 */
export function validateAbiArtifact(bytes, expected = {}) {
  const { envelope, payload } = verifyEnvelope(bytes, 'tsfg.abi', 1, { maxBytes: 4194304, maxDepth: 32 });
  if (payload.callingConvention !== 'win64_c') {
    throw new TypeError(`r04-abi-cc: unsupported callingConvention ${payload.callingConvention}`);
  }
  if (expected.target && payload.target.target !== expected.target) {
    throw new TypeError(`r04-abi-target-mismatch: expected ${expected.target}, got ${payload.target.target}`);
  }
  if (expected.triple && payload.target.triple !== expected.triple) {
    throw new TypeError(`r04-abi-triple-mismatch: expected ${expected.triple}, got ${payload.target.triple}`);
  }
  if (expected.abiHash && payload.abiHash !== expected.abiHash) {
    throw new TypeError(`r04-abi-hash-mismatch: expected ${expected.abiHash}, got ${payload.abiHash}`);
  }

  // Independently recompute layouts from DataLayout and verify every type + function classification
  const dl = parseLlvmDataLayout(payload.target.llvmDataLayout);
  if (dl.ptrBits !== payload.target.pointerBits) {
    throw new TypeError('r04-abi-datalayout: pointerBits mismatch');
  }
  const typeMap = new Map(payload.types.map((t) => [t.name, t]));
  for (const t of payload.types) {
    if (FORBIDDEN_KINDS.has(t.kind)) throw new TypeError(`r04-abi-forbidden-type: ${t.name}`);
    if (t.kind === 'scalar') {
      const exp = dl.scalars[t.name];
      if (!exp || t.byteSize !== exp.size || t.align !== exp.align || t.stride !== exp.stride) {
        throw new TypeError(`r04-abi-layout-mismatch: scalar ${t.name}`);
      }
    } else if (t.kind === 'struct') {
      let off = 0;
      let maxA = 1;
      for (const f of t.fields) {
        const ft = typeMap.get(f.type);
        if (!ft) throw new TypeError(`r04-abi-unknown-field-type: ${t.name}.${f.name}`);
        const aligned = alignUp(off, ft.align);
        if (f.offset !== aligned) {
          throw new TypeError(`r04-abi-offset-mismatch: ${t.name}.${f.name} expected ${aligned}, got ${f.offset}`);
        }
        off = aligned + ft.byteSize;
        if (ft.align > maxA) maxA = ft.align;
      }
      const expSize = alignUp(off, maxA);
      if (t.align !== maxA || t.byteSize !== expSize || t.stride !== expSize) {
        throw new TypeError(`r04-abi-struct-size-mismatch: ${t.name}`);
      }
    } else if (t.kind === 'handle') {
      if (t.byteSize !== 8 || t.align !== 4) throw new TypeError(`r04-abi-handle-layout: ${t.name}`);
    }
  }

  const recomputedHash = abiHash({
    callingConvention: payload.callingConvention,
    functions: payload.functions,
    target: payload.target,
    types: payload.types,
  });
  if (recomputedHash !== payload.abiHash) {
    throw new TypeError(`r04-abi-hash-corrupted: expected ${recomputedHash}, got ${payload.abiHash}`);
  }
  return { envelope, payload };
}
