// SPDX-License-Identifier: MIT
const std = @import("std");
const runtime = @import("request.zig");
const bytecode = @import("bytecode.zig");
const contract = @import("contract.zig");
const host_bindings = @import("host-bindings.zig");
const host_counter = @import("host_counter.zig");

pub const Request = struct {
    kind: []const u8 = "function",
    functionId: ?[]const u8 = null,
    signatureHash: ?[]const u8 = null,
    arguments: []const std.json.Value = &.{},
    capabilities: []const std.json.Value = &.{},
    memoryBytes: u64 = 16384,
    instructionBudget: u64 = 4097,
    semanticFuel: u64 = 4097,
    depth: u32 = 1,
    hostTimeNanos: ?u64 = null,
    stringOutput: @import("string-output.zig").Mode = .strict,
};

pub const ParsedRequest = struct {
    function_id: bytecode.FunctionId,
    arguments: []runtime.TypedValue,
    argument_storage: [64]runtime.TypedValue,
    argument_owner: ?*@import("string-value.zig").Owner = null,
    argument_count: usize,
    capabilities: [2]runtime.Capability,
    capability_count: usize,
    init_only: bool,
    limits: runtime.RequestLimits,
};

// Providers borrow immutable descriptors for the synchronous parse call. The
// VM view retains loader ownership; no table or descriptor is copied here.
pub const VmMetadata = struct {
    module: *const bytecode.VerifiedModule,

    pub fn defaultInfo(self: VmMetadata) *const bytecode.ModuleInfo {
        return bytecode.moduleInfoView(self.module);
    }

    pub fn find(self: VmMetadata, id: bytecode.FunctionId) ?*const bytecode.ModuleInfo {
        for (bytecode.functions(self.module)) |*function| if (std.mem.eql(u8, &id, &function.info.function_id)) {
            return &function.info;
        };
        return null;
    }
};

// The CLI owns typed argument slots and every String input root until invocation.
// Parse owns each original Value array until all synchronous evaluation/formatting
// finishes. Parsed.deinit releases arena blocks without revisiting Value tags.
// The bytes/arena/metadata retain their original heap and callback fees.
pub fn parseRequest(allocator: std.mem.Allocator, metadata: anytype, request: *const Request, counter: *host_counter.Counter, parsed: *ParsedRequest, result_out: *runtime.RequestOutcome) !bool {
    const default_info = metadata.defaultInfo();
    var function_id = default_info.function_id;
    if (request.functionId) |text| {
        const id = if (std.mem.startsWith(u8, text, "sha256:")) text[7..] else text;
        if (id.len != 64) return error.FunctionId;
        for (id) |character| if (!std.ascii.isDigit(character) and !(character >= 'a' and character <= 'f')) return error.FunctionId;
        _ = try std.fmt.hexToBytes(&function_id, id);
    }
    // Parsed JSON and immutable metadata outlive this private request call.
    // Borrow their records; outcomes retain the existing owned IDs.
    const selected = metadata.find(function_id);
    const info = selected orelse { result_out.* = .{ .failed = .{ .code = "r05-request-function", .category = "request", .function_id = function_id, .source = default_info.source, .fuel_remaining = request.semanticFuel } }; return false; };
    if (request.signatureHash) |text| {
        const expected = bytecode.digestText(info.signature_hash);
        if (!std.mem.eql(u8, text, &expected)) { result_out.* = .{ .failed = .{ .code = "r05-request-signature", .category = "request", .function_id = function_id, .source = info.source, .fuel_remaining = request.semanticFuel } }; return false; }
    }
    var valid = request.arguments.len <= 64 and request.arguments.len <= info.presence_masks.len;
    const arguments: []runtime.TypedValue = if (valid) parsed.argument_storage[0..request.arguments.len] else &.{};
    // Preserve the original typed JSON and write only into owned typed slots.
    // String roots are reclaimed even after a later argument fails validation.
    var physical: usize = 0;
    if (valid) for (request.arguments, 0..) |original, index| {
        const argument = &original;
        if (argument.* != .object or argument.object.count() != 2) {
            valid = false;
            break;
        }
        const type_value: *const std.json.Value = argument.object.getPtr("type") orelse {
            valid = false;
            break;
        };
        const value: *const std.json.Value = argument.object.getPtr("value") orelse {
            valid = false;
            break;
        };
        if (type_value.* != .string) {
            valid = false;
            break;
        }
        const code = info.parameter_types[physical];
        physical += if (info.presence_masks[index] & 3 != 0) @as(usize, 2) else 1;
        if (std.mem.eql(u8, type_value.string, "undefined") and value.* == .null) arguments[index] = .{ .undefined_value = {} } else if (std.mem.eql(u8, type_value.string, "null") and value.* == .null) arguments[index] = .{ .null_value = {} } else if (std.mem.eql(u8, type_value.string, "bool") and code == 2 and value.* == .bool) arguments[index] = .{ .boolean = value.bool } else if (std.mem.eql(u8, type_value.string, contract.typeName(code)) and contract.integerType(code) and value.* == .string) {
            var bits: u64 = undefined;
            var buffer: [32]u8 = undefined;
            const canonical = if (contract.signedType(code)) blk: {
                const integer = std.fmt.parseInt(i64, value.string, 10) catch { valid = false; break; };
                bits = @as(u64, @bitCast(integer)) & contract.mask(code);
                if (contract.signedValue(bits, code) != integer) { valid = false; break; }
                break :blk try std.fmt.bufPrint(&buffer, "{d}", .{integer});
            } else blk: {
                bits = std.fmt.parseInt(u64, value.string, 10) catch { valid = false; break; };
                if (bits & ~contract.mask(code) != 0) { valid = false; break; }
                break :blk try std.fmt.bufPrint(&buffer, "{d}", .{bits});
            };
            if (!std.mem.eql(u8, value.string, canonical)) {
                valid = false;
                break;
            }
            arguments[index] = runtime.typedValue(bits, code);
        } else if (std.mem.eql(u8, type_value.string, contract.typeName(code)) and contract.floatType(code) and value.* == .string) {
            if (value.string.len != (if (code == 12) @as(usize, 8) else 16)) { valid = false; break; }
            for (value.string) |c| if (!std.ascii.isDigit(c) and !(c >= 'a' and c <= 'f')) { valid = false; break; };
            if (!valid) break;
            const bits = std.fmt.parseInt(u64, value.string, 16) catch { valid = false; break; };
            arguments[index] = runtime.typedValue(bits, code);
        } else if (code == 14 and std.mem.eql(u8, type_value.string, "string") and value.* == .array) {
            arguments[index] = .{ .string = @import("string-arguments.zig").read(allocator, &parsed.argument_owner, value.*, request.memoryBytes) catch |err| {
                if (err == error.OutOfMemory or err == error.IdentityExhausted) {
                    result_out.* = .{ .failed = .{ .code = "r05-execution-abort", .category = "execution-abort", .function_id = function_id, .source = info.source, .fuel_remaining = request.semanticFuel } };
                    return false;
                }
                valid = false; break;
            } };
        } else {
            valid = false;
            break;
        }
        parsed.argument_count += 1;
    };
    if (valid) valid = @import("request.zig").acceptsArguments(info,arguments);
    if (!valid) { result_out.* = .{ .failed = .{ .code = "r05-request-arguments", .category = "request", .function_id = function_id, .source = info.source, .fuel_remaining = request.semanticFuel } }; return false; }
    const capabilities = &parsed.capabilities;
    var capabilities_valid = request.capabilities.len <= 128;
    if (capabilities_valid) for (request.capabilities, 0..) |value, index| {
        const capability = host_bindings.readCounterGrant(value) catch { capabilities_valid = false; break; };
        if (index < capabilities.len) capabilities[index] = .{ .id = capability.id, .signature = capability.signature, .semantic_contract = capability.semantic_contract, .counter = counter };
    };
    if (!capabilities_valid) { result_out.* = .{ .failed = .{ .code = "r05-request-capability", .category = "request", .function_id = function_id, .source = info.source, .fuel_remaining = request.semanticFuel } }; return false; }
    const init_only = std.mem.eql(u8, request.kind, "module-initialization");
    if (!init_only and !std.mem.eql(u8, request.kind, "function")) { result_out.* = .{ .failed = .{ .code = "r05-request-kind", .category = "request", .function_id = function_id, .source = info.source, .fuel_remaining = request.semanticFuel } }; return false; }
    const limits: runtime.RequestLimits = .{ .memory_bytes = @intCast(request.memoryBytes), .instruction_budget = request.instructionBudget, .semantic_fuel = request.semanticFuel, .depth = request.depth, .host_time_ns = request.hostTimeNanos };
    parsed.function_id = function_id;
    parsed.arguments = arguments;
    parsed.argument_count = request.arguments.len;
    // All128 JSON records were validated in original order. With CLI-only
    // id31/counter, any N>=2 fails at the second original VM descriptor;
    // keep both so signature/counter/duplicate checks retain their order.
    parsed.capability_count = @min(request.capabilities.len, capabilities.len);
    parsed.init_only = init_only;
    parsed.limits = limits;
    return true;
}
