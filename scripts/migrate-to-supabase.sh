#!/usr/bin/env bash
# migrate-to-supabase.sh
#
# Idempotent migration script: moves the seed brain from PGLite to Supabase
# Postgres (or confirms it is already there) and sanitizes config.json.
#
# Usage:
#   set -a && . ./.env.local && set +a  # load env vars first
#   bash scripts/migrate-to-supabase.sh
#
# Phase 2: Supabase mode — requires SUPABASE_DB_URL_DIRECT (port 5432) for
# migration DDL. Runtime queries use SUPABASE_DB_URL_POOLER (port 6543).
#
# ROLLBACK: restore PGLite
#   export GBRAIN_HOME="$(pwd)/brains/seed"
#   export GBRAIN_DATABASE_URL="$SUPABASE_DB_URL_DIRECT"
#   gbrain migrate --to pglite --force
#   # Then re-sanitize config.json (it will show engine:pglite after rollback)
#   # The PGLite backup is preserved at brains/seed/.gbrain/brain.pglite
#   # (gbrain preserve the original .pglite file as a backup during migration)
#   #
#   # To verify rollback worked:
#   #   GBRAIN_HOME="$(pwd)/brains/seed" gbrain list -n 2

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRAIN_HOME="${REPO_ROOT}/brains/seed"
CONFIG_JSON="${BRAIN_HOME}/.gbrain/config.json"

log()  { printf "\033[36m[migrate]\033[0m %s\n" "$1"; }
warn() { printf "\033[33m[migrate WARN]\033[0m %s\n" "$1"; }
die()  { printf "\033[31m[migrate ERROR]\033[0m %s\n" "$1" >&2; exit 1; }

# ── Credential guard ────────────────────────────────────────────────────────
if [ -z "${SUPABASE_DB_URL_DIRECT:-}" ]; then
  die "SUPABASE_DB_URL_DIRECT is not set. Source .env.local first:"
  die "  set -a && . ./.env.local && set +a"
fi

if [ -z "${SUPABASE_DB_URL_POOLER:-}" ]; then
  warn "SUPABASE_DB_URL_POOLER is not set. Runtime queries will not use the pooler."
fi

export GBRAIN_HOME="${BRAIN_HOME}"
export PATH="$HOME/.bun/bin:$PATH"

# ── Idempotency check ───────────────────────────────────────────────────────
if [ -f "${CONFIG_JSON}" ]; then
  current_engine="$(node -e "const c=require('${CONFIG_JSON}'); process.stdout.write(c.engine || '')"  2>/dev/null || echo "")"
  if [ "${current_engine}" = "postgres" ]; then
    log "Brain is already on Postgres engine. Skipping migration."
    log "Re-sanitizing config.json (defense-in-depth — strips database_url if present)."
    node -e "
      const fs = require('fs');
      const config = JSON.parse(fs.readFileSync('${CONFIG_JSON}', 'utf8'));
      delete config.database_url;
      fs.writeFileSync('${CONFIG_JSON}', JSON.stringify(config, null, 2) + '\n');
    "
    log "config.json OK: \$(cat '${CONFIG_JSON}')"
    log "Run 'GBRAIN_DATABASE_URL=\"\$SUPABASE_DB_URL_DIRECT\" gbrain doctor' to verify."
    exit 0
  fi
fi

# ── Migration ───────────────────────────────────────────────────────────────
log "Migrating seed brain from PGLite to Supabase Postgres..."
log "  Source: ${BRAIN_HOME}/.gbrain/brain.pglite"
log "  Target: SUPABASE_DB_URL_DIRECT (port 5432)"

# Use --force only if target already has data (from a prior spike or partial run).
# First try without --force; if target is non-empty, retry with --force.
if ! gbrain migrate --to supabase --url "${SUPABASE_DB_URL_DIRECT}" 2>&1; then
  log "Target may be non-empty (e.g., leftover spike data). Retrying with --force..."
  gbrain migrate --to supabase --url "${SUPABASE_DB_URL_DIRECT}" --force
fi

log "Migration complete."

# ── Sanitize config.json ────────────────────────────────────────────────────
# gbrain writes database_url (with password) into config.json after migration.
# Strip it immediately so it never persists on disk in plaintext.
# gbrain reads the connection string from GBRAIN_DATABASE_URL env var at runtime
# (verified in gbrain/src/core/config.ts: env var takes precedence over file).
log "Sanitizing config.json — removing database_url field..."
node -e "
  const fs = require('fs');
  const config = JSON.parse(fs.readFileSync('${CONFIG_JSON}', 'utf8'));
  if (config.database_url) {
    delete config.database_url;
    fs.writeFileSync('${CONFIG_JSON}', JSON.stringify(config, null, 2) + '\n');
    process.stdout.write('Sanitized: removed database_url\n');
  } else {
    process.stdout.write('No database_url found — already clean\n');
  }
"

# ── Health check ────────────────────────────────────────────────────────────
log "Running gbrain doctor to verify migration health..."
GBRAIN_DATABASE_URL="${SUPABASE_DB_URL_DIRECT}" gbrain doctor 2>&1 | \
  grep -E "(\[OK\]|\[WARN\]|\[FAIL\]|Health score)"

log ""
log "Migration complete. Seed brain is now on Supabase Postgres."
log "Runtime queries route through the pooler (SUPABASE_DB_URL_POOLER, port 6543)."
log "The pooler is injected via GBRAIN_DATABASE_URL in lib/gbrain/client.ts."
log ""
log "────────────────────────────────────────────────"
log "ROLLBACK INSTRUCTIONS (to restore PGLite):"
log "────────────────────────────────────────────────"
log ""
log "  export GBRAIN_HOME=\"\$(pwd)/brains/seed\""
log "  export GBRAIN_DATABASE_URL=\"\$SUPABASE_DB_URL_DIRECT\""
log "  gbrain migrate --to pglite --force"
log ""
log "  The PGLite backup is at brains/seed/.gbrain/brain.pglite"
log "  (gbrain preserves the original file during migration)."
log ""
log "  To verify the rollback worked:"
log "    GBRAIN_HOME=\"\$(pwd)/brains/seed\" gbrain list -n 2"
log ""
log "  Note: After rollback, config.json will show engine:pglite."
log "  To return to Postgres: re-run this script."
