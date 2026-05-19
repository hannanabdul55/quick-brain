---
type: concept
title: March 2026 Anomaly Summary
date: 2026-03-31
tags: [anomaly, summary, 2026-03, weird]
anomalies:
  - severity: high
    dollar_impact: 330.00
    anomaly_type: price-hike
    vendor_slug: beanstalk-roasters
  - severity: medium
    dollar_impact: 79.00
    anomaly_type: duplicate
    vendor_slug: square-pos
  - severity: high
    dollar_impact: 43.00
    anomaly_type: ghost-saas
    vendor_slug: seven-shifts
  - severity: high
    dollar_impact: 150.00
    anomaly_type: missing-invoice
    vendor_slug: quick-clean
---

Compiled truth: This page enumerates everything weird, unusual, or unexpected detected in [[people/mara-okafor]]'s books for March 2026 (also known as "last month"). In March 2026, 4 anomalies were detected in [[people/mara-okafor]]'s books: (1) a +22.0% price hike from [[companies/beanstalk-roasters]] — spend rose from $1,500.00 to $1,830.00 (2) a duplicate $79.00 charge from [[companies/square-pos]] on 2026-03-04 and 2026-03-11 (3) a ghost recurring charge from [[companies/seven-shifts]] at $43.00/mo with no vendor activity in 126 days (4) a missing invoice for [[companies/quick-clean]] — $150.00 debit on 2026-03-15 with no invoice document on file

---

- 2026-03-01: [[companies/beanstalk-roasters]] invoices jumped from $1,500.00 in February 2026 to $1,830.00 in March 2026 — a +22.0% increase ($330.00 more this month)
- 2026-03-04: [[companies/square-pos]] charged $79.00 twice in March 2026 (on 2026-03-04 and 2026-03-11); only one charge was expected — see [[bank-statement-2026-03]]
- 2026-03-31: [[companies/seven-shifts]] billed $43.00 this month and has been billing for 3+ months, but the last meaningful vendor activity on [[companies/seven-shifts]] was 2025-11-30 (126 days ago) — likely a forgotten recurring subscription
- 2026-03-15: [[companies/quick-clean]] debited $150.00 in March 2026 with no matching invoice on file — request invoice from vendor
- 2026-03-31: [[companies/detection-method]] Detection method — month-over-month invoice totals per vendor (price-hike rule, threshold +20%); bank-statement debit deduplication within a 7-day window; recurring-charge audit against [[companies]] last-event timestamps (ghost threshold 90 days); bank-debit-without-invoice cross-reference (missing-invoice rule).
