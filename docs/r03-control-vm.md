<!-- SPDX-License-Identifier: MIT -->

# Structured scalar control and Semantic Fuel

M05 extends the formal source→official owned Snapshot→independent HIR→C++/MLIR
Core→R04→Zig Runtime chain with if/else, while and bool short circuit. Snapshot
0.5.0 already provides these official facts; HIR/Core/R04 use exact development
0.5.0 and wire5 after M06's module-call extension. Lexical bindings and SSA block arguments preserve branch and
loop values. R04 applies incoming phi arguments simultaneously.

Every request charges one function-entry event and one before each while
condition, including the first and final false. Three iterations therefore cost
five events: entry; n0,n1,n2 true; n3 false. A fuel balance4 traps before n3's
condition;5 returns with0. A zero-iteration loop costs2. Short circuit and if
introduce no extra logical charges. Fuel failure precedes condition evaluation,
so an unreachable divide trap remains unreachable and condition division loses
to insufficient fuel. Physical instruction and memory bounds remain separate
Execution Abort channels. Defaults/event priority and exact machine fields are
specified in [R04](../contracts/bytecode.md).

Canonical read/write and verifier checks cover owned source delimiters/types,
Core dominance/successor arity, R04 identities/typed edges/fuel cycles and phi
parallel transfer. Source spelling transformations preserve logical entity IDs,
results and fuel while retaining each source's original UTF16 trap anchors. The
current optimization pipeline performs verified canonical identity printing;
no rewrite or AOT execution is claimed. The Runtime host accepts another request
after trap/abort and reports activeRequests0 after frame cleanup.

M06 extends execution to typed scalar parameters and forward/direct/mutually
recursive calls through the same official chain. The loader validates every
function and call signature before execution. Calls share instruction and
active-frame memory budgets, evaluate arguments left to right, and check
callee depth before allocating its frame or charging entry fuel. Typed public
host requests validate identity, optional signature and all arguments before
logical events. Returning or failing releases every frame before another host
request begins. Delayed initialization,
updates and general ordinary expressions retain their remaining R03/M10 duties.
Q3–Q13, user catch/finally, managed roots/borrows and CPU/GPU domains retain their
authoritative definitions and require their corresponding actual consumers.
Implementation acceptance belongs to M05's final frozen evidence and two
independent review axes; these descriptions do not themselves establish it.
