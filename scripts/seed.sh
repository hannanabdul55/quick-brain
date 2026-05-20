#!/usr/bin/env bash
# DATA-09 / DATA-11: build the seed brain end-to-end.
#
# Phase 2: Supabase mode — set SUPABASE_DB_URL_DIRECT to seed against Postgres.
# Without SUPABASE_DB_URL_DIRECT, seed runs in local PGLite mode (development).
#
# Postgres mode (SUPABASE_DB_URL_DIRECT is set):
#   - Skips `gbrain init` (Postgres schema is managed by gbrain migrate)
#   - Routes import + extract + embed through the direct connection (port 5432)
#   - Import is idempotent on page slug (re-import is safe)
#   - NOTE: gbrain has no bulk `pages delete --all` command. For a full clean
#     reseed on Postgres, manually truncate the Supabase tables:
#       DELETE FROM pages; DELETE FROM content_chunks; DELETE FROM links;
#     Then re-run this script. For incremental updates, just re-run (idempotent).
#
# PGLite mode (SUPABASE_DB_URL_DIRECT is unset):
#   - Original behavior: rm -rf brains/seed && gbrain init (creates fresh PGLite)
#
# Produces brains/seed/ containing:
#   - `gbrain init` defaults (PGLite mode only)
#   - models.default = sonnet
#   - imported Mara's Coffee synthetic data (companies, people, originals)
#   - completed embeddings
#   - anomaly-detection concept pages (data/maras-coffee/concepts/*.md)
#
# Idempotent in Postgres mode (re-import is safe on duplicate slugs).
# In PGLite mode: removes any existing brains/seed/ first.
# Exits non-zero if any step fails so CI / smoke gates catch regressions.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${REPO_ROOT}/data/maras-coffee"
BRAIN_HOME="${REPO_ROOT}/brains/seed"
CONFIG_JSON="${BRAIN_HOME}/.gbrain/config.json"

export GBRAIN_HOME="${BRAIN_HOME}"
export CI=1

log() { printf "\033[36m[seed]\033[0m %s\n" "$1"; }

if ! command -v gbrain >/dev/null 2>&1; then
  echo "gbrain CLI not on PATH; aborting. Run scripts/demo-check.sh first." >&2
  exit 1
fi

if [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "OPENAI_API_KEY must be set (embeddings require it); aborting." >&2
  exit 1
fi
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "⚠ ANTHROPIC_API_KEY unset — proceeding. Embeddings + import + smb-audit skill will succeed;" >&2
  echo "  any 'gbrain query' call returns the placeholder until you add the key to ~/.zshenv." >&2
fi

log "Generating templated fixtures (invoices, bank statements, monthly closes)"
bun "${REPO_ROOT}/scripts/generate-fixtures.ts"

log "Running smb-audit skill (writes concepts/*.md)"
# Direct-bun invocation: skill runs before gbrain init, so the shell-job path
# (which requires an initialized brain at GBRAIN_HOME) cannot be used here.
# GBRAIN_HOME is overridden to DATA_DIR so the skill writes concept pages where
# the seed insight parser reads from (data/maras-coffee/concepts/).
GBRAIN_HOME="${DATA_DIR}" bun "${REPO_ROOT}/skills/smb-audit/scripts/smb-audit.mjs"

if [ ! -f "${DATA_DIR}/concepts/march-anomaly-summary.md" ]; then
  echo "[seed] ERROR: smb-audit skill did not write concepts/march-anomaly-summary.md" >&2
  exit 1
fi

# ── Mode switch: Postgres vs PGLite ─────────────────────────────────────────
if [ -n "${SUPABASE_DB_URL_DIRECT:-}" ]; then
  # ── Postgres mode ──────────────────────────────────────────────────────────
  log "Postgres mode: SUPABASE_DB_URL_DIRECT is set — skipping gbrain init"
  log "  Using direct connection (port 5432) for import + extract + embed"
  export GBRAIN_DATABASE_URL="${SUPABASE_DB_URL_DIRECT}"

  # Ensure brain dir + .gbrain/ exist (gbrain needs them to read config.json)
  mkdir -p "${BRAIN_HOME}/.gbrain"

  # Check if brain is already on Postgres; if not, run migration first.
  if [ -f "${CONFIG_JSON}" ]; then
    current_engine="$(node -e "const c=require('${CONFIG_JSON}'); process.stdout.write(c.engine || '')" 2>/dev/null || echo "")"
    if [ "${current_engine}" != "postgres" ]; then
      log "Brain config shows engine=${current_engine}; running migration to Supabase first..."
      bash "${REPO_ROOT}/scripts/migrate-to-supabase.sh"
    else
      log "Brain already on Postgres engine."
    fi
  else
    log "No config.json found — brain not yet initialized."
    log "Run scripts/migrate-to-supabase.sh first, or gbrain init + migrate."
    log "Proceeding with import (gbrain will connect via GBRAIN_DATABASE_URL)."
  fi

  log "gbrain config set models.default sonnet"
  gbrain config set models.default sonnet

  log "gbrain import ${DATA_DIR} (no embed)"
  gbrain import "${DATA_DIR}" --no-embed

  log "gbrain extract all --source db (wikilinks + timeline → graph edges)"
  gbrain extract all --source db

  log "gbrain embed --stale"
  gbrain embed --stale

  if gbrain --help 2>&1 | grep -q "orphans"; then
    log "gbrain orphans (sanity check, output saved to /tmp/qb-orphans.log)"
    gbrain orphans >/tmp/qb-orphans.log 2>&1 || log "orphans returned non-zero — continuing"
  fi

  log "Indexing skill-written concept pages into brain"
  gbrain import "${DATA_DIR}/concepts/" --no-embed
  gbrain embed --stale

  # Re-sanitize config.json: guard against any gbrain operation re-writing database_url.
  if [ -f "${CONFIG_JSON}" ]; then
    node -e "
      const fs = require('fs');
      const config = JSON.parse(fs.readFileSync('${CONFIG_JSON}', 'utf8'));
      if (config.database_url) {
        delete config.database_url;
        fs.writeFileSync('${CONFIG_JSON}', JSON.stringify(config, null, 2) + '\n');
        process.stdout.write('[seed] Sanitized config.json (removed database_url)\n');
      }
    "
  fi

  log "Seed brain ready at ${BRAIN_HOME} (Postgres / Supabase mode)"
  log "Smoke gate: try"
  log "  GBRAIN_HOME=${BRAIN_HOME} GBRAIN_DATABASE_URL=\"\$SUPABASE_DB_URL_POOLER\" gbrain query \"what was weird about last month?\""

else
  # ── PGLite mode (original behavior) ───────────────────────────────────────
  log "PGLite mode: SUPABASE_DB_URL_DIRECT is unset — using local PGLite brain"

  log "Wiping ${BRAIN_HOME} for a clean rebuild"
  rm -rf "${BRAIN_HOME}"
  mkdir -p "${BRAIN_HOME}"

  log "gbrain init"
  gbrain init --yes

  log "gbrain config set models.default sonnet"
  gbrain config set models.default sonnet

  log "gbrain import ${DATA_DIR} (no embed)"
  gbrain import "${DATA_DIR}" --no-embed

  log "gbrain extract all --source db (wikilinks + timeline → graph edges)"
  gbrain extract all --source db

  log "gbrain embed --stale"
  gbrain embed --stale

  if gbrain --help 2>&1 | grep -q "orphans"; then
    log "gbrain orphans (sanity check, output saved to /tmp/qb-orphans.log)"
    gbrain orphans >/tmp/qb-orphans.log 2>&1 || log "orphans returned non-zero — continuing"
  fi

  log "Indexing skill-written concept pages into brain"
  gbrain import "${DATA_DIR}/concepts/" --no-embed
  gbrain embed --stale

  log "Seed brain ready at ${BRAIN_HOME}"
  log "Smoke gate: try"
  log "  GBRAIN_HOME=${BRAIN_HOME} gbrain graph-query beanstalk-roasters --depth 2"
  log "  GBRAIN_HOME=${BRAIN_HOME} gbrain query \"what was weird about last month?\""
fi
