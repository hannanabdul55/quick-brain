#!/usr/bin/env bash
# DATA-09 / DATA-11: build the seed brain end-to-end.
#
# Produces brains/seed/ containing:
#   - `gbrain init` defaults (PGLite, balanced search mode)
#   - models.default = sonnet
#   - imported Mara's Coffee synthetic data (companies, people, originals)
#   - completed embeddings
#   - anomaly-detection concept pages (data/maras-coffee/concepts/*.md)
#
# Idempotent: removes any existing brains/seed/ first.
# Exits non-zero if any step fails so CI / smoke gates catch regressions.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${REPO_ROOT}/data/maras-coffee"
BRAIN_HOME="${REPO_ROOT}/brains/seed"

export GBRAIN_HOME="${BRAIN_HOME}"
export CI=1

log() { printf "\033[36m[seed]\033[0m %s\n" "$1"; }

if ! command -v gbrain >/dev/null 2>&1; then
  echo "gbrain CLI not on PATH; aborting. Run scripts/demo-check.sh first." >&2
  exit 1
fi

if [ -z "${OPENAI_API_KEY:-}" ] || [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "OPENAI_API_KEY and ANTHROPIC_API_KEY must both be set; aborting." >&2
  exit 1
fi

log "Wiping ${BRAIN_HOME} for a clean rebuild"
rm -rf "${BRAIN_HOME}"
mkdir -p "${BRAIN_HOME}"

log "Generating templated fixtures (invoices, bank statements, monthly closes)"
bun "${REPO_ROOT}/scripts/generate-fixtures.ts"

log "Running anomaly detector (writes data/maras-coffee/concepts/*.md)"
bun "${REPO_ROOT}/scripts/detect-anomalies.ts"

log "gbrain init"
gbrain init --yes

log "gbrain config set models.default sonnet"
gbrain config set models.default sonnet

log "gbrain import ${DATA_DIR} (no embed)"
gbrain import "${DATA_DIR}" --no-embed

log "gbrain embed --stale"
gbrain embed --stale

if gbrain --help 2>&1 | grep -q "orphans"; then
  log "gbrain orphans (sanity check, output saved to /tmp/qb-orphans.log)"
  gbrain orphans >/tmp/qb-orphans.log 2>&1 || log "orphans returned non-zero — continuing"
fi

log "Seed brain ready at ${BRAIN_HOME}"
log "Smoke gate: try"
log "  GBRAIN_HOME=${BRAIN_HOME} gbrain graph-query beanstalk-roasters --depth 2"
log "  GBRAIN_HOME=${BRAIN_HOME} gbrain query \"what was weird about last month?\""
