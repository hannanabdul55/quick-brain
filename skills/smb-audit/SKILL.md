---
name: smb-audit
version: 1.0.0
description: |
  Scans originals/ invoices and bank-statement debits for four SMB anomaly
  patterns: vendor price hike (>20% MoM), duplicate same-vendor charges
  within 7 days, ghost recurring subscriptions (monthly debit, no company
  event >90 days), and missing invoice (bank debit with no matching invoice
  same vendor+month). Writes findings to concepts/march-anomaly-summary.md
  and concepts/recurring-charges.md.
triggers:
  - "run smb audit"
  - "scan for anomalies"
  - "detect unusual charges"
tools:
  - read_file
  - write_file
mutating: true
---

# smb-audit gbrain Skill

Detects four SMB anomaly patterns and writes structured concept pages to the brain.

## Anomaly Rules

1. **Price hike** — vendor MoM invoice total rises >20%
2. **Duplicate charge** — same vendor + same amount, two debits within 7 days
3. **Ghost SaaS** — recurring monthly debit with no company event in >90 days
4. **Missing invoice** — bank-statement debit for a vendor with no matching invoice in the same month

## Output Pages

- `concepts/march-anomaly-summary.md` — all anomalies as bullets matching the bulletRegex consumed by the dashboard parser
- `concepts/recurring-charges.md` — recurring charge audit with ghost flags

## Invocation

### Shell-job path (preferred — Spike 003 confirmed shell-job OK on 2026-05-19)

```bash
GBRAIN_HOME=<brain-dir> \
GBRAIN_ALLOW_SHELL_JOBS=1 \
gbrain jobs submit shell \
  --params '{"cmd":"bun <repo>/skills/smb-audit/scripts/smb-audit.mjs","cwd":"<repo>"}' \
  --follow
```

The shell job exits 0 on success and prints `[smb-audit] Detection complete`.

### Direct invocation (fallback)

```bash
GBRAIN_HOME=<brain-dir> bun skills/smb-audit/scripts/smb-audit.mjs
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GBRAIN_HOME` | YES | Path to the tenant brain directory (e.g. `brains/seed`) |
| `GBRAIN_ALLOW_SHELL_JOBS` | For shell-job path | Must be `1` to enable the Minions shell-job feature |

## Brain Directory Layout

The skill reads from:
- `$GBRAIN_HOME/originals/*.md` — invoices and bank statements
- `$GBRAIN_HOME/companies/*.md` — vendor pages with event timelines

The skill writes to:
- `$GBRAIN_HOME/concepts/march-anomaly-summary.md`
- `$GBRAIN_HOME/concepts/recurring-charges.md`

## Security Notes

- The skill validates that `GBRAIN_HOME` is set before any filesystem access (T-04-03 mitigation)
- The `sourceDir` received by `runDetection` is validated to not contain path traversal sequences (T-04-01 mitigation)
- No network access; reads and writes are local filesystem only (T-04-02 accepted)
