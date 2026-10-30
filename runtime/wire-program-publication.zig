// SPDX-License-Identifier: MIT
const t = @import("wire-program-types.zig");
const member = @import("wire-program-members.zig");

pub const RootKind = enum { application, @"host-callback", @"host-export", @"hot-function", kernel, @"module-initialization" };
pub const ModuleBindingKind = enum { namespace, function, global, @"type" };
pub const ImportKind = enum { @"import", @"export", @"export-star" };
pub const DeclarationKey = struct {
    kind: enum { function, method, constructor, global },
    name: []const u8,
    path: []const []const u8,
    source_path: []const u8,
};
pub const ScopeRoot = struct { kind: RootKind, name: []const u8, source_path: []const u8, target: t.Hash };
pub const ScopeModuleBinding = struct { kind: ModuleBindingKind, name: []const u8, target: t.Hash, target_source_path: []const u8 };
pub const ScopeModule = struct {
    id: t.Hash,
    source_path: []const u8,
    external: bool,
    initializer: t.Hash,
    dependencies: []const []const u8,
    globals: []const t.Hash,
    imports: []const struct {
        kind: ImportKind,
        specifier: []const u8,
        source_path: []const u8,
        bindings: []const struct { imported: []const u8, kind: ModuleBindingKind, name: []const u8, target: t.Hash, target_source_path: []const u8 },
    },
    exports: []const ScopeModuleBinding,
};
pub const ScopeShape = union(enum) {
    primitive: struct { kind: enum { scalar, string, unknown, @"undefined", @"null", @"void" }, label: []const u8 },
    function: struct { kind: enum { function }, label: []const u8, parameters: []const []const u8, return_type: []const u8 },
    union_type: struct { kind: enum { @"union" }, label: []const u8, members: []const []const u8 },
    element: struct { kind: enum { array, readSpan }, label: []const u8, element_type: []const u8 },
    nominal: struct {
        kind: enum { reference, value },
        label: []const u8,
        // Optional semantic-shape properties preserve absence, not JSON null.
        base: ?[]const u8,
        construction: struct { access: member.Access, parameters: []const []const u8, return_type: []const u8 },
        fields: []const struct { access: member.Access, index: u16, name: []const u8, readonly: bool, @"type": []const u8 },
        methods: ?[]const struct { access: member.Access, name: []const u8, parameters: []const []const u8, return_type: []const u8 },
    },
};
pub const StableScope = struct {
    profile: enum { @"common-program-fixed-v2" },
    root_file: []const u8,
    modules: []const ScopeModule,
    roots: struct { roots: []const ScopeRoot, required_roots: []const ScopeRoot },
    types: []const struct { id: t.Hash, label: []const u8, shape: ScopeShape },
    functions: []const struct {
        function_id: t.Hash,
        signature_hash: t.Hash,
        kind: enum { source, method, @"construction-body" },
        decl_key: DeclarationKey,
        parameter_types: []const t.Hash,
        return_type: t.Hash,
        lexical_parent: ?t.Hash,
        lexical_environment: ?t.Hash,
        activation_environment: ?t.Hash,
        captures: []const t.Hash,
        access: member.Access,
    },
    globals: []const struct { global_id: t.Hash, decl_key: DeclarationKey, @"type": t.Hash, writable: bool },
    environments: []const struct {
        id: t.Hash,
        owner: t.Hash,
        parent: ?t.Hash,
        slots: []const struct { key: t.Hash, kind: enum { parameter, local }, @"type": t.Hash, writable: bool },
    },
    host_context: ?struct { contract_digest: t.Hash, build_identity_digest: t.Hash },
    host_imports: []const struct { id: t.Hash, name: []const u8, source_path: []const u8, capability_id: u32, signature_hash: t.Hash, parameter_types: []const t.Hash, return_type: t.Hash },
};
pub const CodeTargets = struct { functions: []const t.Hash, top: bool };
pub const Access = struct { read: bool, write: bool, structural: bool };
pub const EffectUpper = struct {
    parameters: []const struct { index: u16, read: bool, write: bool, structural: bool },
    captures: []const struct { slot: t.Hash, read: bool, write: bool, structural: bool },
    globals: struct { reads: []const t.Hash, writes: []const t.Hash },
    host_resources: struct { reads: []const []const u8, writes: []const []const u8 },
    facets: struct { allocation: bool, @"await": bool, eh_control: bool, escape: bool, lock: bool, managed_reference: bool, may_throw: bool, unknown_host: bool },
};
pub const Publication = struct {
    format: struct { family: enum { @"tsfg.program-publication-candidate" }, version: u32 },
    mode: enum { fixed },
    scope_digest: t.Hash,
    expected_digest: t.Hash,
    contracts: []const struct {
        function_id: t.Hash,
        signature_hash: t.Hash,
        upper: EffectUpper,
        callables: struct { parameters: []const struct { index: u16, allowed: CodeTargets }, returns: ?CodeTargets, slot_writes: [0]void },
        digest: t.Hash,
    },
};
pub const FixedPublication = struct {
    stable_scope: StableScope,
    publication: Publication,
    dependencies: []const struct {
        function_id: t.Hash,
        callees: []const struct { function_id: t.Hash, digest: t.Hash },
        hosts: []const struct { host_id: t.Hash, contract_digest: t.Hash, build_identity_digest: t.Hash },
    },
    request: struct { targets: []const t.Hash },
};
pub const CommonAuthority = struct {
    exports: [0]void,
    entries: [0]void,
    resources: [0]void,
    published: [0]void,
    fixed_publication: FixedPublication,
};
pub const LegacyAuthority = struct {
    exports: []const struct { function: t.FunctionRef, name: []const u8 },
    entries: []const struct { function: t.FunctionRef, parameter: u16, origin: t.Origin, view: t.TypeRef, roots: []const struct { source: t.TypeRef, target: t.TypeRef } },
    resources: []const struct { id: []const u8, semantic_type: t.TypeRef, owners: []const t.DomainRef, elements: []const t.TypeRef, aliases: []const t.DomainRef },
    published: []const struct { id: t.Hash, function: t.FunctionRef, abi: t.AbiRef, source_signature: t.Hash, closure_identity: t.Hash, parameter_bounds: []const t.DomainRef, result_bound: ?t.DomainRef },
    // Required JSON null becomes a concrete unit value after boundary admission.
    // It cannot carry a Common record, and is never an omitted optional field.
    fixed_publication: void,
};
