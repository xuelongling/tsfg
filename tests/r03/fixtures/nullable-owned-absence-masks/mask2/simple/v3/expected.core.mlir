module attributes {tsfg_core.version = "0.9.0", tsfg_core.input_identity = "sha256:7ffe12728ac300f386ac03e46b85cbf935c1028193d541a8e76c4290c9c31a0b", tsfg_core.source_hash = "sha256:0c517833dcec4fe92acd123b9969459008dedc3be959ebc0a6bb9feba8e472e3", tsfg_core.source_path = "/src/main.ts", tsfg_core.target = "windows-x86_64-msvc", tsfg_core.triple = "x86_64-pc-windows-msvc", tsfg_core.data_layout = "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128", tsfg_core.bytecode_schema = "sha256:3dea6ce5de996dfa3e7141cced985243ea74ac9bb80f03636c6694343118f2a6", tsfg_core.source_length = 166 : i64, tsfg_core.nullable = {family = "tsfg.core-nullable-candidate", version = 1 : i32, schema = "sha256:8f99963869ac2fed97db0ce90171d89593e4a3de667288eace4fc141c7cbc4bd", profile = "i32-null-undefined-internal-v1"}} {
  func.func @"coalesce"(%v0: !tsfg_nullable.i32<2>, %v1: i32) -> i32 attributes {tsfg_core.function_id = "sha256:5aa9e404a77348030635dfd34dc778486b98186740dbbf5886705807b3553e3b", tsfg_core.signature_hash = "sha256:4710117717a58229d7296fe8dac53fef3996948cd51937b0132030db9187520a", tsfg_core.type_id = "sha256:376ee983062e25a6fa2c9159a5cbe375a944bc253ce3a22d60386b9678ac797b", tsfg_core.function_start = 0 : i64, tsfg_core.function_end = 92 : i64, tsfg_nullable.role = "internal"} {
    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 0 : i64, tsfg_source.end = 92 : i64} : () -> ()
    %v2 = "tsfg_nullable.tag_test"(%v0) {tag = 0 : i32, tsfg_source.start = 69 : i64, tsfg_source.end = 74 : i64} : (!tsfg_nullable.i32<2>) -> i1
    cf.cond_br %v2, ^bb1, ^bb2 {tsfg_source.start = 69 : i64, tsfg_source.end = 89 : i64}
  ^bb1:
    %v4 = "tsfg_nullable.get"(%v0) {tsfg_source.start = 69 : i64, tsfg_source.end = 74 : i64} : (!tsfg_nullable.i32<2>) -> i32
    cf.br ^bb3(%v4 : i32) {tsfg_source.start = 69 : i64, tsfg_source.end = 89 : i64}
  ^bb2:
    cf.br ^bb3(%v1 : i32) {tsfg_source.start = 69 : i64, tsfg_source.end = 89 : i64}
  ^bb3(%v3: i32):
    "func.return"(%v3) {tsfg_source.start = 61 : i64, tsfg_source.end = 90 : i64} : (i32) -> ()
  }
  func.func @"entry"(%v0: i32) -> i32 attributes {tsfg_core.function_id = "sha256:5da1a7457764beca806759c9852bee4fc6c40809e10120f3a6357d59ea5d9a87", tsfg_core.signature_hash = "sha256:0efea2107f2b928ba61de6e6fa9d404fff614055cfe43059d02e25717b915ef7", tsfg_core.type_id = "sha256:376ee983062e25a6fa2c9159a5cbe375a944bc253ce3a22d60386b9678ac797b", tsfg_core.function_start = 92 : i64, tsfg_core.function_end = 166 : i64, tsfg_nullable.role = "entry"} {
    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 92 : i64, tsfg_source.end = 166 : i64} : () -> ()
    %v1 = "tsfg_nullable.wrap_i32"(%v0) {tsfg_source.start = 150 : i64, tsfg_source.end = 155 : i64} : (i32) -> !tsfg_nullable.i32<2>
    %v2 = "func.call"(%v1, %v0) {callee = @"coalesce", tsfg_core.function_id = "sha256:5aa9e404a77348030635dfd34dc778486b98186740dbbf5886705807b3553e3b", tsfg_core.signature_hash = "sha256:4710117717a58229d7296fe8dac53fef3996948cd51937b0132030db9187520a", tsfg_source.start = 140 : i64, tsfg_source.end = 163 : i64} : (!tsfg_nullable.i32<2>, i32) -> i32
    "func.return"(%v2) {tsfg_source.start = 133 : i64, tsfg_source.end = 164 : i64} : (i32) -> ()
  }
}
