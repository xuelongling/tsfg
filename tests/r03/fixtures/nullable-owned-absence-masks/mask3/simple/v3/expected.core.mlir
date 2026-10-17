module attributes {tsfg_core.version = "0.9.0", tsfg_core.input_identity = "sha256:72803642d6d44ff5f960d984e38129c7c34c9f414b0b6faedc59454c209c929e", tsfg_core.source_hash = "sha256:9fb373bcd1ce3afddd204ae5c7012610956c9f03827e6bf7b9ae8e550f75ee57", tsfg_core.source_path = "/src/main.ts", tsfg_core.target = "windows-x86_64-msvc", tsfg_core.triple = "x86_64-pc-windows-msvc", tsfg_core.data_layout = "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128", tsfg_core.bytecode_schema = "sha256:3dea6ce5de996dfa3e7141cced985243ea74ac9bb80f03636c6694343118f2a6", tsfg_core.source_length = 178 : i64, tsfg_core.nullable = {family = "tsfg.core-nullable-candidate", version = 1 : i32, schema = "sha256:8f99963869ac2fed97db0ce90171d89593e4a3de667288eace4fc141c7cbc4bd", profile = "i32-null-undefined-internal-v1"}} {
  func.func @"coalesce"(%v0: !tsfg_nullable.i32<3>, %v1: i32) -> i32 attributes {tsfg_core.function_id = "sha256:9aeb1eb174041a5a671d3e8a824f846b99700eafea1fffb44b2b55d3411cdd26", tsfg_core.signature_hash = "sha256:0f5e736d5dcd2533cfaaaaac9a77797ce8872257e813e9e3871708277cc56246", tsfg_core.type_id = "sha256:376ee983062e25a6fa2c9159a5cbe375a944bc253ce3a22d60386b9678ac797b", tsfg_core.function_start = 0 : i64, tsfg_core.function_end = 104 : i64, tsfg_nullable.role = "internal"} {
    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 0 : i64, tsfg_source.end = 104 : i64} : () -> ()
    %v2 = "tsfg_nullable.tag_test"(%v0) {tag = 0 : i32, tsfg_source.start = 81 : i64, tsfg_source.end = 86 : i64} : (!tsfg_nullable.i32<3>) -> i1
    cf.cond_br %v2, ^bb1, ^bb2 {tsfg_source.start = 81 : i64, tsfg_source.end = 101 : i64}
  ^bb1:
    %v4 = "tsfg_nullable.get"(%v0) {tsfg_source.start = 81 : i64, tsfg_source.end = 86 : i64} : (!tsfg_nullable.i32<3>) -> i32
    cf.br ^bb3(%v4 : i32) {tsfg_source.start = 81 : i64, tsfg_source.end = 101 : i64}
  ^bb2:
    cf.br ^bb3(%v1 : i32) {tsfg_source.start = 81 : i64, tsfg_source.end = 101 : i64}
  ^bb3(%v3: i32):
    "func.return"(%v3) {tsfg_source.start = 73 : i64, tsfg_source.end = 102 : i64} : (i32) -> ()
  }
  func.func @"entry"(%v0: i32) -> i32 attributes {tsfg_core.function_id = "sha256:7096df4a3cc322fa164d8faf2b39f8646c8348a439a71b8b4eb78701c319abc7", tsfg_core.signature_hash = "sha256:0efea2107f2b928ba61de6e6fa9d404fff614055cfe43059d02e25717b915ef7", tsfg_core.type_id = "sha256:376ee983062e25a6fa2c9159a5cbe375a944bc253ce3a22d60386b9678ac797b", tsfg_core.function_start = 104 : i64, tsfg_core.function_end = 178 : i64, tsfg_nullable.role = "entry"} {
    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 104 : i64, tsfg_source.end = 178 : i64} : () -> ()
    %v1 = "tsfg_nullable.wrap_i32"(%v0) {tsfg_source.start = 162 : i64, tsfg_source.end = 167 : i64} : (i32) -> !tsfg_nullable.i32<3>
    %v2 = "func.call"(%v1, %v0) {callee = @"coalesce", tsfg_core.function_id = "sha256:9aeb1eb174041a5a671d3e8a824f846b99700eafea1fffb44b2b55d3411cdd26", tsfg_core.signature_hash = "sha256:0f5e736d5dcd2533cfaaaaac9a77797ce8872257e813e9e3871708277cc56246", tsfg_source.start = 152 : i64, tsfg_source.end = 175 : i64} : (!tsfg_nullable.i32<3>, i32) -> i32
    "func.return"(%v2) {tsfg_source.start = 145 : i64, tsfg_source.end = 176 : i64} : (i32) -> ()
  }
}
