// SPDX-License-Identifier: MIT
// JSON ownership and allocation rules shared by inner packages and outer IO.
// Profiles remain explicit: an outer envelope never weakens the inner contract.
import { isProxy } from 'node:util/types';
/**
 * @typedef {object} GenericJsonPolicy
 * @property {number} bytes
 * @property {number} depth
 * @property {number} jsonTokens
 * @property {number} stringBytes
 * @property {boolean} allowNul
 * @property {boolean} [safeNonnegativeIntegers]
 * @property {number} [arrayItems]
 * @property {boolean} rejectPrototypeKeys
 */
/** @type {Readonly<GenericJsonPolicy>} */
export const genericPackageJsonPolicy = Object.freeze({ bytes: 8388608, depth: 160,
  jsonTokens: 1000000, stringBytes: 1048576, allowNul: false, rejectPrototypeKeys: true });
/** @type {Readonly<GenericJsonPolicy>} */
export const genericPackageIoJsonPolicy = Object.freeze({ bytes: 16777216, depth: 162,
  jsonTokens: 1032768, stringBytes: 3145728, allowNul: true, rejectPrototypeKeys: false });
/** @param {Readonly<GenericJsonPolicy>} policy @param {string} category @returns {never} */
export function genericJsonFailure(policy, category) {
  const prefix = policy === genericPackageJsonPolicy ? 'generic-package-' : 'generic-package-io-';
  const message = policy === genericPackageJsonPolicy ? 'invalid owned generic package' : 'invalid package IO JSON';
  throw Object.assign(new TypeError(prefix + category + ': ' + message), { code: prefix + category });
}

// Bound the complete canonical representation before allocating DTO copies,
// canonical text or hash preimages. Inspect descriptors without invoking getters.
// Count repeated references each time they would be serialized; reject cycles.
// Optional shared work charging does not replace the structural JSON policy.
// One native ownKeys discovery has unknown cardinality before it returns: pay
// entry first, then the discovered length before descriptors/child traversal.
// This is not a promise to interrupt that single native primitive.
/** @param {Readonly<GenericJsonPolicy>} [policy] @param {((units:number)=>void)} [spend] */
export function checkGenericJsonValueBudget(input, policy = genericPackageJsonPolicy, spend = undefined) {
  const limit = policy, active = new Set();
  const check = (value, category = 'schema') => { if (!value) genericJsonFailure(policy, category); };
  const integer = value => check(Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0));
  let size = 0, tokens = 0;
  const add = count => { size += count; check(size <= limit.bytes, "limit"); };
  const event = (count = 1) => { tokens += count; check(tokens <= limit.jsonTokens, "limit"); };
  function string(value) {
    spend?.(Math.ceil(value.length / 8) + 1);
    let decoded = 0;
    add(2);
    for (let index = 0; index < value.length; index++) {
      const unit = value.charCodeAt(index);
      check(policy.allowNul || unit !== 0);
      let width = unit < 0x80 ? 1 : unit < 0x800 ? 2 : 3;
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const low = value.charCodeAt(++index);
        check(low >= 0xdc00 && low <= 0xdfff); width = 4;
      } else check(unit < 0xdc00 || unit > 0xdfff);
      decoded += width; check(decoded <= limit.stringBytes, "limit");
      const escaped = unit === 0x22 || unit === 0x5c || unit >= 8 && unit <= 10 || unit === 12 || unit === 13;
      add(escaped ? 2 : unit < 0x20 ? 6 : width);
    }
  }
  function visit(value, depth) {
    spend?.(2);
    if (typeof value === "string") { event(); string(value); return; }
    if (typeof value === "number") { event(); integer(value); add(String(value).length); return; }
    if (typeof value === "boolean" || value === null) { event(); add(value === null ? 4 : value ? 4 : 5); return; }
    check(value && typeof value === "object");
    // Reject behavioral objects before any prototype, descriptor or value access.
    check(!isProxy(value));
    check(depth <= limit.depth, "limit"); check(!active.has(value));
    const isArray = Array.isArray(value);
    check(isArray ? Object.getPrototypeOf(value) === Array.prototype
      : [Object.prototype, null].includes(Object.getPrototypeOf(value)));
    if (isArray) {
      check(value.length <= Math.min(limit.jsonTokens, limit.arrayItems ?? limit.jsonTokens), "limit");
      spend?.(value.length + 1);
    }
    spend?.(1);
    const keys = Reflect.ownKeys(value);
    spend?.(keys.length + 1);
    check(keys.length <= limit.jsonTokens + (isArray ? 1 : 0), "limit");
    active.add(value); event(2); add(2);
    let count = 0;
    for (const key of keys) {
      spend?.(2);
      if (isArray && key === "length") continue;
      check(typeof key === "string");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      check(descriptor && Object.hasOwn(descriptor, "value") && descriptor.enumerable);
      if (count++) add(1);
      if (isArray) check(key === String(count - 1));
      else { event(); string(key); add(1); }
      visit(descriptor.value, depth + 1);
    }
    if (isArray) check(count === value.length);
    active.delete(value);
  }
  visit(input, 1);
}
