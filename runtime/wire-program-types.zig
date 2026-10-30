// SPDX-License-Identifier: MIT
// Candidate wire17 data declarations. This module does not activate Runtime12
// and contains no byte decoder, verified execution handle or evaluator.
const std = @import("std");

pub const Hash = [32]u8;
pub const SourceRef = enum(u16) { _ };
pub const TypeRef = enum(u16) { _ };
pub const FunctionRef = enum(u16) { _ };
pub const EnvironmentRef = enum(u16) { _ };
pub const EnvironmentSlotRef = enum(u16) { _ };
pub const ScopeRef = enum(u16) { _ };
pub const ModuleRef = enum(u16) { _ };
pub const HostRef = enum(u16) { _ };
pub const GlobalRef = enum(u16) { _ };
pub const RegisterRef = enum(u16) { _ };
pub const BlockRef = enum(u16) { _ };
pub const DomainRef = enum(u32) { _ };
pub const AbiRef = enum(u32) { _ };
pub const CellRef = enum(u32) { _ };
pub const BindingRef = enum(u32) { _ };
pub const FieldRef = enum(u32) { _ };
pub const MethodRef = enum(u32) { _ };
pub const ConstructionRef = enum(u32) { _ };
pub const CompatibilityRef = enum(u32) { _ };
pub const DispatchRef = enum(u32) { _ };
pub const StorageRef = enum(u32) { _ };

pub const Anchor = struct { start: u32, end: u32 };
pub const Origin = struct { source: SourceRef, start: u32, end: u32 };
pub const Layout = struct { byte_size: u32, alignment: u16, reference_count: u16 };
pub const FieldLayout = struct { layout: Layout, field_offsets: []const u32 };
pub const CarrierKind = enum(u16) { domain = 0, environment = 1, @"type" = 2, cell = 3, payload = 4 };
pub const Carrier = union(CarrierKind) {
    domain: DomainRef,
    environment: EnvironmentRef,
    @"type": TypeRef,
    cell: CellRef,
    payload: void,
};

// The future formal decoder uses these at its untrusted integer boundary.
// Typed references passed inside the model are not repeatedly revalidated.
pub fn reference(comptime Ref: type, value: u64, count: usize) error{InvalidReference}!Ref {
    const Integer = @typeInfo(Ref).@"enum".tag_type;
    if (value >= count or value > std.math.maxInt(Integer)) return error.InvalidReference;
    return @enumFromInt(@as(Integer, @intCast(value)));
}
pub fn origin(source: SourceRef, start: u64, end: u64, source_length: u32) error{InvalidOrigin}!Origin {
    if (start > end or end > source_length) return error.InvalidOrigin;
    return .{ .source = source, .start = @intCast(start), .end = @intCast(end) };
}
