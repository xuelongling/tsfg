// SPDX-License-Identifier: MIT
// Stable public loader seam; decode/verification and views each own one implementation.
const model = @import("bytecode_model.zig");
const decoder = @import("bytecode_decode.zig");
const view = @import("bytecode_view.zig");

pub const contract = model.contract;
pub const module_format = model.module_format;
pub const FunctionId = model.FunctionId;
pub const VerifiedModule = model.VerifiedModule;
pub const Source = model.Source;
pub const ModuleInfo = model.ModuleInfo;
pub const Instruction = model.Instruction;
pub const Parameter = model.Parameter;
pub const Block = model.Block;
pub const Function = model.Function;
pub const LoadFailure = model.LoadFailure;
pub const LoadOutcome = model.LoadOutcome;

pub const load = decoder.load;
pub const unload = decoder.unload;

pub const moduleInfo = view.moduleInfo;
pub const instructions = view.instructions;
pub const blockTable = view.blockTable;
pub const functions = view.functions;
pub const moduleTables = view.moduleTables;
pub const moduleTablesView = view.moduleTablesView;
pub const moduleInfoView = view.moduleInfoView;
pub const serialize = view.serialize;
pub const digestText = view.digestText;
pub const inspect = view.inspect;

// Explicit private-format namespace; its opaque handle is not a VM VerifiedModule.
pub const nullable = @import("nullable-bytecode.zig");

// Private immutable String data; no formal loader or execution qualification.
pub const stringCandidate = @import("string-candidate.zig");
