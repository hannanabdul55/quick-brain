#!/usr/bin/env bash
# DEMO-02: Terminal panic-reset for the QuickBrain demo.
#
# Kills the Next.js dev server and any orphaned gbrain processes, then
# wipes all tenant brain directories EXCEPT brains/seed/.
#
# DOES NOT re-run `bun run seed` — the seed brain is pre-baked.
# Operator should run `bun run dev` to restart the Next.js server afterwards.
#
# Budget: <15s, typically <5s.
#
# Usage:
#   bash scripts/panic-reset.sh
#   # or via shortcut:
#   bun run panic-reset

# NOTE: set -uo pipefail (NOT set -e) because pkill returns exit 1 when
# there are no matching processes, which is expected and must not abort the script.
set -uo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd )"

echo "[panic-reset] starting..."
T0=$(date +%s)

# 1. Kill the Next.js dev server.
pkill -9 -f "next dev" 2>/dev/null || true
pkill -9 -f "next-server" 2>/dev/null || true
echo "[panic-reset] killed next dev/next-server (if running)"

# 2. Kill orphaned gbrain spawns.
#    Two patterns: the `gbrain` binary itself and any `bun ... gbrain` invocation.
pkill -9 -f "gbrain " 2>/dev/null || true
pkill -9 -f "bun .*gbrain" 2>/dev/null || true
echo "[panic-reset] killed gbrain processes (if running)"

# 3. Wipe all tenant brain dirs EXCEPT seed. Do NOT rebuild seed.
if [ -d "$REPO_ROOT/brains" ]; then
  # Iterate immediate children only; skip "seed" and dotfiles.
  while IFS= read -r -d '' entry; do
    name="$(basename "$entry")"
    if [ "$name" != "seed" ]; then
      rm -rf "$entry"
      echo "[panic-reset] wiped brains/$name"
    fi
  done < <(find "$REPO_ROOT/brains" -mindepth 1 -maxdepth 1 -type d -print0)
else
  echo "[panic-reset] brains/ directory not found — nothing to wipe"
fi

# 4. Done. Seed is pre-baked; no `bun run seed` needed.
T1=$(date +%s)
echo "[panic-reset] complete in $((T1 - T0))s"
echo "[panic-reset] NEXT: re-run \`bun run dev\` to restart Next.js"
exit 0
