// SPDX-License-Identifier: MIT

fn floatNan(code: u8, bits: u64) bool {
    return if (code == 12) bits & 0x7f800000 == 0x7f800000 and bits & 0x007fffff != 0
        else bits & 0x7ff0000000000000 == 0x7ff0000000000000 and bits & 0x000fffffffffffff != 0;
}
fn canonicalNan(code: u8) u64 { return if (code == 12) 0x7fc00000 else 0x7ff8000000000000; }

// fmod: exact binary significand long division; no libm or floating division
// quotient overflow. The remainder is representable in the input precision.
fn floatRemainder(code: u8, left: u64, right: u64) u64 {
    const fraction: u6 = if (code == 12) 23 else 52;
    const sign_mask: u64 = if (code == 12) 0x80000000 else 0x8000000000000000;
    const infinity: u64 = if (code == 12) 0x7f800000 else 0x7ff0000000000000;
    const sign = left & sign_mask;
    const a = left & ~sign_mask; const b = right & ~sign_mask;
    if (floatNan(code, left) or floatNan(code, right) or a == infinity or b == 0) return canonicalNan(code);
    if (a < b or b == infinity) return left;
    if (a == b) return sign;
    const implicit = @as(u64, 1) << fraction;
    var x = a & (implicit - 1); var y = b & (implicit - 1);
    var ex: i32 = @intCast(a >> fraction); var ey: i32 = @intCast(b >> fraction);
    if (ex != 0) { x |= implicit; } else { ex = 1; while (x < implicit) { x <<= 1; ex -= 1; } }
    if (ey != 0) { y |= implicit; } else { ey = 1; while (y < implicit) { y <<= 1; ey -= 1; } }
    while (ex > ey) : (ex -= 1) { if (x >= y) x -= y; if (x == 0) return sign; x <<= 1; }
    if (x >= y) x -= y;
    if (x == 0) return sign;
    while (x < implicit) { x <<= 1; ey -= 1; }
    return sign | if (ey > 0) ((@as(u64, @intCast(ey)) << fraction) | (x - implicit)) else (x >> @as(u6, @intCast(1 - ey)));
}

pub fn floatArithmetic(opcode: u8, code: u8, left: u64, right: u64) u64 {
    @setFloatMode(.strict);
    if (floatNan(code, left) or (opcode <= 8 and floatNan(code, right))) return canonicalNan(code);
    if (opcode == 8) return floatRemainder(code, left, right);
    if (opcode == 15) return left ^ (if (code == 12) @as(u64, 0x80000000) else 0x8000000000000000);
    if (opcode == 33) return left;
    const bits: u64 = if (code == 12) blk: {
        const a: f32 = @bitCast(@as(u32, @truncate(left))); const b: f32 = @bitCast(@as(u32, @truncate(right)));
        const value: f32 = if (opcode == 4) a + b else if (opcode == 5) a - b else if (opcode == 6) a * b else if (opcode == 7) a / b else unreachable;
        break :blk @as(u32, @bitCast(value));
    } else blk: {
        const a: f64 = @bitCast(left); const b: f64 = @bitCast(right);
        const value: f64 = if (opcode == 4) a + b else if (opcode == 5) a - b else if (opcode == 6) a * b else if (opcode == 7) a / b else unreachable;
        break :blk @bitCast(value);
    };
    return if (floatNan(code, bits)) canonicalNan(code) else bits;
}

pub fn floatCompare(opcode: u8, code: u8, left: u64, right: u64) bool {
    @setFloatMode(.strict);
    if (floatNan(code, left) or floatNan(code, right)) return opcode == 19;
    return if (code == 12) blk: {
        const a: f32 = @bitCast(@as(u32, @truncate(left))); const b: f32 = @bitCast(@as(u32, @truncate(right)));
        break :blk if (opcode == 18) a == b else if (opcode == 19) a != b else if (opcode == 20) a < b else if (opcode == 21) a <= b else if (opcode == 22) a > b else if (opcode == 23) a >= b else unreachable;
    } else blk: {
        const a: f64 = @bitCast(left); const b: f64 = @bitCast(right);
        break :blk if (opcode == 18) a == b else if (opcode == 19) a != b else if (opcode == 20) a < b else if (opcode == 21) a <= b else if (opcode == 22) a > b else if (opcode == 23) a >= b else unreachable;
    };
}
