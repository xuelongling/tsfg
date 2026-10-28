/* SPDX-License-Identifier: MIT */
#ifndef TSFG_AOT_PROGRAM_H
#define TSFG_AOT_PROGRAM_H
#include <stdint.h>
#include <stddef.h>

/* Read-only data emitted with one complete ABI4 program. These pointers are
 * supplied by the static linker, never by requests or a descriptor loader.
 * Metadata version1 is distinct from the existing execution ABI version4. */
#define TSFG_AOT_PROGRAM_VERSION 1u
typedef struct TsfgAotBytesV1 {
  const uint8_t *data;
  uint32_t length, reserved;
} TsfgAotBytesV1;
typedef struct TsfgAotSourceV1 {
  TsfgAotBytesV1 path;
  uint8_t hash[32];
  uint32_t length, reserved;
} TsfgAotSourceV1;
typedef struct TsfgAotFunctionV1 {
  uint8_t id[32], signature[32], type_id[32];
  TsfgAotBytesV1 name;
  uint32_t source, start, end;
  uint16_t registers, instructions, blocks;
  uint8_t result, initializer;
  uint16_t physical_count, logical_count;
  const uint8_t *parameter_types, *presence_masks;
} TsfgAotFunctionV1;
typedef struct TsfgAotModuleV1 {
  uint8_t id[32];
  uint32_t source, initializer, dependency_count, selected;
  const uint16_t *dependencies;
} TsfgAotModuleV1;
typedef struct TsfgAotGlobalV1 {
  uint8_t id[32];
  TsfgAotBytesV1 name;
  uint32_t source, start, end;
  uint8_t type, writable, generated, reserved;
} TsfgAotGlobalV1;
typedef struct TsfgAotHostV1 {
  uint8_t id[32], signature[32];
  TsfgAotBytesV1 name;
  uint32_t source, capability, start, end, required, reserved;
} TsfgAotHostV1;
typedef struct TsfgAotRootV1 {
  uint32_t kind, source, function, reserved;
  TsfgAotBytesV1 name;
} TsfgAotRootV1;
typedef struct TsfgAotProgramV1 {
  uint32_t version, bytes;
  uint8_t compiled_table_id[32], input_identity[32];
  uint32_t function_count, source_count, module_count, global_count;
  uint32_t host_count, root_count, initialization_count, default_function;
  const TsfgAotFunctionV1 *functions;
  const TsfgAotSourceV1 *sources;
  const TsfgAotModuleV1 *modules;
  const TsfgAotGlobalV1 *globals;
  const TsfgAotHostV1 *hosts;
  const TsfgAotRootV1 *roots;
  const uint16_t *initialization;
} TsfgAotProgramV1;
#ifdef __cplusplus
extern "C" {
#endif
extern const TsfgAotProgramV1 tsfg_aot_program_v1;
#ifdef __cplusplus
}
#define TSFG_PROGRAM_ASSERT static_assert
#else
#define TSFG_PROGRAM_ASSERT _Static_assert
#endif
TSFG_PROGRAM_ASSERT(sizeof(void *) == 8, "compiled program requires Win64");
TSFG_PROGRAM_ASSERT(sizeof(TsfgAotBytesV1) == 16, "compiled byte span layout");
TSFG_PROGRAM_ASSERT(sizeof(TsfgAotSourceV1) == 56, "compiled source layout");
TSFG_PROGRAM_ASSERT(sizeof(TsfgAotFunctionV1) == 152, "compiled function layout");
TSFG_PROGRAM_ASSERT(offsetof(TsfgAotFunctionV1, parameter_types) == 136, "compiled signature offset");
TSFG_PROGRAM_ASSERT(sizeof(TsfgAotModuleV1) == 56, "compiled module layout");
TSFG_PROGRAM_ASSERT(sizeof(TsfgAotGlobalV1) == 64, "compiled global layout");
TSFG_PROGRAM_ASSERT(sizeof(TsfgAotHostV1) == 104, "compiled Host layout");
TSFG_PROGRAM_ASSERT(sizeof(TsfgAotRootV1) == 32, "compiled root layout");
TSFG_PROGRAM_ASSERT(sizeof(TsfgAotProgramV1) == 160, "compiled program layout");
TSFG_PROGRAM_ASSERT(offsetof(TsfgAotProgramV1, functions) == 104, "compiled table offset");
#undef TSFG_PROGRAM_ASSERT
#endif
