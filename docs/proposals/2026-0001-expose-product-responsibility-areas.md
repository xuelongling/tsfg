<!-- SPDX-License-Identifier: MIT -->

# ECP 2026-0001: Expose product responsibility areas

Status: accepted
Owner: @xuelongling
Affected boundaries: repository-topology

## Context

The R00 specification requires the product repository to expose stable
responsibility areas for contracts, compiler, runtime, tooling, engineering
control, tests, documentation, and third-party provenance. The engineering
charter assigns each area a top-level directory, but a clean checkout currently
materializes only `contracts/`, `eng/`, `tests/`, and `docs/`. Git does not
materialize the four remaining empty directories.

## Goals

- Make `compiler/`, `runtime/`, `tooling/`, and `third_party/` visible in every
  complete checkout.
- State each area's ownership and its R00 implementation boundary.
- Add a regression test covering all eight required responsibility areas.

## Non-goals

This decision does not add compiler, runtime, or product-tooling behavior; add a
third-party dependency; alter the Build Input Set; create a generic `src/`
umbrella; or copy a sibling upstream fork into the product repository.

## Affected contracts

None. R00 retains the empty Contract Set and this decision does not change
`contracts/registry.json`, a schema, or a compatibility window.

## Alternatives

Keeping only the directory table in the charter was rejected because a clean
checkout still lacks the named module seams. Empty directories were rejected
because Git cannot preserve them. `.gitkeep` files were rejected because they
do not explain ownership or prevent later responsibility drift. Separate
first-party repositories were rejected because R00 requires one product
repository.

## Compatibility

The change is additive and documentation-only. Existing paths, build commands,
artifact bytes, Product SemVer, Contract Set, and supported targets remain
unchanged. The new Markdown files remain outside the payload Build Input Set.

## Migration and rollback

After this proposal is merged, the implementation adds one tracked README to
each missing area and one topology regression test. No data migration is
required. If an added path conflicts with a later implementation, that
implementation replaces the README while preserving the directory's assigned
responsibility; abandoning or moving an area requires a subsequent ECP.

## Security and licensing

The implementation adds no executable code, dependency, credential, network
access, or binary content. Every new source-controlled file carries the MIT SPDX
identifier and remains covered by the repository license policy.

## Verification evidence

The controlling R00 acceptance specification states the requirement in
implementation decision 3, and `docs/r00-engineering-charter.md` section 3.3
records the repository-local directory map. Before implementation,
`git ls-tree -d HEAD` shows only four of the eight required responsibility
directories. The implementation must pass type checking, repository policy and
license checks, and a test that verifies each required directory and a stable
anchor within it.

## Decision

Represent each currently empty R00 responsibility area with a concise tracked
README and enforce the complete top-level responsibility map with an automated
test. Product implementation remains deferred to its roadmap stage, and
approved upstream forks remain sibling repositories.
