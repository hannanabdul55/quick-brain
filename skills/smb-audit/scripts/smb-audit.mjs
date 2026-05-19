#!/usr/bin/env node
// skills/smb-audit/scripts/smb-audit.mjs
//
// smb-audit gbrain skill entry point. Pure ESM (.mjs), top-level await.
//
// Environment:
//   GBRAIN_HOME (required) — path to the tenant brain directory.
//
// Exits 0 on success, 1 on any error.

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

// --- GBRAIN_HOME validation (T-04-03 mitigation) ---
const gbBrainHome = process.env["GBRAIN_HOME"];
if (!gbBrainHome) {
  process.stderr.write(
    "[smb-audit] ERROR: GBRAIN_HOME environment variable is not set.\n" +
    "  Set it to the tenant brain directory, e.g.:\n" +
    "    GBRAIN_HOME=brains/seed bun skills/smb-audit/scripts/smb-audit.mjs\n"
  );
  process.exit(1);
}

// Dynamically import runDetection from the lib (resolved relative to repo root)
// Using dynamic import so the module is resolved at runtime from the .mjs entry point.
const { runDetection } = await import(
  resolve(REPO_ROOT, "lib", "audit", "index.ts")
);

try {
  await runDetection(gbBrainHome);
  process.stdout.write("[smb-audit] Detection complete\n");
  process.exit(0);
} catch (err) {
  process.stderr.write(
    `[smb-audit] ERROR: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
}
