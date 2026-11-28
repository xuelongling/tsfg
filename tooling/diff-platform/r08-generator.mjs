// SPDX-License-Identifier: MIT
// R08 Seeded Core IR / tsfg Dialect Program Generator + Independent Semantic Oracle
// + R05 TSFGR05B Binary Bytecode Encoder for 5-way Cross-Backend Differential Testing.
import { createHash } from 'node:crypto';
import { functionId, sha256, WINDOWS_X64_TARGET } from '../../compiler/r04-identity.mjs';

function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0);
  };
}

const f64Buf = new ArrayBuffer(8);
const f64View = new DataView(f64Buf);
const CANON_NAN_HEX = '7ff8000000000000';

export function f64HexToNum(hex) {
  f64View.setBigUint64(0, BigInt('0x' + hex), true);
  return f64View.getFloat64(0, true);
}

export function numToCanonF64Hex(n) {
  if (Number.isNaN(n)) return CANON_NAN_HEX;
  f64View.setFloat64(0, n, true);
  return f64View.getBigUint64(0, true).toString(16).padStart(16, '0');
}

/**
 * Generate a deterministic `tsfg` dialect program (i32 or strict f64) from a numeric seed.
 */
export function generateSeededProgram(seed, opts = {}) {
  const kind = opts.kind ?? (seed % 3 === 0 ? 'f64' : 'i32');
  const rng = makeRng(seed);
  const length = opts.length ?? (4 + (rng() % 8));
  const fnName = `diff_fn_s${seed}_${kind}`;
  const ops = [{ op: 'tsfg.fuel', attrs: { event: 'entry' }, operands: [] }];

  if (kind === 'i32') {
    const live = ['a', 'b'];
    const i32Ops = ['tsfg.add_i32', 'tsfg.sub_i32', 'tsfg.mul_i32', 'tsfg.div_i32', 'tsfg.rem_i32'];
    for (let i = 0; i < length; i++) {
      const rName = `v${i}`;
      const choice = rng() % 6;
      if (choice === 0) {
        const vals = [0, 1, -1, 7, -13, 42, 2147483647, -2147483648];
        ops.push({ op: 'tsfg.const_i32', result: rName, type: 'i32', attrs: { value: vals[rng() % vals.length] }, operands: [] });
      } else {
        const opName = i32Ops[rng() % i32Ops.length];
        const l = live[rng() % live.length];
        const r = live[rng() % live.length];
        ops.push({ op: opName, result: rName, type: 'i32', attrs: {}, operands: [l, r] });
      }
      live.push(rName);
    }
    ops.push({ op: 'tsfg.return', operands: [live[live.length - 1]] });
  } else {
    const live = ['a', 'b'];
    const fOps = ['tsfg.add_f64', 'tsfg.sub_f64', 'tsfg.mul_f64', 'tsfg.div_f64'];
    const interestingHex = [
      '0000000000000000', // +0.0
      '8000000000000000', // -0.0
      '3ff0000000000000', // 1.0
      '3ff8000000000000', // 1.5
      '0000000000000001', // min subnormal
      '7ff0000000000000', // +Inf
    ];
    for (let i = 0; i < length; i++) {
      const rName = `f${i}`;
      if (rng() % 4 === 0) {
        ops.push({ op: 'tsfg.const_f64', result: rName, type: 'f64', attrs: { bits: interestingHex[rng() % interestingHex.length] }, operands: [] });
      } else {
        const opName = fOps[rng() % fOps.length];
        const l = live[rng() % live.length];
        const r = live[rng() % live.length];
        ops.push({ op: opName, result: rName, type: 'f64', attrs: {}, operands: [l, r] });
      }
      live.push(rName);
    }
    ops.push({ op: 'tsfg.return', operands: [live[live.length - 1]] });
  }

  return {
    abiHash: sha256(`r08-diff-abi-${seed}`),
    functions: [
      {
        functionId: functionId('/src/diff.ts', fnName, kind, [kind, kind]),
        name: fnName,
        ops,
        params: [
          { name: 'a', type: kind },
          { name: 'b', type: kind },
        ],
        returnType: kind,
      },
    ],
    kind,
    seed,
    target: WINDOWS_X64_TARGET.target,
  };
}

/**
 * Independent Semantic Oracle directly evaluating the language specification
 * (wrapping i32, INT32_MIN/-1 trap, INT32_MIN%-1==0, strict IEEE f64 + canonical quiet NaN).
 */
export function evalIndependentOracle(mod, arg0, arg1) {
  const fn = mod.functions[0];
  const env = new Map([['a', arg0], ['b', arg1]]);

  for (const op of fn.ops) {
    if (op.op === 'tsfg.fuel') continue;
    if (op.op === 'tsfg.const_i32') {
      env.set(op.result, op.attrs.value | 0);
    } else if (op.op === 'tsfg.const_f64') {
      env.set(op.result, op.attrs.bits);
    } else if (op.op === 'tsfg.add_i32') {
      env.set(op.result, (env.get(op.operands[0]) + env.get(op.operands[1])) | 0);
    } else if (op.op === 'tsfg.sub_i32') {
      env.set(op.result, (env.get(op.operands[0]) - env.get(op.operands[1])) | 0);
    } else if (op.op === 'tsfg.mul_i32') {
      env.set(op.result, Math.imul(env.get(op.operands[0]), env.get(op.operands[1])));
    } else if (op.op === 'tsfg.div_i32') {
      const l = env.get(op.operands[0]);
      const r = env.get(op.operands[1]);
      if (r === 0 || (l === -2147483648 && r === -1)) return { kind: 'i32', trap: 3, value: 0 };
      env.set(op.result, Math.trunc(l / r) | 0);
    } else if (op.op === 'tsfg.rem_i32') {
      const l = env.get(op.operands[0]);
      const r = env.get(op.operands[1]);
      if (r === 0) return { kind: 'i32', trap: 3, value: 0 };
      env.set(op.result, l === -2147483648 && r === -1 ? 0 : (l % r) | 0);
    } else if (op.op === 'tsfg.add_f64' || op.op === 'tsfg.sub_f64' || op.op === 'tsfg.mul_f64' || op.op === 'tsfg.div_f64') {
      const l = f64HexToNum(env.get(op.operands[0]));
      const r = f64HexToNum(env.get(op.operands[1]));
      const out = op.op === 'tsfg.add_f64' ? l + r : op.op === 'tsfg.sub_f64' ? l - r : op.op === 'tsfg.mul_f64' ? l * r : l / r;
      env.set(op.result, numToCanonF64Hex(out));
    } else if (op.op === 'tsfg.return') {
      const v = env.get(op.operands[0]);
      return fn.returnType === 'f64' ? { bits: v, kind: 'f64', trap: 0 } : { kind: 'i32', trap: 0, value: v | 0 };
    }
  }
  throw new Error('oracle: function fell off end without tsfg.return');
}

/**
 * Compile a generated R08 `tsfg` dialect program directly to R05 `TSFGR05B` binary bytecode
 * so the exact same program executes on BOTH R05 Zig VM (unfused/fused) AND R07 AOT DLL (`/O0`/`/O2`).
 */
export function encodeDialectToR05Bytecode(mod) {
  const fn = mod.functions[0];
  const regMap = new Map([['a', 0], ['b', 1]]);
  let nextReg = 2;
  const f64Pool = [];
  const f64Map = new Map();
  const internF64 = (hex) => {
    if (f64Map.has(hex)) return f64Map.get(hex);
    const idx = f64Pool.length;
    f64Pool.push(BigInt('0x' + hex));
    f64Map.set(hex, idx);
    return idx;
  };
  const getR = (name) => {
    if (!regMap.has(name)) regMap.set(name, nextReg++);
    return regMap.get(name);
  };

  const OP = {
    fuel: 1, const_i32: 2, const_f64: 6, add_i32: 10, sub_i32: 11, mul_i32: 12,
    div_i32: 13, rem_i32: 14, add_f64: 26, sub_f64: 27, mul_f64: 28, div_f64: 29, ret: 36,
  };

  const ops = [];
  let spanPos = 1;
  for (const op of fn.ops) {
    const start = spanPos;
    const end = spanPos + 4;
    spanPos += 5;
    if (op.op === 'tsfg.fuel') {
      ops.push({ a: 1, b: 0, dst: 0, end, imm32: 0, op: OP.fuel, start });
    } else if (op.op === 'tsfg.const_i32') {
      ops.push({ a: 0, b: 0, dst: getR(op.result), end, imm32: op.attrs.value | 0, op: OP.const_i32, start });
    } else if (op.op === 'tsfg.const_f64') {
      ops.push({ a: 0, b: 0, dst: getR(op.result), end, imm32: internF64(op.attrs.bits), op: OP.const_f64, start });
    } else if (op.op === 'tsfg.return') {
      ops.push({ a: getR(op.operands[0]), b: 0, dst: 0, end, imm32: 0, op: OP.ret, start });
    } else {
      const code = OP[op.op.slice(5)];
      ops.push({ a: getR(op.operands[0]), b: getR(op.operands[1]), dst: getR(op.result), end, imm32: 0, op: code, start });
    }
  }

  const shaRaw = (s) => createHash('sha256').update(s).digest();
  const chunks = [shaRaw('r08-mod'), shaRaw(mod.abiHash), shaRaw('r08-schema')];
  const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v, 0); chunks.push(b); };
  const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); chunks.push(b); };
  const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v | 0, 0); chunks.push(b); };
  const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt.asUintN(64, BigInt(v)), 0); chunks.push(b); };

  u64(1n); // code_version
  u16(0); // global_count
  u16(0); // caps
  u16(f64Pool.length);
  for (const bits of f64Pool) u64(bits);
  u16(1); // fn_count
  chunks.push(shaRaw(fn.functionId));
  u16(2); // param_count
  u16(nextReg); // reg_count
  u64(0n); // ref_reg_mask
  u16(0); // handlers
  u32(ops.length);
  for (const o of ops) {
    chunks.push(Buffer.from([o.op, 0]));
    u16(o.dst); u16(o.a); u16(o.b); i32(o.imm32); u32(o.start); u32(o.end);
  }

  const payload = Buffer.concat(chunks);
  const digest = shaRaw(payload);
  const hdr = Buffer.alloc(16);
  hdr.write('TSFGR05B', 0, 'ascii');
  hdr.writeUInt32LE(1, 8);
  hdr.writeUInt32LE(48 + payload.length, 12);
  return Buffer.concat([hdr, digest, payload]);
}
