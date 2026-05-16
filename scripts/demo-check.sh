#!/usr/bin/env bash
# HARN-02 (relaxed per CONTEXT.md spec adjustment): pre-flight check before seeding or running the demo.
# Exits non-zero if any of these are missing/broken:
#   - `gbrain` CLI on PATH and reports a version
#   - `gbrain doctor --fast` passes
#   - OPENAI_API_KEY is set (gbrain needs it for embeddings + hybrid search)
#   - ./brains/ is writable
# Warns (does NOT fail) if:
#   - ANTHROPIC_API_KEY is missing — query synthesis returns placeholder, but
#     embeddings + graph + import + anomaly detector all still work. Add the
#     key to ~/.zshenv when credits arrive and the warning silently disappears.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRAINS_DIR="${REPO_ROOT}/brains"
FAIL=0

red()    { printf "\033[31m%s\033[0m\n" "$1"; }
green()  { printf "\033[32m%s\033[0m\n" "$1"; }
yellow() { printf "\033[33m%s\033[0m\n" "$1"; }

echo "QuickBrain demo-check"
echo "  repo: ${REPO_ROOT}"
echo

# 1. gbrain on PATH + version
if command -v gbrain >/dev/null 2>&1; then
  version="$(gbrain --version 2>&1 | head -n 1)"
  green "  [ok] gbrain on PATH: ${version}"
else
  red "  [FAIL] gbrain CLI not on PATH"
  red "         Install: git clone https://github.com/garrytan/gbrain.git && cd gbrain && bun install && bun link"
  FAIL=1
fi

# 2. gbrain doctor --fast
if command -v gbrain >/dev/null 2>&1; then
  if gbrain doctor --fast >/tmp/qb-doctor.log 2>&1; then
    green "  [ok] gbrain doctor --fast"
  else
    red "  [FAIL] gbrain doctor --fast (see /tmp/qb-doctor.log)"
    FAIL=1
  fi
fi

# 3. OPENAI_API_KEY
if [ -n "${OPENAI_API_KEY:-}" ]; then
  green "  [ok] OPENAI_API_KEY set (${#OPENAI_API_KEY} chars)"
else
  red   "  [FAIL] OPENAI_API_KEY is unset — required for gbrain embeddings"
  FAIL=1
fi

# 4. ANTHROPIC_API_KEY (warn-only per CONTEXT.md spec adjustment)
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  green "  [ok] ANTHROPIC_API_KEY set (${#ANTHROPIC_API_KEY} chars)"
else
  yellow "  [warn] ANTHROPIC_API_KEY missing — gbrain query synthesis will return a"
  yellow "         placeholder; embeddings + graph + import + anomaly detector still"
  yellow "         work. Add to ~/.zshenv when credits arrive — no code change needed."
fi

# 5. brains/ is writable
mkdir -p "${BRAINS_DIR}" 2>/dev/null || true
if [ -w "${BRAINS_DIR}" ]; then
  green "  [ok] ${BRAINS_DIR} is writable"
else
  red   "  [FAIL] ${BRAINS_DIR} is not writable"
  FAIL=1
fi

echo
if [ ${FAIL} -ne 0 ]; then
  red "demo-check FAILED — fix the above before running scripts/seed.sh"
  exit 1
fi

green "demo-check passed — ready to seed"
exit 0
