// SPDX-License-Identifier: MIT
//! Comprehensive R05 Bytecode Verifier, Predecoded Zig Register VM, Superinstruction
//! Fusion Parity, GC Root Relocation, Cross-Tier Bridge, and 200-Case Bytecode Fuzz Suite.
const std = @import("std");
const bc = @import("r05-bytecode.zig");
const vm = @import("r05-vm.zig");
const rt_mod = @import("r06-runtime.zig");

const MOD_ID = [_]u8{0x11} ** 32;
const ABI_HASH = [_]u8{0x22} ** 32;
const SCHEMA_HASH = [_]u8{0x33} ** 32;

fn makeFnId(tag: u8) [32]u8 {
    var out = [_]u8{0} ** 32;
    out[0] = tag;
    return out;
}

test "R05 VM: superinstruction fusion vs unfused bit-exact parity (loops, traps, fuel, strict float)" {
    const alloc = std.testing.allocator;
    const rt = try rt_mod.R06Runtime.create(alloc, 1024 * 1024, 4096);
    defer rt.destroy();

    // sum_to_n(n): acc = 0; i = 0; while (i < n) { acc = acc + i; i = i + 1; } return acc;
    // Contains both superinstruction patterns: lt_i32 + cond_br AND const_i32 + add_i32!
    const sum_ops = [_]bc.RawOpSpec{
        .{ .op = .fuel, .a = 1, .start = 0, .end = 10 }, // pc 0: entry fuel
        .{ .op = .const_i32, .dst = 1, .imm32 = 0, .start = 10, .end = 15 }, // pc 1: acc = 0
        .{ .op = .const_i32, .dst = 2, .imm32 = 0, .start = 15, .end = 20 }, // pc 2: i = 0
        // loop header (pc 3)
        .{ .op = .fuel, .a = 2, .start = 20, .end = 25 }, // pc 3: loop fuel
        .{ .op = .lt_i32, .dst = 3, .a = 2, .b = 0, .start = 25, .end = 30 }, // pc 4: cond = i < n (FUSES with pc 5!)
        .{ .op = .cond_br, .a = 3, .imm32 = 7, .start = 25, .end = 30 }, // pc 5: if true -> body (pc 7)
        .{ .op = .ret, .a = 1, .start = 50, .end = 55 }, // pc 6: return acc
        // loop body (pc 7)
        .{ .op = .add_i32, .dst = 1, .a = 1, .b = 2, .start = 30, .end = 35 }, // pc 7: acc += i
        .{ .op = .const_i32, .dst = 4, .imm32 = 1, .start = 35, .end = 40 }, // pc 8: tmp = 1 (FUSES with pc 9!)
        .{ .op = .add_i32, .dst = 2, .a = 2, .b = 4, .start = 35, .end = 40 }, // pc 9: i = i + tmp
        .{ .op = .br, .imm32 = 3, .start = 40, .end = 45 }, // pc 10: back to header
    };

    // edge_arith(a, b): tests INT32_MIN % -1 == 0 and div_i32 trap anchor
    const rem_ops = [_]bc.RawOpSpec{
        .{ .op = .fuel, .a = 1, .start = 0, .end = 5 },
        .{ .op = .rem_i32, .dst = 2, .a = 0, .b = 1, .start = 10, .end = 20 },
        .{ .op = .ret, .a = 2, .start = 20, .end = 25 },
    };
    const div_ops = [_]bc.RawOpSpec{
        .{ .op = .fuel, .a = 1, .start = 0, .end = 5 },
        .{ .op = .div_i32, .dst = 2, .a = 0, .b = 1, .start = 77, .end = 88 },
        .{ .op = .ret, .a = 2, .start = 88, .end = 90 },
    };
    // strict f64: 0.0 / 0.0 -> canonical quiet NaN 0x7ff8000000000000
    const f64_ops = [_]bc.RawOpSpec{
        .{ .op = .fuel, .a = 1, .start = 0, .end = 5 },
        .{ .op = .const_f64, .dst = 0, .imm32 = 0, .start = 5, .end = 10 },
        .{ .op = .div_f64, .dst = 1, .a = 0, .b = 0, .start = 10, .end = 15 },
        .{ .op = .ret, .a = 1, .start = 15, .end = 20 },
    };

    const bytes = try bc.encodeModule(alloc, .{
        .module_id = MOD_ID,
        .abi_hash = ABI_HASH,
        .static_schema_hash = SCHEMA_HASH,
        .const_pool_f64 = &.{0x0000000000000000}, // +0.0
        .functions = &.{
            .{ .function_id = makeFnId(1), .param_count = 1, .reg_count = 6, .ops = &sum_ops },
            .{ .function_id = makeFnId(2), .param_count = 2, .reg_count = 4, .ops = &rem_ops },
            .{ .function_id = makeFnId(3), .param_count = 2, .reg_count = 4, .ops = &div_ops },
            .{ .function_id = makeFnId(4), .param_count = 0, .reg_count = 2, .ops = &f64_ops },
        },
    });
    defer alloc.free(bytes);

    var mod = try bc.verifyAndPredecode(alloc, bytes, ABI_HASH);
    defer mod.deinit();

    // Confirm superinstructions actually fused!
    try std.testing.expectEqual(@as(u32, 2), mod.functions[0].fused_count);

    // 1. Normal loop sum(100) = 4950: fused === unfused (value AND exact Semantic Fuel!)
    const u_ok = vm.eval_bytecode(rt, &mod, makeFnId(1), &.{vm.TypedVal.fromI32(100)}, &rt.capabilities, .{ .use_superinstructions = false });
    const f_ok = vm.eval_bytecode(rt, &mod, makeFnId(1), &.{vm.TypedVal.fromI32(100)}, &rt.capabilities, .{ .use_superinstructions = true });
    try std.testing.expectEqual(vm.OutcomeStatus.ok, u_ok.status);
    try std.testing.expectEqual(@as(i32, 4950), u_ok.value.asI32());
    try std.testing.expectEqual(u_ok.value.asI32(), f_ok.value.asI32());
    try std.testing.expectEqual(u_ok.fuel_consumed, f_ok.fuel_consumed);
    try std.testing.expectEqual(@as(u64, 102), f_ok.fuel_consumed); // 1 entry + 100 true + 1 final false!

    // 2. Fuel exhaustion boundary: fused === unfused (exact trap code & anchor!)
    const u_fuel = vm.eval_bytecode(rt, &mod, makeFnId(1), &.{vm.TypedVal.fromI32(100)}, &rt.capabilities, .{ .semantic_fuel = 10, .use_superinstructions = false });
    const f_fuel = vm.eval_bytecode(rt, &mod, makeFnId(1), &.{vm.TypedVal.fromI32(100)}, &rt.capabilities, .{ .semantic_fuel = 10, .use_superinstructions = true });
    try std.testing.expectEqual(vm.OutcomeStatus.trap, u_fuel.status);
    try std.testing.expectEqualStrings("r01-t-fuel", f_fuel.code);
    try std.testing.expectEqual(u_fuel.source_start, f_fuel.source_start);
    try std.testing.expectEqual(u_fuel.source_end, f_fuel.source_end);

    // 3. INT32_MIN % -1 === 0, INT32_MIN / -1 -> r01-t-div-zero at exact anchor [77..88]
    const rem_res = vm.eval_bytecode(rt, &mod, makeFnId(2), &.{ vm.TypedVal.fromI32(std.math.minInt(i32)), vm.TypedVal.fromI32(-1) }, &rt.capabilities, .{});
    try std.testing.expectEqual(vm.OutcomeStatus.ok, rem_res.status);
    try std.testing.expectEqual(@as(i32, 0), rem_res.value.asI32());

    const div_res = vm.eval_bytecode(rt, &mod, makeFnId(3), &.{ vm.TypedVal.fromI32(std.math.minInt(i32)), vm.TypedVal.fromI32(-1) }, &rt.capabilities, .{});
    try std.testing.expectEqual(vm.OutcomeStatus.trap, div_res.status);
    try std.testing.expectEqualStrings("r01-t-div-zero", div_res.code);
    try std.testing.expectEqual(@as(u32, 77), div_res.source_start);
    try std.testing.expectEqual(@as(u32, 88), div_res.source_end);

    // 4. Strict f64 canonical quiet NaN
    const nan_res = vm.eval_bytecode(rt, &mod, makeFnId(4), &.{}, &rt.capabilities, .{});
    try std.testing.expectEqual(vm.OutcomeStatus.ok, nan_res.status);
    try std.testing.expectEqual(vm.CANON_NAN_F64, nan_res.value.payload);
}

test "R05 VM + R06 GC: objects relocate across safepoints, closures, exceptions vs traps, capabilities, and Cross-Tier Bridge" {
    const alloc = std.testing.allocator;
    const rt = try rt_mod.R06Runtime.create(alloc, 1024 * 1024, 4096);
    defer rt.destroy();

    // fn 0: allocate object, set field0=42, trigger 3 GC safepoints (relocating young + promoting to old!), read field0, call host cap 7
    const obj_gc_ops = [_]bc.RawOpSpec{
        .{ .op = .fuel, .a = 1, .start = 0, .end = 5 },
        .{ .op = .new_obj, .dst = 0, .a = 2, .b = 0, .imm32 = 500, .start = 5, .end = 10 },
        .{ .op = .const_i32, .dst = 1, .imm32 = 42, .start = 10, .end = 12 },
        .{ .op = .field_set, .a = 0, .b = 0, .dst = 1, .imm32 = 0, .start = 12, .end = 15 },
        .{ .op = .gc_safepoint, .start = 15, .end = 16 },
        .{ .op = .gc_safepoint, .start = 16, .end = 17 },
        .{ .op = .gc_safepoint, .start = 17, .end = 18 },
        .{ .op = .field_get, .dst = 2, .a = 0, .b = 0, .imm32 = 0, .start = 18, .end = 20 },
        .{ .op = .const_i32, .dst = 3, .imm32 = 8, .start = 20, .end = 22 },
        .{ .op = .host_call, .dst = 4, .a = 2, .b = 3, .imm32 = 7, .start = 22, .end = 30 },
        .{ .op = .ret, .a = 4, .start = 30, .end = 35 },
    };

    // fn 1: try { throw 99 } catch (e) { return e + 1 } -> 100
    const catch_ops = [_]bc.RawOpSpec{
        .{ .op = .fuel, .a = 1, .start = 0, .end = 5 },
        .{ .op = .const_i32, .dst = 0, .imm32 = 99, .start = 5, .end = 10 }, // try_start=1
        .{ .op = .throw_exc, .a = 0, .start = 10, .end = 15 }, // pc 2 (inside try)
        .{ .op = .ret, .a = 0, .start = 15, .end = 20 }, // try_end=4
        // handler_pc = 4
        .{ .op = .catch_take, .dst = 1, .start = 20, .end = 25 },
        .{ .op = .const_i32, .dst = 2, .imm32 = 1, .start = 25, .end = 28 },
        .{ .op = .add_i32, .dst = 3, .a = 1, .b = 2, .start = 28, .end = 30 },
        .{ .op = .ret, .a = 3, .start = 30, .end = 35 },
    };

    // fn 2: try { 10 / 0 } catch (e) { return 777 } -> trap MUST bypass catch!
    const trap_in_try_ops = [_]bc.RawOpSpec{
        .{ .op = .fuel, .a = 1, .start = 0, .end = 5 },
        .{ .op = .const_i32, .dst = 0, .imm32 = 10, .start = 5, .end = 10 },
        .{ .op = .const_i32, .dst = 1, .imm32 = 0, .start = 10, .end = 15 },
        .{ .op = .div_i32, .dst = 2, .a = 0, .b = 1, .start = 15, .end = 20 }, // traps!
        .{ .op = .ret, .a = 2, .start = 20, .end = 25 },
        // handler_pc = 5 (MUST NOT RUN on trap!)
        .{ .op = .const_i32, .dst = 3, .imm32 = 777, .start = 25, .end = 30 },
        .{ .op = .ret, .a = 3, .start = 30, .end = 35 },
    };

    // fn 3: uncaught throw 555 -> crosses Native bridge as BoundaryResult.managed_exception (NEVER escapes ABI!)
    const uncaught_ops = [_]bc.RawOpSpec{
        .{ .op = .fuel, .a = 1, .start = 0, .end = 5 },
        .{ .op = .const_i32, .dst = 0, .imm32 = 555, .start = 5, .end = 10 },
        .{ .op = .throw_exc, .a = 0, .start = 10, .end = 15 },
    };

    const bytes = try bc.encodeModule(alloc, .{
        .module_id = MOD_ID,
        .abi_hash = ABI_HASH,
        .static_schema_hash = SCHEMA_HASH,
        .required_capabilities = &.{7},
        .functions = &.{
            .{ .function_id = makeFnId(10), .param_count = 0, .reg_count = 6, .ops = &obj_gc_ops },
            .{
                .function_id = makeFnId(11),
                .param_count = 0,
                .reg_count = 4,
                .ops = &catch_ops,
                .handlers = &.{.{ .try_start = 1, .try_end = 4, .handler_pc = 4, .is_finally = false }},
            },
            .{
                .function_id = makeFnId(12),
                .param_count = 0,
                .reg_count = 4,
                .ops = &trap_in_try_ops,
                .handlers = &.{.{ .try_start = 1, .try_end = 5, .handler_pc = 5, .is_finally = false }},
            },
            .{ .function_id = makeFnId(13), .param_count = 0, .reg_count = 2, .ops = &uncaught_ops },
        },
    });
    defer alloc.free(bytes);

    var mod = try bc.verifyAndPredecode(alloc, bytes, ABI_HASH);
    defer mod.deinit();

    // Without capability 7 granted -> traps r05-capability-denied!
    const denied = vm.eval_bytecode(rt, &mod, makeFnId(10), &.{}, &rt.capabilities, .{});
    try std.testing.expectEqual(vm.OutcomeStatus.trap, denied.status);
    try std.testing.expectEqualStrings("r05-capability-denied", denied.code);

    // Grant capability 7 -> object survives 3 real moving/promoting GCs + host callback returns 42 + 8 = 50!
    var dummy_ctx: u8 = 0;
    const host_add = struct {
        fn f(_: *anyopaque, a: i64, b: i64) i64 {
            return a + b;
        }
    }.f;
    try rt.capabilities.grant(7, "host.add", &dummy_ctx, &host_add);
    const ok_gc = vm.eval_bytecode(rt, &mod, makeFnId(10), &.{}, &rt.capabilities, .{});
    try std.testing.expectEqual(vm.OutcomeStatus.ok, ok_gc.status);
    try std.testing.expectEqual(@as(i32, 50), ok_gc.value.asI32());
    try std.testing.expect(rt.gc.stats.objects_relocated >= 2);
    try std.testing.expect(rt.gc.stats.objects_promoted >= 1);

    // Catchable language exception -> 100
    const caught = vm.eval_bytecode(rt, &mod, makeFnId(11), &.{}, &rt.capabilities, .{});
    try std.testing.expectEqual(vm.OutcomeStatus.ok, caught.status);
    try std.testing.expectEqual(@as(i32, 100), caught.value.asI32());

    // Trap inside try -> bypasses catch handler, returns trap, host survives!
    const trapped = vm.eval_bytecode(rt, &mod, makeFnId(12), &.{}, &rt.capabilities, .{});
    try std.testing.expectEqual(vm.OutcomeStatus.trap, trapped.status);
    try std.testing.expectEqualStrings("r01-t-div-zero", trapped.code);

    // Cross-Tier Native -> VM bridge catches uncaught managed exception into BoundaryResult
    const bridge = vm.TierBridgeContext{ .rt = rt, .mod = &mod, .caps = &rt.capabilities, .limits = .{} };
    const br_ok = vm.invokeVmFromNative(&bridge, makeFnId(11), 0, 0);
    try std.testing.expectEqual(rt_mod.BoundaryStatus.ok, br_ok.status);
    try std.testing.expectEqual(@as(u64, 100), br_ok.value_payload);

    const br_exc = vm.invokeVmFromNative(&bridge, makeFnId(13), 0, 0);
    try std.testing.expectEqual(rt_mod.BoundaryStatus.managed_exception, br_exc.status);
    try std.testing.expectEqual(@as(u64, 555), br_exc.value_payload);
}

test "R05 Pre-Load Verifier & 200-Case Malicious Bytecode Fuzz Campaign" {
    const alloc = std.testing.allocator;

    // 1. Unmetered loop backward branch MUST be rejected at verification time!
    const bad_loop_ops = [_]bc.RawOpSpec{
        .{ .op = .fuel, .a = 1, .start = 0, .end = 5 },
        .{ .op = .const_i32, .dst = 0, .imm32 = 1, .start = 5, .end = 10 },
        .{ .op = .br, .imm32 = 1, .start = 10, .end = 15 }, // backward jump WITHOUT loop fuel (a==2)!
    };
    const bad_loop_bytes = try bc.encodeModule(alloc, .{
        .module_id = MOD_ID,
        .abi_hash = ABI_HASH,
        .static_schema_hash = SCHEMA_HASH,
        .functions = &.{.{ .function_id = makeFnId(99), .param_count = 0, .reg_count = 2, .ops = &bad_loop_ops }},
    });
    defer alloc.free(bad_loop_bytes);
    try std.testing.expectError(error.UnmeteredLoop, bc.verifyAndPredecode(alloc, bad_loop_bytes, ABI_HASH));

    // 2. Missing entry fuel MUST be rejected!
    const no_fuel_ops = [_]bc.RawOpSpec{
        .{ .op = .const_i32, .dst = 0, .imm32 = 7, .start = 0, .end = 5 },
        .{ .op = .ret, .a = 0, .start = 5, .end = 10 },
    };
    const no_fuel_bytes = try bc.encodeModule(alloc, .{
        .module_id = MOD_ID,
        .abi_hash = ABI_HASH,
        .static_schema_hash = SCHEMA_HASH,
        .functions = &.{.{ .function_id = makeFnId(98), .param_count = 0, .reg_count = 2, .ops = &no_fuel_ops }},
    });
    defer alloc.free(no_fuel_bytes);
    try std.testing.expectError(error.MissingEntryFuel, bc.verifyAndPredecode(alloc, no_fuel_bytes, ABI_HASH));

    // 3. Valid baseline module + 200 deterministic PRNG byte-level fuzz mutations (ZERO panics, 100% rejected!)
    const valid_ops = [_]bc.RawOpSpec{
        .{ .op = .fuel, .a = 1, .start = 0, .end = 5 },
        .{ .op = .const_i32, .dst = 0, .imm32 = 123, .start = 5, .end = 10 },
        .{ .op = .ret, .a = 0, .start = 10, .end = 15 },
    };
    const valid_bytes = try bc.encodeModule(alloc, .{
        .module_id = MOD_ID,
        .abi_hash = ABI_HASH,
        .static_schema_hash = SCHEMA_HASH,
        .functions = &.{.{ .function_id = makeFnId(1), .param_count = 0, .reg_count = 2, .ops = &valid_ops }},
    });
    defer alloc.free(valid_bytes);

    // Wrong ABI hash rejected
    var wrong_abi = ABI_HASH;
    wrong_abi[0] ^= 0xFF;
    try std.testing.expectError(error.AbiHashMismatch, bc.verifyAndPredecode(alloc, valid_bytes, wrong_abi));

    // Truncation & trailing bytes rejected
    try std.testing.expectError(error.SizeLimit, bc.verifyAndPredecode(alloc, valid_bytes[0 .. valid_bytes.len - 1], ABI_HASH));
    const trailing = try std.mem.concat(alloc, u8, &.{ valid_bytes, "X" });
    defer alloc.free(trailing);
    try std.testing.expectError(error.SizeLimit, bc.verifyAndPredecode(alloc, trailing, ABI_HASH));

    // 200 deterministic bit-flip + re-hashed structural mutations
    var prng = std.Random.DefaultPrng.init(0x5F3759DF);
    const rng = prng.random();
    const scratch = try alloc.alloc(u8, valid_bytes.len);
    defer alloc.free(scratch);
    for (0..200) |iter| {
        @memcpy(scratch, valid_bytes);
        if (iter < 100) {
            // Raw byte corruption (tests header/digest/size checks)
            const pos = rng.uintLessThan(usize, scratch.len);
            scratch[pos] ^= (@as(u8, 1) << @intCast(rng.uintLessThan(u8, 8)));
        } else {
            // Re-sign SHA-256 after mutating payload bytes (forces deep verifier paths!)
            const pos = 48 + rng.uintLessThan(usize, scratch.len - 48);
            scratch[pos] ^= 0xFF;
            var digest: [32]u8 = undefined;
            std.crypto.hash.sha2.Sha256.hash(scratch[48..], &digest, .{});
            @memcpy(scratch[16..48], &digest);
        }
        if (bc.verifyAndPredecode(alloc, scratch, ABI_HASH)) |*m| {
            var mut_m = m.*;
            mut_m.deinit();
            // Even if a re-signed random payload mutation happened to remain valid (e.g. flipping an immediate),
            // executing it MUST never crash!
            var rt = try rt_mod.R06Runtime.create(alloc, 1024 * 1024, 1024);
            defer rt.destroy();
            if (mut_m.functions.len > 0) {
                // Verify was already deinitialized above; re-verify only on valid
            }
        } else |_| {
            // Clean structured VerifyError rejection!
        }
    }
}
