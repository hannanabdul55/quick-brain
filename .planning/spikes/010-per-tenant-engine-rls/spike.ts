/**
 * Spike 010: per-tenant engine context — shared engine + sourceId isolation
 *
 * Pre-research finding (gbrain/src/core/schema-embedded.ts:889):
 *   "The postgres role (used by gbrain via pooler) has BYPASSRLS."
 *
 * gbrain enables RLS on every table BUT the role we connect as has BYPASSRLS.
 * So RLS is NOT the isolation primitive for QuickBrain — it's defense-in-depth
 * against the Supabase anon role. All tenant isolation must come from
 * app-layer `sourceId` scoping per call on the shared engine.
 *
 * The design under test is in lib/gbrain/engine.ts: a single long-lived
 * BrainEngine instance + per-call `sourceId` arg to hybridSearch / getPage.
 * Spike 007 proved this works for one query at a time. This spike pushes:
 *
 *   1. Concurrent — 20 interleaved queries from 2 tenants; no cross-talk
 *   2. Slug-collision — same slug in two sourceIds → two independent rows
 *   3. "Forgot sourceId" — does engine.listPages() without scope leak across tenants?
 *   4. getPage without sourceId — does it find the wrong tenant's page?
 *   5. hybridSearch without sourceId — what does it return?
 *
 * Cleanup: DELETE FROM sources WHERE id IN ('spike-010-tenant-a', 'spike-010-tenant-b').
 * FK cascade sweeps pages + chunks.
 *
 * How to run:
 *   set -a && . ./.env.local && set +a
 *   bun .planning/spikes/010-per-tenant-engine-rls/spike.ts
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

async function loadGbrain(subpath: string): Promise<any> {
  return import(/* @vite-ignore */ "gbrain/" + subpath);
}

interface SpikeEvent {
  t: string;
  ms: number;
  category: "setup" | "config" | "engine" | "ingest" | "search" | "concurrent" | "leak-probe" | "cleanup" | "error";
  message: string;
  data?: unknown;
}

const events: SpikeEvent[] = [];
const t0 = Date.now();

function log(category: SpikeEvent["category"], message: string, data?: unknown) {
  const ms = Date.now() - t0;
  events.push({ t: new Date().toISOString(), ms, category, message, ...(data !== undefined ? { data } : {}) });
  const tag = `[${String(ms).padStart(6, " ")}ms] ${category.toUpperCase().padEnd(12)}`;
  console.log(`${tag} ${message}${data !== undefined ? "  " + JSON.stringify(data) : ""}`);
}

const TENANT_A = "spike-010-tenant-a";
const TENANT_B = "spike-010-tenant-b";
const COLLIDING_SLUG = "originals/spike-010-shared-slug";

const PAYLOAD_A = `---
type: bill
vendor: tenant-a-vendor
vendor_slug: tenant-a-vendor
date: 2026-05-28
amount: 100.00
currency: USD
tenant: A
---

Bill from [[companies/tenant-a-vendor]] for $100. TENANT_A_SECRET_MARKER_${Date.now()}.
This is Tenant A's private bill — Tenant B must never see this content.`;

const PAYLOAD_B = `---
type: bill
vendor: tenant-b-vendor
vendor_slug: tenant-b-vendor
date: 2026-05-28
amount: 500.00
currency: USD
tenant: B
---

Bill from [[companies/tenant-b-vendor]] for $500. TENANT_B_SECRET_MARKER_${Date.now()}.
This is Tenant B's confidential bill — Tenant A must never see this content.`;

interface VerdictTable {
  probe: string;
  outcome: "PASS" | "FAIL";
  detail: string;
}
const verdicts: VerdictTable[] = [];
function verdict(probe: string, ok: boolean, detail: string) {
  verdicts.push({ probe, outcome: ok ? "PASS" : "FAIL", detail });
  log(ok ? "search" : "error", `${ok ? "✓" : "✗"} ${probe} — ${detail}`);
}

async function main() {
  log("setup", "Spike 010 starting", { tenants: [TENANT_A, TENANT_B], slug: COLLIDING_SLUG });

  const dbUrl = process.env.GBRAIN_DATABASE_URL ?? process.env.SUPABASE_DB_URL_POOLER;
  if (!dbUrl || !process.env.OPENAI_API_KEY) {
    log("error", "Missing env (need SUPABASE_DB_URL_POOLER + OPENAI_API_KEY)");
    process.exit(1);
  }

  log("config", "configureGateway + createEngine + connect");
  const gateway = await loadGbrain("ai/gateway");
  await gateway.configureGateway({ env: { ...process.env } });
  const ef = await loadGbrain("engine-factory");
  const cfg = { engine: "postgres" as const, database_url: dbUrl };
  const engine = await ef.createEngine(cfg);
  await engine.connect(cfg);
  log("engine", "Engine ready (single shared instance — same pattern as lib/gbrain/engine.ts)");

  // ── Setup: pre-register both sources + write the colliding-slug pages ────
  log("ingest", "Pre-register both tenant source rows");
  for (const id of [TENANT_A, TENANT_B]) {
    await engine.executeRaw(
      `INSERT INTO sources (id, name, config) VALUES ($1, $2, $3::jsonb) ON CONFLICT (id) DO NOTHING`,
      [id, id, JSON.stringify({ kind: "spike-010" })],
    );
  }

  const im = await loadGbrain("import-file");
  log("ingest", `Tenant A: importFromContent slug=${COLLIDING_SLUG}`);
  const ra = await im.importFromContent(engine, COLLIDING_SLUG, PAYLOAD_A, { sourceId: TENANT_A, forceRechunk: true });
  log("ingest", "Tenant A wrote", { status: ra.status, chunks: ra.chunks });

  log("ingest", `Tenant B: importFromContent SAME slug=${COLLIDING_SLUG} (different content)`);
  const rb = await im.importFromContent(engine, COLLIDING_SLUG, PAYLOAD_B, { sourceId: TENANT_B, forceRechunk: true });
  log("ingest", "Tenant B wrote", { status: rb.status, chunks: rb.chunks });

  // ── Probe 1: getPage(slug, {sourceId: A}) returns A's content, not B's ──
  log("leak-probe", "Probe 1: getPage(slug, {sourceId: A}) returns A's content");
  const pageA = await engine.getPage(COLLIDING_SLUG, { sourceId: TENANT_A });
  const pageB = await engine.getPage(COLLIDING_SLUG, { sourceId: TENANT_B });
  const aHasASecret = pageA?.compiled_truth?.includes("TENANT_A_SECRET_MARKER");
  const aHasBSecret = pageA?.compiled_truth?.includes("TENANT_B_SECRET_MARKER");
  const bHasBSecret = pageB?.compiled_truth?.includes("TENANT_B_SECRET_MARKER");
  const bHasASecret = pageB?.compiled_truth?.includes("TENANT_A_SECRET_MARKER");
  verdict(
    "PROBE 1: composite-key getPage isolation",
    aHasASecret && bHasBSecret && !aHasBSecret && !bHasASecret,
    `A→A=${aHasASecret} A→B=${aHasBSecret} B→B=${bHasBSecret} B→A=${bHasASecret} (want T T F F)`,
  );

  // ── Probe 2: 20 concurrent interleaved queries from both tenants ────────
  log("concurrent", "Probe 2: 20 concurrent hybridSearch calls interleaved between tenants");
  const hs = await loadGbrain("search/hybrid");
  const query = "bill from vendor";
  const concurrentStart = Date.now();
  const tasks = Array.from({ length: 20 }, (_, i) => {
    const tenant = i % 2 === 0 ? TENANT_A : TENANT_B;
    return hs.hybridSearch(engine, query, { sourceId: tenant, limit: 3 }).then((results: any[]) => ({
      i,
      tenant,
      slugs: results.map((r) => r.slug),
      contents: results.map((r) => r.chunk_text?.slice(0, 60)),
    }));
  });
  const concurrentResults = await Promise.all(tasks);
  const concurrentMs = Date.now() - concurrentStart;
  log("concurrent", `20 concurrent calls completed in ${concurrentMs}ms`);

  // For each call, check that none of the returned chunks contain the OTHER tenant's secret marker
  let leakCount = 0;
  const leakDetails: any[] = [];
  for (const r of concurrentResults) {
    const otherMarker = r.tenant === TENANT_A ? "TENANT_B_SECRET_MARKER" : "TENANT_A_SECRET_MARKER";
    const hasOtherSecret = r.contents.some((c: string) => c?.includes(otherMarker));
    if (hasOtherSecret) {
      leakCount++;
      leakDetails.push({ call: r.i, tenant: r.tenant, leaked: r.contents.filter((c: string) => c?.includes(otherMarker)) });
    }
  }
  verdict(
    "PROBE 2: 20 concurrent interleaved queries — no cross-tenant leak",
    leakCount === 0,
    `${leakCount}/20 calls leaked other-tenant secrets${leakCount > 0 ? " — " + JSON.stringify(leakDetails) : ""}`,
  );

  // ── Probe 3: hybridSearch with NO sourceId — what does it return? ───────
  log("leak-probe", "Probe 3: hybridSearch WITHOUT sourceId (\"forgot to pass\" bug class)");
  const unscopedResults = await hs.hybridSearch(engine, query, { limit: 10 });
  const unscopedSlugs = unscopedResults.map((r: any) => ({ slug: r.slug, src: r.source_id, score: r.score }));
  log("leak-probe", `Unscoped search returned ${unscopedResults.length} results`, unscopedSlugs.slice(0, 5));
  const unscopedSawA = unscopedResults.some((r: any) => r.chunk_text?.includes("TENANT_A_SECRET_MARKER"));
  const unscopedSawB = unscopedResults.some((r: any) => r.chunk_text?.includes("TENANT_B_SECRET_MARKER"));
  verdict(
    "PROBE 3: unscoped hybridSearch behavior — what does \"forgot to pass sourceId\" do?",
    true, // not pass/fail per se — informational
    `Unscoped sees A=${unscopedSawA} B=${unscopedSawB}. ${unscopedSawA && unscopedSawB ? "LEAK CLASS: omitting sourceId returns federated rows across tenants." : "Defaults to one source — safe."}`,
  );

  // ── Probe 4: getPage(slug) with NO sourceId — composite key behavior ────
  log("leak-probe", "Probe 4: getPage(slug) WITHOUT sourceId — which row does it return?");
  const pageNoSrc = await engine.getPage(COLLIDING_SLUG);
  const noSrcMarker = pageNoSrc?.compiled_truth?.includes("TENANT_A_SECRET_MARKER") ? "A"
                    : pageNoSrc?.compiled_truth?.includes("TENANT_B_SECRET_MARKER") ? "B"
                    : "neither";
  verdict(
    "PROBE 4: getPage WITHOUT sourceId — which tenant's row wins?",
    noSrcMarker === "neither" || pageNoSrc === null,
    pageNoSrc === null
      ? "Returns null (safe — defaults to source_id='default' which has no such slug)"
      : `Returns tenant ${noSrcMarker}'s page (LEAK: would expose other-tenant content if caller forgets to pass sourceId)`,
  );

  // ── Probe 5: listPages() with no scope — federated list? ────────────────
  log("leak-probe", "Probe 5: listPages with no scope (admin-style enumeration)");
  if (typeof engine.listPages === "function") {
    try {
      const listAll = await engine.listPages({});
      const listA = await engine.listPages({ sourceId: TENANT_A });
      const listB = await engine.listPages({ sourceId: TENANT_B });
      const allCount = Array.isArray(listAll) ? listAll.length : (listAll?.pages?.length ?? -1);
      const aCount = Array.isArray(listA) ? listA.length : (listA?.pages?.length ?? -1);
      const bCount = Array.isArray(listB) ? listB.length : (listB?.pages?.length ?? -1);
      log("leak-probe", "listPages counts", { unscoped: allCount, tenantA: aCount, tenantB: bCount });
      verdict(
        "PROBE 5: listPages scope behavior",
        aCount >= 1 && bCount >= 1,
        `unscoped=${allCount} A=${aCount} B=${bCount}. ${allCount > aCount + bCount ? "Includes other sources (default + seed)" : ""}`,
      );
    } catch (err: any) {
      log("error", "listPages threw", { message: err?.message });
      verdict("PROBE 5: listPages scope behavior", false, `threw: ${err?.message}`);
    }
  } else {
    log("leak-probe", "listPages not present on engine — skipping");
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  log("cleanup", "DELETE FROM sources WHERE id IN (...) — cascades pages + chunks");
  await engine.executeRaw(`DELETE FROM sources WHERE id = ANY($1::text[])`, [[TENANT_A, TENANT_B]]);
  log("cleanup", "engine.disconnect()");
  await engine.disconnect();
  log("setup", "Spike 010 complete");

  const totalMs = Date.now() - t0;
  const allPass = verdicts.every((v) => v.outcome === "PASS");

  const outPath = join(__dirname, "spike-events.json");
  writeFileSync(outPath, JSON.stringify({
    spike: "010",
    finishedAt: new Date().toISOString(),
    totalMs,
    allPass,
    verdicts,
    events,
  }, null, 2));
  log("setup", `Event log written to ${outPath}`);

  console.log(`\nFINAL VERDICT: ${allPass ? "VALIDATED ✓" : "PARTIAL ⚠"} (${verdicts.filter((v) => v.outcome === "PASS").length}/${verdicts.length} probes passed)`);
  for (const v of verdicts) {
    console.log(`  ${v.outcome === "PASS" ? "✓" : "✗"} ${v.probe}`);
    console.log(`      ${v.detail}`);
  }
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  log("error", "FATAL", { name: err?.name, message: err?.message });
  console.error(err);
  process.exit(1);
});
