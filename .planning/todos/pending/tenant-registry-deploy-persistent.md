---
id: tenant-registry-deploy-persistent
created: 2026-05-21
resolves_phase: 6
status: pending
source: Phase 4 execution — 04-03 live verification
---

# Tenant registry is filesystem-based — incompatible with stateless serverless

## Problem

`lib/gbrain/tenants.ts` rebuilds its registry via `readdir(BRAINS_ROOT)` — each
`brains/<slug>/` directory on the local filesystem IS a tenant. `brains/` is
gitignored and Vercel's filesystem is stateless/ephemeral, so the deployed app
sees zero tenants and every `POST /api/tenants/<id>/chat` returns
`404 tenant_not_found`.

Phase 2 moved the gbrain DATA to Supabase, but the tenant REGISTRY was not
migrated — it still depends on local directories.

## Impact

Phase 4's must-have "deployed `POST /api/tenants/[id]/chat` returns a real
gbrain answer" cannot pass on Vercel until the registry is deploy-persistent.
Phase 4 completed 2026-05-21 with this single item explicitly deferred (the
DEPLOY-01..05 infrastructure requirements were all met). The Vercel Bun runtime
and file-tracing risks are proven resolved — the chat route runs gbrain code;
the 404 is a clean app-level miss, not `MODULE_NOT_FOUND`.

## Fix direction (Phase 6 — Auth + Multi-Tenant Isolation)

Make tenant resolution load from a persistent source (Supabase) instead of the
local filesystem. Aligns directly with Phase 6's "per-user brain provisioning"
and "isolation enforced by gbrain RLS".

## Verification when resolved

```
curl -s -X POST https://quickbrain-brown.vercel.app/api/tenants/seed/chat \
  -H 'Content-Type: application/json' \
  -d '{"question":"what was weird about March?"}'
```

Expect a real gbrain answer about March anomalies (not `tenant_not_found`).
