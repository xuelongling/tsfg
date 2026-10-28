module attributes {tsfg_core.version = "0.9.0", tsfg_core.input_identity = "sha256:0e617f6b45655f5f0afaf1763a537ba7e73c4d6dbfda2c1696329144ea77ece5", tsfg_core.source_hash = "sha256:ca4815b1b71ef1e4921b01566d60eeb1b70751bb9a126b7b37d7f45454d16e44", tsfg_core.source_path = "/original/main.ts", tsfg_core.target = "windows-x86_64-msvc", tsfg_core.triple = "x86_64-pc-windows-msvc", tsfg_core.data_layout = "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128", tsfg_core.bytecode_schema = "sha256:3dea6ce5de996dfa3e7141cced985243ea74ac9bb80f03636c6694343118f2a6", tsfg_core.source_length = 90 : i64} {
  func.func @"__tsfg_generic_v1_8ec71ddf67e4742cbf261ce272dcfdd86126082abb531d388125f16d1e911517"(%v0: f64, %v1: f64) -> f64 attributes {tsfg_core.function_id = "sha256:b5c99f053e495c15c2f0e53cc8e140482fef711326c0364a25c8d829a152bd76", tsfg_core.signature_hash = "sha256:3a9e15f807ca235a4412978eeead8c2311616b62036a8340e135ed08e139d585", tsfg_core.type_id = "sha256:dfbc72c48bec549ea679cd6aff531f9ebef95e001f6ae0bf419d2f33bf988a6c", tsfg_core.function_start = 6 : i64, tsfg_core.function_end = 90 : i64} {
    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 6 : i64, tsfg_source.end = 90 : i64} : () -> ()
    %v2 = "tsfg_core.add"(%v0, %v1) {tsfg_source.start = 75 : i64, tsfg_source.end = 87 : i64} : (f64, f64) -> f64
    "func.return"(%v2) {tsfg_source.start = 75 : i64, tsfg_source.end = 87 : i64} : (f64) -> ()
  }
  func.func @"__tsfg_generic_v1_ec1cf4cff127cc87fdcf945b51998b6f81e603d6a358098ff1345a5d2ca155bf"(%v0: f64, %v1: f64) -> f64 attributes {tsfg_core.function_id = "sha256:73e2a1d9ee11e646ff704d05df7161fceb3e07465d1953194b7751fcc7246b32", tsfg_core.signature_hash = "sha256:3a9e15f807ca235a4412978eeead8c2311616b62036a8340e135ed08e139d585", tsfg_core.type_id = "sha256:dfbc72c48bec549ea679cd6aff531f9ebef95e001f6ae0bf419d2f33bf988a6c", tsfg_core.function_start = 6 : i64, tsfg_core.function_end = 90 : i64} {
    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 6 : i64, tsfg_source.end = 90 : i64} : () -> ()
    %v2 = "tsfg_core.add"(%v0, %v1) {tsfg_source.start = 75 : i64, tsfg_source.end = 87 : i64} : (f64, f64) -> f64
    "func.return"(%v2) {tsfg_source.start = 75 : i64, tsfg_source.end = 87 : i64} : (f64) -> ()
  }
}
