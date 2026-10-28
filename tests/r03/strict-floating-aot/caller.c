// SPDX-License-Identifier: MIT
// Compile/link only. This test does not execute the generated object.
#include <stdint.h>
#include <stddef.h>
typedef struct { uint32_t low, high; } Slot;
typedef uint32_t (*Event)(void *, uint32_t, uint32_t, uint32_t, uint32_t, uint64_t);
extern const uint32_t tsfg_native_abi_version;
extern uint32_t tsfg_native_invoke_v3(void *, Event, uint32_t, uint32_t,
    const uint8_t *, uint8_t, const Slot *, Slot *);
_Static_assert(sizeof(Slot) == 8 && _Alignof(Slot) == 4, "ABI3 slot");
_Static_assert(offsetof(Slot, high) == 4, "ABI3 word offsets");
_Static_assert(sizeof(float) == 4 && sizeof(double) == 8, "IEEE formats");
__declspec(dllexport) uint32_t tsfg_c_float_probe(void *state, Event event,
    uint32_t index, float single, double wide, Slot *output) {
    const union { float value; uint32_t raw; } a = { .value = single };
    const union { double value; uint64_t raw; } b = { .value = wide };
    const uint8_t types[2] = {12, 13};
    const Slot arguments[2] = {{a.raw, 0}, {(uint32_t)b.raw, (uint32_t)(b.raw >> 32)}};
    return tsfg_native_abi_version == 3 ? tsfg_native_invoke_v3(state, event,
        index, 2, types, 13, arguments, output) : 0;
}
