# Domain docs

This workspace contains multiple independent repositories and therefore uses a multi-context domain layout.

## Before exploring

1. Read the root `CONTEXT-MAP.md` and select the repositories relevant to the task.
2. Read each selected repository's `CONTEXT.md` when present.
3. Read workspace-wide ADRs under `docs/adr/` and repository-specific ADRs under that repository's `docs/adr/` when they touch the work.

Missing domain files are not blockers. Continue silently; create or update them only when domain-modeling work resolves terminology or a durable decision.

## Layout

```text
workspace/
├── CONTEXT-MAP.md
├── docs/adr/                 # cross-repository decisions
├── repository-a/
│   ├── CONTEXT.md
│   └── docs/adr/             # repository-specific decisions
└── repository-b/
    ├── CONTEXT.md
    └── docs/adr/
```

Use glossary terms exactly in issues, specifications, tests, and design proposals. Surface any conflict with an existing ADR explicitly instead of silently overriding it.
