// SPDX-License-Identifier: MIT
const std=@import("std");
const conversions=@import("conversions.zig");
const oracle=@import("oracle");
// This component imports only the pure conversion function, scalar contract
// definitions and independently frozen raw-bit rows. No loader or VM runs.
test "all286 conversion entries match3238 independent exact-bit cases" {
    try std.testing.expectEqual(@as(usize,3238),oracle.cases.len);
    for (oracle.cases,0..) |row,index| {
        errdefer std.debug.print("conversion oracle row {d}: op={d} from={d} to={d} input={x}\n",.{index,row.opcode,row.source,row.target,row.input});
        const actual=conversions.convert(row.opcode,row.input,row.source,row.target);
        switch (row.kind) {
            .value=> {try std.testing.expect(actual==.value);try std.testing.expectEqual(row.bits,actual.value);},
            .range=>try std.testing.expect(actual==.range),
            .nonfinite=>try std.testing.expect(actual==.nonfinite),
        }
    }
}
