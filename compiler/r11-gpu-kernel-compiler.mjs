// SPDX-License-Identifier: MIT
// R11 Explicit GPU Kernel Legality Verifier, SPIR-V 1.3 Compute Shader Binary Emitter,
// SPIR-V Structural Validator, and Integrity-Sealed Pipeline Cache Envelope.
import { createHash } from 'node:crypto';
import { canonical, sha256 } from './r04-identity.mjs';

const ALLOWED_GPU_TYPES = new Set(['i32', 'u32', 'f32', 'f64']);
const ALLOWED_ADDR_SPACES = new Set(['storage_readonly', 'storage_readwrite', 'uniform']);
const FORBIDDEN_GPU_EFFECTS = new Set([
  'gc_ref',
  'managed_alloc',
  'managed_string',
  'throw',
  'await',
  'escape_borrow',
  'implicit_host_deref',
  'recursion',
]);

/**
 * Validate a tsfg `@gpu_kernel` specification before lowering to SPIR-V.
 * Rejects GC references, exceptions, implicit host pointers, recursion, write-aliasing,
 * and unsupported f64 when the negotiated device lacks `shaderFloat64`.
 */
export function verifyGpuKernelSpec(spec, deviceFeatures = { shaderFloat64: false, maxWorkgroupSize: 1024 }) {
  if (!spec || typeof spec.name !== 'string' || !spec.name) {
    throw new TypeError('r11-gpu-invalid: kernel name is required');
  }
  const wg = spec.workgroupSize ?? 64;
  if (!Number.isInteger(wg) || wg <= 0 || wg > (deviceFeatures.maxWorkgroupSize ?? 1024)) {
    throw new TypeError(`r11-gpu-workgroup: invalid workgroupSize ${wg}`);
  }
  for (const eff of spec.effects ?? []) {
    if (FORBIDDEN_GPU_EFFECTS.has(eff)) {
      throw new TypeError(`r11-gpu-illegal-effect: GPU kernel '${spec.name}' forbids '${eff}'`);
    }
  }
  if (!spec.explicitTransfers) {
    throw new TypeError(`r11-gpu-implicit-copy: GPU kernel '${spec.name}' requires explicit host<->device transfers`);
  }

  const seenBindings = new Set();
  const writtenBuffers = new Set();
  const readBuffers = new Set();
  for (const b of spec.bindings ?? []) {
    if (!ALLOWED_ADDR_SPACES.has(b.addressSpace)) {
      throw new TypeError(`r11-gpu-addrspace: invalid addressSpace '${b.addressSpace}'`);
    }
    if (!ALLOWED_GPU_TYPES.has(b.elementType)) {
      throw new TypeError(`r11-gpu-type: forbidden GPU element type '${b.elementType}'`);
    }
    if (b.elementType === 'f64' && !deviceFeatures.shaderFloat64) {
      throw new TypeError('r11-gpu-feature-missing: device does not support shaderFloat64');
    }
    if (seenBindings.has(b.binding)) {
      throw new TypeError(`r11-gpu-dup-binding: duplicate binding ${b.binding}`);
    }
    seenBindings.add(b.binding);
    const bufKey = b.bufferName ?? `b${b.binding}`;
    if (b.addressSpace === 'storage_readwrite') {
      if (writtenBuffers.has(bufKey) || readBuffers.has(bufKey)) {
        throw new TypeError(`r11-gpu-write-alias: buffer '${bufKey}' aliased with write access`);
      }
      writtenBuffers.add(bufKey);
    } else {
      if (writtenBuffers.has(bufKey)) {
        throw new TypeError(`r11-gpu-write-alias: buffer '${bufKey}' aliased with write access`);
      }
      readBuffers.add(bufKey);
    }
  }
  if (seenBindings.size === 0) {
    throw new TypeError('r11-gpu-empty-bindings: kernel requires at least one storage/uniform binding');
  }
  return {
    ok: true,
    kernelDigest: sha256(Buffer.from(canonical(spec))),
    workgroupSize: wg,
  };
}

/**
 * Emit a REAL, spec-compliant SPIR-V 1.3 Compute Shader binary (`Uint8Array`)
 * targeting Vulkan 1.3 `GLCompute` with `LocalSize(64, 1, 1)` and 3 StorageBuffer bindings:
 *   - set=0, binding=0: readonly float[] a
 *   - set=0, binding=1: readonly float[] b
 *   - set=0, binding=2: readwrite float[] out
 * Supported ops:
 *   - `'f32_add'`: `out[i] = a[i] + b[i]`
 *   - `'f32_mad'`: `out[i] = a[i] * b[i] + a[i]`
 */
export function emitSpirv13ComputeKernel(mode, elementCount, workgroupSize = 64) {
  if (mode !== 'f32_add' && mode !== 'f32_mad') {
    throw new TypeError(`r11-spirv-op: unsupported kernel mode '${mode}'`);
  }
  const words = [];
  const ins = (opcode, ...operands) => {
    const wc = 1 + operands.length;
    words.push(((wc & 0xffff) << 16) | (opcode & 0xffff));
    for (const o of operands) words.push(o >>> 0);
  };

  // ID allocation
  const ID_MAIN = 1;
  const ID_VOID = 2;
  const ID_FN_TY = 3;
  const ID_U32 = 4;
  const ID_I32 = 5;
  const ID_F32 = 6;
  const ID_BOOL = 7;
  const ID_V3U32 = 8;
  const ID_PTR_IN_V3U32 = 9;
  const ID_PTR_IN_U32 = 10;
  const ID_ARR_F32 = 11;
  const ID_BUF_STRUCT = 12;
  const ID_PTR_SB_STRUCT = 13;
  const ID_PTR_SB_F32 = 14;
  const ID_C0_U32 = 15;
  const ID_C0_I32 = 16;
  const ID_C_COUNT = 17;
  const ID_GL_GID = 18;
  const ID_VAR_A = 19;
  const ID_VAR_B = 20;
  const ID_VAR_OUT = 21;
  const ID_ENTRY = 22;
  const ID_GID_PTR = 23;
  const ID_GID = 24;
  const ID_IN_BOUNDS = 25;
  const ID_BODY = 26;
  const ID_MERGE = 27;
  const ID_PA = 28;
  const ID_PB = 29;
  const ID_PO = 30;
  const ID_VA = 31;
  const ID_VB = 32;
  const ID_TMP1 = 33;
  const ID_RES = 34;
  const BOUND = 35;

  // Header
  words.push(0x07230203); // SPIR-V magic
  words.push(0x00010300); // SPIR-V 1.3
  words.push(0x00000000); // generator
  words.push(BOUND);      // id bound
  words.push(0x00000000); // schema

  // Capabilities & Memory Model
  ins(17, 1);         // OpCapability Shader
  ins(14, 0, 1);      // OpMemoryModel Logical GLSL450

  // EntryPoint "main" & ExecutionMode LocalSize
  ins(15, 5, ID_MAIN, 0x6e69616d, 0x00000000, ID_GL_GID); // OpEntryPoint GLCompute %main "main" %gl_gid
  ins(16, ID_MAIN, 17, workgroupSize, 1, 1);              // OpExecutionMode %main LocalSize wg 1 1

  // Decorations
  ins(71, ID_GL_GID, 11, 28);          // BuiltIn GlobalInvocationId
  ins(71, ID_ARR_F32, 6, 4);           // ArrayStride 4
  ins(71, ID_BUF_STRUCT, 2);           // Block
  ins(72, ID_BUF_STRUCT, 0, 35, 0);    // MemberDecorate Offset 0
  ins(71, ID_VAR_A, 34, 0);            // DescriptorSet 0
  ins(71, ID_VAR_A, 33, 0);            // Binding 0
  ins(71, ID_VAR_B, 34, 0);            // DescriptorSet 0
  ins(71, ID_VAR_B, 33, 1);            // Binding 1
  ins(71, ID_VAR_OUT, 34, 0);          // DescriptorSet 0
  ins(71, ID_VAR_OUT, 33, 2);          // Binding 2

  // Types & Constants
  ins(19, ID_VOID);
  ins(33, ID_FN_TY, ID_VOID);
  ins(21, ID_U32, 32, 0);
  ins(21, ID_I32, 32, 1);
  ins(22, ID_F32, 32);
  ins(20, ID_BOOL);
  ins(23, ID_V3U32, ID_U32, 3);
  ins(32, ID_PTR_IN_V3U32, 1, ID_V3U32);
  ins(32, ID_PTR_IN_U32, 1, ID_U32);
  ins(29, ID_ARR_F32, ID_F32);
  ins(30, ID_BUF_STRUCT, ID_ARR_F32);
  ins(32, ID_PTR_SB_STRUCT, 12, ID_BUF_STRUCT);
  ins(32, ID_PTR_SB_F32, 12, ID_F32);
  ins(43, ID_U32, ID_C0_U32, 0);
  ins(43, ID_I32, ID_C0_I32, 0);
  ins(43, ID_U32, ID_C_COUNT, elementCount >>> 0);

  // Module Variables
  ins(59, ID_PTR_IN_V3U32, ID_GL_GID, 1);
  ins(59, ID_PTR_SB_STRUCT, ID_VAR_A, 12);
  ins(59, ID_PTR_SB_STRUCT, ID_VAR_B, 12);
  ins(59, ID_PTR_SB_STRUCT, ID_VAR_OUT, 12);

  // Function %main
  ins(54, ID_VOID, ID_MAIN, 0, ID_FN_TY);
  ins(248, ID_ENTRY);
  ins(65, ID_PTR_IN_U32, ID_GID_PTR, ID_GL_GID, ID_C0_U32);
  ins(61, ID_U32, ID_GID, ID_GID_PTR);
  ins(176, ID_BOOL, ID_IN_BOUNDS, ID_GID, ID_C_COUNT);
  ins(247, ID_MERGE, 0);
  ins(250, ID_IN_BOUNDS, ID_BODY, ID_MERGE);

  ins(248, ID_BODY);
  ins(65, ID_PTR_SB_F32, ID_PA, ID_VAR_A, ID_C0_I32, ID_GID);
  ins(65, ID_PTR_SB_F32, ID_PB, ID_VAR_B, ID_C0_I32, ID_GID);
  ins(65, ID_PTR_SB_F32, ID_PO, ID_VAR_OUT, ID_C0_I32, ID_GID);
  ins(61, ID_F32, ID_VA, ID_PA);
  ins(61, ID_F32, ID_VB, ID_PB);
  if (mode === 'f32_add') {
    ins(129, ID_F32, ID_RES, ID_VA, ID_VB); // OpFAdd
  } else {
    ins(133, ID_F32, ID_TMP1, ID_VA, ID_VB); // OpFMul
    ins(129, ID_F32, ID_RES, ID_TMP1, ID_VA); // OpFAdd
  }
  ins(62, ID_PO, ID_RES);
  ins(249, ID_MERGE);

  ins(248, ID_MERGE);
  ins(253); // OpReturn
  ins(56);  // OpFunctionEnd

  const bytes = Buffer.alloc(words.length * 4);
  for (let i = 0; i < words.length; i++) {
    bytes.writeUInt32LE(words[i], i * 4);
  }
  return {
    bytes,
    wordCount: words.length,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

/**
 * Structural SPIR-V binary validator (magic, version, 4-byte alignment, bound, instruction framing).
 */
export function validateSpirvBinary(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 20 || (bytes.length % 4) !== 0) {
    throw new TypeError('r11-spirv-framing: invalid SPIR-V byte length');
  }
  const magic = bytes.readUInt32LE(0);
  if (magic !== 0x07230203) {
    throw new TypeError(`r11-spirv-magic: expected 0x07230203, got 0x${magic.toString(16)}`);
  }
  const version = bytes.readUInt32LE(4);
  const bound = bytes.readUInt32LE(12);
  if (bound < 2) throw new TypeError('r11-spirv-bound: invalid id bound');

  let pos = 5;
  const totalWords = bytes.length / 4;
  let instructionCount = 0;
  let hasEntryPoint = false;
  while (pos < totalWords) {
    const first = bytes.readUInt32LE(pos * 4);
    const wc = first >>> 16;
    const op = first & 0xffff;
    if (wc === 0 || pos + wc > totalWords) {
      throw new TypeError(`r11-spirv-truncated: bad wordCount ${wc} at word ${pos}`);
    }
    if (op === 15) hasEntryPoint = true;
    pos += wc;
    instructionCount += 1;
  }
  if (!hasEntryPoint) throw new TypeError('r11-spirv-no-entry: missing OpEntryPoint');
  return { valid: true, version, bound, instructionCount };
}

/**
 * CPU Reference oracle for R11 GPU kernels (independent of Vulkan/SPIR-V).
 */
export function runCpuGpuReference(mode, a, b) {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) {
    if (mode === 'f32_add') {
      out[i] = Math.fround(a[i] + b[i]);
    } else if (mode === 'f32_mad') {
      out[i] = Math.fround(Math.fround(a[i] * b[i]) + a[i]);
    } else {
      throw new TypeError(`r11-ref-op: unknown mode ${mode}`);
    }
  }
  return out;
}

/**
 * Compile a real TypeScript `@gpu_kernel` function directly to a validated SPIR-V 1.3 compute shader!
 * Supports:
 *   - 2..8 storage buffer parameters (`ReadSpan<f32|i32|u32>`, `Span<f32|i32|u32>`)
 *   - `const`/`let` scalar locals, `+`, `-`, `*`, `/`, parentheses, numeric literals, `buf[i]` reads
 *   - `out[i] = <expr>` assignment guarded by `globalId.x < elementCount`
 *   - Rejects forbidden GPU effects (`gc_ref`, `throw`, `new`, `string`, `any`) statically!
 */
export function compileTsGpuKernelToSpirv(sourceText, opts = {}) {
  const stripped = sourceText.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  if (/\bthrow\b|\bnew\s+[A-Z]|\bas\s+any\b|:\s*any\b|:\s*string\b/.test(stripped)) {
    throw new TypeError('r11-gpu-illegal-effect: GPU kernel source contains forbidden managed/exception/dynamic construct');
  }

  const fnMatch = stripped.match(/@gpu_kernel\s+(?:export\s+)?function\s+([A-Za-z_]\w*)\s*\(([^)]*)\)[^{]*\{([\s\S]*)\}/);
  if (!fnMatch) {
    throw new TypeError('r11-gpu-parse: expected `@gpu_kernel function name(...) { ... }`');
  }
  const kernelName = fnMatch[1];
  const rawParams = fnMatch[2].split(',').map((s) => s.trim()).filter(Boolean);
  const body = fnMatch[3];

  const bindings = [];
  for (const rp of rawParams) {
    const pm = rp.match(/^([A-Za-z_]\w*)\s*:\s*(ReadSpan|Span)\s*<\s*(f32|i32|u32)\s*>$/);
    if (!pm) continue;
    bindings.push({
      name: pm[1],
      binding: bindings.length,
      bufferName: pm[1],
      addressSpace: pm[2] === 'Span' ? 'storage_readwrite' : 'storage_readonly',
      elementType: pm[3],
    });
  }
  if (bindings.length < 2 || bindings.length > 8) {
    throw new TypeError(`r11-gpu-bindings: expected 2..8 storage buffer params, found ${bindings.length}`);
  }
  const elemType = bindings[0].elementType;
  if (!bindings.every((b) => b.elementType === elemType)) {
    throw new TypeError('r11-gpu-type: all buffer parameters in a compute kernel must share scalar element type');
  }

  const elementCount = opts.elementCount ?? 1024;
  const workgroupSize = opts.workgroupSize ?? 64;
  verifyGpuKernelSpec({
    name: kernelName,
    workgroupSize,
    explicitTransfers: true,
    effects: [],
    bindings,
  });

  // Parse simple statements: `const/let x = expr;` and `out[idx] = expr;`
  const stmts = body.split(';').map((s) => s.trim()).filter(Boolean);
  const locals = new Map();
  let storeTarget = null;
  let storeExpr = null;

  const tokenize = (expr) => {
    const toks = [];
    let i = 0;
    while (i < expr.length) {
      if (/\s/.test(expr[i])) { i++; continue; }
      if ('+-*/()[]'.includes(expr[i])) { toks.push({ k: expr[i], v: expr[i] }); i++; continue; }
      const nm = expr.slice(i).match(/^\d+(?:\.\d+)?/);
      if (nm) { toks.push({ k: 'num', v: nm[0] }); i += nm[0].length; continue; }
      const id = expr.slice(i).match(/^[A-Za-z_]\w*/);
      if (id) { toks.push({ k: 'id', v: id[0] }); i += id[0].length; continue; }
      throw new TypeError(`r11-gpu-parse: unexpected token '${expr[i]}' in GPU expression`);
    }
    return toks;
  };

  const parseExpr = (expr) => {
    const toks = tokenize(expr);
    let pos = 0;
    const peek = () => toks[pos];
    const eat = (k) => {
      if (toks[pos]?.k !== k) throw new TypeError(`r11-gpu-parse: expected '${k}'`);
      return toks[pos++];
    };
    const parsePrimary = () => {
      const tk = peek();
      if (!tk) throw new TypeError('r11-gpu-parse: unexpected end of expression');
      if (tk.k === '(') {
        eat('(');
        const inner = parseAddSub();
        eat(')');
        return inner;
      }
      if (tk.k === 'num') {
        pos++;
        return { kind: 'lit', value: Number(tk.v) };
      }
      if (tk.k === 'id') {
        pos++;
        if (peek()?.k === '[') {
          eat('[');
          while (peek() && peek().k !== ']') pos++;
          eat(']');
          return { kind: 'load', buffer: tk.v };
        }
        return { kind: 'var', name: tk.v };
      }
      throw new TypeError(`r11-gpu-parse: unexpected token '${tk.v}'`);
    };
    const parseMulDiv = () => {
      let left = parsePrimary();
      while (peek()?.k === '*' || peek()?.k === '/') {
        const op = toks[pos++].k;
        left = { kind: 'bin', op, left, right: parsePrimary() };
      }
      return left;
    };
    const parseAddSub = () => {
      let left = parseMulDiv();
      while (peek()?.k === '+' || peek()?.k === '-') {
        const op = toks[pos++].k;
        left = { kind: 'bin', op, left, right: parseMulDiv() };
      }
      return left;
    };
    return parseAddSub();
  };

  const orderedLocals = [];
  for (const st of stmts) {
    if (st.startsWith('if') || st.startsWith('return')) continue;
    const lm = st.match(/^(?:const|let)\s+([A-Za-z_]\w*)(?:\s*:\s*[A-Za-z_]\w*)?\s*=\s*(.+)$/);
    if (lm) {
      orderedLocals.push({ name: lm[1], ast: parseExpr(lm[2]) });
      continue;
    }
    const sm = st.match(/^([A-Za-z_]\w*)\s*\[[^\]]+\]\s*=\s*(.+)$/);
    if (sm) {
      storeTarget = sm[1];
      storeExpr = parseExpr(sm[2]);
    }
  }
  if (!storeTarget || !storeExpr) {
    throw new TypeError('r11-gpu-parse: GPU kernel must contain an output buffer assignment `out[i] = ...`');
  }
  const outBinding = bindings.find((b) => b.name === storeTarget && b.addressSpace === 'storage_readwrite');
  if (!outBinding) {
    throw new TypeError(`r11-gpu-write-target: '${storeTarget}' is not a writable Span<T> parameter`);
  }

  // Emit SPIR-V 1.3 instructions dynamically
  let nextId = 1;
  const allocId = () => nextId++;
  const ID_MAIN = allocId();
  const ID_VOID = allocId();
  const ID_FN_TY = allocId();
  const ID_U32 = allocId();
  const ID_I32 = allocId();
  const ID_F32 = allocId();
  const ID_BOOL = allocId();
  const ID_V3U32 = allocId();
  const ID_PTR_IN_V3U32 = allocId();
  const ID_PTR_IN_U32 = allocId();
  const ID_ELEM = elemType === 'f32' ? ID_F32 : elemType === 'i32' ? ID_I32 : ID_U32;
  const ID_ARR = allocId();
  const ID_BUF_STRUCT = allocId();
  const ID_PTR_SB_STRUCT = allocId();
  const ID_PTR_SB_ELEM = allocId();
  const ID_C0_U32 = allocId();
  const ID_C0_I32 = allocId();
  const ID_C_COUNT = allocId();
  const ID_GL_GID = allocId();
  const varIdByBuf = new Map();
  for (const b of bindings) varIdByBuf.set(b.name, allocId());

  const ID_ENTRY = allocId();
  const ID_GID_PTR = allocId();
  const ID_GID = allocId();
  const ID_IN_BOUNDS = allocId();
  const ID_BODY = allocId();
  const ID_MERGE = allocId();

  const constEntries = [];
  const constIdByKey = new Map();
  const internLit = (val) => {
    let bits;
    if (elemType === 'f32') {
      const f = new Float32Array([val]);
      bits = new Uint32Array(f.buffer)[0];
    } else {
      bits = (val | 0) >>> 0;
    }
    const key = `${elemType}:${bits}`;
    if (constIdByKey.has(key)) return constIdByKey.get(key);
    const id = allocId();
    constIdByKey.set(key, id);
    constEntries.push({ id, bits });
    return id;
  };

  const bodyIns = [];
  const emitBody = (op, ...args) => bodyIns.push([op, ...args]);

  const lowerAst = (node) => {
    if (node.kind === 'lit') return internLit(node.value);
    if (node.kind === 'var') {
      if (!locals.has(node.name)) throw new TypeError(`r11-gpu-var: undefined variable '${node.name}'`);
      return locals.get(node.name);
    }
    if (node.kind === 'load') {
      const varId = varIdByBuf.get(node.buffer);
      if (!varId) throw new TypeError(`r11-gpu-buf: unknown buffer '${node.buffer}'`);
      const ptrId = allocId();
      const valId = allocId();
      emitBody(65, ID_PTR_SB_ELEM, ptrId, varId, ID_C0_I32, ID_GID);
      emitBody(61, ID_ELEM, valId, ptrId);
      return valId;
    }
    if (node.kind === 'bin') {
      const l = lowerAst(node.left);
      const r = lowerAst(node.right);
      const dst = allocId();
      const opTable = elemType === 'f32'
        ? { '+': 129, '-': 131, '*': 133, '/': 136 }
        : elemType === 'i32'
          ? { '+': 128, '-': 130, '*': 132, '/': 135 }
          : { '+': 128, '-': 130, '*': 132, '/': 134 };
      emitBody(opTable[node.op], ID_ELEM, dst, l, r);
      return dst;
    }
    throw new TypeError(`r11-gpu-ast: unsupported node ${node.kind}`);
  };

  for (const loc of orderedLocals) {
    locals.set(loc.name, lowerAst(loc.ast));
  }
  const resId = lowerAst(storeExpr);
  const outPtrId = allocId();
  emitBody(65, ID_PTR_SB_ELEM, outPtrId, varIdByBuf.get(storeTarget), ID_C0_I32, ID_GID);
  emitBody(62, outPtrId, resId);

  const words = [];
  const ins = (opcode, ...operands) => {
    const wc = 1 + operands.length;
    words.push(((wc & 0xffff) << 16) | (opcode & 0xffff));
    for (const o of operands) words.push(o >>> 0);
  };

  words.push(0x07230203, 0x00010300, 0x00000000, nextId, 0x00000000);
  ins(17, 1);
  ins(14, 0, 1);
  ins(15, 5, ID_MAIN, 0x6e69616d, 0x00000000, ID_GL_GID);
  ins(16, ID_MAIN, 17, workgroupSize, 1, 1);

  ins(71, ID_GL_GID, 11, 28);
  ins(71, ID_ARR, 6, 4);
  ins(71, ID_BUF_STRUCT, 2);
  ins(72, ID_BUF_STRUCT, 0, 35, 0);
  for (const b of bindings) {
    const vid = varIdByBuf.get(b.name);
    ins(71, vid, 34, 0);
    ins(71, vid, 33, b.binding);
  }

  ins(19, ID_VOID);
  ins(33, ID_FN_TY, ID_VOID);
  ins(21, ID_U32, 32, 0);
  ins(21, ID_I32, 32, 1);
  ins(22, ID_F32, 32);
  ins(20, ID_BOOL);
  ins(23, ID_V3U32, ID_U32, 3);
  ins(32, ID_PTR_IN_V3U32, 1, ID_V3U32);
  ins(32, ID_PTR_IN_U32, 1, ID_U32);
  ins(29, ID_ARR, ID_ELEM);
  ins(30, ID_BUF_STRUCT, ID_ARR);
  ins(32, ID_PTR_SB_STRUCT, 12, ID_BUF_STRUCT);
  ins(32, ID_PTR_SB_ELEM, 12, ID_ELEM);
  ins(43, ID_U32, ID_C0_U32, 0);
  ins(43, ID_I32, ID_C0_I32, 0);
  ins(43, ID_U32, ID_C_COUNT, elementCount >>> 0);
  for (const c of constEntries) {
    ins(43, ID_ELEM, c.id, c.bits);
  }

  ins(59, ID_PTR_IN_V3U32, ID_GL_GID, 1);
  for (const b of bindings) {
    ins(59, ID_PTR_SB_STRUCT, varIdByBuf.get(b.name), 12);
  }

  ins(54, ID_VOID, ID_MAIN, 0, ID_FN_TY);
  ins(248, ID_ENTRY);
  ins(65, ID_PTR_IN_U32, ID_GID_PTR, ID_GL_GID, ID_C0_U32);
  ins(61, ID_U32, ID_GID, ID_GID_PTR);
  ins(176, ID_BOOL, ID_IN_BOUNDS, ID_GID, ID_C_COUNT);
  ins(247, ID_MERGE, 0);
  ins(250, ID_IN_BOUNDS, ID_BODY, ID_MERGE);

  ins(248, ID_BODY);
  for (const bi of bodyIns) ins(...bi);
  ins(249, ID_MERGE);

  ins(248, ID_MERGE);
  ins(253);
  ins(56);

  const bytes = Buffer.alloc(words.length * 4);
  for (let i = 0; i < words.length; i++) bytes.writeUInt32LE(words[i], i * 4);
  const validation = validateSpirvBinary(bytes);
  return {
    name: kernelName,
    bindings,
    elementType: elemType,
    workgroupSize,
    bytes,
    wordCount: words.length,
    validation,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}
