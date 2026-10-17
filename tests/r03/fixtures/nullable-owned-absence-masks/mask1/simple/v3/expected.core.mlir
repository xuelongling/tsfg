module attributes {tsfg_core.version = "0.9.0", tsfg_core.input_identity = "sha256:ddc7dddc332801317130978f7dc229e8e4f42659d1905e50c2b84398bdbca6ac", tsfg_core.source_hash = "sha256:d0c9f55832571e9916b8acdcca4023caedaa9126014115d1bbc2ab9582335363", tsfg_core.source_path = "/src/main.ts", tsfg_core.target = "windows-x86_64-msvc", tsfg_core.triple = "x86_64-pc-windows-msvc", tsfg_core.data_layout = "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128", tsfg_core.bytecode_schema = "sha256:3dea6ce5de996dfa3e7141cced985243ea74ac9bb80f03636c6694343118f2a6", tsfg_core.source_length = 171 : i64, tsfg_core.nullable = {family = "tsfg.core-nullable-candidate", version = 1 : i32, schema = "sha256:8f99963869ac2fed97db0ce90171d89593e4a3de667288eace4fc141c7cbc4bd", profile = "i32-null-undefined-internal-v1"}} {
  func.func @"coalesce"(%v0: !tsfg_nullable.i32<1>, %v1: i32) -> i32 attributes {tsfg_core.function_id = "sha256:77c2886ce899441cd261deff15da16b05c8f1cd0f09b2b470a917c8035200533", tsfg_core.signature_hash = "sha256:1daede6c64532b67c9bb85c6d91afc28a867855fd97cfa42b4fce26123e684c8", tsfg_core.type_id = "sha256:376ee983062e25a6fa2c9159a5cbe375a944bc253ce3a22d60386b9678ac797b", tsfg_core.function_start = 0 : i64, tsfg_core.function_end = 97 : i64, tsfg_nullable.role = "internal"} {
    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 0 : i64, tsfg_source.end = 97 : i64} : () -> ()
    %v2 = "tsfg_nullable.tag_test"(%v0) {tag = 0 : i32, tsfg_source.start = 74 : i64, tsfg_source.end = 79 : i64} : (!tsfg_nullable.i32<1>) -> i1
    cf.cond_br %v2, ^bb1, ^bb2 {tsfg_source.start = 74 : i64, tsfg_source.end = 94 : i64}
  ^bb1:
    %v4 = "tsfg_nullable.get"(%v0) {tsfg_source.start = 74 : i64, tsfg_source.end = 79 : i64} : (!tsfg_nullable.i32<1>) -> i32
    cf.br ^bb3(%v4 : i32) {tsfg_source.start = 74 : i64, tsfg_source.end = 94 : i64}
  ^bb2:
    cf.br ^bb3(%v1 : i32) {tsfg_source.start = 74 : i64, tsfg_source.end = 94 : i64}
  ^bb3(%v3: i32):
    "func.return"(%v3) {tsfg_source.start = 66 : i64, tsfg_source.end = 95 : i64} : (i32) -> ()
  }
  func.func @"entry"(%v0: i32) -> i32 attributes {tsfg_core.function_id = "sha256:0de6ba9e8ce6db9e6d9ebe9e32ec4c927ff481cfc6144887d0f7635728a1595b", tsfg_core.signature_hash = "sha256:0efea2107f2b928ba61de6e6fa9d404fff614055cfe43059d02e25717b915ef7", tsfg_core.type_id = "sha256:376ee983062e25a6fa2c9159a5cbe375a944bc253ce3a22d60386b9678ac797b", tsfg_core.function_start = 97 : i64, tsfg_core.function_end = 171 : i64, tsfg_nullable.role = "entry"} {
    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 97 : i64, tsfg_source.end = 171 : i64} : () -> ()
    %v1 = "tsfg_nullable.wrap_i32"(%v0) {tsfg_source.start = 155 : i64, tsfg_source.end = 160 : i64} : (i32) -> !tsfg_nullable.i32<1>
    %v2 = "func.call"(%v1, %v0) {callee = @"coalesce", tsfg_core.function_id = "sha256:77c2886ce899441cd261deff15da16b05c8f1cd0f09b2b470a917c8035200533", tsfg_core.signature_hash = "sha256:1daede6c64532b67c9bb85c6d91afc28a867855fd97cfa42b4fce26123e684c8", tsfg_source.start = 145 : i64, tsfg_source.end = 168 : i64} : (!tsfg_nullable.i32<1>, i32) -> i32
    "func.return"(%v2) {tsfg_source.start = 138 : i64, tsfg_source.end = 169 : i64} : (i32) -> ()
  }
}
