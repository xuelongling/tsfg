// SPDX-License-Identifier: MIT
const contract = @import("contract.zig");

pub const Outcome = union(enum) { value: u64, nonfinite, range };
const Exact = struct { negative: bool, magnitude: u64, power: i32 = 0, infinity: bool = false, nan: bool = false };

fn decode(bits: u64, code: u8) Exact {
    if (contract.integerType(code)) {
        if (contract.signedType(code)) {
            const value: i128 = contract.signedValue(bits, code);
            return .{ .negative = value < 0, .magnitude = @intCast(if (value < 0) -value else value) };
        }
        return .{ .negative = false, .magnitude = bits & contract.mask(code) };
    }
    const fraction: u6 = if (code == 12) 23 else 52;
    const bias: i32 = if (code == 12) 127 else 1023;
    const exponent_mask: u64 = if (code == 12) 255 else 2047;
    const exponent = (bits >> fraction) & exponent_mask;
    const significand = bits & ((@as(u64, 1) << fraction) - 1);
    const negative = bits & (@as(u64, 1) << @as(u6, @intCast(contract.bitWidth(code) - 1))) != 0;
    if (exponent == exponent_mask) return .{ .negative = negative, .magnitude = 0, .infinity = significand == 0, .nan = significand != 0 };
    return .{ .negative = negative, .magnitude = if (exponent == 0) significand else significand | (@as(u64, 1) << fraction),
        .power = (if (exponent == 0) 1 else @as(i32, @intCast(exponent))) - bias - fraction };
}

// Exact binary quotient and discarded bits: no host FP or intermediate f64.
fn rounded(value: u64, shift: i32) u64 {
    if (shift <= 0) return value << @as(u6, @intCast(-shift));
    if (shift > 64) return 0;
    const quotient = if (shift == 64) 0 else value >> @as(u6, @intCast(shift));
    const remainder = if (shift == 64) value else value & ((@as(u64, 1) << @as(u6, @intCast(shift))) - 1);
    const halfway = @as(u64, 1) << @as(u6, @intCast(shift - 1));
    return quotient + @intFromBool(remainder > halfway or (remainder == halfway and quotient & 1 != 0));
}

fn toFloat(exact: Exact, target: u8) Outcome {
    const fraction: u6 = if (target == 12) 23 else 52;
    const bias: i32 = if (target == 12) 127 else 1023;
    const sign = if (exact.negative) @as(u64, 1) << @as(u6, @intCast(contract.bitWidth(target) - 1)) else 0;
    const infinity: u64 = if (target == 12) 0x7f800000 else 0x7ff0000000000000;
    if (exact.nan) return .{ .value = if (target == 12) 0x7fc00000 else 0x7ff8000000000000 };
    if (exact.infinity) return .{ .value = sign | infinity };
    if (exact.magnitude == 0) return .{ .value = sign };
    const top: i32 = @intCast(63 - @clz(exact.magnitude));
    var exponent = top + exact.power;
    const emin = 1 - bias;
    if (exponent < emin) {
        const significand = rounded(exact.magnitude, emin - fraction - exact.power);
        return .{ .value = sign | significand };
    }
    var significand = rounded(exact.magnitude, top - fraction);
    if (significand == @as(u64, 1) << (fraction + 1)) { significand >>= 1; exponent += 1; }
    if (exponent > bias) return .range;
    return .{ .value = sign | (@as(u64, @intCast(exponent + bias)) << fraction) | (significand & ((@as(u64, 1) << fraction) - 1)) };
}

fn toInteger(exact: Exact, target: u8) Outcome {
    if (exact.nan or exact.infinity) return .nonfinite;
    var magnitude: u128 = exact.magnitude;
    if (magnitude != 0) {
        const top: i32 = @intCast(63 - @clz(exact.magnitude));
        if (top + exact.power > 64) return .range;
        if (exact.power >= 0) magnitude <<= @as(u7, @intCast(exact.power))
        else magnitude = if (exact.power <= -64) 0 else magnitude >> @as(u7, @intCast(-exact.power));
    }
    const width = contract.bitWidth(target);
    if (contract.signedType(target)) {
        const limit = @as(u128, 1) << @as(u7, @intCast(width - 1));
        if (magnitude > limit or (!exact.negative and magnitude == limit)) return .range;
    } else {
        if ((exact.negative and magnitude != 0) or magnitude >= (@as(u128, 1) << @as(u7, @intCast(width)))) return .range;
    }
    const low: u64 = @intCast(magnitude);
    return .{ .value = (if (exact.negative) 0 -% low else low) & contract.mask(target) };
}

pub fn convert(opcode: u8, bits: u64, source: u8, target: u8) Outcome {
    if (opcode == 36) return .{ .value = bits & contract.mask(target) };
    if (opcode == 35) {
        const extended: u64 = if (contract.signedType(source)) @bitCast(contract.signedValue(bits, source)) else bits;
        return .{ .value = extended & contract.mask(target) };
    }
    const exact = decode(bits, source);
    return if (contract.floatType(target)) toFloat(exact, target) else toInteger(exact, target);
}
