# Brain Schema — QuickBrain Canonical Contract

**Version:** 1.0 (Phase 4)  
**Binding:** The smb-audit gbrain skill (Phase 4) consumes the Input Schema. The QBO transformer (Phase 6) must produce documents that satisfy this contract.

This document is the schema contract between:
- the **smb-audit skill** (`lib/audit/anomaly-detector.ts`) — the consumer
- the **synthetic seed data** (`data/maras-coffee/`) — the current data producer
- the **QBO transformer** (`lib/qbo/transformer.ts`, Phase 6) — the future data producer

---

## Input Schema (pages consumed by the smb-audit skill)

### Invoice documents (`originals/invoice-*.md`)

Required frontmatter fields:

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `type` | string | Must be `invoice` | `invoice` |
| `vendor` | string | Human-readable vendor name (kebab-case slug) | `beanstalk-roasters` |
| `vendor_slug` | string | Kebab-case slug matching `companies/<slug>.md` filename | `beanstalk-roasters` |
| `date` | string | `YYYY-MM-DD` format, the invoice date | `2026-03-04` |
| `amount` | number | USD amount unless `currency` specifies otherwise | `915.00` |
| `currency` | string | ISO 4217 code, default `USD` | `USD` |

**Note:** In the current synthetic seed, `vendor` and `vendor_slug` carry the same value (the kebab-case slug). Both fields must be present for QBO-sourced documents where the human-readable name and slug differ.

Body must contain a wikilink to the vendor's company page:

```markdown
[[companies/<vendor_slug>]]
```

Example invoice document:

```markdown
---
type: invoice
vendor: beanstalk-roasters
vendor_slug: beanstalk-roasters
date: 2026-03-04
amount: 915.00
currency: USD
---

Invoice from [[companies/beanstalk-roasters]] for $915.00.
```

### Bank-statement documents (`originals/bank-statement-*.md`)

Required frontmatter fields:

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Must be `bank-statement` |
| `date` | string | `YYYY-MM-DD` (statement period end date) |

**Body debit line format** used by the duplicate and missing-invoice detection rules:

```
- YYYY-MM-DD: $X.XX debit — <description> [[companies/<vendor_slug>]]
```

The regex the detector applies to body lines:

```
/^-\s+(\d{4}-\d{2}-\d{2}):\s+\$([0-9,]+\.\d{2})\s+debit\s+—.*\[\[(?:companies\/)?([a-z0-9-]+)\]\]/
```

Capture groups:
1. Transaction date (`YYYY-MM-DD`)
2. Amount (string with possible commas, e.g. `1,390.75`)
3. Vendor slug (with or without `companies/` prefix — both are accepted)

**Important:** Credit lines (revenue deposits) must use `credit` in place of `debit` — the detector ignores them:

```
- YYYY-MM-DD: $X.XX credit — <description> [[companies/<vendor_slug>]]
```

### Company documents (`companies/<slug>.md`)

Required frontmatter fields:

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | `vendor` or `company` |
| `vendor` | string | Human-readable vendor name |
| `slug` | string | Kebab-case slug; MUST match the filename without `.md` |

**Body timeline bullets** used by the ghost-saas detection rule:

```
- YYYY-MM-DD: <event description>
```

The detector finds the most recent timeline date via regex `^-\s+(\d{4}-\d{2}-\d{2}):` and computes age in days from `DEMO_TODAY` (`2026-04-05`). Vendors with age >= 90 days and >= 2 months of bank debits are flagged as ghost subscriptions.

---

## Output Schema (pages written by the smb-audit skill)

### `concepts/march-anomaly-summary.md`

**Frontmatter:**

```yaml
---
type: concept
title: March 2026 Anomaly Summary
date: YYYY-MM-31
tags: [anomaly, summary, YYYY-MM, weird]
anomalies:
  - severity: high | medium | low
    dollar_impact: <number, 2dp>
    anomaly_type: price-hike | duplicate | ghost-saas | missing-invoice
    vendor_slug: <kebab-case slug matching companies/ page>
---
```

The `anomalies:` YAML list is a structured sidecar consumed by the dashboard insight card renderer to populate severity badges and dollar impact values.

**Body bullet format** (MUST match `lib/insights/anomalies.ts` `bulletRegex`):

```
- YYYY-MM-DD: [[companies/<vendor_slug>]] <description text>
```

Regex:
```
/^- (\d{4}-\d{2}-\d{2}):\s+\[\[([^\]]+)\]\]\s+(.+?)$/
```

Filter rules applied by `computeAnomalies` (do NOT violate these):
1. Lines where `wikilinkTarget` does not start with `companies/` are skipped
2. Lines where `description` starts with `"Detection method"` are skipped
3. At least 3 anomaly rows must pass the filters (throws if fewer)

**Price-hike bullet shape** — include the parenthetical `($X.XX more this month)` to satisfy `extractDollarImpact`'s special-case parser:

```
- YYYY-MM-01: [[companies/<vendor>]] invoices jumped from $X.XX in <month> to $Y.YY in <month> — a +Z.Z% increase ($D.DD more this month)
```

### `concepts/recurring-charges.md`

**Frontmatter:**

```yaml
---
type: concept
title: Recurring Charges Audit
date: YYYY-MM-31
tags: [recurring, subscriptions, audit, saas]
---
```

**Body bullet format:**

```
- YYYY-MM-31: [[companies/<vendor_slug>]] — $X.XX in <Month YYYY>, active across N months; last meaningful vendor event YYYY-MM-DD (N days ago)[⚠ GHOST]
```

---

## Wikilink Convention

All cross-references to vendor pages MUST use the full path form:

```
[[companies/<slug>]]
```

Bare `[[slug]]` wikilinks without the `companies/` prefix:
- Are NOT matched by `computeAnomalies` (filtered at step 1 above)
- Are NOT matched by gbrain's `WIKILINK_RE` graph extractor for knowledge-graph edges

Always use `[[companies/<slug>]]` in both input (invoice bodies, bank statement lines) and output (concept page bullets).

---

## Severity Tiers

| Severity | Condition |
|----------|-----------|
| `high` | `dollar_impact > 100` OR `anomaly_type` is `ghost-saas` OR `missing-invoice` |
| `medium` | `30 <= dollar_impact <= 100` |
| `low` | `dollar_impact < 30` |

The severity tier is computed by `lib/audit/anomaly-detector.ts::severityFor()` and stored in the `anomalies:` YAML sidecar.

---

## Detection Thresholds

| Threshold | Value | Description |
|-----------|-------|-------------|
| `DEMO_TODAY` | `2026-04-05` | Pinned reference date for age calculations (prevents demo drift) |
| `GHOST_THRESHOLD_DAYS` | `90` | Minimum age (days) of last company event to flag ghost-saas |
| `PRICE_HIKE_THRESHOLD_PCT` | `20` | Minimum MoM percentage increase to flag price-hike |
| `DUPLICATE_WINDOW_DAYS` | `7` | Maximum days between two debits for same vendor+amount to be flagged duplicate |

---

## Phase 6 Binding

The QBO transformer (`lib/qbo/transformer.ts`, Phase 6) MUST emit invoice documents that satisfy the Input Schema above. Field mapping from the QuickBooks Online API:

| QBO API Field | Brain Frontmatter Field | Notes |
|---------------|------------------------|-------|
| `TxnDate` | `date` | Use `TxnDate`, NOT `MetaData.LastUpdatedTime` |
| `TotalAmt` | `amount` | Raw number, no currency symbol |
| `VendorRef.name` | `vendor` | Human-readable vendor name as returned by QBO |
| `VendorRef.name` slugified | `vendor_slug` | Lowercase, spaces → hyphens, strip special chars |
| `CurrencyRef.value` | `currency` | ISO 4217; default `USD` if absent |

**Wikilinks in QBO-sourced pages** MUST use qbo-prefixed slugs:

```
[[companies/qbo-<slug>]]
```

The QBO transformer must also create `companies/qbo-<slug>.md` pages with `type: vendor` and a `slug: qbo-<slug>` frontmatter field so the ghost-saas rule can resolve vendor timeline events.

---

## Immutability Contract

The following files are NOT modified by the smb-audit skill and MUST NOT be changed by it:

- `lib/insights/anomalies.ts` — bullet parser (bulletRegex is the canonical contract)
- `lib/insights/types.ts` — AnomalyRow shape
- Any file in `originals/` or `companies/` — these are source documents, not outputs

The skill's write surface is limited to `$GBRAIN_HOME/concepts/`.
