// SPDX-License-Identifier: MIT
// Compile/link-only caller: this file is never executed by the ABI checks.
#include <stdint.h>
#include <stddef.h>
typedef struct { uint32_t low; uint32_t high; } Slot;
typedef struct { int32_t integer; uint8_t boolean; uint8_t reserved[3]; } LegacySlot;
typedef uint32_t (*Event)(void *, uint32_t, uint32_t, uint32_t, uint32_t, uint64_t);
_Static_assert(sizeof(Slot) == 8 && _Alignof(Slot) == 4, "slot layout");
_Static_assert(offsetof(Slot, low) == 0 && offsetof(Slot, high) == 4, "word offsets");
_Static_assert(sizeof(LegacySlot) == 8 && _Alignof(LegacySlot) == 4, "legacy layout");
_Static_assert(offsetof(LegacySlot, boolean) == 4 && offsetof(LegacySlot, reserved) == 5, "legacy bool byte");
_Static_assert(sizeof(void *) == 8 && _Alignof(void *) == 8, "admitted pointer layout");
#ifdef TSFG_TEST_OLD_ABI
extern uint32_t tsfg_native_invoke(void *, Event, uint32_t, const Slot *, Slot *);
__declspec(dllexport) uint32_t tsfg_c_abi_probe(void *state, Event event, uint32_t index,
    const Slot *arguments, Slot *output) {
    return tsfg_native_invoke(state, event, index, arguments, output);
}
#else
extern const uint32_t tsfg_native_abi_version;
extern uint32_t tsfg_native_invoke_v3(void *, Event, uint32_t, uint32_t,
    const uint8_t *, uint8_t, const Slot *, Slot *);
__declspec(dllexport) uint32_t tsfg_c_abi_probe(void *state, Event event, uint32_t index,
    uint32_t count, const uint8_t *types, uint8_t result_type,
    const Slot *arguments, Slot *output) {
    return tsfg_native_abi_version == 3 ? tsfg_native_invoke_v3(state, event,
        index, count, types, result_type, arguments, output) : 0;
}
#endif
