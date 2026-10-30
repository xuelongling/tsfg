// SPDX-License-Identifier: MIT
const t = @import("wire-program-types.zig");
const storage = @import("wire-program-storage.zig");

pub const SlotKind = enum { parameter, local };
pub const LegacyClosures = struct {
    functions: []const struct {
        function: t.FunctionRef,
        parent: ?t.FunctionRef,
        lexical_environment: ?t.EnvironmentRef,
        activation_environment: ?t.EnvironmentRef,
        scope: []const u8,
        @"type": t.TypeRef,
    },
    environments: []const struct {
        id: t.Hash,
        storage_id: t.Hash,
        owner: t.FunctionRef,
        parent: ?t.EnvironmentRef,
        byte_size: u32,
        alignment: u16,
        reference_count: u16,
        slots: []const struct {
            binding: t.Hash,
            role: SlotKind,
            @"type": t.TypeRef,
            writable: bool,
            offset: u32,
            state_offset: u32,
            reference_offset: u16,
            declaration_index: u16,
        },
    },
    calls: []const struct { function: t.FunctionRef, block: t.BlockRef, instruction: u16, targets: []const t.FunctionRef },
};
pub const CommonClosures = struct {
    functions: []const struct {
        function: t.FunctionRef,
        parent: ?t.FunctionRef,
        lexical_environment: ?t.EnvironmentRef,
        activation_environment: ?t.EnvironmentRef,
        captures: []const struct { environment: t.EnvironmentRef, slot: t.EnvironmentSlotRef },
    },
    environments: []const struct {
        id: t.Hash,
        owner: t.FunctionRef,
        parent: ?t.EnvironmentRef,
        slots: []const struct { binding: t.BindingRef, key: t.Hash, kind: SlotKind, @"type": t.TypeRef, writable: bool },
    },
    calls: []const struct { function: t.FunctionRef, block: t.BlockRef, instruction: u16, signature: t.Hash, targets: []const t.FunctionRef },
};
pub const ExceptionControl = struct {
    functions: []const struct {
        captures: []const t.CellRef,
        declaring_scope: ?t.Hash,
        module: t.ModuleRef,
        parameters: []const t.CellRef,
        parent: ?t.FunctionRef,
        @"type": ?t.TypeRef,
    },
    bindings: []const struct {
        id: t.Hash,
        index: u16,
        name: []const u8,
        owner: t.FunctionRef,
        range: t.Anchor,
        role: enum { parameter, local, function, @"catch" },
        scope: t.ScopeRef,
        @"type": t.TypeRef,
        writable: bool,
        carrier: storage.ExceptionCarrier,
    },
    scopes: []const struct {
        id: t.Hash,
        owner: t.FunctionRef,
        parent: ?t.ScopeRef,
        path: []const struct { slot: []const u8, statement: u16 },
        range: t.Anchor,
        role: enum { function, module, block, then, @"else", @"try", @"catch", finally, loop },
    },
};
pub const Completion = enum { normal, @"return", @"throw" };
pub const CommonControl = struct {
    functions: []const struct {
        function: t.FunctionRef,
        handlers: []const struct {
            id: []const u8,
            source: t.SourceRef,
            range: t.Anchor,
            has_catch: bool,
            has_finally: bool,
            catch_binding: ?t.BindingRef,
            catch_block: ?t.BlockRef,
            finally_blocks: []const struct { block: t.BlockRef, completion: Completion },
        },
    },
    bindings: []const struct { binding: t.BindingRef, scope: t.ScopeRef },
    scopes: []const struct { owner: t.FunctionRef, path: []const []const u8 },
};
