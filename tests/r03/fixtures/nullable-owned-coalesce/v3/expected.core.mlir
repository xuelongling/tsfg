module attributes {tsfg_core.version = "0.9.0", tsfg_core.input_identity = "sha256:c2401435aaccd6d9d9131f26297ae4c776136907a3c1457674caea8fb6055b2b", tsfg_core.source_hash = "sha256:7a250e785ef05abe46da6f8fe4953c9f50305c6d8090086f3af02f8a71552d94", tsfg_core.source_path = "/src/main.ts", tsfg_core.target = "windows-x86_64-msvc", tsfg_core.triple = "x86_64-pc-windows-msvc", tsfg_core.data_layout = "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128", tsfg_core.bytecode_schema = "sha256:3dea6ce5de996dfa3e7141cced985243ea74ac9bb80f03636c6694343118f2a6", tsfg_core.source_length = 229 : i64, tsfg_core.nullable = {family = "tsfg.core-nullable-candidate", version = 1 : i32, schema = "sha256:8f99963869ac2fed97db0ce90171d89593e4a3de667288eace4fc141c7cbc4bd", profile = "i32-null-undefined-internal-v1"}} {
  func.func @"fallback"(%v0: i32) -> i32 attributes {tsfg_core.function_id = "sha256:d370e779b5682be12fd5f7ccebd7838375b99c1453b90ae628fa3da1188160bb", tsfg_core.signature_hash = "sha256:0efea2107f2b928ba61de6e6fa9d404fff614055cfe43059d02e25717b915ef7", tsfg_core.type_id = "sha256:376ee983062e25a6fa2c9159a5cbe375a944bc253ce3a22d60386b9678ac797b", tsfg_core.function_start = 0 : i64, tsfg_core.function_end = 52 : i64, tsfg_nullable.role = "internal"} {
    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 0 : i64, tsfg_source.end = 52 : i64} : () -> ()
    "func.return"(%v0) {tsfg_source.start = 36 : i64, tsfg_source.end = 50 : i64} : (i32) -> ()
  }
  func.func @"coalesce"(%v0: !tsfg_nullable.i32<2>, %v1: i32) -> i32 attributes {tsfg_core.function_id = "sha256:c47cc1eb00d6b7dd4d5b146e0b617118e3e2d70e1894a216e802cf3f50a1399a", tsfg_core.signature_hash = "sha256:4710117717a58229d7296fe8dac53fef3996948cd51937b0132030db9187520a", tsfg_core.type_id = "sha256:376ee983062e25a6fa2c9159a5cbe375a944bc253ce3a22d60386b9678ac797b", tsfg_core.function_start = 52 : i64, tsfg_core.function_end = 155 : i64, tsfg_nullable.role = "internal"} {
    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 52 : i64, tsfg_source.end = 155 : i64} : () -> ()
    %v2 = "tsfg_nullable.tag_test"(%v0) {tag = 0 : i32, tsfg_source.start = 122 : i64, tsfg_source.end = 127 : i64} : (!tsfg_nullable.i32<2>) -> i1
    cf.cond_br %v2, ^bb1, ^bb2 {tsfg_source.start = 122 : i64, tsfg_source.end = 152 : i64}
  ^bb1:
    %v4 = "tsfg_nullable.get"(%v0) {tsfg_source.start = 122 : i64, tsfg_source.end = 127 : i64} : (!tsfg_nullable.i32<2>) -> i32
    cf.br ^bb3(%v4 : i32) {tsfg_source.start = 122 : i64, tsfg_source.end = 152 : i64}
  ^bb2:
    %v5 = "func.call"(%v1) {callee = @"fallback", tsfg_core.function_id = "sha256:d370e779b5682be12fd5f7ccebd7838375b99c1453b90ae628fa3da1188160bb", tsfg_core.signature_hash = "sha256:0efea2107f2b928ba61de6e6fa9d404fff614055cfe43059d02e25717b915ef7", tsfg_source.start = 130 : i64, tsfg_source.end = 152 : i64} : (i32) -> i32
    cf.br ^bb3(%v5 : i32) {tsfg_source.start = 122 : i64, tsfg_source.end = 152 : i64}
  ^bb3(%v3: i32):
    "func.return"(%v3) {tsfg_source.start = 114 : i64, tsfg_source.end = 153 : i64} : (i32) -> ()
  }
  func.func @"entry"(%v0: i32) -> i32 attributes {tsfg_core.function_id = "sha256:d247e1d1939e56da863bc813cbb04adf62e138fe2141860e07aa6a2fb3e295b1", tsfg_core.signature_hash = "sha256:0efea2107f2b928ba61de6e6fa9d404fff614055cfe43059d02e25717b915ef7", tsfg_core.type_id = "sha256:376ee983062e25a6fa2c9159a5cbe375a944bc253ce3a22d60386b9678ac797b", tsfg_core.function_start = 155 : i64, tsfg_core.function_end = 229 : i64, tsfg_nullable.role = "entry"} {
    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 155 : i64, tsfg_source.end = 229 : i64} : () -> ()
    %v1 = "tsfg_nullable.wrap_i32"(%v0) {tsfg_source.start = 213 : i64, tsfg_source.end = 218 : i64} : (i32) -> !tsfg_nullable.i32<2>
    %v2 = "func.call"(%v1, %v0) {callee = @"coalesce", tsfg_core.function_id = "sha256:c47cc1eb00d6b7dd4d5b146e0b617118e3e2d70e1894a216e802cf3f50a1399a", tsfg_core.signature_hash = "sha256:4710117717a58229d7296fe8dac53fef3996948cd51937b0132030db9187520a", tsfg_source.start = 203 : i64, tsfg_source.end = 226 : i64} : (!tsfg_nullable.i32<2>, i32) -> i32
    "func.return"(%v2) {tsfg_source.start = 196 : i64, tsfg_source.end = 227 : i64} : (i32) -> ()
  }
}
