// SPDX-License-Identifier: MIT
const t = @import("wire-program-types.zig");

// Layouts with explicit root/field offsets belong to the EH frame model.
// They are not Common object bodies or finite defined-state layouts.
pub const ExceptionLayout = struct { bytes: u32, alignment: u16, roots: []const u32, offsets: []const u32 };
pub const ExceptionCarrierKind = enum(u16) { domain = 0, @"type" = 2, payload = 4 };
pub const ExceptionCarrier = union(ExceptionCarrierKind) { domain: t.DomainRef, @"type": t.TypeRef, payload: void };
pub const ExceptionStorage = struct {
    frames: []const struct {
        function: t.FunctionRef,
        physical_parameters: u16,
        physical_bytes: u32,
        layout: ExceptionLayout,
        slots: []const struct { binding: t.CellRef, kind: enum { value, cell }, @"type": t.TypeRef, carrier: ?ExceptionCarrier, offset: u32 },
    },
};
pub const ExceptionAbi = struct {
    function: t.FunctionRef,
    frame: t.StorageRef,
    parameters: []const t.CellRef,
    captures: []const t.CellRef,
    result: ?t.TypeRef,
    signature: t.Hash,
    carriers: []const ExceptionCarrier,
    physical_parameters: u16,
    result_carrier: ?ExceptionCarrier,
};

pub const BindingRole = enum { param, local, receiver, global, field, element };
// The on-wire role selects the owner directory exactly once at decode.
pub const BindingOwner = union(BindingRole) {
    param: t.FunctionRef,
    local: t.FunctionRef,
    receiver: t.FunctionRef,
    global: t.GlobalRef,
    field: t.FieldRef,
    element: t.TypeRef,
};
pub const CommonBinding = struct {
    id: []const u8,
    owner: BindingOwner,
    name: []const u8,
    @"type": t.TypeRef,
    writable: bool,
    origin: ?t.Origin,
    carrier: t.Carrier,
    scope: ?t.ScopeRef,
    declaration_kind: ?enum { parameter, local, @"catch" },
};
pub const CommonStorage = struct {
    bindings: []const CommonBinding,
    concrete: []const struct {
        @"type": t.TypeRef,
        carrier: t.FieldLayout,
        body: ?struct {
            byte_size: u32,
            alignment: u16,
            reference_count: u16,
            fields: []const struct { field: t.FieldRef, binding: t.BindingRef, offset: u32, reference_offset: u16 },
        },
    },
    arrays: []const struct { @"type": t.TypeRef, element_carrier: t.Carrier },
    environments: []const struct {
        environment: t.EnvironmentRef,
        byte_size: u32,
        alignment: u16,
        reference_count: u16,
        parent_offset: ?u32,
        slot_offsets: []const u32,
    },
    payload: t.Layout,
};
pub const CommonAbi = struct {
    kind: enum { common },
    function: t.FunctionRef,
    signature: t.Hash,
    parameters: []const t.BindingRef,
    receiver: ?t.BindingRef,
    lexical_environment: ?t.EnvironmentRef,
    physical_parameters: []const t.Carrier,
    result: ?t.TypeRef,
    result_carrier: ?t.Carrier,
};

pub const LegacyStorage = struct {
    arrays: []const struct { @"type": t.TypeRef, domain: t.DomainRef },
    concrete: []const struct {
        id: t.Hash,
        @"type": t.TypeRef,
        byte_size: u32,
        alignment: u16,
        reference_count: u16,
        fields: []const struct { field: t.FieldRef, domain: t.DomainRef, offset: u32, state_offset: u32, reference_offset: u16 },
    },
    domains: []const struct { id: t.Hash, domain: t.DomainRef },
};
pub const LegacyAbi = struct {
    id: t.Hash,
    function: t.FunctionRef,
    kind: enum { native, finite, closure },
    source_signature: t.Hash,
    source_result: t.TypeRef,
    parameters: []const struct { binding: []const u8, view: t.TypeRef, domain: t.DomainRef, presence: u8, origin: ?t.Origin },
    presence: []const u8,
    result: ?struct { view: t.TypeRef, domain: t.DomainRef },
};
