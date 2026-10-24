module attributes {tsfg_core.version = "0.9.0", tsfg_core.input_identity = "sha256:51cd938c8b545dfbd8b1e7039c1f458ea2066d7f04e4ed2438b3fbdaec0e568a", tsfg_core.source_hash = "sha256:ded7073e5fb837e5bb1d1fc2b73211ddc66f05b47192963abd1ff22101bd4ca7", tsfg_core.source_path = "/src/main.ts", tsfg_core.target = "windows-x86_64-msvc", tsfg_core.triple = "x86_64-pc-windows-msvc", tsfg_core.data_layout = "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128", tsfg_core.bytecode_schema = "sha256:3dea6ce5de996dfa3e7141cced985243ea74ac9bb80f03636c6694343118f2a6", tsfg_core.source_length = 511 : i64, tsfg_core.nullable = {family = "tsfg.core-nullable-candidate", version = 1 : i32, schema = "sha256:8f99963869ac2fed97db0ce90171d89593e4a3de667288eace4fc141c7cbc4bd", profile = "i32-null-undefined-internal-v1"}} {
  func.func @"eq"(%v0: !tsfg_nullable.i32<1>, %v1: i32) -> i32 attributes {tsfg_core.function_id = "sha256:b2a17328d3620004fa61a56464d10b0f120dad0ba9d57572aa2a03cd05e708a9", tsfg_core.signature_hash = "sha256:1daede6c64532b67c9bb85c6d91afc28a867855fd97cfa42b4fce26123e684c8", tsfg_core.type_id = "sha256:376ee983062e25a6fa2c9159a5cbe375a944bc253ce3a22d60386b9678ac797b", tsfg_core.function_start = 0 : i64, tsfg_core.function_end = 86 : i64, tsfg_nullable.role = "internal"} {
    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 0 : i64, tsfg_source.end = 86 : i64} : () -> ()
    %v2 = "tsfg_nullable.tag_test"(%v0) {tag = 1 : i32, tsfg_source.start = 42 : i64, tsfg_source.end = 64 : i64} : (!tsfg_nullable.i32<1>) -> i1
    cf.cond_br %v2, ^bb1, ^bb2 {tsfg_source.start = 42 : i64, tsfg_source.end = 64 : i64}
  ^bb1:
    "func.return"(%v1) {tsfg_source.start = 66 : i64, tsfg_source.end = 75 : i64} : (i32) -> ()
  ^bb2:
    cf.br ^bb3(%v0, %v1 : !tsfg_nullable.i32<1>, i32) {tsfg_source.start = 39 : i64, tsfg_source.end = 76 : i64}
  ^bb3(%v3: !tsfg_nullable.i32<1>, %v4: i32):
    %v5 = "tsfg_nullable.get"(%v3) {tsfg_source.start = 82 : i64, tsfg_source.end = 84 : i64} : (!tsfg_nullable.i32<1>) -> i32
    "func.return"(%v5) {tsfg_source.start = 76 : i64, tsfg_source.end = 85 : i64} : (i32) -> ()
  }
  func.func @"ne"(%v0: !tsfg_nullable.i32<1>, %v1: i32) -> i32 attributes {tsfg_core.function_id = "sha256:5d9fd632ede1aa37fac1af3077f70c6333b7a443cada5908ba6134889d25975b", tsfg_core.signature_hash = "sha256:1daede6c64532b67c9bb85c6d91afc28a867855fd97cfa42b4fce26123e684c8", tsfg_core.type_id = "sha256:376ee983062e25a6fa2c9159a5cbe375a944bc253ce3a22d60386b9678ac797b", tsfg_core.function_start = 86 : i64, tsfg_core.function_end = 173 : i64, tsfg_nullable.role = "internal"} {
    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 86 : i64, tsfg_source.end = 173 : i64} : () -> ()
    %v2 = "tsfg_nullable.tag_test"(%v0) {tag = 0 : i32, tsfg_source.start = 129 : i64, tsfg_source.end = 151 : i64} : (!tsfg_nullable.i32<1>) -> i1
    cf.cond_br %v2, ^bb1, ^bb2 {tsfg_source.start = 129 : i64, tsfg_source.end = 151 : i64}
  ^bb1:
    %v3 = "tsfg_nullable.get"(%v0) {tsfg_source.start = 159 : i64, tsfg_source.end = 161 : i64} : (!tsfg_nullable.i32<1>) -> i32
    "func.return"(%v3) {tsfg_source.start = 153 : i64, tsfg_source.end = 162 : i64} : (i32) -> ()
  ^bb2:
    cf.br ^bb3(%v0, %v1 : !tsfg_nullable.i32<1>, i32) {tsfg_source.start = 126 : i64, tsfg_source.end = 163 : i64}
  ^bb3(%v4: !tsfg_nullable.i32<1>, %v5: i32):
    "func.return"(%v5) {tsfg_source.start = 163 : i64, tsfg_source.end = 172 : i64} : (i32) -> ()
  }
  func.func @"mirrorEq"(%v0: !tsfg_nullable.i32<1>, %v1: i32) -> i32 attributes {tsfg_core.function_id = "sha256:5451f0aa13a9cad2df0d0b3fb1b5cbcad958a418145872e2e16a65d58a2cf9c9", tsfg_core.signature_hash = "sha256:1daede6c64532b67c9bb85c6d91afc28a867855fd97cfa42b4fce26123e684c8", tsfg_core.type_id = "sha256:376ee983062e25a6fa2c9159a5cbe375a944bc253ce3a22d60386b9678ac797b", tsfg_core.function_start = 173 : i64, tsfg_core.function_end = 266 : i64, tsfg_nullable.role = "internal"} {
    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 173 : i64, tsfg_source.end = 266 : i64} : () -> ()
    %v2 = "tsfg_nullable.tag_test"(%v0) {tag = 1 : i32, tsfg_source.start = 222 : i64, tsfg_source.end = 244 : i64} : (!tsfg_nullable.i32<1>) -> i1
    cf.cond_br %v2, ^bb1, ^bb2 {tsfg_source.start = 222 : i64, tsfg_source.end = 244 : i64}
  ^bb1:
    "func.return"(%v1) {tsfg_source.start = 246 : i64, tsfg_source.end = 255 : i64} : (i32) -> ()
  ^bb2:
    cf.br ^bb3(%v0, %v1 : !tsfg_nullable.i32<1>, i32) {tsfg_source.start = 219 : i64, tsfg_source.end = 256 : i64}
  ^bb3(%v3: !tsfg_nullable.i32<1>, %v4: i32):
    %v5 = "tsfg_nullable.get"(%v3) {tsfg_source.start = 262 : i64, tsfg_source.end = 264 : i64} : (!tsfg_nullable.i32<1>) -> i32
    "func.return"(%v5) {tsfg_source.start = 256 : i64, tsfg_source.end = 265 : i64} : (i32) -> ()
  }
  func.func @"mirrorNe"(%v0: !tsfg_nullable.i32<1>, %v1: i32) -> i32 attributes {tsfg_core.function_id = "sha256:ea12942983d93489f9908ad7deaa75bd0929c2942a4e7e593c1ec1f8f017ab8f", tsfg_core.signature_hash = "sha256:1daede6c64532b67c9bb85c6d91afc28a867855fd97cfa42b4fce26123e684c8", tsfg_core.type_id = "sha256:376ee983062e25a6fa2c9159a5cbe375a944bc253ce3a22d60386b9678ac797b", tsfg_core.function_start = 266 : i64, tsfg_core.function_end = 359 : i64, tsfg_nullable.role = "internal"} {
    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 266 : i64, tsfg_source.end = 359 : i64} : () -> ()
    %v2 = "tsfg_nullable.tag_test"(%v0) {tag = 0 : i32, tsfg_source.start = 315 : i64, tsfg_source.end = 337 : i64} : (!tsfg_nullable.i32<1>) -> i1
    cf.cond_br %v2, ^bb1, ^bb2 {tsfg_source.start = 315 : i64, tsfg_source.end = 337 : i64}
  ^bb1:
    %v3 = "tsfg_nullable.get"(%v0) {tsfg_source.start = 345 : i64, tsfg_source.end = 347 : i64} : (!tsfg_nullable.i32<1>) -> i32
    "func.return"(%v3) {tsfg_source.start = 339 : i64, tsfg_source.end = 348 : i64} : (i32) -> ()
  ^bb2:
    cf.br ^bb3(%v0, %v1 : !tsfg_nullable.i32<1>, i32) {tsfg_source.start = 312 : i64, tsfg_source.end = 349 : i64}
  ^bb3(%v4: !tsfg_nullable.i32<1>, %v5: i32):
    "func.return"(%v5) {tsfg_source.start = 349 : i64, tsfg_source.end = 358 : i64} : (i32) -> ()
  }
  func.func @"keepNull"(%v0: !tsfg_nullable.i32<3>, %v1: i32) -> i32 attributes {tsfg_core.function_id = "sha256:316bb1434fea163785718e2915c69b3a4c22847b91331f96003f72ad1e4b36ff", tsfg_core.signature_hash = "sha256:0f5e736d5dcd2533cfaaaaac9a77797ce8872257e813e9e3871708277cc56246", tsfg_core.type_id = "sha256:376ee983062e25a6fa2c9159a5cbe375a944bc253ce3a22d60386b9678ac797b", tsfg_core.function_start = 359 : i64, tsfg_core.function_end = 460 : i64, tsfg_nullable.role = "internal"} {
    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 359 : i64, tsfg_source.end = 460 : i64} : () -> ()
    %v2 = "tsfg_nullable.tag_test"(%v0) {tag = 1 : i32, tsfg_source.start = 413 : i64, tsfg_source.end = 435 : i64} : (!tsfg_nullable.i32<3>) -> i1
    cf.cond_br %v2, ^bb1, ^bb2 {tsfg_source.start = 413 : i64, tsfg_source.end = 435 : i64}
  ^bb1:
    "func.return"(%v1) {tsfg_source.start = 437 : i64, tsfg_source.end = 446 : i64} : (i32) -> ()
  ^bb2:
    cf.br ^bb3(%v0, %v1 : !tsfg_nullable.i32<3>, i32) {tsfg_source.start = 410 : i64, tsfg_source.end = 447 : i64}
  ^bb3(%v3: !tsfg_nullable.i32<3>, %v4: i32):
    %v5 = "tsfg_nullable.tag_test"(%v3) {tag = 0 : i32, tsfg_source.start = 454 : i64, tsfg_source.end = 455 : i64} : (!tsfg_nullable.i32<3>) -> i1
    cf.cond_br %v5, ^bb4, ^bb5 {tsfg_source.start = 454 : i64, tsfg_source.end = 458 : i64}
  ^bb4:
    %v7 = "tsfg_nullable.get"(%v3) {tsfg_source.start = 454 : i64, tsfg_source.end = 455 : i64} : (!tsfg_nullable.i32<3>) -> i32
    cf.br ^bb6(%v7 : i32) {tsfg_source.start = 454 : i64, tsfg_source.end = 458 : i64}
  ^bb5:
    cf.br ^bb6(%v4 : i32) {tsfg_source.start = 454 : i64, tsfg_source.end = 458 : i64}
  ^bb6(%v6: i32):
    "func.return"(%v6) {tsfg_source.start = 447 : i64, tsfg_source.end = 459 : i64} : (i32) -> ()
  }
  func.func @"entry"(%v0: i32) -> i32 attributes {tsfg_core.function_id = "sha256:a373e626d1303c95d5fcdf722524453f394935900596f4fb6f637d48bee79803", tsfg_core.signature_hash = "sha256:0efea2107f2b928ba61de6e6fa9d404fff614055cfe43059d02e25717b915ef7", tsfg_core.type_id = "sha256:376ee983062e25a6fa2c9159a5cbe375a944bc253ce3a22d60386b9678ac797b", tsfg_core.function_start = 460 : i64, tsfg_core.function_end = 510 : i64, tsfg_nullable.role = "entry"} {
    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 460 : i64, tsfg_source.end = 510 : i64} : () -> ()
    %v1 = "tsfg_nullable.wrap_i32"(%v0) {tsfg_source.start = 504 : i64, tsfg_source.end = 505 : i64} : (i32) -> !tsfg_nullable.i32<1>
    %v2 = "func.call"(%v1, %v0) {callee = @"eq", tsfg_core.function_id = "sha256:b2a17328d3620004fa61a56464d10b0f120dad0ba9d57572aa2a03cd05e708a9", tsfg_core.signature_hash = "sha256:1daede6c64532b67c9bb85c6d91afc28a867855fd97cfa42b4fce26123e684c8", tsfg_source.start = 500 : i64, tsfg_source.end = 508 : i64} : (!tsfg_nullable.i32<1>, i32) -> i32
    "func.return"(%v2) {tsfg_source.start = 494 : i64, tsfg_source.end = 509 : i64} : (i32) -> ()
  }
}
