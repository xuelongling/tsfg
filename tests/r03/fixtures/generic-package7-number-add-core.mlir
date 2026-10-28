module attributes {tsfg_core.version = "0.12.0", tsfg_core.input_identity = "sha256:291d3c3e5272b485b24e0ae4da72f9255f7716e3e7429c6ec3ce65947ee09254", tsfg_core.source_hash = "sha256:ca4815b1b71ef1e4921b01566d60eeb1b70751bb9a126b7b37d7f45454d16e44", tsfg_core.source_path = "/original/main.ts", tsfg_core.target = "windows-x86_64-msvc", tsfg_core.triple = "x86_64-pc-windows-msvc", tsfg_core.data_layout = "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128", tsfg_core.bytecode_schema = "sha256:fec456a47f509480d96f65e5c03d465c7c204d60f09630e71b19c714d4aaafa7", tsfg_core.source_length = 90 : i64} {
  func.func @"__tsfg_generic_v1_081b126cebb1ebf91215381e1370589c31e192f74e7272b296f9445430155378"(%v0: f64, %v1: f64) -> f64 attributes {tsfg_core.function_id = "sha256:161d075a4344fdb1c5039dbfffe1f718b9fd6ab45115f75d4e4fb1e2a2cbf420", tsfg_core.signature_hash = "sha256:3a9e15f807ca235a4412978eeead8c2311616b62036a8340e135ed08e139d585", tsfg_core.type_id = "sha256:dfbc72c48bec549ea679cd6aff531f9ebef95e001f6ae0bf419d2f33bf988a6c", tsfg_core.function_start = 6 : i64, tsfg_core.function_end = 90 : i64} {
    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 6 : i64, tsfg_source.end = 90 : i64} : () -> ()
    %v2 = "tsfg_core.add"(%v0, %v1) {tsfg_source.start = 75 : i64, tsfg_source.end = 87 : i64} : (f64, f64) -> f64
    "func.return"(%v2) {tsfg_source.start = 75 : i64, tsfg_source.end = 87 : i64} : (f64) -> ()
  }
  func.func @"__tsfg_generic_v1_d828cd3d083e8da147aa016baea6db645f9f786250b4c84054659db5f2e80f8c"(%v0: f64, %v1: f64) -> f64 attributes {tsfg_core.function_id = "sha256:cd7514b19f22cd7d0903efdc26f1c5e2bb78b6ff3a074ff87b0c440f4379dd7e", tsfg_core.signature_hash = "sha256:3a9e15f807ca235a4412978eeead8c2311616b62036a8340e135ed08e139d585", tsfg_core.type_id = "sha256:dfbc72c48bec549ea679cd6aff531f9ebef95e001f6ae0bf419d2f33bf988a6c", tsfg_core.function_start = 6 : i64, tsfg_core.function_end = 90 : i64} {
    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 6 : i64, tsfg_source.end = 90 : i64} : () -> ()
    %v2 = "tsfg_core.add"(%v0, %v1) {tsfg_source.start = 75 : i64, tsfg_source.end = 87 : i64} : (f64, f64) -> f64
    "func.return"(%v2) {tsfg_source.start = 75 : i64, tsfg_source.end = 87 : i64} : (f64) -> ()
  }
}
