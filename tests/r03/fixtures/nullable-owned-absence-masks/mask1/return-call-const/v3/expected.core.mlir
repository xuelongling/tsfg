module attributes {tsfg_core.version = "0.9.0", tsfg_core.input_identity = "sha256:2d049141634c71ab65bfaab29bbf6d230b5cc5b06963475c0304f3445c9e4ac1", tsfg_core.source_hash = "sha256:5f18a73cc07795ce9bf5b8aebeea6e82f247964cb4b2ab60e294adfed6e060f9", tsfg_core.source_path = "/src/main.ts", tsfg_core.target = "windows-x86_64-msvc", tsfg_core.triple = "x86_64-pc-windows-msvc", tsfg_core.data_layout = "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128", tsfg_core.bytecode_schema = "sha256:3dea6ce5de996dfa3e7141cced985243ea74ac9bb80f03636c6694343118f2a6", tsfg_core.source_length = 340 : i64, tsfg_core.nullable = {family = "tsfg.core-nullable-candidate", version = 1 : i32, schema = "sha256:8f99963869ac2fed97db0ce90171d89593e4a3de667288eace4fc141c7cbc4bd", profile = "i32-null-undefined-internal-v1"}} {
  func.func @"echo"(%v0: !tsfg_nullable.i32<1>) -> !tsfg_nullable.i32<1> attributes {tsfg_core.function_id = "sha256:308b302588c7bd14c84962c8bf39708d1623f272309974b1f13c18aadb022d28", tsfg_core.signature_hash = "sha256:28a8369e56ac83a527ef8f7f723dc5435a68c268632a90589935c65031918e14", tsfg_core.type_id = "sha256:e07faa2f020f1b27839d19a581aad387c0af7606f0353a51d8b89db272b8c9fb", tsfg_core.function_start = 0 : i64, tsfg_core.function_end = 72 : i64, tsfg_nullable.role = "internal"} {
    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 0 : i64, tsfg_source.end = 72 : i64} : () -> ()
    "func.return"(%v0) {tsfg_source.start = 56 : i64, tsfg_source.end = 70 : i64} : (!tsfg_nullable.i32<1>) -> ()
  }
  func.func @"coalesce"(%v0: !tsfg_nullable.i32<1>, %v1: i32) -> i32 attributes {tsfg_core.function_id = "sha256:5453c7b9c83552f2ead6b652f211177f49b060cfe2eb89eeb64c90f4092be76c", tsfg_core.signature_hash = "sha256:1daede6c64532b67c9bb85c6d91afc28a867855fd97cfa42b4fce26123e684c8", tsfg_core.type_id = "sha256:376ee983062e25a6fa2c9159a5cbe375a944bc253ce3a22d60386b9678ac797b", tsfg_core.function_start = 72 : i64, tsfg_core.function_end = 266 : i64, tsfg_nullable.role = "internal"} {
    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 72 : i64, tsfg_source.end = 266 : i64} : () -> ()
    %v2 = "func.call"(%v0) {callee = @"echo", tsfg_core.function_id = "sha256:308b302588c7bd14c84962c8bf39708d1623f272309974b1f13c18aadb022d28", tsfg_core.signature_hash = "sha256:28a8369e56ac83a527ef8f7f723dc5435a68c268632a90589935c65031918e14", tsfg_source.start = 212 : i64, tsfg_source.end = 227 : i64} : (!tsfg_nullable.i32<1>) -> !tsfg_nullable.i32<1>
    %v3 = "func.call"(%v2) {callee = @"echo", tsfg_core.function_id = "sha256:308b302588c7bd14c84962c8bf39708d1623f272309974b1f13c18aadb022d28", tsfg_core.signature_hash = "sha256:28a8369e56ac83a527ef8f7f723dc5435a68c268632a90589935c65031918e14", tsfg_source.start = 235 : i64, tsfg_source.end = 248 : i64} : (!tsfg_nullable.i32<1>) -> !tsfg_nullable.i32<1>
    %v4 = "tsfg_nullable.tag_test"(%v3) {tag = 0 : i32, tsfg_source.start = 235 : i64, tsfg_source.end = 248 : i64} : (!tsfg_nullable.i32<1>) -> i1
    cf.cond_br %v4, ^bb1, ^bb2 {tsfg_source.start = 236 : i64, tsfg_source.end = 263 : i64}
  ^bb1:
    %v6 = "tsfg_nullable.get"(%v3) {tsfg_source.start = 235 : i64, tsfg_source.end = 248 : i64} : (!tsfg_nullable.i32<1>) -> i32
    cf.br ^bb3(%v6 : i32) {tsfg_source.start = 236 : i64, tsfg_source.end = 263 : i64}
  ^bb2:
    cf.br ^bb3(%v1 : i32) {tsfg_source.start = 236 : i64, tsfg_source.end = 263 : i64}
  ^bb3(%v5: i32):
    "func.return"(%v5) {tsfg_source.start = 228 : i64, tsfg_source.end = 264 : i64} : (i32) -> ()
  }
  func.func @"entry"(%v0: i32) -> i32 attributes {tsfg_core.function_id = "sha256:437bf7a9716766102473e1aa9ef427add7d61417e734ec9aa959f2c5a47d5ad1", tsfg_core.signature_hash = "sha256:0efea2107f2b928ba61de6e6fa9d404fff614055cfe43059d02e25717b915ef7", tsfg_core.type_id = "sha256:376ee983062e25a6fa2c9159a5cbe375a944bc253ce3a22d60386b9678ac797b", tsfg_core.function_start = 266 : i64, tsfg_core.function_end = 340 : i64, tsfg_nullable.role = "entry"} {
    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 266 : i64, tsfg_source.end = 340 : i64} : () -> ()
    %v1 = "tsfg_nullable.wrap_i32"(%v0) {tsfg_source.start = 324 : i64, tsfg_source.end = 329 : i64} : (i32) -> !tsfg_nullable.i32<1>
    %v2 = "func.call"(%v1, %v0) {callee = @"coalesce", tsfg_core.function_id = "sha256:5453c7b9c83552f2ead6b652f211177f49b060cfe2eb89eeb64c90f4092be76c", tsfg_core.signature_hash = "sha256:1daede6c64532b67c9bb85c6d91afc28a867855fd97cfa42b4fce26123e684c8", tsfg_source.start = 314 : i64, tsfg_source.end = 337 : i64} : (!tsfg_nullable.i32<1>, i32) -> i32
    "func.return"(%v2) {tsfg_source.start = 307 : i64, tsfg_source.end = 338 : i64} : (i32) -> ()
  }
}
