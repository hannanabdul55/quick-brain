# QuickBrain

A 60-second onboarding shell around [gbrain](https://github.com/garrytan/gbrain) for non-technical small-business owners. Demo persona: Mara, who owns a neighborhood coffee shop.

> **Phase 1 status (current branch):** the brain spine and synthetic Mara's Coffee dataset.
> The Next.js onboarding UI and chat surface land in Phase 2.

## What's in this branch

```
lib/gbrain/         — TypeScript harness that spawns the gbrain CLI per-tenant
                      with GBRAIN_HOME isolation and an in-process mutex queue
data/maras-coffee/  — 44-file synthetic dataset under gbrain's whitelisted dirs
                      (companies/, people/, originals/, concepts/) with 3
                      planted anomalies wired through invoices, bank statements,
                      monthly closes, and vendor emails
scripts/
  demo-check.sh           — pre-flight: gbrain version, doctor, API keys, brains/ write
  seed.sh                 — produces brains/seed/ end-to-end
  generate-fixtures.ts    — regenerates the templated invoices/statements/closes
  detect-anomalies.ts     — rule-based detector → concepts/*.md
  concurrent-smoke.ts     — concurrent queries verify mutex serialization
brains/             — gitignored; populated by scripts/seed.sh
```

## Install gbrain (only supported path)

`bun install -g github:garrytan/gbrain` is **broken** — Bun skips postinstall, PGLite migrations never run, and the CLI aborts on first use (gbrain issue #218). Use the clone+link path:

```bash
git clone https://github.com/garrytan/gbrain.git
cd gbrain && bun install && bun link
gbrain --version
```

## Prerequisites

```bash
export OPENAI_API_KEY="sk-..."        # required for embeddings + hybrid search
export ANTHROPIC_API_KEY="sk-ant-..." # required for query expansion + chat
```

## Build the seed brain

```bash
bun install
scripts/demo-check.sh   # verify env, gbrain, keys, brains/ write
scripts/seed.sh         # produces brains/seed/
```

## Phase 1 smoke gate

After `scripts/seed.sh` succeeds, all four of these should work:

```bash
GBRAIN_HOME=brains/seed gbrain graph-query beanstalk-roasters --depth 2
GBRAIN_HOME=brains/seed gbrain orphans
GBRAIN_HOME=brains/seed gbrain query "what was weird about last month?"
bun scripts/concurrent-smoke.ts   # 3 concurrent queries serialize via mutex
```

The "what was weird" query should name all three planted anomalies in a single response:

1. Beanstalk Roasters price hike (+22%) in March 2026
2. Square POS duplicate $79 subscription charge on Mar 4 and Mar 11
3. Ghost 7shifts SaaS subscription ($43/mo, no activity for 90+ days)

## Panic recovery

If the demo breaks during recording or rehearsal:

1. **Quick recover** (cache or in-memory state is bad, brain dirs are fine):
   - On the dashboard, press-and-hold the **Reset** button for 2 seconds.
   - This wipes the current tenant's brain, re-copies `brains/seed/`, kills any in-flight `gbrain` spawn, and clears the insight cache.
   - Should complete in under 10 seconds.

2. **Hard recover** (Next.js server is hung, multiple tenants are corrupted, ports stuck):
   ```bash
   bun run panic-reset   # kills next dev + gbrain processes, wipes all non-seed tenants
   bun run dev           # restart on :3000
   ```
   This does NOT rebuild the seed brain — the pre-baked `brains/seed/` is preserved.
   Total wall-clock: under 15 seconds.

3. **Nuclear recover** (the code itself broke between rehearsals):
   ```bash
   git checkout demo-final
   bun install
   bun run panic-reset
   bun run dev
   ```
   `demo-final` is the operator-blessed frozen tag (created when all 3 rehearsals pass cleanly — see `docs/DEMO-SCRIPT.md`).

> **Pre-demo checklist** — see `docs/DEMO-SCRIPT.md` for the full 30-second pre-flight.
