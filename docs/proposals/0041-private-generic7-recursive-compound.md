<!-- SPDX-License-Identifier: MIT -->

# ECP-0041: private generic7 finite compound call graphs

Status: accepted under the Owner's continuing full R03 instruction and Root's explicit private7 engineering decision, following ECP-0015. Actual qualification and independent review remain separate requirements.

Adopt private owned generic package7, tsfg-owned-scalar-generics-host-v7 and concrete HIR7. The complete canonical descriptor is retained at `tests/r03/fixtures/generic-descriptor-v7.json`, SHA256 `2e9d1e07016b6f8ce5f48bf8a3508491eaf1ce7e6fd43bf497c133f65c8dff94`. Package identity uses the `tsfg-owned-generic-package/v7` newline domain. All predecessor contracts including private6 and mixed identities are rejected without a compatibility path. This supersedes ECP-0038's internal one-hop restriction.

Conditional and mapped/indexed signatures retain one required outer type parameter, one required value parameter and exactly equal complete parameter/return structures. A definition may directly return parameter0 or call an existing same-module definition with the same complete signature, explicitly forwarding outer type parameter0 and value parameter0. Each definition and every call edge is validated independently. The existing request queue deduplicates concrete instance keys before scheduling them, so multi-hop calls, ordinary self recursion, mutual recursion and repeated roots produce a finite complete closure. Official fresh checkers and the existing mapper supply the actual bool/f64 facts; Product performs structural correspondence and never evaluates conditional or mapped types.

Complete mapped binder text, key occurrence order, value role and index remain significant. Missing targets, wrong arities/slots, concrete or inferred call type arguments, nested argument calls, mismatched signatures and mixed conditional/indexed edges remain rejected. Existing direct leaf signatures and number-add behavior remain supported. The existing definition256, root256, instance512 and JSON/expression budgets are unchanged.

DTO field shapes, capabilities, definition/instance/linkage/HIR input algorithms, IO/request/command1, DTS362, Source admission, registry and formal Frontend/HIR/Core exchange contracts are unchanged. New private7 fixtures are independently calculated expectations until matched against actual fresh Source outputs. Historical private6 bytes remain predecessor negative inputs. Static canonical/optimized Core checks grant no guest, VM, native, scheduler or Runtime execution credit; all existing STOP boundaries remain in force.
