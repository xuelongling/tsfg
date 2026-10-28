module attributes {tsfg_core.version = "0.9.0", tsfg_core.input_identity = "sha256:da38831a6bbc2b30b20838408a18fc60a2fdc8d7227b14706269c958cfea011f", tsfg_core.source_hash = "sha256:869ddba6195c112ca4cd3912e1ec67038ba89382a819a05e1ffd2482d9569a74", tsfg_core.source_path = "/src/main.ts", tsfg_core.target = "windows-x86_64-msvc", tsfg_core.triple = "x86_64-pc-windows-msvc", tsfg_core.data_layout = "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128", tsfg_core.bytecode_schema = "sha256:3dea6ce5de996dfa3e7141cced985243ea74ac9bb80f03636c6694343118f2a6", tsfg_core.source_length = 375 : i64, tsfg_core.nullable = {family = "tsfg.core-nullable-candidate", version = 1 : i32, schema = "sha256:8f99963869ac2fed97db0ce90171d89593e4a3de667288eace4fc141c7cbc4bd", profile = "i32-null-undefined-internal-v1"}} {
  func.func @"echo"(%v0: !tsfg_nullable.i32<3>) -> !tsfg_nullable.i32<3> attributes {tsfg_core.function_id = "sha256:5c0a65df5a94b3fcba54e90e94bb3eb301804a141295258418c9455badb2bd11", tsfg_core.signature_hash = "sha256:c37af51aa1f6de298cfdbedb130d17568ab16d4664c711ede6ebb6696d5ff7a4", tsfg_core.type_id = "sha256:7833389d9851a4df3f11369537a0b964abedc8ecab8234e054c2466b7c40b206", tsfg_core.function_start = 0 : i64, tsfg_core.function_end = 86 : i64, tsfg_nullable.role = "internal"} {
    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 0 : i64, tsfg_source.end = 86 : i64} : () -> ()
    "func.return"(%v0) {tsfg_source.start = 70 : i64, tsfg_source.end = 84 : i64} : (!tsfg_nullable.i32<3>) -> ()
  }
  func.func @"coalesce"(%v0: !tsfg_nullable.i32<3>, %v1: i32) -> i32 attributes {tsfg_core.function_id = "sha256:d305d8453405bcc6b8071e11d6bc39a059331170a0acbb7c29eda3cd8d41f1d7", tsfg_core.signature_hash = "sha256:0f5e736d5dcd2533cfaaaaac9a77797ce8872257e813e9e3871708277cc56246", tsfg_core.type_id = "sha256:376ee983062e25a6fa2c9159a5cbe375a944bc253ce3a22d60386b9678ac797b", tsfg_core.function_start = 86 : i64, tsfg_core.function_end = 301 : i64, tsfg_nullable.role = "internal"} {
    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 86 : i64, tsfg_source.end = 301 : i64} : () -> ()
    %v2 = "func.call"(%v0) {callee = @"echo", tsfg_core.function_id = "sha256:5c0a65df5a94b3fcba54e90e94bb3eb301804a141295258418c9455badb2bd11", tsfg_core.signature_hash = "sha256:c37af51aa1f6de298cfdbedb130d17568ab16d4664c711ede6ebb6696d5ff7a4", tsfg_source.start = 247 : i64, tsfg_source.end = 262 : i64} : (!tsfg_nullable.i32<3>) -> !tsfg_nullable.i32<3>
    %v3 = "func.call"(%v2) {callee = @"echo", tsfg_core.function_id = "sha256:5c0a65df5a94b3fcba54e90e94bb3eb301804a141295258418c9455badb2bd11", tsfg_core.signature_hash = "sha256:c37af51aa1f6de298cfdbedb130d17568ab16d4664c711ede6ebb6696d5ff7a4", tsfg_source.start = 270 : i64, tsfg_source.end = 283 : i64} : (!tsfg_nullable.i32<3>) -> !tsfg_nullable.i32<3>
    %v4 = "tsfg_nullable.tag_test"(%v3) {tag = 0 : i32, tsfg_source.start = 270 : i64, tsfg_source.end = 283 : i64} : (!tsfg_nullable.i32<3>) -> i1
    cf.cond_br %v4, ^bb1, ^bb2 {tsfg_source.start = 271 : i64, tsfg_source.end = 298 : i64}
  ^bb1:
    %v6 = "tsfg_nullable.get"(%v3) {tsfg_source.start = 270 : i64, tsfg_source.end = 283 : i64} : (!tsfg_nullable.i32<3>) -> i32
    cf.br ^bb3(%v6 : i32) {tsfg_source.start = 271 : i64, tsfg_source.end = 298 : i64}
  ^bb2:
    cf.br ^bb3(%v1 : i32) {tsfg_source.start = 271 : i64, tsfg_source.end = 298 : i64}
  ^bb3(%v5: i32):
    "func.return"(%v5) {tsfg_source.start = 263 : i64, tsfg_source.end = 299 : i64} : (i32) -> ()
  }
  func.func @"entry"(%v0: i32) -> i32 attributes {tsfg_core.function_id = "sha256:13d80296693f5522f6b017521e1e1ad3db44f987dfaaf5e4c05340125f76bc6a", tsfg_core.signature_hash = "sha256:0efea2107f2b928ba61de6e6fa9d404fff614055cfe43059d02e25717b915ef7", tsfg_core.type_id = "sha256:376ee983062e25a6fa2c9159a5cbe375a944bc253ce3a22d60386b9678ac797b", tsfg_core.function_start = 301 : i64, tsfg_core.function_end = 375 : i64, tsfg_nullable.role = "entry"} {
    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 301 : i64, tsfg_source.end = 375 : i64} : () -> ()
    %v1 = "tsfg_nullable.wrap_i32"(%v0) {tsfg_source.start = 359 : i64, tsfg_source.end = 364 : i64} : (i32) -> !tsfg_nullable.i32<3>
    %v2 = "func.call"(%v1, %v0) {callee = @"coalesce", tsfg_core.function_id = "sha256:d305d8453405bcc6b8071e11d6bc39a059331170a0acbb7c29eda3cd8d41f1d7", tsfg_core.signature_hash = "sha256:0f5e736d5dcd2533cfaaaaac9a77797ce8872257e813e9e3871708277cc56246", tsfg_source.start = 349 : i64, tsfg_source.end = 372 : i64} : (!tsfg_nullable.i32<3>, i32) -> i32
    "func.return"(%v2) {tsfg_source.start = 342 : i64, tsfg_source.end = 373 : i64} : (i32) -> ()
  }
}
