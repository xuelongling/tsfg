// SPDX-License-Identifier: MIT
// Owned wire17 data only. Declaration bounds/joins are enforced by the future
// decoder and independent validator, not by an execution handle in this model.
const t = @import("wire-program-types.zig");
const member_model = @import("wire-program-members.zig");
const storage_model = @import("wire-program-storage.zig");
const publication_model = @import("wire-program-publication.zig");
const control_model = @import("wire-program-control.zig");

pub const Tag = enum(u8) { sources = 0, types = 1, members = 2, domains = 3, storage = 4, views = 5, abis = 6, modules = 7, authority = 8, closures = 9, exceptions = 10 };
pub const Mode = enum { legacy, exception, common };
pub const Source = struct { hash: t.Hash, path: []const u8, length: u32 };
pub const LegacyType = struct {
    id: t.Hash,
    kind: enum { scalar, @"undefined", @"null", @"void", @"union", array, readSpan, reference, value, string, function },
    name: []const u8,
    native_code: u8,
    base: ?t.TypeRef,
    element: ?t.TypeRef,
    members: []const t.TypeRef,
    nominal_key: ?struct { category: enum { class, value }, declaration_path: []const []const u8, source: t.SourceRef },
    runtime_key: ?t.Hash,
};
pub const CommonType = struct {
    id: t.Hash,
    kind: enum { scalar, unknown, @"undefined", @"null", @"void", @"union", array, readSpan, reference, value, string, function },
    name: []const u8,
    native_code: u8,
    base: ?t.TypeRef,
    element: ?t.TypeRef,
    members: []const t.TypeRef,
    methods: ?[]const t.MethodRef,
    nominal_key: ?struct { category: enum { reference, value, component }, declaration_path: []const []const u8, source: t.SourceRef },
    runtime_key: ?t.Hash,
};
pub const ExceptionType = struct {
    id: t.Hash,
    kind: enum { scalar, unknown, nullable, callable, aggregate, @"undefined", @"null" },
    name: []const u8,
    base: ?t.TypeRef,
    mask: u8,
    parameters: []const t.TypeRef,
    result: ?t.TypeRef,
    source: ?t.SourceRef,
    // The wire spelling for empty is the empty category string.
    category: enum { empty, value, component },
    path: []const []const u8,
    field_indexes: []const t.FieldRef,
    constructors: []const t.ConstructionRef,
    fields: []const struct { @"type": t.TypeRef },
    layout: storage_model.ExceptionLayout,
};
pub const LegacyDomain = struct {
    id: t.Hash,
    alternatives: []const t.TypeRef,
    representation: enum { bottom, native, reference, absence, @"inline", @"finite-union" },
    native_code: u8,
    byte_size: u32,
    alignment: u16,
    reference_count: u16,
    tag_bytes: u8,
};
pub const TypedDomain = struct {
    id: t.Hash,
    actual_types: []const t.TypeRef,
    representation: enum { bottom, absence, reference, @"finite-union" },
    byte_size: u32,
    alignment: u16,
    reference_count: u16,
    tag_bytes: u8,
};
pub const Dispatch = union(enum) {
    field: struct {
        view: t.TypeRef,
        member: t.FieldRef,
        arms: []const struct { actual: t.TypeRef, target: ?t.FieldRef, abi: ?t.AbiRef },
    },
    method: struct {
        view: t.TypeRef,
        member: t.MethodRef,
        arms: []const struct { actual: t.TypeRef, target: ?t.FunctionRef, abi: ?t.AbiRef },
    },
};
pub const FieldLike = union(enum) { field: t.FieldRef, length: t.TypeRef };
pub const LegacyViews = struct {
    compatibility: []const struct {
        source_type: t.TypeRef,
        target_type: t.TypeRef,
        fields: []const struct { actual: ?t.FieldRef, target: t.FieldRef },
        methods: []const struct { actual: t.MethodRef, target: t.MethodRef },
    },
    dispatch: []const Dispatch,
};
pub const CommonViews = struct {
    compatibility: []const struct {
        source_type: t.TypeRef,
        target_type: t.TypeRef,
        origin: t.Origin,
        fields: []const struct { actual: ?FieldLike, target: FieldLike },
        methods: []const struct { actual: t.MethodRef, target: t.MethodRef },
    },
    dispatch: []const Dispatch,
    entries: []const struct { function: t.FunctionRef, parameter: t.BindingRef, roots: []const t.CompatibilityRef },
};
pub const LegacyModules = struct {
    globals: []const struct { id: t.Hash, source: t.SourceRef, name: []const u8, view: t.TypeRef, domain: t.DomainRef, writable: bool, generated: bool, start: u32, end: u32 },
    hosts: []const struct { id: t.Hash, source: t.SourceRef, name: []const u8, capability: u32, signature: t.Hash, start: u32, end: u32 },
    modules: []const struct { id: t.Hash, source: t.SourceRef, initializer: t.FunctionRef, dependencies: []const t.ModuleRef },
    initialization: []const t.FunctionRef,
    roots: []const struct { kind: u8, name: []const u8, source: t.SourceRef, function: t.FunctionRef },
};
pub const ExceptionModules = struct {
    modules: []const struct {
        id: t.Hash,
        source: t.SourceRef,
        external: bool,
        initializer: ?t.FunctionRef,
        functions: []const t.FunctionRef,
        imports: []const struct {
            module: t.ModuleRef,
            specifier: []const u8,
            bindings: []const struct { function: t.FunctionRef, name: []const u8, range: t.Anchor },
        },
        exports: []const struct { function: t.FunctionRef, name: []const u8, range: t.Anchor, definition: t.Anchor },
    },
};
pub const CommonModules = struct {
    globals: []const struct {
        id: t.Hash,
        source: t.SourceRef,
        name: []const u8,
        @"type": t.TypeRef,
        carrier: t.Carrier,
        writable: bool,
        generated: bool,
        start: u32,
        end: u32,
        decl_key: publication_model.DeclarationKey,
        binding: t.BindingRef,
    },
    hosts: []const struct {
        id: t.Hash,
        source: t.SourceRef,
        name: []const u8,
        capability: u32,
        signature: t.Hash,
        start: u32,
        end: u32,
        parameter_types: []const t.TypeRef,
        return_type: t.TypeRef,
        contract_digest: t.Hash,
        build_identity_digest: t.Hash,
    },
    modules: []const struct {
        id: t.Hash,
        source: t.SourceRef,
        external: bool,
        initializer: t.FunctionRef,
        dependencies: []const t.ModuleRef,
        globals: []const t.GlobalRef,
        imports: []const struct {
            kind: publication_model.ImportKind,
            specifier: []const u8,
            source: t.SourceRef,
            bindings: []const struct { imported: []const u8, kind: publication_model.ModuleBindingKind, name: []const u8, target: t.Hash, target_source: t.SourceRef },
        },
        exports: []const struct { kind: publication_model.ModuleBindingKind, name: []const u8, target: t.Hash, target_source: t.SourceRef },
    },
    initialization: []const t.ModuleRef,
    roots: struct {
        roots: []const struct { kind: publication_model.RootKind, name: []const u8, source: t.SourceRef, target: t.Hash },
        required_roots: []const struct { kind: publication_model.RootKind, name: []const u8, source: t.SourceRef, target: t.Hash },
    },
};
pub const LegacyTables = struct {
    types: []const LegacyType,
    members: member_model.LegacyMembers,
    domains: []const LegacyDomain,
    storage: storage_model.LegacyStorage,
    views: LegacyViews,
    abis: []const storage_model.LegacyAbi,
    modules: LegacyModules,
    authority: publication_model.LegacyAuthority,
    closures: control_model.LegacyClosures,
    exceptions: control_model.ExceptionControl,
};
pub const ExceptionTables = struct {
    types: []const ExceptionType,
    members: member_model.ExceptionMembers,
    domains: []const TypedDomain,
    storage: storage_model.ExceptionStorage,
    views: struct {},
    abis: []const storage_model.ExceptionAbi,
    modules: ExceptionModules,
    authority: publication_model.LegacyAuthority,
    closures: control_model.LegacyClosures,
    exceptions: control_model.ExceptionControl,
};
pub const CommonTables = struct {
    types: []const CommonType,
    members: member_model.CommonMembers,
    domains: []const TypedDomain,
    storage: storage_model.CommonStorage,
    views: CommonViews,
    abis: []const storage_model.CommonAbi,
    modules: CommonModules,
    authority: publication_model.CommonAuthority,
    closures: control_model.CommonClosures,
    exceptions: control_model.CommonControl,
};
// Mode is one complete table family, never eleven independently mixable unions.
pub const Tables = struct {
    sources: []const Source,
    mode: union(Mode) { legacy: LegacyTables, exception: ExceptionTables, common: CommonTables },
};
