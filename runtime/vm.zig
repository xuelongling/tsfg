// SPDX-License-Identifier: MIT
// Public VM API. Lifecycle/admission and the instruction owner have separate
// responsibilities while preserving the embedding interface.
const instance = @import("vm-instance.zig");
const request = @import("request.zig");
pub const ModuleInstance = instance.ModuleInstance;
pub const evaluate = instance.evaluate;
pub const TypedValue = request.TypedValue;
pub const typedValue = request.typedValue;
pub const Capability = request.Capability;
pub const RequestLimits = request.RequestLimits;
pub const Returned = request.Returned;
pub const RequestFailure = request.RequestFailure;
pub const RequestOutcome = request.RequestOutcome;
pub const FloatingEnvironment = @import("floating-environment.zig").FloatingEnvironment;