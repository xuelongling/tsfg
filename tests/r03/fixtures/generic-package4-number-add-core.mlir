module attributes {tsfg_core.version = "0.9.0", tsfg_core.input_identity = "sha256:e873c2f118d74ba3ed82386a71a3af0aa38c1120cc702f2f33fd0183df8198c5", tsfg_core.source_hash = "sha256:ca4815b1b71ef1e4921b01566d60eeb1b70751bb9a126b7b37d7f45454d16e44", tsfg_core.source_path = "/original/main.ts", tsfg_core.target = "windows-x86_64-msvc", tsfg_core.triple = "x86_64-pc-windows-msvc", tsfg_core.data_layout = "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128", tsfg_core.bytecode_schema = "sha256:3dea6ce5de996dfa3e7141cced985243ea74ac9bb80f03636c6694343118f2a6", tsfg_core.source_length = 90 : i64} {
  func.func @"__tsfg_generic_v1_b1fbd79265cc14fe45b0c4a1e7d2db606a1e5ea5d2e732faedaa0a879f4f370c"(%v0: f64, %v1: f64) -> f64 attributes {tsfg_core.function_id = "sha256:1c4440637fdfd3f2c5d57b0b027cdbfed55ff0833800f28321b4faf2fa54dcdb", tsfg_core.signature_hash = "sha256:3a9e15f807ca235a4412978eeead8c2311616b62036a8340e135ed08e139d585", tsfg_core.type_id = "sha256:dfbc72c48bec549ea679cd6aff531f9ebef95e001f6ae0bf419d2f33bf988a6c", tsfg_core.function_start = 6 : i64, tsfg_core.function_end = 90 : i64} {
    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 6 : i64, tsfg_source.end = 90 : i64} : () -> ()
    %v2 = "tsfg_core.add"(%v0, %v1) {tsfg_source.start = 75 : i64, tsfg_source.end = 87 : i64} : (f64, f64) -> f64
    "func.return"(%v2) {tsfg_source.start = 75 : i64, tsfg_source.end = 87 : i64} : (f64) -> ()
  }
  func.func @"__tsfg_generic_v1_ca829f92f91a4171479138b050e716fec32f4df7d397905fedd30e27264a9c9a"(%v0: f64, %v1: f64) -> f64 attributes {tsfg_core.function_id = "sha256:a6ce3eaa2276fb6f2e00ddfe5c715f4b2f8405476e06f6da5e5bc462057b6cc3", tsfg_core.signature_hash = "sha256:3a9e15f807ca235a4412978eeead8c2311616b62036a8340e135ed08e139d585", tsfg_core.type_id = "sha256:dfbc72c48bec549ea679cd6aff531f9ebef95e001f6ae0bf419d2f33bf988a6c", tsfg_core.function_start = 6 : i64, tsfg_core.function_end = 90 : i64} {
    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 6 : i64, tsfg_source.end = 90 : i64} : () -> ()
    %v2 = "tsfg_core.add"(%v0, %v1) {tsfg_source.start = 75 : i64, tsfg_source.end = 87 : i64} : (f64, f64) -> f64
    "func.return"(%v2) {tsfg_source.start = 75 : i64, tsfg_source.end = 87 : i64} : (f64) -> ()
  }
}
