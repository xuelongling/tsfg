// SPDX-License-Identifier: MIT
// Independent passive Graph5 controls for the scoped Ref Data proof.
// The separate strict typed fixture owns Context/ABI/layout/SSA/correspondence.
const std = @import("std");
const m = @import("wire-program-return-origin-model.zig");
const domain = @import("wire-program-return-origin-construction.zig");
const owners = @import("wire-program-return-origin-owners.zig");
const dto = @import("constructor-language-ref-dto.zig");
const normal_dto = @import("constructor-scoped-ref-dto.zig");
const Meter = struct {
    left: usize = 100000000, spent: usize = 0,
    fn charge(raw: *anyopaque, units: usize) error{BudgetExceeded}!void {
        const self: *@This() = @ptrCast(@alignCast(raw));
        if (units > self.left) return error.BudgetExceeded;
        self.left -= units; self.spent += units;
    }
};
fn fixedRows(contracts: *const @TypeOf(dto.contracts)) [4]domain.FixedFunction {
    return .{
        .{ .function_id = dto.caller, .declaration = &dto.declarations[0], .contract = &contracts[0], .initialization_fields = &.{} },
        .{ .function_id = dto.native_callee, .declaration = &dto.declarations[1], .contract = &contracts[1], .initialization_fields = &.{} },
        .{ .function_id = dto.callee, .declaration = &dto.declarations[2], .contract = &contracts[2], .initialization_fields = &.{dto.field} },
        .{ .function_id = dto.final_callee, .declaration = &dto.declarations[3], .contract = &contracts[3], .initialization_fields = &.{dto.native_field} },
    };
}
fn ownerRows(contracts: *const @TypeOf(dto.contracts)) [4]owners.Fixed {
    return .{
        .{ .function_id = dto.caller, .graph = &contracts[0].return_origins.?, .parameters = &.{.{ .write = true }}, .captures = &.{}, .may_throw = contracts[0].upper.facets.may_throw },
        .{ .function_id = dto.native_callee, .graph = &contracts[1].return_origins.?, .parameters = &.{.{ .write = true }}, .captures = &.{}, .may_throw = contracts[1].upper.facets.may_throw },
        .{ .function_id = dto.callee, .graph = &contracts[2].return_origins.?, .parameters = &.{ .{ .write = true }, .{} }, .captures = &.{}, .may_throw = contracts[2].upper.facets.may_throw },
        .{ .function_id = dto.final_callee, .graph = &contracts[3].return_origins.?, .parameters = &.{.{ .write = true }}, .captures = &.{}, .may_throw = contracts[3].upper.facets.may_throw },
    };
}
const physical = [_]owners.Physical{
    .{ .type_id = dto.c, .fields = &.{} }, .{ .type_id = dto.a, .fields = &.{} },
    .{ .type_id = dto.b, .fields = &.{.{ .id = dto.field, .view = dto.b, .physical = 0, .type_id = dto.a }} },
    .{ .type_id = dto.actual_c, .fields = &.{.{ .id = dto.native_field, .view = dto.actual_c, .physical = 0, .type_id = dto.scalar }} },
};
fn validate(contracts: *const @TypeOf(dto.contracts), graph: *const m.Graph, budget: *m.Budget) !void {
    try m.validateDirectory(std.testing.allocator, &dto.directory, budget);
    const checked = try m.validateGraph(std.testing.allocator, &dto.directory, dto.caller, graph, budget);
    try std.testing.expect(checked == .pending and checked.pending == .construction_frame);
    for (contracts, [_]m.Symbol{ dto.caller, dto.native_callee, dto.callee, dto.final_callee }) |row, id| if (row.return_origins) |*dependency| {
        const leaf = try m.validateGraph(std.testing.allocator, &dto.directory, id, dependency, budget);
        try std.testing.expect(leaf == .pending and leaf.pending == .construction_frame);
    };
}

test "complete language C has original completion birth native contents and D alias" {
    const fixed=fixedRows(&dto.contracts); var meter:Meter=.{}; var budget=m.Budget{.context=&meter,.charge=Meter.charge}; try validate(&dto.contracts,&dto.caller_graph,&budget);
    var result=try domain.analyzeReturns(std.testing.allocator,&dto.directory,&dto.caller_graph,&budget,.{.function_id=dto.caller,.fixed=&fixed}); defer result.deinit();
    try std.testing.expect(result.pending==null and result.calls.len==2);
    const origin=result.calls[1].arguments[1][0].source.scoped_allocation;
    try std.testing.expect(origin.analysis==result.calls[0].analysis and origin.completion==.language);
    const frame=origin.analysis.frames[origin.frame]; try std.testing.expect(!frame.normal.live and frame.language.live and !frame.language.unbound and frame.language.missing_fields.?.len==0);
    const rows=ownerRows(&dto.contracts);
    var content=try owners.analyzeReceiver(std.testing.allocator,&dto.directory,&physical,dto.caller,&dto.caller_graph,&rows,&budget,&result); defer content.deinit();
    try std.testing.expect(content.pending==null and content.normal.len==1 and content.normal_payloads.len==2);
    var stored:?usize=null; var native:?owners.Payload=null;
    for(content.normal_payloads) |row| { if(std.mem.eql(u8,row.type_id,dto.b)) { try std.testing.expect(row.slots[0].values.len==1); stored=row.slots[0].values[0]; } if(std.mem.eql(u8,row.type_id,dto.actual_c)) native=row; }
    try std.testing.expect(stored!=null and native!=null and stored.?==native.?.location);
    const original=content.locations[stored.?]; try std.testing.expectEqualStrings(dto.actual_c,original.type_id.?); try std.testing.expectEqual(origin.frame,original.node); try std.testing.expect(original.scope==1);
    try std.testing.expect(native.?.slots[0].values.len==1 and content.locations[native.?.slots[0].values[0]].owner==.nonowning);
}
test "same birth normal complete language partial cannot lend its MUST proof" {
    var leaf=normal_dto.actual_leaf; leaf.language=&.{2}; leaf.exits.language=&.{.{.heap=2,.control=2}};
    var contracts=normal_dto.contracts; contracts[3].return_origins=leaf;
    contracts[0].upper.facets.may_throw=true; contracts[1].upper.facets.may_throw=true; contracts[3].upper.facets.may_throw=true;
    const fixed=fixedRows(&contracts); var meter:Meter=.{}; var budget=m.Budget{.context=&meter,.charge=Meter.charge};
    try validate(&contracts,&normal_dto.caller_graph,&budget);
    var normal=try domain.analyzeReturns(std.testing.allocator,&dto.directory,&normal_dto.caller_graph,&budget,.{.function_id=dto.caller,.fixed=&fixed}); defer normal.deinit();
    try std.testing.expect(normal.pending==null and normal.calls.len==2);
    const c_birth=normal.calls[0].analysis.calls[0].receiver; const frame=normal.calls[0].analysis.frames[c_birth];
    try std.testing.expect(frame.normal.live and frame.language.live and frame.normal.missing_fields.?.len==0);
    try std.testing.expectEqualSlices(m.Symbol,&.{dto.native_field},frame.language.missing_fields.?);
    try validate(&contracts,&dto.caller_graph,&budget);
    var language=try domain.analyzeReturns(std.testing.allocator,&dto.directory,&dto.caller_graph,&budget,.{.function_id=dto.caller,.fixed=&fixed}); defer language.deinit();
    try std.testing.expectEqual(@as(?domain.Pending,.data_protocol),language.pending);
}
test "same birth language complete normal partial cannot lend its MUST proof" {
    var leaf=normal_dto.actual_leaf; leaf.normal=&.{2}; leaf.exits.normal=&.{.{.heap=2,.control=2}}; leaf.language=&.{5}; leaf.exits.language=&.{.{.heap=4,.control=3}};
    var contracts=normal_dto.contracts; contracts[3].return_origins=leaf;
    contracts[0].upper.facets.may_throw=true; contracts[1].upper.facets.may_throw=true; contracts[3].upper.facets.may_throw=true;
    const fixed=fixedRows(&contracts); var meter:Meter=.{}; var budget=m.Budget{.context=&meter,.charge=Meter.charge};
    const calls=normal_dto.caller_graph.calls[0..1].*;
    var graph=normal_dto.caller_graph; graph.nodes=normal_dto.caller_graph.nodes[0..4];graph.heaps=normal_dto.caller_graph.heaps[0..3];graph.controls=normal_dto.caller_graph.controls[0..3];graph.calls=&calls;
    graph.normal=&.{2};graph.language=&.{3};graph.exits=.{.normal=&.{.{.heap=1,.control=1}},.language=&.{.{.heap=2,.control=2}}};
    try validate(&contracts,&graph,&budget);
    var result=try domain.analyzeReturns(std.testing.allocator,&dto.directory,&graph,&budget,.{.function_id=dto.caller,.fixed=&fixed});defer result.deinit();
    try std.testing.expect(result.pending==null and result.normal.len==1 and result.language.len==1);
    const n=result.normal[0].source.scoped_allocation; const l=result.language[0].source.scoped_allocation;
    try std.testing.expect(n.analysis==l.analysis and n.frame==l.frame and n.completion==.normal and l.completion==.language);
    const frame=n.analysis.frames[n.frame];try std.testing.expectEqualSlices(m.Symbol,&.{dto.native_field},frame.normal.missing_fields.?);try std.testing.expect(frame.language.missing_fields.?.len==0);
    try validate(&contracts,&normal_dto.caller_graph,&budget);
    var rejected=try domain.analyzeReturns(std.testing.allocator,&dto.directory,&normal_dto.caller_graph,&budget,.{.function_id=dto.caller,.fixed=&fixed});defer rejected.deinit();
    try std.testing.expectEqual(@as(?domain.Pending,.data_protocol),rejected.pending);
}
test "language aliases retain two same B original callsite C namespaces and full Set" {
    var nodes:[15]m.Value=undefined;@memcpy(nodes[0..10],dto.caller_graph.nodes);
    nodes[10]=.{.receiver_frame=.{.construction=dto.role_a,.new_target=dto.a,.parent=null,.site="A:second-B",.control=2}};
    nodes[11]=.{.call=.{.@"type"=dto.a,.call=2,.completion=.normal}};nodes[12]=.{.call=.{.@"type"=null,.call=2,.completion=.language}};
    nodes[13]=.{.join=.{.@"type"=dto.a,.inputs=&.{12}}};nodes[14]=.{.join=.{.@"type"=dto.a,.inputs=&.{9,13}}};nodes[4].receiver_frame.control=9;
    var heaps:[10]m.Heap=undefined;@memcpy(heaps[0..7],dto.caller_graph.heaps);heaps[7]=.{.call=.{.call=2,.completion=.normal}};heaps[8]=.{.call=.{.call=2,.completion=.language}};heaps[9]=.{.join=.{.inputs=&.{2,8}}};
    var controls:[10]m.Control=undefined;@memcpy(controls[0..7],dto.caller_graph.controls);controls[7]=.{.call=.{.call=2,.completion=.normal}};controls[8]=.{.call=.{.call=2,.completion=.language}};controls[9]=.{.join=.{.inputs=&.{2,8}}};
    var calls:[3]m.Call=undefined;@memcpy(calls[0..2],dto.caller_graph.calls);calls[1].arguments=&.{&.{14}};calls[1].heap=9;calls[1].control=9;calls[2]=calls[0];calls[2].receiver=&.{10};calls[2].heap=2;calls[2].control=2;calls[2].site="A:second-construct-B";
    var graph=dto.caller_graph;graph.nodes=&nodes;graph.heaps=&heaps;graph.controls=&controls;graph.calls=&calls;
    const fixed=fixedRows(&dto.contracts);var meter:Meter=.{};var budget=m.Budget{.context=&meter,.charge=Meter.charge};try validate(&dto.contracts,&graph,&budget);
    var result=try domain.analyzeReturns(std.testing.allocator,&dto.directory,&graph,&budget,.{.function_id=dto.caller,.fixed=&fixed});defer result.deinit();try std.testing.expect(result.pending==null and result.calls.len==3);
    const rows=ownerRows(&dto.contracts);var content=try owners.analyzeReceiver(std.testing.allocator,&dto.directory,&physical,dto.caller,&graph,&rows,&budget,&result);defer content.deinit();
    try std.testing.expect(content.pending==null and content.normal.len==1 and content.normal_payloads.len==3);
    var holder:?owners.Payload=null;var native_count:usize=0;for(content.normal_payloads) |row| {if(std.mem.eql(u8,row.type_id,dto.b))holder=row;if(std.mem.eql(u8,row.type_id,dto.actual_c)) {native_count+=1;try std.testing.expect(row.slots[0].values.len==1);}}try std.testing.expect(native_count==2);
    const values=holder.?.slots[0].values;try std.testing.expect(values.len==2);const first=content.locations[values[0]];const second=content.locations[values[1]];try std.testing.expect(first.scope!=second.scope and first.node==second.node);try std.testing.expectEqualStrings(dto.actual_c,first.type_id.?);try std.testing.expectEqualStrings(dto.actual_c,second.type_id.?);
    var borrowed=result;var facts:[3]domain.CallFact=undefined;@memcpy(&facts,result.calls);var proof:[2][]const domain.Atom=undefined;var one:[1]domain.Atom=undefined;
    for(&facts) |*fact| if(fact.call==1) {try std.testing.expect(fact.arguments[1].len==2);one[0]=fact.arguments[1][0];proof=.{&.{},&one};fact.arguments=&proof;};borrowed.calls=&facts;
    var stale=try owners.analyzeReceiver(std.testing.allocator,&dto.directory,&physical,dto.caller,&graph,&rows,&budget,&borrowed);defer stale.deinit();try std.testing.expectEqual(@as(?owners.Pending,.receiver_protocol),stale.pending);
}
test "language argument requires typed root and only transparent payload nulls" {
    var meter:Meter=.{};var budget=m.Budget{.context=&meter,.charge=Meter.charge};
    const fixed=fixedRows(&dto.contracts);
    // No static B root; the original actual C proof alone does not invent one.
    var calls=dto.caller_graph.calls[0..2].*;calls[1].arguments=&.{&.{3}};var graph=dto.caller_graph;graph.calls=&calls;try validate(&dto.contracts,&graph,&budget);
    var untyped=try domain.analyzeReturns(std.testing.allocator,&dto.directory,&graph,&budget,.{.function_id=dto.caller,.fixed=&fixed});defer untyped.deinit();try std.testing.expectEqual(@as(?domain.Pending,.data_protocol),untyped.pending);
    // A nonnull inner static type remains exact, even around complete C.
    var nodes:[11]m.Value=undefined;@memcpy(nodes[0..10],dto.caller_graph.nodes);nodes[9]=.{.join=.{.@"type"=dto.a,.inputs=&.{10}}};nodes[10]=.{.join=.{.@"type"=dto.actual_c,.inputs=&.{3}}};graph=dto.caller_graph;graph.nodes=&nodes;try validate(&dto.contracts,&graph,&budget);
    var mismatch=try domain.analyzeReturns(std.testing.allocator,&dto.directory,&graph,&budget,.{.function_id=dto.caller,.fixed=&fixed});defer mismatch.deinit();try std.testing.expectEqual(@as(?domain.Pending,.data_protocol),mismatch.pending);
    // A normal argument with the wrong static root type is still rejected.
    var normal_nodes:[10]m.Value=undefined;@memcpy(normal_nodes[0..9],normal_dto.caller_graph.nodes);normal_nodes[9]=.{.join=.{.@"type"=dto.b,.inputs=&.{2}}};var normal_calls=normal_dto.caller_graph.calls[0..2].*;normal_calls[1].arguments=&.{&.{9}};graph=normal_dto.caller_graph;graph.nodes=&normal_nodes;graph.calls=&normal_calls;
    try validate(&normal_dto.contracts,&graph,&budget);const normal_fixed=fixedRows(&normal_dto.contracts);var rejected=try domain.analyzeReturns(std.testing.allocator,&dto.directory,&graph,&budget,.{.function_id=dto.caller,.fixed=&normal_fixed});defer rejected.deinit();try std.testing.expectEqual(@as(?domain.Pending,.data_protocol),rejected.pending);
}
test "scoped Data unknown inventory missing graph and unsupported unknown stay Pending" {
    var contracts = dto.contracts; var fixed = fixedRows(&contracts);
    fixed[3].initialization_fields = null;
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try validate(&contracts, &dto.caller_graph, &budget);
    var inventory = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer inventory.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .data_protocol), inventory.pending);
    contracts[3].return_origins = null; fixed = fixedRows(&contracts);
    var missing = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer missing.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .fixed_call), missing.pending);
    var unknown_nodes: [7]m.Value = undefined; @memcpy(unknown_nodes[0..6], dto.actual_leaf.nodes); unknown_nodes[6] = .unknown;
    var unknown = dto.actual_leaf; unknown.nodes = &unknown_nodes; contracts = dto.contracts; contracts[3].return_origins = unknown; fixed = fixedRows(&contracts); try validate(&contracts, &dto.caller_graph, &budget);
    var unsupported = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer unsupported.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .unknown_origin), unsupported.pending);
}
test "scoped Ref keeps complete Upper flags original Set and cumulative Budget" {
    var contracts = normal_dto.contracts; contracts[3].upper.facets.may_throw = true; var fixed = fixedRows(&contracts);
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try validate(&contracts, &dto.caller_graph, &budget);
    var completion = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &normal_dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer completion.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .fixed_completion), completion.pending);
    contracts = dto.contracts; fixed = fixedRows(&contracts);
    var result = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer result.deinit();
    try std.testing.expect(result.pending == null and meter.spent != 0);
    var rows = ownerRows(&contracts); rows[2].parameters = &.{ .{ .write = true }, .{ .read = true } };
    var flags = try owners.analyzeReceiver(std.testing.allocator, &dto.directory, &physical, dto.caller, &dto.caller_graph, &rows, &budget, &result); defer flags.deinit();
    try std.testing.expectEqual(@as(?owners.Pending, .receiver_protocol), flags.pending);
    rows = ownerRows(&contracts); var borrowed = result; var facts: [2]domain.CallFact = undefined; @memcpy(&facts, result.calls);
    for (&facts) |*fact| if (fact.call == 1) { fact.arguments = &.{ &.{}, &.{} }; };
    borrowed.calls = &facts;
    var unmatched = try owners.analyzeReceiver(std.testing.allocator, &dto.directory, &physical, dto.caller, &dto.caller_graph, &rows, &budget, &borrowed); defer unmatched.deinit();
    try std.testing.expect(unmatched.pending != null);
    meter.left = 0;
    try std.testing.expectError(error.BudgetExceeded, owners.analyzeReceiver(std.testing.allocator, &dto.directory, &physical, dto.caller, &dto.caller_graph, &rows, &budget, &result));
    try std.testing.expectEqual(@as(usize, 0), meter.left);
}
