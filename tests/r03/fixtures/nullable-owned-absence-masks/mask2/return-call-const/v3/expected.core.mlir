module attributes {tsfg_core.version = "0.9.0", tsfg_core.input_identity = "sha256:62e6b90ec1eb856961ee9b09c34aa505ff3cdfe0b465566fb8c07223ead69645", tsfg_core.source_hash = "sha256:6e4f6abc4ad190417a9bc3f211b20fed35b410c10ebc482490f398f07c5c460e", tsfg_core.source_path = "/src/main.ts", tsfg_core.target = "windows-x86_64-msvc", tsfg_core.triple = "x86_64-pc-windows-msvc", tsfg_core.data_layout = "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128", tsfg_core.bytecode_schema = "sha256:3dea6ce5de996dfa3e7141cced985243ea74ac9bb80f03636c6694343118f2a6", tsfg_core.source_length = 315 : i64, tsfg_core.nullable = {family = "tsfg.core-nullable-candidate", version = 1 : i32, schema = "sha256:8f99963869ac2fed97db0ce90171d89593e4a3de667288eace4fc141c7cbc4bd", profile = "i32-null-undefined-internal-v1"}} {
  func.func @"echo"(%v0: !tsfg_nullable.i32<2>) -> !tsfg_nullable.i32<2> attributes {tsfg_core.function_id = "sha256:f9291aa7968d327759506613e3cb8a2bcf5bb8f56dbf16310ac93e99303bb022", tsfg_core.signature_hash = "sha256:f129ecf988b10fa86bb2859605707aeb16ae16ff5ea2336168b79ea7f620f53d", tsfg_core.type_id = "sha256:222eb3f134fe25e0cc38957832649f864929d02ef74e87213b9bc6e55408d683", tsfg_core.function_start = 0 : i64, tsfg_core.function_end = 62 : i64, tsfg_nullable.role = "internal"} {
    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 0 : i64, tsfg_source.end = 62 : i64} : () -> ()
    "func.return"(%v0) {tsfg_source.start = 46 : i64, tsfg_source.end = 60 : i64} : (!tsfg_nullable.i32<2>) -> ()
  }
  func.func @"coalesce"(%v0: !tsfg_nullable.i32<2>, %v1: i32) -> i32 attributes {tsfg_core.function_id = "sha256:22fc96af30fec016463782302a24cc1241a099f7189757a77bda2dda2f1b03a0", tsfg_core.signature_hash = "sha256:4710117717a58229d7296fe8dac53fef3996948cd51937b0132030db9187520a", tsfg_core.type_id = "sha256:376ee983062e25a6fa2c9159a5cbe375a944bc253ce3a22d60386b9678ac797b", tsfg_core.function_start = 62 : i64, tsfg_core.function_end = 241 : i64, tsfg_nullable.role = "internal"} {
    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 62 : i64, tsfg_source.end = 241 : i64} : () -> ()
    %v2 = "func.call"(%v0) {callee = @"echo", tsfg_core.function_id = "sha256:f9291aa7968d327759506613e3cb8a2bcf5bb8f56dbf16310ac93e99303bb022", tsfg_core.signature_hash = "sha256:f129ecf988b10fa86bb2859605707aeb16ae16ff5ea2336168b79ea7f620f53d", tsfg_source.start = 187 : i64, tsfg_source.end = 202 : i64} : (!tsfg_nullable.i32<2>) -> !tsfg_nullable.i32<2>
    %v3 = "func.call"(%v2) {callee = @"echo", tsfg_core.function_id = "sha256:f9291aa7968d327759506613e3cb8a2bcf5bb8f56dbf16310ac93e99303bb022", tsfg_core.signature_hash = "sha256:f129ecf988b10fa86bb2859605707aeb16ae16ff5ea2336168b79ea7f620f53d", tsfg_source.start = 210 : i64, tsfg_source.end = 223 : i64} : (!tsfg_nullable.i32<2>) -> !tsfg_nullable.i32<2>
    %v4 = "tsfg_nullable.tag_test"(%v3) {tag = 0 : i32, tsfg_source.start = 210 : i64, tsfg_source.end = 223 : i64} : (!tsfg_nullable.i32<2>) -> i1
    cf.cond_br %v4, ^bb1, ^bb2 {tsfg_source.start = 211 : i64, tsfg_source.end = 238 : i64}
  ^bb1:
    %v6 = "tsfg_nullable.get"(%v3) {tsfg_source.start = 210 : i64, tsfg_source.end = 223 : i64} : (!tsfg_nullable.i32<2>) -> i32
    cf.br ^bb3(%v6 : i32) {tsfg_source.start = 211 : i64, tsfg_source.end = 238 : i64}
  ^bb2:
    cf.br ^bb3(%v1 : i32) {tsfg_source.start = 211 : i64, tsfg_source.end = 238 : i64}
  ^bb3(%v5: i32):
    "func.return"(%v5) {tsfg_source.start = 203 : i64, tsfg_source.end = 239 : i64} : (i32) -> ()
  }
  func.func @"entry"(%v0: i32) -> i32 attributes {tsfg_core.function_id = "sha256:8dd67729146842906a9ef123affb5036bbd888419338705247924cf292416da9", tsfg_core.signature_hash = "sha256:0efea2107f2b928ba61de6e6fa9d404fff614055cfe43059d02e25717b915ef7", tsfg_core.type_id = "sha256:376ee983062e25a6fa2c9159a5cbe375a944bc253ce3a22d60386b9678ac797b", tsfg_core.function_start = 241 : i64, tsfg_core.function_end = 315 : i64, tsfg_nullable.role = "entry"} {
    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 241 : i64, tsfg_source.end = 315 : i64} : () -> ()
    %v1 = "tsfg_nullable.wrap_i32"(%v0) {tsfg_source.start = 299 : i64, tsfg_source.end = 304 : i64} : (i32) -> !tsfg_nullable.i32<2>
    %v2 = "func.call"(%v1, %v0) {callee = @"coalesce", tsfg_core.function_id = "sha256:22fc96af30fec016463782302a24cc1241a099f7189757a77bda2dda2f1b03a0", tsfg_core.signature_hash = "sha256:4710117717a58229d7296fe8dac53fef3996948cd51937b0132030db9187520a", tsfg_source.start = 289 : i64, tsfg_source.end = 312 : i64} : (!tsfg_nullable.i32<2>, i32) -> i32
    "func.return"(%v2) {tsfg_source.start = 282 : i64, tsfg_source.end = 313 : i64} : (i32) -> ()
  }
}
