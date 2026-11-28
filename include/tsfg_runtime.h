/* SPDX-License-Identifier: MIT */
/* Public Windows x64 C-ABI Host SDK Header for `tsfg_runtime.lib` / `tsfg_runtime.dll`. */
#ifndef TSFG_RUNTIME_H
#define TSFG_RUNTIME_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define TSFG_RUNTIME_ABI_VERSION 1u

typedef struct TsfgEngineOpaque* TsfgEngineHandle;

typedef struct TsfgResourceHandle {
    uint32_t index;
    uint32_t generation;
} TsfgResourceHandle;

typedef struct TsfgStringView {
    const uint8_t* ptr;
    size_t len;
} TsfgStringView;

uint32_t tsfg_runtime_abi_version(void);
TsfgEngineHandle tsfg_engine_create(size_t max_heap_bytes, size_t arena_bytes, uint32_t worker_threads);
void tsfg_engine_destroy(TsfgEngineHandle engine);
void tsfg_engine_enable_profiling(TsfgEngineHandle engine, uint8_t enabled);
int32_t tsfg_engine_eval_i32(
    TsfgEngineHandle engine,
    const uint8_t* bytecode_ptr,
    size_t bytecode_len,
    uint32_t fn_idx,
    int32_t arg0,
    int32_t arg1,
    int32_t* out_val
);

#ifdef __cplusplus
}
#endif

#endif /* TSFG_RUNTIME_H */
