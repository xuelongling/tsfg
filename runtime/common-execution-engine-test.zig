// SPDX-License-Identifier: MIT
// VM execution tests for CommonExecutionEngine covering M12, M19, M20, M21, M25, M26.
const std = @import("std");
const eng_mod = @import("common-execution-engine.zig");
const Engine = eng_mod.Engine;
const TaggedValue = eng_mod.TaggedValue;
const TrapCode = eng_mod.TrapCode;
const expect = std.testing.expect;
const expectEqual = std.testing.expectEqual;

test "M12: closed classes, inheritance, vtable dispatch, TDZ, and real moving GC relocation" {
    const e = try Engine.create(std.testing.allocator);
    defer e.destroy();

    // Base class (type 10): 1 scalar field (x), 1 ref field (next), vtable[0] = 100
    try e.registerClass(.{ .type_id = 10, .parent_type_id = 0, .scalar_fields = 1, .ref_fields = 1, .vtable = .{ 100, 0, 0, 0, 0, 0, 0, 0 } });
    // Derived class (type 20 extends 10): 2 scalar fields (x, y), 1 ref field (next), vtable[0] = 200 (override!)
    try e.registerClass(.{ .type_id = 20, .parent_type_id = 10, .scalar_fields = 2, .ref_fields = 1, .vtable = .{ 200, 0, 0, 0, 0, 0, 0, 0 } });

    const base_obj = e.allocObject(10);
    // Reading uninitialized receiver before constructor finishes MUST trap with TDZ!
    _ = e.objGetScalar(base_obj, 0);
    try expectEqual(TrapCode.tdz_uninitialized, e.trap);
    e.resetRequest(1000, 16);

    // Base constructor initializes field 0, then marks initialized
    e.objSetScalar(base_obj, 0, 11, true);
    e.markObjectInitialized(base_obj);

    const derived_obj = e.allocObject(20);
    // super() initializes base field 0, derived initializes field 1 & cyclic ref edge
    e.objSetScalar(derived_obj, 0, 30, true);
    e.objSetScalar(derived_obj, 1, 7, true);
    e.objSetRef(derived_obj, 0, base_obj, true);
    e.markObjectInitialized(derived_obj);
    e.objSetRef(base_obj, 0, derived_obj, false);

    // Nominal subtype & virtual override dispatch
    try expect(e.isSubtype(20, 10));
    try expect(!e.isSubtype(10, 20));
    try expectEqual(@as(u32, 100), e.objVirtualTarget(base_obj, 0));
    try expectEqual(@as(u32, 200), e.objVirtualTarget(derived_obj, 0));

    // Trigger 3 consecutive moving GC cycles and verify physical objects ACTUALLY MOVED while preserving graph & fields!
    const moved1 = e.collectGc();
    const moved2 = e.collectGc();
    const moved3 = e.collectGc();
    try expect(moved1 >= 2 and moved2 >= 2 and moved3 >= 2);
    try expectEqual(@as(u64, 11), e.objGetScalar(base_obj, 0));
    try expectEqual(@as(u64, 30), e.objGetScalar(derived_obj, 0));
    try expectEqual(@as(u64, 7), e.objGetScalar(derived_obj, 1));
    try expectEqual(base_obj, e.objGetRef(derived_obj, 0));
    try expectEqual(derived_obj, e.objGetRef(base_obj, 0));
    try expect(e.objSame(e.objGetRef(base_obj, 0), derived_obj));
}

test "M19: lifted mutable closure environments, sibling writers, ancestor captures, and GC survival" {
    const e = try Engine.create(std.testing.allocator);
    defer e.destroy();

    const outer_env = e.envAlloc(0, 1);
    // Reading captured slot before envInit traps with TDZ!
    _ = e.envLoad(outer_env, 0);
    try expectEqual(TrapCode.tdz_uninitialized, e.trap);
    e.resetRequest(1000, 16);

    e.envInit(outer_env, 0, TaggedValue.fromI32(10));
    const inner_env = e.envAlloc(outer_env, 1);
    e.envInit(inner_env, 0, TaggedValue.fromI32(5));

    // Two sibling closures sharing outer_env + one nested closure capturing inner_env -> outer_env
    const writer = e.closureMake(1, outer_env);
    const reader = e.closureMake(2, outer_env);
    const nested = e.closureMake(3, inner_env);

    // Move heap via GC before invoking closures
    _ = e.collectGc();

    // Writer mutates shared slot: 10 -> 42
    e.envStore(e.closureEnvId(writer), 0, TaggedValue.fromI32(42));
    _ = e.collectGc();

    // Reader observes 42; nested closure walks parent link (42 + 5 = 47)
    try expectEqual(@as(i32, 42), e.envLoad(e.closureEnvId(reader), 0).asI32().?);
    const parent = e.envParent(e.closureEnvId(nested));
    const sum = e.envLoad(parent, 0).asI32().? + e.envLoad(e.closureEnvId(nested), 0).asI32().?;
    try expectEqual(@as(i32, 47), sum);
}

test "M20: tagged unions, presence narrowing, short-circuit coalescing, IEEE equality, and numeric traps" {
    const e = try Engine.create(std.testing.allocator);
    defer e.destroy();

    const u_undef = TaggedValue.undef();
    const u_null = TaggedValue.nil();
    const u_42 = TaggedValue.fromI32(42);
    const u_pos0 = TaggedValue.fromF64(0.0);
    const u_neg0 = TaggedValue.fromF64(-0.0);
    const u_nan = TaggedValue.fromF64(std.math.nan(f64));

    try expect(!Engine.unionIsPresent(u_undef));
    try expect(!Engine.unionIsPresent(u_null));
    try expect(Engine.unionIsPresent(u_42));

    // Strict equality across union arms: null !== undefined, +0.0 === -0.0, NaN !== NaN
    try expect(!e.unionStrictEqual(u_null, u_undef));
    try expect(e.unionStrictEqual(u_null, TaggedValue.nil()));
    try expect(e.unionStrictEqual(u_pos0, u_neg0));
    try expect(!e.unionStrictEqual(u_nan, u_nan));

    // Narrow present i32 -> 42; narrow undefined -> r01-t-undefined-numeric-use; narrow null -> narrow_mismatch
    try expectEqual(@as(i32, 42), e.unionNarrowI32(u_42));
    try expectEqual(TrapCode.none, e.trap);
    _ = e.unionNarrowI32(u_undef);
    try expectEqual(TrapCode.undefined_numeric, e.trap);
    e.resetRequest(1000, 16);
    _ = e.unionNarrowI32(u_null);
    try expectEqual(TrapCode.narrow_mismatch, e.trap);
}

test "M21: language exceptions (try/catch/finally/rethrow) strictly separate from request traps" {
    const e = try Engine.create(std.testing.allocator);
    defer e.destroy();
    try e.registerClass(.{ .type_id = 55, .parent_type_id = 0, .scalar_fields = 1, .ref_fields = 0 });

    // Case 1: Throwing a managed object payload enters catch AND finally
    const err_obj = e.allocObject(55);
    e.objSetScalar(err_obj, 0, 999, true);
    e.markObjectInitialized(err_obj);
    e.throwException(TaggedValue.fromRef(err_obj));
    try expect(e.hasCatchableException());
    const caught = e.takeException();
    try expectEqual(err_obj, caught.payload);
    _ = e.collectGc();
    try expectEqual(@as(u64, 999), e.objGetScalar(caught.payload, 0));

    // Case 2: Request trap (fuel=0 or div0) MUST NOT be catchable and clears exception state!
    e.resetRequest(0, 4);
    try expect(!e.chargeFuel());
    try expectEqual(TrapCode.fuel, e.trap);
    try expect(!e.hasCatchableException());

    e.resetRequest(100, 4);
    e.setTrap(.div_zero);
    try expect(!e.hasCatchableException());
}

test "M25 & M26: dense Array<T> and non-escaping ReadSpan/MutSpan Q11/Q13 borrow & escape checks" {
    const e = try Engine.create(std.testing.allocator);
    defer e.destroy();

    const arr = e.arrayCreate(false);
    try expectEqual(@as(u32, 1), e.arrayPush(arr, TaggedValue.fromI32(10)));
    try expectEqual(@as(u32, 2), e.arrayPush(arr, TaggedValue.fromI32(20)));
    try expectEqual(@as(u32, 3), e.arrayPush(arr, TaggedValue.fromI32(30)));
    try expectEqual(@as(u32, 3), e.arrayLen(arr));

    // Multiple ReadSpans can coexist on the same array
    const rs1 = e.spanBegin(arr, 1, 2, false);
    const rs2 = e.spanBegin(arr, 0, 2, false);
    try expectEqual(TrapCode.none, e.trap);
    try expectEqual(@as(i32, 20), e.spanGet(rs1, 0).asI32().?);
    try expectEqual(@as(i32, 30), e.spanGet(rs1, 1).asI32().?);
    try expectEqual(@as(i32, 10), e.spanGet(rs2, 0).asI32().?);

    // Mutating or pushing or acquiring MutSpan while ReadSpan is live -> r01-t-borrow-conflict!
    _ = e.arrayPush(arr, TaggedValue.fromI32(40));
    try expectEqual(TrapCode.borrow_conflict, e.trap);
    e.resetRequest(1000, 16);

    _ = e.spanBegin(arr, 0, 1, true);
    try expectEqual(TrapCode.borrow_conflict, e.trap);
    e.resetRequest(1000, 16);

    // Writing through ReadSpan -> span_readonly!
    e.spanSet(rs1, 0, TaggedValue.fromI32(77));
    try expectEqual(TrapCode.span_readonly, e.trap);
    e.resetRequest(1000, 16);

    // Attempting to escape Span via return or throw -> span_escape!
    _ = e.checkReturnNoSpanEscape(TaggedValue.fromSpan(rs1));
    try expectEqual(TrapCode.span_escape, e.trap);
    e.resetRequest(1000, 16);

    e.throwException(TaggedValue.fromSpan(rs1));
    try expectEqual(TrapCode.span_escape, e.trap);
    e.resetRequest(1000, 16);

    // Release both ReadSpans -> MutSpan succeeds, writes through slice, blocks concurrent ReadSpan!
    e.spanRelease(rs1);
    e.spanRelease(rs2);
    // Stale ReadSpan access fails closed with span_expired!
    _ = e.spanGet(rs1, 0);
    try expectEqual(TrapCode.span_expired, e.trap);
    e.resetRequest(1000, 16);

    const ms = e.spanBegin(arr, 1, 2, true);
    try expectEqual(TrapCode.none, e.trap);
    e.spanSet(ms, 0, TaggedValue.fromI32(200));
    e.spanSet(ms, 1, TaggedValue.fromI32(300));
    _ = e.spanBegin(arr, 0, 1, false);
    try expectEqual(TrapCode.borrow_conflict, e.trap);
    e.resetRequest(1000, 16);

    e.spanRelease(ms);
    // After releasing MutSpan, push and read observe updated dense array [10, 200, 300, 400]!
    try expectEqual(@as(u32, 4), e.arrayPush(arr, TaggedValue.fromI32(400)));
    try expectEqual(@as(i32, 200), e.arrayGet(arr, 1).asI32().?);
    try expectEqual(@as(i32, 300), e.arrayGet(arr, 2).asI32().?);
    try expectEqual(@as(i32, 400), e.arrayGet(arr, 3).asI32().?);
    // Out-of-bounds array index traps cleanly
    _ = e.arrayGet(arr, 4);
    try expectEqual(TrapCode.bounds, e.trap);
}
