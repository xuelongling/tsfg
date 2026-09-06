<!-- SPDX-License-Identifier: MIT -->

# Engineering Change Proposals

An Engineering Change Proposal (ECP) records review of an engineering boundary
before implementation. Copy [`template.md`](template.md) to
`docs/proposals/<year>-<sequence>-<slug>.md`; use four decimal digits for the
sequence and a lowercase ASCII kebab-case slug.

## Process

1. Open a proposal-only pull request. Fill every template section and use
   `Status: draft` while discussion is active.
2. The responsible human owner changes the status to `accepted` or `rejected`
   as part of that proposal review. Merge the proposal before implementation.
3. An implementation pull request references the accepted file from its base
   commit with exactly one `ECP: docs/proposals/<file>.md` line in its body.
   Adding the proposal and its implementation in one pull request fails closed.
4. A later proposal may mark an earlier decision `superseded`. Proposal history
   is never deleted.

The required `ECP Governance / trusted base ECP gate` check runs on
`pull_request_target`, checks out only the pull request base, fetches the head as
Git objects without checking it out, and executes the gate bytes from the base
commit. Candidate changes therefore cannot weaken the gate that judges the same
pull request. The initial bootstrap pull request is merged under the pre-existing
Product controls and human review because the trusted workflow does not exist in
the base yet; immediately after that merge, configure this check as required.
There is deliberately no fallback that executes `eng/ecp-gate.mjs` from the
candidate head.

Only `draft`, `accepted`, `rejected`, and `superseded` are valid statuses. An
accepted proposal must have a concrete GitHub login in `Owner`, cover every
boundary class reported by CI, and replace all placeholders with substantive
decisions and evidence. TODO, TBD, FIXME, placeholder prompts, and equivalent
placeholder sentences are invalid even when surrounded by otherwise substantive
text. Once accepted, a proposal may only retain `accepted` or advance to
`superseded`; its substantive text cannot be rewritten. An implementation pull
request's referenced accepted proposal must remain accepted and semantically
identical in both base and head. A pull request with no governed impact uses
`ECP: none`.

## Automatic classification

The repository gate compares the pull request base and head commits. It reports
one or more of these stable boundary classes:

| Boundary class | Automatically governed facts |
| --- | --- |
| `repository-topology` | Top-level repository directories and `.gitmodules` |
| `build-identity` | The normative Build Identity section of the engineering charter |
| `build-input-set` | Build Input Set schema and its normative charter section; ordinary entry membership remains exempt |
| `tier-1` | Toolchain target set, fixed workflow runner labels, and the Tier 1 charter section |
| `toolchain-major-minor` | Added/removed tools, tool major/minor changes, and the toolchain charter section; patch updates remain exempt |
| `contract-schema` | Files under `contracts/` and the contract/version charter section |
| `compatibility-window` | Contract Registry and the contract/version charter section |
| `release-security` | Workflow event/permission/environment boundaries, action identity, credential-bearing environment values and token/secret inputs, and sensitive authentication/deployment/publication steps, plus the CI security charter section |
| `durable-decision` | New or changed ADRs |

The classifier intentionally follows authoritative facts. An implementation
patch that preserves those facts remains ordinary; changing their semantics
requires the proposal-led normative update first. Existing policy,
compatibility, lock, hermetic-build, and workflow tests continue to enforce the
declared behavior.

Only an accepted, durable, hard-to-reverse decision with meaningful tradeoffs
may produce an ADR. An ECP is not an implementation ticket and does not replace
the relevant compatibility, security, license, migration, or rollback tests.
