// SPDX-License-Identifier: MIT
// Production Common20 Core IR VM executing canonicalized or optimized
// `tsfg-core-ir.exe --common-program` MLIR modules parsed by `common-mlir-parser.mjs`.
import { parseCommonCoreMlir } from './common-mlir-parser.mjs';

export const TAG = Object.freeze({
  undefined: 0,
  null: 1,
  bool: 2,
  i32: 3,
  f64: 4,
  ref: 5,
  closure: 6,
  array: 7,
  span: 8,
});

export const TRAP = Object.freeze({
  none: 0,
  fuel: 1,
  depth: 2,
  div_zero: 3,
  bounds: 4,
  borrow_conflict: 5,
  span_expired: 6,
  span_readonly: 7,
  span_escape: 8,
  undefined_numeric: 9,
  tdz_uninitialized: 10,
  narrow_mismatch: 11,
  oom: 12,
  invalid_handle: 13,
});

const UNDEF = Object.freeze({ tag: TAG.undefined, payload: 0n });
const NULL_V = Object.freeze({ tag: TAG.null, payload: 0n });
const i32ToU64 = (n) => BigInt((n | 0) >>> 0);
const u64ToI32 = (p) => Number(p & 0xffffffffn) | 0;
const u64ToU32 = (p) => Number(p & 0xffffffffn) >>> 0;
const mkI32 = (n) => ({ tag: TAG.i32, payload: i32ToU64(n) });
const mkBool = (b) => ({ tag: TAG.bool, payload: b ? 1n : 0n });
const f64Buf = new ArrayBuffer(8);
const f64View = new DataView(f64Buf);
const CANON_NAN_BITS = 0x7ff8000000000000n;
const f64BitsToNum = (bits) => {
  f64View.setBigUint64(0, BigInt.asUintN(64, bits), true);
  return f64View.getFloat64(0, true);
};
const numToCanonicalF64Bits = (n) => {
  if (Number.isNaN(n)) return CANON_NAN_BITS;
  f64View.setFloat64(0, n, true);
  return f64View.getBigUint64(0, true);
};
const mkF64 = (n) => ({ tag: TAG.f64, payload: numToCanonicalF64Bits(n) });
const strictEqualVal = (l, r) => {
  if (l.tag !== r.tag) return false;
  if (l.tag === TAG.undefined || l.tag === TAG.null) return true;
  if (l.tag === TAG.f64) return f64BitsToNum(l.payload) === f64BitsToNum(r.payload);
  return l.payload === r.payload;
};

export class CommonCoreVm {
  constructor(mlirText) {
    this.mod = typeof mlirText === 'string' ? parseCommonCoreMlir(mlirText) : mlirText;
    this.objects = [];
    this.envs = [];
    this.closures = [];
    this.arrays = [];
    this.spans = [];
    this.frames = new Map(); // receiver frame id -> { newTarget, objId }
    this.nextFrameId = 1;
    this.globals = new Map();
    this.trap = TRAP.none;
    this.trapAnchor = null;
    this.fuel = 100000;
    this.depthLimit = 64;
    this.depth = 0;
    this.initialized = false;
  }

  setTrap(code, anchor = null) {
    if (this.trap === TRAP.none) {
      this.trap = code;
      this.trapAnchor = anchor;
    }
  }

  allocObject(typeId) {
    const cls = this.mod.classesById.get(typeId);
    const fMap = this.mod.classFieldMap.get(typeId);
    const nFields = fMap ? fMap.size : 0;
    const obj = {
      id: BigInt(this.objects.length + 1),
      typeId,
      kind: cls?.kind ?? 'reference',
      initialized: false,
      fields: Array.from({ length: nFields }, () => UNDEF),
    };
    this.objects.push(obj);
    return obj;
  }

  getObject(id) {
    const idx = Number(id) - 1;
    if (idx < 0 || idx >= this.objects.length) return null;
    return this.objects[idx];
  }

  cloneObject(id) {
    const src = this.getObject(id);
    if (!src) {
      this.setTrap(TRAP.invalid_handle);
      return 0n;
    }
    const dst = {
      id: BigInt(this.objects.length + 1),
      typeId: src.typeId,
      kind: src.kind,
      initialized: src.initialized,
      fields: src.fields.map((v) => ({ tag: v.tag, payload: v.payload })),
    };
    this.objects.push(dst);
    return dst.id;
  }

  createValueObject(typeName, fieldValues = {}) {
    let typeId = null;
    for (const [tid, cls] of this.mod.classesById.entries()) {
      if (cls.name === typeName) { typeId = tid; break; }
    }
    if (!typeId) throw new Error(`Unknown class/value type: ${typeName}`);
    const obj = this.allocObject(typeId);
    const fMap = this.mod.classFieldMap.get(typeId);
    for (const [fid, fidx] of fMap.entries()) {
      const fMeta = this.mod.fieldsById.get(fid);
      if (fMeta && Object.hasOwn(fieldValues, fMeta.name)) {
        const v = fieldValues[fMeta.name];
        obj.fields[fidx] = typeof v === 'object' && 'tag' in v ? v : mkI32(v);
      } else {
        obj.fields[fidx] = mkI32(0);
      }
    }
    obj.initialized = true;
    return { tag: TAG.ref, payload: obj.id };
  }

  createArray(elements = []) {
    const arr = {
      id: BigInt(this.arrays.length + 1),
      items: elements.map((v) => (typeof v === 'object' && 'tag' in v ? v : mkI32(v))),
      activeReaders: 0,
      activeWriter: false,
    };
    this.arrays.push(arr);
    return { tag: TAG.array, payload: arr.id };
  }

  initializeModules() {
    if (this.initialized) return;
    this.initialized = true;
    // Run module initializers in dependency order (imported modules first if possible)
    const initFns = this.mod.functions.filter((f) => f.role === 'module-initializer' || f.role === 'module-initialization');
    if (this.mod.hir?.modules) {
      const byPath = new Map(initFns.map((f) => [f.sourcePath, f]));
      const visited = new Set();
      const order = [];
      const modByPath = new Map(this.mod.hir.modules.map((m) => [m.sourcePath, m]));
      const visit = (p) => {
        if (visited.has(p)) return;
        visited.add(p);
        const m = modByPath.get(p);
        for (const imp of m?.imports ?? []) {
          if (imp.sourcePath) visit(imp.sourcePath);
        }
        const f = byPath.get(p);
        if (f) order.push(f);
      };
      for (const f of initFns) visit(f.sourcePath);
      for (const f of order) {
        const res = this.execFunction(f, []);
        if (res.kind !== 'return') return res;
      }
    } else {
      for (const f of initFns) {
        const res = this.execFunction(f, []);
        if (res.kind !== 'return') return res;
      }
    }
    return { kind: 'return', value: UNDEF };
  }

  callExport(name, rawArgs = [], options = {}) {
    this.fuel = options.fuel ?? 100000;
    this.depthLimit = options.depthLimit ?? 64;
    this.depth = 0;
    this.trap = TRAP.none;
    this.trapAnchor = null;

    if (!this.initialized) {
      const initRes = this.initializeModules();
      if (this.trap !== TRAP.none) return { status: 'trap', trap: this.trap, anchor: this.trapAnchor };
      if (initRes && initRes.kind === 'throw') return { status: 'exception', value: initRes.value };
    }

    const fnId = this.mod.exportsByName.get(name) ?? this.mod.functions.find((f) => f.name === name)?.functionId;
    if (!fnId) throw new Error(`Export not found: ${name}`);
    const fn = this.mod.functionsById.get(fnId);
    const args = rawArgs.map((a) => {
      if (a && typeof a === 'object' && 'tag' in a) return a;
      if (typeof a === 'boolean') return mkBool(a);
      if (a === null) return NULL_V;
      if (a === undefined) return UNDEF;
      return mkI32(a);
    });
    const res = this.execFunction(fn, args);
    if (this.trap !== TRAP.none) return { status: 'trap', trap: this.trap, anchor: this.trapAnchor };
    if (res.kind === 'throw') return { status: 'exception', value: res.value };
    return {
      status: 'ok',
      tag: res.value.tag,
      payload: res.value.payload,
      i32: res.value.tag === TAG.i32 ? u64ToI32(res.value.payload) : null,
      bool: res.value.tag === TAG.bool ? res.value.payload !== 0n : null,
    };
  }

  execFunction(fn, args) {
    if (this.trap !== TRAP.none) return { kind: 'trap' };
    if (this.depth >= this.depthLimit) {
      this.setTrap(TRAP.depth);
      return { kind: 'trap' };
    }
    this.depth++;
    try {
      const blockMap = new Map(fn.blocks.map((b) => [b.label, b]));
      const regs = new Map();
      const cells = new Map();
      const frames = this.frames;

      const entry = fn.blocks[0];
      for (let i = 0; i < entry.params.length; i++) {
        regs.set(entry.params[i].reg, args[i] ?? UNDEF);
      }

      let curBlock = entry;
      while (curBlock) {
        let branched = false;
        for (const op of curBlock.ops) {
          if (this.trap !== TRAP.none) return { kind: 'trap' };
          const getReg = (r) => regs.get(r) ?? UNDEF;
          const setReg = (v) => { if (op.result) regs.set(op.result, v); };
          const jumpTo = (label, passArgs = []) => {
            const target = blockMap.get(label);
            if (!target) throw new Error(`Missing block ${label} in ${fn.name}`);
            for (let i = 0; i < target.params.length; i++) {
              regs.set(target.params[i].reg, passArgs[i] ?? UNDEF);
            }
            curBlock = target;
            branched = true;
          };

          const n = op.name;
          const p = op.properties;

          if (n === 'tsfg_program.fuel') {
            if (this.fuel <= 0) { this.setTrap(TRAP.fuel, op.anchor); return { kind: 'trap' }; }
            this.fuel--;
          } else if (n === 'tsfg_program.constant') {
            const val = Number(p.decimal ?? p.value ?? 0);
            setReg(mkI32(val));
          } else if (n === 'tsfg_program.boolean') {
            setReg(mkBool(Boolean(p.value)));
          } else if (n === 'tsfg_program.undefined') {
            setReg(UNDEF);
          } else if (n === 'tsfg_program.null') {
            setReg(NULL_V);
          } else if (n === 'tsfg_program.floating') {
            const bits = BigInt('0x' + (p.bits ?? '0'));
            setReg({ tag: TAG.f64, payload: bits });
          } else if (n === 'tsfg_program.cell') {
            const cellId = p.binding ?? op.result;
            if (!cells.has(cellId)) cells.set(cellId, UNDEF);
            setReg({ tag: TAG.ref, payload: cellId });
          } else if (n === 'tsfg_program.store') {
            const cellKey = p.binding ?? getReg(op.operands[0]).payload;
            cells.set(cellKey, getReg(op.operands[1]));
          } else if (n === 'tsfg_program.load') {
            const cellKey = p.binding ?? getReg(op.operands[0]).payload;
            setReg(cells.get(cellKey) ?? UNDEF);
          } else if (n === 'tsfg_program.global_store') {
            this.globals.set(p.global, getReg(op.operands[0]));
          } else if (n === 'tsfg_program.global_load') {
            if (!this.globals.has(p.global)) {
              this.setTrap(TRAP.tdz_uninitialized, op.anchor);
              return { kind: 'trap' };
            }
            setReg(this.globals.get(p.global));
          } else if (n === 'tsfg_program.numeric_use') {
            const v = getReg(op.operands[0]);
            if (v.tag !== TAG.i32 && v.tag !== TAG.f64) {
              this.setTrap(TRAP.undefined_numeric, op.anchor);
              return { kind: 'trap' };
            }
            jumpTo(op.successors[0], [v]);
            break;
          } else if (n === 'tsfg_program.binary') {
            const l = getReg(op.operands[0]);
            const r = getReg(op.operands[1]);
            const oper = p.operator;
            let out;
            if (oper === '===' || oper === '==') {
              out = mkBool(strictEqualVal(l, r));
            } else if (oper === '!==' || oper === '!=') {
              out = mkBool(!strictEqualVal(l, r));
            } else if (l.tag === TAG.f64 || r.tag === TAG.f64) {
              const fa = l.tag === TAG.f64 ? f64BitsToNum(l.payload) : u64ToI32(l.payload);
              const fb = r.tag === TAG.f64 ? f64BitsToNum(r.payload) : u64ToI32(r.payload);
              if (oper === '+') out = mkF64(fa + fb);
              else if (oper === '-') out = mkF64(fa - fb);
              else if (oper === '*') out = mkF64(fa * fb);
              else if (oper === '/') out = mkF64(fa / fb);
              else if (oper === '<') out = mkBool(fa < fb);
              else if (oper === '<=') out = mkBool(fa <= fb);
              else if (oper === '>') out = mkBool(fa > fb);
              else if (oper === '>=') out = mkBool(fa >= fb);
              else throw new Error(`Unsupported f64 binary op: ${oper}`);
            } else {
              const a = u64ToI32(l.payload);
              const b = u64ToI32(r.payload);
              if (oper === '+') out = mkI32((a + b) | 0);
              else if (oper === '-') out = mkI32((a - b) | 0);
              else if (oper === '*') out = mkI32(Math.imul(a, b));
              else if (oper === '/') {
                if (b === 0 || (a === -2147483648 && b === -1)) { this.setTrap(TRAP.div_zero, op.anchor); return { kind: 'trap' }; }
                out = mkI32(Math.trunc(a / b));
              } else if (oper === '%') {
                if (b === 0) { this.setTrap(TRAP.div_zero, op.anchor); return { kind: 'trap' }; }
                out = mkI32(a === -2147483648 && b === -1 ? 0 : (a % b) | 0);
              } else if (oper === '<') out = mkBool(a < b);
              else if (oper === '<=') out = mkBool(a <= b);
              else if (oper === '>') out = mkBool(a > b);
              else if (oper === '>=') out = mkBool(a >= b);
              else if (oper === '&') out = mkI32(a & b);
              else if (oper === '|') out = mkI32(a | b);
              else if (oper === '^') out = mkI32(a ^ b);
              else if (oper === '<<') out = mkI32(a << (b & 31));
              else if (oper === '>>') out = mkI32(a >> (b & 31));
              else if (oper === '>>>') out = mkI32(a >>> (b & 31));
              else throw new Error(`Unsupported binary op: ${oper}`);
            }
            setReg(out);
          } else if (n === 'tsfg_program.unary') {
            const v = getReg(op.operands[0]);
            const oper = p.operator;
            if (oper === '-') {
              if (v.tag === TAG.f64) setReg(mkF64(-f64BitsToNum(v.payload)));
              else setReg(mkI32((-u64ToI32(v.payload)) | 0));
            }
            else if (oper === '!') setReg(mkBool(v.payload === 0n));
            else if (oper === '~') setReg(mkI32(~u64ToI32(v.payload)));
            else if (oper === '+') setReg(v);
            else throw new Error(`Unsupported unary op: ${oper}`);
          } else if (n === 'tsfg_program.strict_equal') {
            const l = getReg(op.operands[0]);
            const r = getReg(op.operands[1]);
            const eq = strictEqualVal(l, r);
            setReg(mkBool(p.operator === '!==' ? !eq : eq));
          } else if (n === 'tsfg_program.value_copy') {
            const v = getReg(op.operands[0]);
            const ty = this.mod.typesById.get(p.type);
            if (ty?.kind === 'value' && v.tag === TAG.ref) {
              setReg({ tag: TAG.ref, payload: this.cloneObject(v.payload) });
            } else {
              setReg({ tag: v.tag, payload: v.payload });
            }
          } else if (n === 'tsfg_program.assert') {
            const v = getReg(op.operands[0]);
            const targetTy = this.mod.typesById.get(op.viewType);
            if (targetTy?.kind === 'scalar' && targetTy.name === 'i32' && v.tag !== TAG.i32) {
              this.setTrap(TRAP.narrow_mismatch, op.anchor);
              return { kind: 'trap' };
            }
            if (p.operator === '!' && (v.tag === TAG.undefined || v.tag === TAG.null)) {
              this.setTrap(TRAP.narrow_mismatch, op.anchor);
              return { kind: 'trap' };
            }
            setReg(v);
          } else if (n === 'tsfg_program.carrier_cast' || n === 'tsfg_program.view' || n === 'tsfg_program.pack') {
            setReg(getReg(op.operands[0]));
          } else if (n === 'tsfg_program.receiver_create') {
            const fid = this.nextFrameId++;
            frames.set(fid, { newTarget: p.new_target ?? p.owner, objId: 0n });
            setReg({ tag: TAG.ref, payload: BigInt(fid) });
          } else if (n === 'tsfg_program.receiver_child') {
            setReg(getReg(op.operands[0]));
          } else if (n === 'tsfg_program.receiver_allocate') {
            const frame = frames.get(Number(getReg(op.operands[0]).payload));
            const obj = this.allocObject(frame ? frame.newTarget : p.owner);
            if (frame) frame.objId = obj.id;
            setReg({ tag: TAG.ref, payload: obj.id });
          } else if (n === 'tsfg_program.receiver_bind') {
            const frame = frames.get(Number(getReg(op.operands[0]).payload));
            const objVal = getReg(op.operands[1]);
            if (frame) frame.objId = objVal.payload;
            jumpTo(op.successors[0], [objVal]);
            break;
          } else if (n === 'tsfg_program.initialize_begin') {
            setReg(getReg(op.operands[1]));
          } else if (n === 'tsfg_program.initialize_field') {
            const objVal = getReg(op.operands[1]);
            const val = getReg(op.operands[2]);
            const obj = this.getObject(objVal.payload);
            const fMeta = this.mod.fieldsById.get(p.field);
            if (!obj || !fMeta) { this.setTrap(TRAP.invalid_handle, op.anchor); return { kind: 'trap' }; }
            obj.fields[fMeta.fieldIndex] = val;
            setReg(getReg(op.operands[0]));
          } else if (n === 'tsfg_program.initialize_end') {
            const obj = this.getObject(getReg(op.operands[1]).payload);
            if (obj) obj.initialized = true;
          } else if (n === 'tsfg_program.receiver_result') {
            const frame = frames.get(Number(getReg(op.operands[0]).payload));
            const obj = frame ? this.getObject(frame.objId) : null;
            if (obj) obj.initialized = true;
            jumpTo(op.successors[0], [{ tag: TAG.ref, payload: frame ? frame.objId : 0n }]);
            break;
          } else if (n === 'tsfg_program.receiver_get') {
            const frame = frames.get(Number(getReg(op.operands[0]).payload));
            if (!frame || frame.objId === 0n) { this.setTrap(TRAP.tdz_uninitialized, op.anchor); return { kind: 'trap' }; }
            setReg({ tag: TAG.ref, payload: frame.objId });
          } else if (n === 'tsfg_program.construct_value' || n === 'tsfg_program.allocate_reference') {
            const obj = this.allocObject(p.type);
            for (let fi = 0; fi < op.operands.length && fi < obj.fields.length; fi++) {
              obj.fields[fi] = getReg(op.operands[fi]);
            }
            if (n === 'tsfg_program.construct_value') obj.initialized = true;
            setReg({ tag: TAG.ref, payload: obj.id });
          } else if (n === 'tsfg_program.field_load') {
            const obj = this.getObject(getReg(op.operands[0]).payload);
            const fMeta = this.mod.fieldsById.get(p.field);
            if (!obj || !fMeta) { this.setTrap(TRAP.invalid_handle, op.anchor); return { kind: 'trap' }; }
            if (!obj.initialized) { this.setTrap(TRAP.tdz_uninitialized, op.anchor); return { kind: 'trap' }; }
            setReg(obj.fields[fMeta.fieldIndex] ?? UNDEF);
          } else if (n === 'tsfg_program.field_store') {
            const obj = this.getObject(getReg(op.operands[0]).payload);
            const fMeta = this.mod.fieldsById.get(p.field);
            if (!obj || !fMeta) { this.setTrap(TRAP.invalid_handle, op.anchor); return { kind: 'trap' }; }
            if (!p.initialize && !obj.initialized) { this.setTrap(TRAP.tdz_uninitialized, op.anchor); return { kind: 'trap' }; }
            obj.fields[fMeta.fieldIndex] = getReg(op.operands[1]);
          } else if (n === 'tsfg_program.env_alloc') {
            const envMeta = this.mod.envsById.get(p.layout);
            const slots = Array.from({ length: Math.max(1, envMeta?.slotCount ?? 4) }, () => UNDEF);
            const parentId = op.operands.length > 0 ? getReg(op.operands[0]).payload : 0n;
            const env = { id: BigInt(this.envs.length + 1), layout: p.layout, parentId, slots };
            this.envs.push(env);
            setReg({ tag: TAG.ref, payload: env.id });
          } else if (n === 'tsfg_program.env_parent') {
            const env = this.envs[Number(getReg(op.operands[0]).payload) - 1];
            if (!env || env.parentId === 0n) { this.setTrap(TRAP.invalid_handle, op.anchor); return { kind: 'trap' }; }
            setReg({ tag: TAG.ref, payload: env.parentId });
          } else if (n === 'tsfg_program.env_init' || n === 'tsfg_program.env_store') {
            const env = this.envs[Number(getReg(op.operands[0]).payload) - 1];
            const envMeta = this.mod.envsById.get(p.layout ?? env?.layout);
            const slotIdx = envMeta?.slotMap.get(p.binding) ?? envMeta?.slotMap.get(p.key) ?? 0;
            if (!env) { this.setTrap(TRAP.invalid_handle, op.anchor); return { kind: 'trap' }; }
            env.slots[slotIdx] = getReg(op.operands[1]);
          } else if (n === 'tsfg_program.env_load') {
            const env = this.envs[Number(getReg(op.operands[0]).payload) - 1];
            const envMeta = this.mod.envsById.get(p.layout ?? env?.layout);
            const slotIdx = envMeta?.slotMap.get(p.binding) ?? envMeta?.slotMap.get(p.key) ?? 0;
            if (!env) { this.setTrap(TRAP.invalid_handle, op.anchor); return { kind: 'trap' }; }
            setReg(env.slots[slotIdx] ?? UNDEF);
          } else if (n === 'tsfg_program.make_closure') {
            const targetFnId = p.function_id ?? p.function;
            const envVal = op.operands.length > 0 ? getReg(op.operands[0]).payload : 0n;
            const c = { id: BigInt(this.closures.length + 1), functionId: targetFnId, envId: envVal };
            this.closures.push(c);
            setReg({ tag: TAG.closure, payload: c.id });
          } else if (n === 'tsfg_program.array_create') {
            const items = op.operands.map((r) => getReg(r));
            const arr = { id: BigInt(this.arrays.length + 1), items, activeReaders: 0, activeWriter: false };
            this.arrays.push(arr);
            setReg({ tag: TAG.array, payload: arr.id });
          } else if (n === 'tsfg_program.array_length' || n === 'tsfg_program.readspan_length') {
            const recv = getReg(op.operands[0]);
            if (recv.tag === TAG.array) {
              const arr = this.arrays[Number(recv.payload) - 1];
              setReg(mkI32(arr ? arr.items.length : 0));
            } else if (recv.tag === TAG.span) {
              const sp = this.spans[Number(recv.payload) - 1];
              setReg(mkI32(sp ? sp.len : 0));
            } else {
              this.setTrap(TRAP.invalid_handle, op.anchor);
              return { kind: 'trap' };
            }
          } else if (n === 'tsfg_program.array_resize') {
            const recv = getReg(op.operands[0]);
            const newLen = u64ToU32(getReg(op.operands[1]).payload);
            const fill = op.operands.length > 2 ? getReg(op.operands[2]) : UNDEF;
            if (recv.tag !== TAG.array) { this.setTrap(TRAP.invalid_handle, op.anchor); return { kind: 'trap' }; }
            const arr = this.arrays[Number(recv.payload) - 1];
            if (!arr) { this.setTrap(TRAP.invalid_handle, op.anchor); return { kind: 'trap' }; }
            if (arr.activeReaders > 0 || arr.activeWriter) { this.setTrap(TRAP.borrow_conflict, op.anchor); return { kind: 'trap' }; }
            if (newLen > arr.items.length && op.operands.length <= 2) { this.setTrap(TRAP.bounds, op.anchor); return { kind: 'trap' }; }
            while (arr.items.length < newLen) arr.items.push(fill);
            if (arr.items.length > newLen) arr.items.length = newLen;
          } else if (n === 'tsfg_program.readspan') {
            const arrVal = getReg(op.operands[0]);
            const start = u64ToU32(getReg(op.operands[1]).payload);
            const len = u64ToU32(getReg(op.operands[2]).payload);
            const arr = this.arrays[Number(arrVal.payload) - 1];
            if (!arr) { this.setTrap(TRAP.invalid_handle, op.anchor); return { kind: 'trap' }; }
            if (start + len > arr.items.length) { this.setTrap(TRAP.bounds, op.anchor); return { kind: 'trap' }; }
            arr.activeReaders++;
            const sp = { id: BigInt(this.spans.length + 1), arrayId: arr.id, start, len };
            this.spans.push(sp);
            setReg({ tag: TAG.span, payload: sp.id });
          } else if (n === 'tsfg_program.array_read') {
            const recv = getReg(op.operands[0]);
            const idx = u64ToU32(getReg(op.operands[1]).payload);
            if (recv.tag === TAG.span) {
              const sp = this.spans[Number(recv.payload) - 1];
              if (!sp || idx >= sp.len) { this.setTrap(TRAP.bounds, op.anchor); return { kind: 'trap' }; }
              const arr = this.arrays[Number(sp.arrayId) - 1];
              setReg(arr.items[sp.start + idx]);
            } else if (recv.tag === TAG.array) {
              const arr = this.arrays[Number(recv.payload) - 1];
              if (!arr || idx >= arr.items.length) { this.setTrap(TRAP.bounds, op.anchor); return { kind: 'trap' }; }
              setReg(arr.items[idx]);
            } else {
              this.setTrap(TRAP.invalid_handle, op.anchor);
              return { kind: 'trap' };
            }
          } else if (n === 'tsfg_program.array_store') {
            const recv = getReg(op.operands[0]);
            const idx = u64ToU32(getReg(op.operands[1]).payload);
            const val = getReg(op.operands[2]);
            if (recv.tag === TAG.span) { this.setTrap(TRAP.span_readonly, op.anchor); return { kind: 'trap' }; }
            if (recv.tag !== TAG.array) { this.setTrap(TRAP.invalid_handle, op.anchor); return { kind: 'trap' }; }
            const arr = this.arrays[Number(recv.payload) - 1];
            if (!arr || idx >= arr.items.length) { this.setTrap(TRAP.bounds, op.anchor); return { kind: 'trap' }; }
            arr.items[idx] = val;
          } else if (n === 'tsfg_program.enter_handler' || n === 'tsfg_program.finally_enter') {
            // Structural handler markers
          } else if (n === 'tsfg_program.route') {
            const passArgs = op.operands.map((r) => getReg(r));
            jumpTo(op.successors[0], passArgs);
            break;
          } else if (n === 'tsfg_program.catch_bind') {
            const cellKey = p.binding ?? op.result;
            cells.set(cellKey, getReg(op.operands[0]));
            setReg({ tag: TAG.ref, payload: cellKey });
          } else if (n === 'tsfg_program.return_throw') {
            return { kind: 'throw', value: getReg(op.operands[0]) };
          } else if (n === 'tsfg_program.unreachable') {
            this.setTrap(TRAP.invalid_handle, op.anchor);
            return { kind: 'trap' };
          } else if (n === 'tsfg_program.invoke' || n === 'tsfg_program.invoke_method' || n === 'tsfg_program.invoke_indirect') {
            let callee = null;
            let callArgs = op.operands.map((r) => getReg(r));
            if (n === 'tsfg_program.invoke') {
              callee = this.mod.functionsById.get(p.function_id);
            } else if (n === 'tsfg_program.invoke_method') {
              const recvObj = this.getObject(callArgs[0]?.payload ?? 0n);
              if (!recvObj) { this.setTrap(TRAP.invalid_handle, op.anchor); return { kind: 'trap' }; }
              const hit = (p.dispatch ?? []).find((d) => d.receiver_type === recvObj.typeId);
              callee = this.mod.functionsById.get(hit ? hit.target : p.function_id);
            } else {
              const clVal = callArgs[0];
              const cl = this.closures[Number(clVal.payload) - 1];
              if (!cl) { this.setTrap(TRAP.invalid_handle, op.anchor); return { kind: 'trap' }; }
              callee = this.mod.functionsById.get(cl.functionId);
              const restArgs = callArgs.slice(1);
              const expectsEnv = callee.paramTypes.length > 0 && callee.paramTypes[0].includes('env:');
              callArgs = expectsEnv ? [{ tag: TAG.ref, payload: cl.envId }, ...restArgs] : restArgs;
            }
            if (!callee) throw new Error(`Missing callee for ${n}`);
            const sub = this.execFunction(callee, callArgs);
            if (this.trap !== TRAP.none || sub.kind === 'trap') return { kind: 'trap' };
            if (sub.kind === 'throw') {
              jumpTo(op.successors[1], [sub.value]);
            } else {
              jumpTo(op.successors[0], sub.value ? [sub.value] : []);
            }
            break;
          } else if (n === 'cf.br') {
            jumpTo(op.successors[0], op.operands.map((r) => getReg(r)));
            break;
          } else if (n === 'cf.cond_br') {
            const cond = getReg(op.operands[0]).payload !== 0n;
            const segs = op.operandSegmentSizes ?? [1, 0, 0];
            const tArgs = op.operands.slice(1, 1 + segs[1]).map((r) => getReg(r));
            const fArgs = op.operands.slice(1 + segs[1], 1 + segs[1] + segs[2]).map((r) => getReg(r));
            jumpTo(cond ? op.successors[0] : op.successors[1], cond ? tArgs : fArgs);
            break;
          } else if (n === 'func.return') {
            return { kind: 'return', value: op.operands.length > 0 ? getReg(op.operands[0]) : UNDEF };
          } else {
            throw new Error(`Unsupported Common20 VM op: ${n}`);
          }
        }
        if (!branched) break;
      }
      return { kind: 'return', value: UNDEF };
    } finally {
      this.depth--;
    }
  }
}
