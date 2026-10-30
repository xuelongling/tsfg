// SPDX-License-Identifier: MIT
const t = @import("wire-program-types.zig");

pub const Access = enum { public, protected, private };
pub const Phase = enum { @"before-body", @"after-successful-super" };
pub const Signature = struct { parameters: []const t.TypeRef, return_type: t.TypeRef };
pub const SourceSignature = struct { id: t.Hash, origin: t.Origin };
pub const ConstructorParameterRef = struct { construction: t.ConstructionRef, parameter: u16 };
pub const ConstructorParameter = struct {
    binding: ?t.BindingRef,
    inherited_from: ?ConstructorParameterRef,
    origin: t.Origin,
    @"type": t.TypeRef,
};
pub const ImplicitForward = struct {
    target: t.ConstructionRef,
    origin: t.Origin,
    base_signature: struct { parameters: []const ConstructorParameter, @"return": t.TypeRef },
    parameters: []const struct { source: ConstructorParameterRef, target: ConstructorParameterRef, compatibility: t.CompatibilityRef },
};
pub const CommonField = struct {
    id: t.Hash,
    owner: t.TypeRef,
    ordinal: u16,
    name: []const u8,
    @"type": t.TypeRef,
    declared_type: t.TypeRef,
    readonly: bool,
    optional: bool,
    access: Access,
    origin: t.Origin,
    binding: t.BindingRef,
};
pub const CommonMethod = struct {
    id: t.Hash,
    owner: t.TypeRef,
    function: t.FunctionRef,
    name: []const u8,
    signature: t.Hash,
    override: ?t.Hash,
    access: Access,
};
pub const CommonConstruction = struct {
    id: t.Hash,
    owner: t.TypeRef,
    function: ?t.FunctionRef,
    kind: enum { explicit, @"implicit-base", @"implicit-derived" },
    origin: t.Origin,
    parameters: []const ConstructorParameter,
    signature: Signature,
    source_signature: SourceSignature,
    implicit_forward: ?ImplicitForward,
    initialization_phase: Phase,
    initialization_fields: []const t.FieldRef,
    access: Access,
};
pub const CommonMembers = struct { fields: []const CommonField, methods: []const CommonMethod, constructions: []const CommonConstruction };

pub const LegacyField = struct {
    id: t.Hash,
    owner: t.TypeRef,
    ordinal: u16,
    name: []const u8,
    @"type": t.TypeRef,
    declared_type: t.TypeRef,
    readonly: bool,
    optional: bool,
    origin: ?t.Origin,
};
pub const LegacyMethod = struct { id: t.Hash, owner: t.TypeRef, function: t.FunctionRef, signature: t.Hash, override: ?t.Hash };
pub const LegacyConstruction = struct {
    id: t.Hash,
    owner: t.TypeRef,
    function: t.FunctionRef,
    receiver_binding: []const u8,
    entry: enum { allocated, unbound },
    base: ?t.Hash,
    activation: Phase,
    events: []const struct {
        field: t.FieldRef,
        kind: enum { nativeDefine, initializerWrite, parameterWrite },
        ordinal: u16,
        origin: t.Origin,
        parameter: ?u16,
    },
};
pub const LegacyMembers = struct { fields: []const LegacyField, methods: []const LegacyMethod, constructions: []const LegacyConstruction };

pub const ExceptionField = struct {
    id: t.Hash,
    owner: t.TypeRef,
    ordinal: u16,
    name: []const u8,
    @"type": t.TypeRef,
    readonly: bool,
    range: t.Anchor,
};
pub const ExceptionConstruction = struct { id: t.Hash, owner: t.TypeRef, range: t.Anchor, signature: t.Hash };
pub const ExceptionMembers = struct { fields: []const ExceptionField, constructions: []const ExceptionConstruction };
