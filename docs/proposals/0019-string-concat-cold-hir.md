<!-- SPDX-License-Identifier: MIT -->

# 0019: StringFacts v2 cold consumer and typed HIR concat

Status: accepted bounded development contract by Root under the existing reasonable-scope
R03 authorization. Root froze the exact24f contract cd5d13d431496033d7508200a1651c4fc3f6c8fc04cc9f63c909b1160743d880;
implementation validation is recorded separately and is not claimed by this document.

The existing string-facts family gains an explicit version2 cold reader/writer for
the already frozen typed binary string concat facts. The unchanged v1 APIs retain
their exact schema and values. Both cold versions share source/range validation,
and String HIR and v2 cold IO share the native byte-view snapshot. No Source parser,
evaluator, replacement string or hidden session/version fallback is introduced.

The existing tsfg.hir family advances exactly to0.11 with H11
sha256:fe225e07d8445184ec49e3cce978c9df7b9be6db0ca64d6e45c63d5a5aaaf1bd.
A v2 context has exact factsVersion:2/factsBytes/expectedPackageId fields; v1 keeps
its two-field context. Expected identity comes from the independently selected
actual producer job. The HIR verifier compares every owner/range/leaf/operation,
while ordinary scalar/module callers retain their single-argument interface.
String concat remains a typed operation containing two independent constant leaves.
Core exchange0.9, bytecode/wire9, ABI and the nominal String identity remain unchanged.
Old HIR migrates only current metadata; no compatibility reader is installed.

Exactly three new tsfg input members are adopted: compiler/string-facts-v2-model.mjs,
compiler/string-facts-v2.mjs and contracts/string-facts-v2-candidate.schema.json.
Product209 becomes212 and M13210 becomes213, each declaration adding202 bytes;
all prior members, M13's managed heap, SDKv2 and identity/encoding algorithms remain.
This Product checkout adopts only its complete212 declaration. Root serially adopts
M13's complete213 union; this file does not imply that integration already occurred.

String Core lowering remains an explicit validated capability failure. This change
grants no Source012 admission, storage/GC/ABI/VM/String execution, publication or
historical cyber STOP release. Revert the complete change including HIR schema,
registry, declaration and exact test metadata together; a partial metadata rollback
would leave mixed identities. Acceptance and necessary failure originals belong
to the single24f workspace summary, not an additional in-repository evidence chain.
