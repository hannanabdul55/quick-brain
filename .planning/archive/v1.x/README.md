# v1.x Archive

Snapshot of the hackathon-era planning artifacts, archived 2026-05-19 when the
project pivoted from "7.5h hackathon shell" to a real-world product for SMB
owners (see `.planning/PROJECT.md` → milestone v2.0).

## What's here

- `phases/01-03` — **v1.0 "Demo"**, shipped. Brain spine + synthetic seed,
  onboarding theatre + chat, insight cards + demo readiness.
- `phases/04` — **v1.1 "Beyond the Demo"**, Phase 4 only, **shipped**. The
  `smb-audit` gbrain skill. This is real, working code on `main`.
- `phases/05` — **v1.1 Phase 5**, *planned but never executed*. Email
  magic-link auth. The 5 PLAN.md files + RESEARCH.md + CONTEXT.md were written
  under hackathon assumptions and are **superseded** by v2.0's auth +
  multi-tenant phase. Kept as input: the jose/bun:sqlite research and the
  atomic-token-guard patterns still inform the v2.0 re-scope.
- `ROADMAP.md` / `REQUIREMENTS.md` — the v1.0 + v1.1 roadmap and requirement
  set (DEMO-*, BRAIN-*, SKIL-*, AUTH-*, QBO-* IDs).

## Why archived, not deleted

Phases 01-04 are shipped history — the code is on `main`. Phase 05's plans are
not wasted: v2.0's auth phase reuses the research. Nothing here is live; the
v2.0 roadmap starts fresh at Phase 1.
