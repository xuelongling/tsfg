// SPDX-License-Identifier: MIT
// Common module business joins over already checked typed records. Identity
// binds Scope to these directories; it does not prove import resolution,
// declaration ownership, dependency derivation or initializer order. Rebuild
// those relations here without Source text, an interpreter or an actual heap.
const std = @import("std");
const model = @import("wire-program-model.zig");
const tables = @import("wire-program-tables.zig");
const publication = @import("wire-program-publication.zig");
const context = @import("wire-program-refcheck-context.zig");
const t = model.types;
const Context = context.Context;
pub const Error = context.Error;

fn textEqual(c: *Context, a: []const u8, b: []const u8) Error!bool {
    // Equality is business work, not repeated UTF8/NUL/schema admission.
    try c.charge(1 + a.len / 64 + b.len / 64);
    return std.mem.eql(u8, a, b);
}

fn resolves(c: *Context, path: []const u8, specifier: []const u8, expected: []const u8) Error!bool {
    try c.charge(1 + path.len / 64 + specifier.len / 64);
    if (!std.mem.startsWith(u8, specifier, "./") and !std.mem.startsWith(u8, specifier, "../")) return false;
    var parts: std.ArrayListUnmanaged([]const u8) = .empty;
    defer parts.deinit(c.allocator);
    // Source paths are already canonical absolute virtual paths. This is the
    // original relative-module recipe, never an OS/filesystem resolution.
    var prefix = std.mem.splitScalar(u8, path[1..], '/');
    while (prefix.next()) |part| { try c.step(); try parts.append(c.allocator, part); }
    parts.items.len -= 1;
    var tail = std.mem.splitScalar(u8, specifier, '/');
    while (tail.next()) |part| {
        try c.step();
        if (part.len == 0 or std.mem.eql(u8, part, ".")) continue;
        if (std.mem.eql(u8, part, "..")) {
            if (parts.items.len == 0) return false;
            parts.items.len -= 1;
        } else try parts.append(c.allocator, part);
    }
    var joined: std.ArrayListUnmanaged(u8) = .empty;
    defer joined.deinit(c.allocator);
    for (parts.items) |part| {
        try c.charge(1 + part.len / 64);
        try joined.append(c.allocator, '/');
        try joined.appendSlice(c.allocator, part);
    }
    if (!std.mem.endsWith(u8, joined.items, ".ts")) try joined.appendSlice(c.allocator, ".ts");
    return textEqual(c, joined.items, expected);
}

const Visit = struct { module: t.ModuleRef, next: usize = 0 };
const Checker = struct {
    c: *Context,
    common: tables.CommonTables,
    source_modules: []?t.ModuleRef,
    functions: std.AutoHashMapUnmanaged(t.Hash, t.FunctionRef) = .empty,
    globals: std.AutoHashMapUnmanaged(t.Hash, t.GlobalRef) = .empty,
    modules: std.AutoHashMapUnmanaged(t.Hash, t.ModuleRef) = .empty,
    types: std.AutoHashMapUnmanaged(t.Hash, t.TypeRef) = .empty,

    fn deinit(self: *Checker) void {
        self.c.allocator.free(self.source_modules);
        self.functions.deinit(self.c.allocator); self.globals.deinit(self.c.allocator);
        self.modules.deinit(self.c.allocator); self.types.deinit(self.c.allocator);
    }

    fn catalogue(self: *Checker) Error!void {
        const c = self.c;
        for (c.program.functions, 0..) |function, index| { try c.step(); try self.functions.put(c.allocator, function.id, @enumFromInt(index)); }
        for (self.common.modules.globals, 0..) |global, index| { try c.step(); try self.globals.put(c.allocator, global.id, @enumFromInt(index)); }
        for (self.common.types, 0..) |row, index| { try c.step(); try self.types.put(c.allocator, row.id, @enumFromInt(index)); }
        for (self.common.modules.modules, 0..) |module, index| {
            try c.step(); const source = @intFromEnum(module.source);
            // Semantic-ID uniqueness already passed. This is the independent
            // one-module-per-Source relation, not a second ID/hash check.
            try c.require(self.source_modules[source] == null);
            self.source_modules[source] = @enumFromInt(index);
            try self.modules.put(c.allocator, module.id, @enumFromInt(index));
        }
    }

    fn target(self: *Checker, kind: publication.ModuleBindingKind, id: t.Hash, source: t.SourceRef) Error!void {
        const c = self.c; try c.step();
        switch (kind) {
            .function => {
                const function = c.program.functions[@intFromEnum(self.functions.get(id) orelse return error.InvalidReference)];
                try c.require(function.role != .module_initializer and function.source == source);
            },
            .global => {
                const row = self.common.modules.globals[@intFromEnum(self.globals.get(id) orelse return error.InvalidReference)];
                try c.require(row.source == source);
            },
            .namespace => {
                const row = self.common.modules.modules[@intFromEnum(self.modules.get(id) orelse return error.InvalidReference)];
                try c.require(row.source == source);
            },
            .@"type" => {
                const row = self.common.types[@intFromEnum(self.types.get(id) orelse return error.InvalidReference)];
                // Only nominal Types retain their defining Source directory
                // reference. Do not invent one for scalar/union/function IDs.
                if (row.nominal_key) |nominal| try c.require(nominal.source == source);
            },
        }
    }

    fn moduleRows(self: *Checker) Error!void {
        const c = self.c; const rows = self.common.modules;
        try c.charge(c.program.functions.len + rows.globals.len);
        const initializers = try c.allocator.alloc(bool, c.program.functions.len);
        defer c.allocator.free(initializers); @memset(initializers, false);
        const owned_globals = try c.allocator.alloc(bool, rows.globals.len);
        defer c.allocator.free(owned_globals); @memset(owned_globals, false);
        for (rows.modules) |module| {
            try c.step(); const initializer = @intFromEnum(module.initializer); const function = c.program.functions[initializer];
            try c.require(!initializers[initializer] and function.role == .module_initializer and function.source == module.source);
            initializers[initializer] = true;
            try c.require(try textEqual(c, function.name, "$moduleInit"));
            try c.require(function.declaration.start == 0 and function.declaration.end == c.program.tables.sources[@intFromEnum(module.source)].length);
            const abi = self.common.abis[@intFromEnum(function.abi)];
            try c.require(abi.parameters.len == 0 and abi.receiver == null and abi.lexical_environment == null and abi.result == null);
            // Layout already owns physical/logical ABI pairing, ID/signature
            // reconstruction belongs to identity, and bytecode refs to shape.
            var previous: ?u32 = null;
            for (module.globals) |ref| {
                try c.step(); const index = @intFromEnum(ref); const global = rows.globals[index];
                try c.require(!owned_globals[index] and global.source == module.source);
                owned_globals[index] = true;
                if (previous) |start| try c.require(start <= global.start);
                previous = global.start;
            }
            var dependencies: std.ArrayListUnmanaged(t.ModuleRef) = .empty;
            defer dependencies.deinit(c.allocator);
            var seen: std.AutoHashMapUnmanaged(t.ModuleRef, void) = .empty;
            defer seen.deinit(c.allocator);
            const path = c.program.tables.sources[@intFromEnum(module.source)].path;
            for (module.imports) |import| {
                try c.step(); const imported = self.source_modules[@intFromEnum(import.source)] orelse return error.InvalidShape;
                const provider = rows.modules[@intFromEnum(imported)];
                try c.require(try resolves(c, path, import.specifier, c.program.tables.sources[@intFromEnum(import.source)].path));
                if (!(try seen.getOrPut(c.allocator, imported)).found_existing) try dependencies.append(c.allocator, imported);
                for (import.bindings) |binding| {
                    try c.step(); try self.target(binding.kind, binding.target, binding.target_source);
                    if (binding.kind == .namespace) {
                        try c.require(try textEqual(c, binding.imported, "*"));
                        try c.require(binding.target_source == import.source and std.mem.eql(u8, &binding.target, &provider.id));
                    } else {
                        var found = false;
                        for (provider.exports) |exported| {
                            try c.step();
                            if (try textEqual(c, exported.name, binding.imported)) {
                                try c.require(exported.kind == binding.kind and exported.target_source == binding.target_source and std.mem.eql(u8, &exported.target, &binding.target));
                                found = true; break;
                            }
                        }
                        try c.require(found);
                    }
                }
            }
            try c.require(dependencies.items.len == module.dependencies.len);
            for (dependencies.items, module.dependencies) |computed, claimed| try c.require(computed == claimed);
            for (module.exports) |exported| { try c.step(); try self.target(exported.kind, exported.target, exported.target_source); }
        }
        for (c.program.functions, initializers) |function, represented| {
            try c.step(); try c.require((function.role == .module_initializer) == represented);
        }
        for (owned_globals) |represented| { try c.step(); try c.require(represented); }
        for (rows.globals) |global| {
            try c.step(); const binding = self.common.storage.bindings[@intFromEnum(global.binding)];
            const origin = binding.origin orelse return error.InvalidShape;
            try c.require(binding.@"type" == global.@"type" and binding.writable == global.writable);
            try c.require(binding.declaration_kind != null and binding.declaration_kind.? == .local);
            try c.require(try textEqual(c, binding.name, global.name));
            try c.require(origin.source == global.source and origin.start == global.start and origin.end == global.end);
            try c.require(global.decl_key.kind == .global and global.decl_key.path.len == 0);
            try c.require(try textEqual(c, global.decl_key.source_path, c.program.tables.sources[@intFromEnum(global.source)].path));
            try c.require(try textEqual(c, global.decl_key.name, if (global.generated) "$default" else global.name));
            if (global.generated) try c.require(!global.writable);
        }
        // Layout checks each Global -> binding owner/carrier. Add only the
        // inverse: no orphan global-role Storage binding may hide in the table.
        for (self.common.storage.bindings, 0..) |binding, index| {
            try c.step(); if (binding.owner == .global) try c.require(@intFromEnum(rows.globals[@intFromEnum(binding.owner.global)].binding) == index);
        }
    }

    fn globalStores(self: *Checker) Error!void {
        const c = self.c;
        for (c.program.functions, 0..) |function, index| {
            try c.step();
            for (function.blocks) |block| for (block.instructions) |op| {
                try c.step();
                switch (op.data) {
                    .global_store => |store| {
                        const global = self.common.modules.globals[@intFromEnum(store.global)];
                        // Inlined defining-module code can store from another
                        // function. Core binding permission uses mutability;
                        // Source import assignment is checked separately.
                        if (store.initialize) {
                            try c.step();
                            const owner = self.source_modules[@intFromEnum(global.source)] orelse return error.InvalidShape;
                            const module = self.common.modules.modules[@intFromEnum(owner)];
                            try c.require(function.role == .module_initializer and @intFromEnum(module.initializer) == index);
                        } else try c.require(global.writable);
                    },
                    else => {},
                }
            };
        }
    }

    fn roots(self: *Checker) Error!void {
        const c = self.c; const rows = self.common.modules.roots;
        inline for (.{ rows.roots, rows.required_roots }) |group| for (group) |root| {
            try c.step(); const ref = self.functions.get(root.target) orelse return error.InvalidReference;
            const function = c.program.functions[@intFromEnum(ref)];
            try c.require(self.source_modules[@intFromEnum(root.source)] != null and function.source == root.source);
            try c.require((root.kind == .@"module-initialization") == (function.role == .module_initializer));
            // The original Common root contract names the actual declaration,
            // not an export alias or an independently self-consistent label.
            try c.require(try textEqual(c, root.name, function.name));
        };
        for (rows.required_roots) |required| {
            try c.step(); var found = false;
            for (rows.roots) |root| {
                try c.step();
                if (root.kind == required.kind and root.source == required.source and std.mem.eql(u8, &root.target, &required.target) and try textEqual(c, root.name, required.name)) { found = true; break; }
            }
            try c.require(found);
        }
    }

    fn initialization(self: *Checker) Error!void {
        const c = self.c; const rows = self.common.modules;
        try c.charge(rows.modules.len);
        const seen = try c.allocator.alloc(bool, rows.modules.len); defer c.allocator.free(seen); @memset(seen, false);
        var stack: std.ArrayListUnmanaged(Visit) = .empty; defer stack.deinit(c.allocator);
        var ordinal: usize = 0;
        // Scope preserves original module sequence; semantic-ID directory
        // order is not the Source traversal order. Identity already joined
        // each Scope module/dependency to these typed tables exactly once.
        for (self.common.authority.fixed_publication.stable_scope.modules) |module| {
            try c.step(); const ref = self.modules.get(module.id) orelse return error.InvalidReference;
            if (seen[@intFromEnum(ref)]) continue;
            try stack.append(c.allocator, .{ .module = ref }); seen[@intFromEnum(ref)] = true;
            while (stack.items.len != 0) {
                try c.step(); const last = stack.items.len - 1; const frame = stack.items[last];
                const dependencies = rows.modules[@intFromEnum(frame.module)].dependencies;
                if (frame.next < dependencies.len) {
                    const dependency = dependencies[frame.next]; stack.items[last].next += 1;
                    if (!seen[@intFromEnum(dependency)]) {
                        try stack.append(c.allocator, .{ .module = dependency }); seen[@intFromEnum(dependency)] = true;
                    }
                } else {
                    // Mark-before-descend intentionally retains the original
                    // cycle-tolerant DFS recipe; do not invent an acyclic rule.
                    try c.require(rows.initialization[ordinal] == frame.module);
                    ordinal += 1; stack.items.len -= 1;
                }
            }
        }
        try c.require(ordinal == rows.initialization.len);
    }
};

// Preconditions: same-Context refs/layout/SSA/identity have succeeded. Types,
// source paths, IDs, tuple uniqueness, hash recipes and Scope directory joins
// are already owned there; do not repeat that boundary or solve any Code realm.
//
// Success proves the module business relations above, not that actual Source
// contains these import/export tokens, complete export-star expansion, original
// declaration text or an initializer store-once body. Global stores separately
// prove binding mutability and the exact defining-module initializer owner.
// Non-nominal Type defining
// Source is absent from that typed Type row. HSC, effects, borrow, complete
// publication/admission and any Runtime/GPU/execution authority remain separate.
pub fn checkModules(c: *Context) Error!void {
    const common = switch (c.program.tables.mode) { .common => |value| value, else => return error.WrongMode };
    try c.charge(c.program.tables.sources.len);
    const source_modules = try c.allocator.alloc(?t.ModuleRef, c.program.tables.sources.len);
    @memset(source_modules, null);
    var checker = Checker{ .c = c, .common = common, .source_modules = source_modules };
    defer checker.deinit();
    try checker.catalogue(); try checker.moduleRows(); try checker.globalStores(); try checker.roots(); try checker.initialization();
}
