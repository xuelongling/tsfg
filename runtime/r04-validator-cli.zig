// SPDX-License-Identifier: MIT
//! Standalone Zig Runtime R04 Contract Validator & Identity/ABI Export CLI.
//! Zero compiler/LLVM/MLIR/TypeScript dependencies.
//! Modes:
//!   --validate <abi|tmeta|core-ir-exchange|native-patch|module-reload|compiler-service>
//!   --identity-probe       (prints JSON of canonical Zig-computed R04 digests)
//!   --export-zig-abi       (prints comptime-reflected Zig extern struct/enum JSON)
const std = @import("std");
const id = @import("r04-identity.zig");
const abi = @import("r04-abi.zig");
const abi_export = @import("r04-abi-export.zig");
const proto = @import("r04-protocols.zig");

const ProbeSmallPair = extern struct { tag: u8, pad_val: i32 };
const ProbeVec3 = extern struct { x: f32, y: f32, z: f32 };
const ProbeQuat16 = extern struct { x: f32, y: f32, z: f32, w: f32 };
const ProbeLargePose = extern struct { a: f64, b: f64, c: i64, flag: u8 };
const ProbeMode = enum(u16) { idle = 0, active = 1 };

fn writeStdout(io: std.Io, bytes: []const u8) !void {
    const stdout_file = std.Io.File.stdout();
    var write_buf: [4096]u8 = undefined;
    var writer = stdout_file.writer(io, &write_buf);
    try writer.interface.writeAll(bytes);
    try writer.interface.flush();
}

fn readStdinAll(allocator: std.mem.Allocator, io: std.Io) ![]u8 {
    const stdin_file = std.Io.File.stdin();
    var read_buf: [4096]u8 = undefined;
    var reader = stdin_file.reader(io, &read_buf);
    return reader.interface.allocRemaining(allocator, .limited(10 * 1024 * 1024));
}

pub fn main(init: std.process.Init) !void {
    const allocator = init.gpa;
    const io = init.io;
    const args = try init.minimal.args.toSlice(init.arena.allocator());

    if (args.len < 2) {
        std.debug.print("r04-cli-usage: expected --validate <kind> | --identity-probe | --export-zig-abi\n", .{});
        std.process.exit(2);
    }

    if (std.mem.eql(u8, args[1], "--identity-probe")) {
        const i32_id = id.typeIdScalar("i32");
        const bool_id = id.typeIdScalar("bool");
        const nominal_id = id.typeIdNominal("struct", "/src/abi.ts", "Vec3");
        const handle_id = id.typeIdHandle(&nominal_id);
        const rspan_id = id.typeIdSpan(false, &i32_id);
        const span_id = id.typeIdSpan(true, &i32_id);
        const sv_id = id.typeIdStringView();
        const sig_id = id.signatureHash("i32", &.{ "i32", "f64" });
        const fn_id = id.functionId("/src/abi.ts", "step", "i32", &.{ "i32", "f64" });
        const fnptr_id = id.typeIdFnPtr(&sig_id);
        const eff_id = id.effectHashFromCanonical("{\"capabilities\":[\"host.log\"],\"mayAllocate\":false,\"mayCallHost\":true,\"mayThrow\":false,\"reads\":[\"Position\"],\"writes\":[\"Velocity\"]}");

        var out: std.ArrayListUnmanaged(u8) = .empty;
        defer out.deinit(allocator);
        try out.print(
            allocator,
            "{{\"boolTypeId\":\"{s}\",\"contractSetId\":\"{s}\",\"effectHash\":\"{s}\",\"fnPtrTypeId\":\"{s}\",\"functionId\":\"{s}\",\"handleAlign\":{d},\"handleSize\":{d},\"handleTypeId\":\"{s}\",\"i32TypeId\":\"{s}\",\"nominalTypeId\":\"{s}\",\"readSpanTypeId\":\"{s}\",\"signatureHash\":\"{s}\",\"spanTypeId\":\"{s}\",\"stringViewTypeId\":\"{s}\"}}\n",
            .{
                bool_id,
                id.CURRENT_CONTRACT_SET_ID,
                eff_id,
                fnptr_id,
                fn_id,
                @alignOf(id.ResourceHandle),
                @sizeOf(id.ResourceHandle),
                handle_id,
                i32_id,
                nominal_id,
                rspan_id,
                sig_id,
                span_id,
                sv_id,
            },
        );
        try writeStdout(io, out.items);
        return;
    }

    if (std.mem.eql(u8, args[1], "--export-zig-abi")) {
        const specs = [_]abi_export.ExportedType{
            abi_export.reflectExternStruct("SmallPair", ProbeSmallPair),
            abi_export.reflectExternStruct("Vec3", ProbeVec3),
            abi_export.reflectExternStruct("Quat16", ProbeQuat16),
            abi_export.reflectExternStruct("LargePose", ProbeLargePose),
            abi_export.reflectBackedEnum("Mode", ProbeMode),
        };
        var out: std.ArrayListUnmanaged(u8) = .empty;
        defer out.deinit(allocator);
        try abi_export.appendExportedSpecsJson(allocator, &out, &specs);
        try out.append(allocator, '\n');
        try writeStdout(io, out.items);
        return;
    }

    if (std.mem.eql(u8, args[1], "--validate") and args.len >= 3) {
        const kind = args[2];
        const bytes = readStdinAll(allocator, io) catch |err| {
            std.debug.print("r04-cli-stdin: {s}\n", .{@errorName(err)});
            std.process.exit(3);
        };
        defer allocator.free(bytes);

        if (std.mem.eql(u8, kind, "abi")) {
            var verified = abi.validateAbiEnvelope(allocator, bytes) catch |err| {
                std.debug.print("r04-reject-abi:{s}\n", .{@errorName(err)});
                std.process.exit(4);
            };
            defer verified.deinit();
            try writeStdout(io, "OK:abi\n");
            return;
        } else if (std.mem.eql(u8, kind, "tmeta")) {
            proto.validateTmetaEnvelope(allocator, bytes, null) catch |err| {
                std.debug.print("r04-reject-tmeta:{s}\n", .{@errorName(err)});
                std.process.exit(4);
            };
            try writeStdout(io, "OK:tmeta\n");
            return;
        } else if (std.mem.eql(u8, kind, "core-ir-exchange")) {
            proto.validateCoreIrExchange(allocator, bytes) catch |err| {
                std.debug.print("r04-reject-core-ir-exchange:{s}\n", .{@errorName(err)});
                std.process.exit(4);
            };
            try writeStdout(io, "OK:core-ir-exchange\n");
            return;
        } else if (std.mem.eql(u8, kind, "native-patch")) {
            proto.validateNativePatch(allocator, bytes, null) catch |err| {
                std.debug.print("r04-reject-native-patch:{s}\n", .{@errorName(err)});
                std.process.exit(4);
            };
            try writeStdout(io, "OK:native-patch\n");
            return;
        } else if (std.mem.eql(u8, kind, "module-reload")) {
            proto.validateModuleReload(allocator, bytes) catch |err| {
                std.debug.print("r04-reject-module-reload:{s}\n", .{@errorName(err)});
                std.process.exit(4);
            };
            try writeStdout(io, "OK:module-reload\n");
            return;
        } else if (std.mem.eql(u8, kind, "compiler-service")) {
            proto.validateCompilerServiceMessage(allocator, bytes, 0, null) catch |err| {
                std.debug.print("r04-reject-compiler-service:{s}\n", .{@errorName(err)});
                std.process.exit(4);
            };
            try writeStdout(io, "OK:compiler-service\n");
            return;
        }
    }

    std.debug.print("r04-cli-usage: invalid arguments\n", .{});
    std.process.exit(2);
}
