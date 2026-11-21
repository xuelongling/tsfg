// SPDX-License-Identifier: MIT
// Independent passive Graph5 controls for original transitive Ref forwarding.
// The separate strict typed fixture owns Context/ABI/layout/SSA/correspondence.
const std = @import("std");
const m = @import("wire-program-return-origin-model.zig");
const domain = @import("wire-program-return-origin-construction.zig");
const inclusion = @import("wire-program-return-origins.zig");
const owners = @import("wire-program-return-origin-owners.zig");
const dto = @import("constructor-transitive-ref-dto.zig");
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
        .{ .function_id = dto.native_callee, .graph = &contracts[1].return_origins.?, .parameters = &.{ .{ .write = true }, .{} }, .captures = &.{}, .may_throw = contracts[1].upper.facets.may_throw },
        .{ .function_id = dto.callee, .graph = &contracts[2].return_origins.?, .parameters = &.{ .{ .write = true }, .{} }, .captures = &.{}, .may_throw = contracts[2].upper.facets.may_throw },
        .{ .function_id = dto.final_callee, .graph = &contracts[3].return_origins.?, .parameters = &.{.{ .write = true }}, .captures = &.{}, .may_throw = contracts[3].upper.facets.may_throw },
    };
}
const physical = [_]owners.Physical{
    .{ .type_id = dto.c, .fields = &.{} }, .{ .type_id = dto.a, .fields = &.{} },
    .{ .type_id = dto.b, .fields = &.{.{ .id = dto.field, .view = dto.b, .physical = 0, .type_id = dto.actual_c }} },
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
test "public formal Ref cannot manufacture a caller proof for its nested D" {
    const fixed = fixedRows(&dto.contracts); var meter: Meter = .{}; var budget = m.Budget{ .context=&meter, .charge=Meter.charge };
    try validate(&dto.contracts,&dto.caller_graph,&budget);
    var result = try domain.analyzeReturns(std.testing.allocator,&dto.directory,&dto.native_leaf,&budget,.{ .function_id=dto.native_callee, .fixed=&fixed }); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending,.data_protocol),result.pending);
}
test "ordinary ABI Ref keeps its original input through two constructor copies and the replacement field" {
    var functions = dto.directory.functions[0..4].*;
    functions[0].kind = .source;
    functions[0].parameter_types = &.{dto.actual_c};
    functions[0].return_type = dto.actual_c;
    functions[0].construction = null;
    var constructions = dto.directory.constructions[0..4].*;
    constructions[0].kind = .implicit_base;
    constructions[0].function_id = null;
    const carrier_field = "sha256:" ++ "9b" ** 32;
    var directory = dto.directory;
    directory.functions = &functions;
    directory.constructions = &constructions;
    directory.fields = &.{ dto.field, dto.native_field, carrier_field };
    var layout = physical;
    layout[2].fields = &.{
        .{ .id = dto.field, .view = dto.b, .physical = 0, .type_id = dto.actual_c },
        .{ .id = carrier_field, .view = dto.a, .physical = 0, .type_id = dto.actual_c },
    };
    var declarations = dto.declarations;
    declarations[0].kind = .source;
    declarations[0].decl_key.kind = .function;
    declarations[0].decl_key.name = "pass";
    declarations[0].parameter_types = &.{@splat(0x46)};
    declarations[0].return_type = @splat(0x46);
    declarations[0].construction = null;
    const graph: m.Graph = .{
        .nodes = &.{
            .{ .parameter = .{ .@"type" = dto.actual_c, .index = 0 } },
            .{ .receiver_frame = .{ .construction = dto.role_a, .new_target = dto.a, .parent = null, .site = "pass:new-Carrier", .control = 0 } },
            .{ .copy = .{ .@"type" = dto.actual_c, .bases = &.{0}, .site = "pass:owner", .heap = 0, .control = 0 } },
            .{ .call = .{ .@"type" = dto.a, .call = 0, .completion = .normal } },
            .{ .call = .{ .@"type" = null, .call = 0, .completion = .language } },
            .{ .projection = .{ .@"type" = dto.actual_c, .bases = &.{3}, .selector = "field:" ++ carrier_field, .view = dto.a, .heap = 2, .control = 1 } },
            .{ .copy = .{ .@"type" = dto.actual_c, .bases = &.{5}, .site = "pass:return", .heap = 2, .control = 1 } },
        },
        .heaps = &.{
            .entry, .{ .copy = .{ .previous = 0, .value = 2 } },
            .{ .call = .{ .call = 0, .completion = .normal } }, .{ .call = .{ .call = 0, .completion = .language } },
            .{ .copy = .{ .previous = 2, .value = 6 } },
        },
        .controls = &.{ .entry, .{ .call = .{ .call = 0, .completion = .normal } }, .{ .call = .{ .call = 0, .completion = .language } } },
        .calls = &.{.{ .function_id = dto.native_callee, .arguments = &.{&.{2}}, .environment = null, .callee = null, .receiver = &.{1}, .heap = 1, .control = 0, .site = "pass:construct-Carrier" }},
        .normal = &.{6}, .language = &.{4},
        .exits = .{ .normal = &.{.{ .heap = 4, .control = 1 }}, .language = &.{.{ .heap = 3, .control = 2 }} },
        .accesses = &.{.{ .values = &.{3}, .flag = .read, .control = 1 }},
    };
    var upper_nodes = graph.nodes[0..6].*;
    upper_nodes[1].receiver_frame.site = "published:new-Carrier";
    upper_nodes[2].copy.site = "published:owner";
    upper_nodes[4] = graph.nodes[5];
    upper_nodes[5] = graph.nodes[6];
    upper_nodes[5].copy.site = "published:return";
    upper_nodes[5].copy.bases = &.{4};
    var upper_heaps = graph.heaps[0..4].*;
    upper_heaps[3] = .{ .copy = .{ .previous = 2, .value = 5 } };
    var upper = graph;
    upper.nodes = &upper_nodes;
    upper.heaps = &upper_heaps;
    upper.controls = graph.controls[0..2];
    upper.language = &.{};
    upper.normal = &.{5};
    upper.exits = .{ .normal = &.{.{ .heap = 3, .control = 1 }}, .language = &.{} };
    var carrier = dto.native_leaf;
    var carrier_nodes = carrier.nodes[0..7].* ++ [_]m.Value{.{
        .copy = .{ .@"type" = dto.actual_c, .bases = &.{6}, .site = "Carrier:owner", .heap = 0, .control = 0 },
    }};
    const carrier_heaps = carrier.heaps[0..5].* ++ [_]m.Heap{.{ .copy = .{ .previous = 0, .value = 7 } }};
    var carrier_calls = carrier.calls[0..1].*;
    carrier_calls[0].arguments = &.{&.{7}};
    carrier_calls[0].heap = 5;
    carrier.nodes = &carrier_nodes;
    carrier.heaps = &carrier_heaps;
    carrier.calls = &carrier_calls;
    var contracts = dto.contracts;
    contracts[0].return_origins = upper;
    contracts[0].upper.parameters = &.{.{ .index = 0, .read = true, .write = false, .structural = false }};
    contracts[1].return_origins = carrier;
    var fixed = fixedRows(&contracts);
    fixed[0].declaration = &declarations[0];
    const evidence = domain.OrdinaryReferenceInputs{ .current = &graph, .upper = &contracts[0].return_origins.?, .types = &.{dto.actual_c} };
    var meter: Meter = .{};
    var budget = m.Budget{ .context = &meter, .charge = Meter.charge };
    try m.validateDirectory(std.testing.allocator, &directory, &budget);
    const bounds = [_]inclusion.FixedContract{
        .{ .function_id = dto.caller, .graph = evidence.upper, .complete = &fixed[0] },
        .{ .function_id = dto.native_callee, .graph = &contracts[1].return_origins.?, .complete = &fixed[1] },
        .{ .function_id = dto.callee, .graph = &contracts[2].return_origins.?, .complete = &fixed[2] },
        .{ .function_id = dto.final_callee, .graph = &contracts[3].return_origins.?, .complete = &fixed[3] },
    };
    try std.testing.expect((try inclusion.coveredWithEvidence(std.testing.allocator, &directory, dto.caller, &graph, &bounds, &budget, .{ .ordinary = evidence })) == .covered);
    var rows = ownerRows(&contracts);
    rows[0].parameters = &.{.{ .read = true }};
    const initial = owners.Initial{
        .locations = &.{ .{ .kind = .root, .owner = .{ .input = 0 } }, .{ .kind = .root, .owner = .{ .input = 1 } } },
        .arguments = &.{&.{1}}, .environment = &.{}, .heap = &.{}, .parents = &.{},
    };
    for ([_]*const m.Graph{ &graph, evidence.upper }) |candidate| {
        var result = try domain.analyzeReturns(std.testing.allocator, &directory, candidate, &budget, .{ .function_id = dto.caller, .fixed = &fixed, .ordinary = evidence });
        defer result.deinit();
        try std.testing.expectEqual(@as(?domain.Pending, null), result.pending);
        try std.testing.expect(result.normal_live and !result.language_live);
        const outer = result.calls[0];
        const inner = outer.analysis.calls[0];
        try std.testing.expectEqual(@as(usize, 1), outer.arguments[1].len);
        try std.testing.expectEqual(@as(usize, 1), inner.arguments[1].len);
        try std.testing.expectEqual(@as(m.Ref, 0), outer.arguments[1][0].source.node);
        try std.testing.expectEqual(@as(m.Ref, 6), inner.arguments[1][0].source.node);
        try std.testing.expectEqual(@as(?m.Ref, 0), outer.orderedReferenceSource(1));
        try std.testing.expectEqual(@as(?m.Ref, 6), inner.orderedReferenceSource(1));
        var returned = try owners.analyzeInputs(std.testing.allocator, &directory, &layout, dto.caller, candidate, &rows, &budget, &result, &initial);
        defer returned.deinit();
        try std.testing.expectEqual(@as(?owners.Pending, null), returned.pending);
        try std.testing.expect(returned.normal_live and !returned.language_live);
        try std.testing.expectEqual(@as(usize, 1), returned.normal.len);
        const original = returned.locations[returned.normal[0]];
        try std.testing.expect(original.kind == .root and original.owner == .input and original.owner.input == 1 and original.type_id == null);
        var wrong = initial;
        wrong.locations = &.{.{ .kind = .root, .owner = .{ .parameter = 1 } }};
        wrong.arguments = &.{&.{0}};
        var rejected = try owners.analyzeInputs(std.testing.allocator, &directory, &layout, dto.caller, candidate, &rows, &budget, &result, &wrong);
        defer rejected.deinit();
        try std.testing.expectEqual(@as(?owners.Pending, .receiver_protocol), rejected.pending);
    }
    contracts[1].return_origins = dto.native_leaf;
    rows = ownerRows(&contracts);
    rows[0].parameters = &.{.{ .read = true }};
    var bare = try domain.analyzeReturns(std.testing.allocator, &directory, &graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed, .ordinary = evidence });
    defer bare.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, null), bare.pending);
    try std.testing.expectEqual(@as(?m.Ref, null), bare.calls[0].analysis.calls[0].orderedReferenceSource(1));
    var uncommitted = try owners.analyzeInputs(std.testing.allocator, &directory, &layout, dto.caller, &graph, &rows, &budget, &bare, &initial);
    defer uncommitted.deinit();
    try std.testing.expectEqual(@as(?owners.Pending, .receiver_protocol), uncommitted.pending);
}
test "late missing C native field cannot borrow B known empty inventory through forwarding" {
    var heaps: [6]m.Heap = undefined; @memcpy(heaps[0..5],dto.actual_leaf.heaps);
    heaps[5]=.{ .join=.{ .inputs=&.{ 2,3 } } }; heaps[4].receiver_action.previous=5;
    var leaf=dto.actual_leaf; leaf.heaps=&heaps;
    var contracts=dto.contracts; contracts[3].return_origins=leaf; const fixed=fixedRows(&contracts);
    var meter: Meter=.{}; var budget=m.Budget{ .context=&meter,.charge=Meter.charge }; try validate(&contracts,&dto.caller_graph,&budget);
    var result=try domain.analyzeReturns(std.testing.allocator,&dto.directory,&dto.caller_graph,&budget,.{.function_id=dto.caller,.fixed=&fixed}); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending,.data_protocol),result.pending);
    try std.testing.expectEqual(@as(usize,1),result.calls.len);
    const original=result.calls[0].analysis.input_exits.?.normal;
    try std.testing.expectEqualSlices(m.Symbol,&.{dto.native_field},original.missing_fields.?);
    try std.testing.expectEqual(@as(usize,1),result.calls[0].analysis.initializations.len);
}
test "two original C callsites stay distinct through one B parameter and D field" {
    var nodes: [14]m.Value=undefined; @memcpy(nodes[0..9],dto.caller_graph.nodes);
    nodes[9]=.{.receiver_frame=.{.construction=dto.final_role,.new_target=dto.actual_c,.parent=null,.site="A:second-new-C",.control=1}};
    nodes[10]=.{.call=.{.@"type"=dto.actual_c,.call=2,.completion=.normal}};
    nodes[11]=.{.call=.{.@"type"=null,.call=2,.completion=.language}};
    // Both births are fully initialized at heap7. The postposed gate lets
    // the original Engine discover C2 after the first B demand, exercising
    // its parametric summary and final complete Set without mixing an
    // unbound C2 predecessor into B's actual input World.
    nodes[12]=.{.join=.{.@"type"=dto.actual_c,.inputs=&.{2,13}}};
    nodes[13]=.{.gate=.{.@"type"=dto.actual_c,.inputs=&.{10},.control=7}}; nodes[4].receiver_frame.control=7;
    var heaps: [10]m.Heap=undefined; @memcpy(heaps[0..7],dto.caller_graph.heaps);
    heaps[7]=.{.call=.{.call=2,.completion=.normal}}; heaps[8]=.{.call=.{.call=2,.completion=.language}}; heaps[9]=.{.join=.{.inputs=&.{1,7}}};
    var controls: [10]m.Control=undefined; @memcpy(controls[0..7],dto.caller_graph.controls);
    controls[7]=.{.call=.{.call=2,.completion=.normal}}; controls[8]=.{.call=.{.call=2,.completion=.language}}; controls[9]=.{.join=.{.inputs=&.{1,7}}};
    var calls: [3]m.Call=undefined; @memcpy(calls[0..2],dto.caller_graph.calls);
    calls[1].arguments=&.{&.{12}}; calls[1].heap=7; calls[1].control=7;
    calls[2]=calls[0]; calls[2].receiver=&.{9}; calls[2].heap=1; calls[2].control=1; calls[2].site="A:second-construct-C";
    var graph=dto.caller_graph; graph.nodes=&nodes; graph.heaps=&heaps; graph.controls=&controls; graph.calls=&calls;
    graph.language=&.{3,6,8,11}; graph.exits.language=&.{.{.heap=2,.control=2},.{.heap=4,.control=4},.{.heap=6,.control=6},.{.heap=8,.control=8}};
    const fixed=fixedRows(&dto.contracts); var meter: Meter=.{}; var budget=m.Budget{.context=&meter,.charge=Meter.charge}; try validate(&dto.contracts,&graph,&budget);
    var result=try domain.analyzeReturns(std.testing.allocator,&dto.directory,&graph,&budget,.{.function_id=dto.caller,.fixed=&fixed}); defer result.deinit();
    try std.testing.expect(result.pending==null and result.calls.len==3);
    var forward: ?domain.CallFact=null; var births: [2]domain.CallFact=undefined; var count: usize=0;
    for(result.calls) |fact| { if(fact.call==1) { forward=fact; } else { births[count]=fact;count+=1; } }
    try std.testing.expect(count==2 and births[0].analysis!=births[1].analysis and births[0].receiver!=births[1].receiver);
    try std.testing.expectEqual(@as(usize,2),forward.?.arguments[1].len);
    const nested=forward.?.analysis.calls[0];
    try std.testing.expectEqual(@as(usize,1),nested.arguments[1].len);
    try std.testing.expect(nested.arguments[1][0].source==.node and nested.caller_graph.nodes[nested.arguments[1][0].source.node]==.parameter);
    const rows=ownerRows(&dto.contracts);
    var content=try owners.analyzeReceiver(std.testing.allocator,&dto.directory,&physical,dto.caller,&graph,&rows,&budget,&result); defer content.deinit();
    try std.testing.expect(content.pending==null and content.normal_payloads.len==3);
    var holder: ?owners.Payload=null;
    for(content.normal_payloads) |row| if(std.mem.eql(u8,row.type_id,dto.b)) {holder=row;};
    const values=holder.?.slots[0].values; try std.testing.expectEqual(@as(usize,2),values.len);
    const first=content.locations[values[0]]; const second=content.locations[values[1]];
    try std.testing.expect(first.scope==0 and second.scope==0 and first.node!=second.node);
    try std.testing.expectEqualStrings(dto.actual_c,first.type_id.?); try std.testing.expectEqualStrings(dto.actual_c,second.type_id.?);
    var native_count: usize=0;
    for(content.normal_payloads) |row| if(std.mem.eql(u8,row.type_id,dto.actual_c)) {native_count+=1;try std.testing.expectEqualStrings("field:"++dto.native_field,row.slots[0].selector);try std.testing.expectEqual(@as(usize,1),row.slots[0].values.len);};
    try std.testing.expectEqual(@as(usize,2),native_count);
    var borrowed=result; var facts: [3]domain.CallFact=undefined; @memcpy(&facts,result.calls);
    var arguments: [2][]const domain.Atom=undefined; var one: [1]domain.Atom=undefined;
    for(&facts) |*fact| if(fact.call==1) {one[0]=fact.arguments[1][0];arguments=.{&.{},&one};fact.arguments=&arguments;}; borrowed.calls=&facts;
    var stale=try owners.analyzeReceiver(std.testing.allocator,&dto.directory,&physical,dto.caller,&graph,&rows,&budget,&borrowed);defer stale.deinit();
    try std.testing.expectEqual(@as(?owners.Pending,.receiver_protocol),stale.pending);
}
test "formal forwarding keeps exact typed Ref root and interior rules" {
    var nodes: [8]m.Value=undefined; @memcpy(nodes[0..7],dto.native_leaf.nodes); nodes[7]=.{.join=.{.@"type"=dto.a,.inputs=&.{6}}};
    var calls=dto.native_leaf.calls[0..1].*; calls[0].arguments=&.{&.{7}}; var graph=dto.native_leaf; graph.nodes=&nodes; graph.calls=&calls; var contracts=dto.contracts; contracts[1].return_origins=graph;
    // A legal static wrapper cannot license the wrong Data type; invoke
    // the original fixed interpretation after validating every Graph row.
    const fixed=fixedRows(&contracts); var meter: Meter=.{}; var budget=m.Budget{.context=&meter,.charge=Meter.charge}; try validate(&contracts,&dto.caller_graph,&budget);
    var result=try domain.analyzeReturns(std.testing.allocator,&dto.directory,&dto.caller_graph,&budget,.{.function_id=dto.caller,.fixed=&fixed});defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending,.data_protocol),result.pending);
}
test "transitive fixed closure retains missing unknown and original cycle refusal" {
    var contracts=dto.contracts; var fixed=fixedRows(&contracts); fixed[3].initialization_fields=null;
    var meter: Meter=.{};var budget=m.Budget{.context=&meter,.charge=Meter.charge};
    var inventory=try domain.analyzeReturns(std.testing.allocator,&dto.directory,&dto.caller_graph,&budget,.{.function_id=dto.caller,.fixed=&fixed});defer inventory.deinit();
    try std.testing.expectEqual(@as(?domain.Pending,.data_protocol),inventory.pending);
    contracts[2].return_origins=null;fixed=fixedRows(&contracts);
    var missing=try domain.analyzeReturns(std.testing.allocator,&dto.directory,&dto.caller_graph,&budget,.{.function_id=dto.caller,.fixed=&fixed});defer missing.deinit();
    try std.testing.expectEqual(@as(?domain.Pending,.fixed_call),missing.pending);
    var nodes: [7]m.Value=undefined;@memcpy(nodes[0..6],dto.actual_leaf.nodes);nodes[6]=.unknown;
    var unknown=dto.actual_leaf;unknown.nodes=&nodes;contracts=dto.contracts;contracts[3].return_origins=unknown;fixed=fixedRows(&contracts);try validate(&contracts,&dto.caller_graph,&budget);
    var unresolved=try domain.analyzeReturns(std.testing.allocator,&dto.directory,&dto.caller_graph,&budget,.{.function_id=dto.caller,.fixed=&fixed});defer unresolved.deinit();
    try std.testing.expectEqual(@as(?domain.Pending,.unknown_origin),unresolved.pending);
    // A complete original dependency cycle remains Pending before Data flow;
    // it cannot be erased by a syntactically absent completion.
    var cycle=dto.native_leaf;var cyclic_nodes=dto.native_leaf.nodes[0..7].*;cyclic_nodes[1].receiver_frame.construction=dto.role_a;cyclic_nodes[1].receiver_frame.new_target=dto.a;cyclic_nodes[2].call.@"type"=dto.a;cycle.nodes=&cyclic_nodes;var cyclic_call=dto.native_leaf.calls[0..1].*;cyclic_call[0].function_id=dto.native_callee;cycle.calls=&cyclic_call;
    contracts=dto.contracts;contracts[1].return_origins=cycle;fixed=fixedRows(&contracts);try validate(&contracts,&dto.caller_graph,&budget);
    var cyclic=try domain.analyzeReturns(std.testing.allocator,&dto.directory,&dto.caller_graph,&budget,.{.function_id=dto.caller,.fixed=&fixed});defer cyclic.deinit();
    try std.testing.expectEqual(@as(?domain.Pending,.fixed_call),cyclic.pending);
}
test "nested Ref calls preserve complete Upper flags original Set and Budget" {
    const fixed=fixedRows(&dto.contracts);var meter: Meter=.{};var budget=m.Budget{.context=&meter,.charge=Meter.charge};try validate(&dto.contracts,&dto.caller_graph,&budget);
    var result=try domain.analyzeReturns(std.testing.allocator,&dto.directory,&dto.caller_graph,&budget,.{.function_id=dto.caller,.fixed=&fixed});defer result.deinit();try std.testing.expect(result.pending==null);
    const flags=[_]owners.Flags{ .{.read=true},.{.write=true},.{.structural=true} };
    for([_]usize{1,2}) |callee| for(flags) |flag| {
        var rows=ownerRows(&dto.contracts);const parameters=[_]owners.Flags{.{.write=true},flag};rows[callee].parameters=&parameters;
        var checked=try owners.analyzeReceiver(std.testing.allocator,&dto.directory,&physical,dto.caller,&dto.caller_graph,&rows,&budget,&result);defer checked.deinit();
        try std.testing.expectEqual(@as(?owners.Pending,.receiver_protocol),checked.pending);
    };
    meter.left=0;
    try std.testing.expectError(error.BudgetExceeded,domain.analyzeReturns(std.testing.allocator,&dto.directory,&dto.caller_graph,&budget,.{.function_id=dto.caller,.fixed=&fixed}));
    try std.testing.expectEqual(@as(usize,0),meter.left);
}
test "forwarded language C uses its own MUST proof independently of normal C" {
    var leaf=dto.actual_leaf; leaf.language=&.{2}; leaf.exits.language=&.{.{.heap=3,.control=2}};
    var contracts=dto.contracts;contracts[3].return_origins=leaf;contracts[3].upper.facets.may_throw=true;
    var nodes: [10]m.Value=undefined;@memcpy(nodes[0..9],dto.caller_graph.nodes);nodes[4].receiver_frame.control=2;
    nodes[9]=.{.join=.{.@"type"=dto.actual_c,.inputs=&.{3}}};
    var calls=dto.caller_graph.calls[0..2].*;calls[1].arguments=&.{&.{9}};calls[1].heap=2;calls[1].control=2;
    var graph=dto.caller_graph;graph.nodes=&nodes;graph.calls=&calls;graph.language=&.{6,8};graph.exits.language=&.{.{.heap=4,.control=4},.{.heap=6,.control=6}};
    var fixed=fixedRows(&contracts);var meter: Meter=.{};var budget=m.Budget{.context=&meter,.charge=Meter.charge};try validate(&contracts,&graph,&budget);
    var accepted=try domain.analyzeReturns(std.testing.allocator,&dto.directory,&graph,&budget,.{.function_id=dto.caller,.fixed=&fixed});defer accepted.deinit();
    try std.testing.expect(accepted.pending==null and accepted.normal_live and !accepted.language_live);
    try std.testing.expect(accepted.calls.len==2 and accepted.calls[1].analysis.calls.len==1);
    const c=accepted.calls[0].analysis.input_exits.?;try std.testing.expect(c.normal.live and c.language.live and c.language.missing_fields.?.len==0);
    const rows=ownerRows(&contracts);
    var content=try owners.analyzeReceiver(std.testing.allocator,&dto.directory,&physical,dto.caller,&graph,&rows,&budget,&accepted);defer content.deinit();
    try std.testing.expect(content.pending==null and content.normal_payloads.len==2);
    var holder: ?owners.Payload=null;var original: ?owners.Payload=null;
    for(content.normal_payloads) |row| {if(std.mem.eql(u8,row.type_id,dto.b))holder=row;if(std.mem.eql(u8,row.type_id,dto.actual_c))original=row;}
    try std.testing.expect(holder!=null and original!=null);
    try std.testing.expectEqualSlices(usize,&.{original.?.location},holder.?.slots[0].values);
    try std.testing.expectEqualStrings("field:"++dto.native_field,original.?.slots[0].selector);
    // Normal C is complete; the same birth's language exit precedes its
    // initialization. The formal chain cannot borrow the normal inventory.
    leaf.exits.language=&.{.{.heap=2,.control=2}};contracts[3].return_origins=leaf;fixed=fixedRows(&contracts);try validate(&contracts,&graph,&budget);
    var missing_language=try domain.analyzeReturns(std.testing.allocator,&dto.directory,&graph,&budget,.{.function_id=dto.caller,.fixed=&fixed});defer missing_language.deinit();
    try std.testing.expectEqual(@as(?domain.Pending,.data_protocol),missing_language.pending);
    const incomplete=missing_language.calls[0].analysis.input_exits.?;
    try std.testing.expect(incomplete.normal.missing_fields.?.len==0);
    try std.testing.expectEqualSlices(m.Symbol,&.{dto.native_field},incomplete.language.missing_fields.?);
    // Conversely a complete language exit does not repair an incomplete
    // normal path, while the language forwarding control remains accepted.
    var heaps: [6]m.Heap=undefined;@memcpy(heaps[0..5],dto.actual_leaf.heaps);heaps[5]=.{.join=.{.inputs=&.{2,3}}};heaps[4].receiver_action.previous=5;
    leaf.heaps=&heaps;leaf.exits.language=&.{.{.heap=3,.control=2}};contracts[3].return_origins=leaf;fixed=fixedRows(&contracts);try validate(&contracts,&graph,&budget);
    var complete_language=try domain.analyzeReturns(std.testing.allocator,&dto.directory,&graph,&budget,.{.function_id=dto.caller,.fixed=&fixed});defer complete_language.deinit();
    try std.testing.expect(complete_language.pending==null and complete_language.normal_live);
    var missing_normal=try domain.analyzeReturns(std.testing.allocator,&dto.directory,&dto.caller_graph,&budget,.{.function_id=dto.caller,.fixed=&fixed});defer missing_normal.deinit();
    try std.testing.expectEqual(@as(?domain.Pending,.data_protocol),missing_normal.pending);
}
