---
phase: 7
slug: quickbooks-online-ingest
status: draft
shadcn_initialized: true
preset: base-nova
created: 2026-05-26
---

# Phase 7 — UI Design Contract

> Visual and interaction contract for the QuickBooks Online ingest UI surfaces:
> empty-state connect callout, sticky reconnect banner, `/connections/quickbooks`
> status page, sync-progress screen, re-sync confirmation modal, and disconnect
> confirmation modal.
>
> **Scope discipline:** This phase adds connector-management UI within the
> existing authenticated dashboard shell. Every new surface reuses the established
> shadcn `base-nova` / `neutral` token set, the centered-card layout from
> Phase 6, and the `<JobProgress>` component from Phase 5. No new design system,
> no new brand identity.

---

## Design System

| Property | Value | Source |
|----------|-------|--------|
| Tool | shadcn (already initialized — `components.json` present) | inherit-06 |
| Preset | `base-nova` style, `neutral` base color, CSS variables on | inherit-06 |
| Component library | radix (shadcn `base-nova` under the hood) | inherit-06 |
| Icon library | lucide-react | inherit-06 |
| Font | Geist (`next/font/google`, `--font-sans`) — set in `app/layout.tsx`; do not change | inherit-06 |

**Detected from codebase — do not re-specify.** The app ships
`components/ui/`: `button.tsx`, `card.tsx`, `input.tsx`, `badge.tsx`,
`skeleton.tsx`, `scroll-area.tsx`. Color tokens are oklch CSS variables in
`app/globals.css`. No third-party registries are configured (`"registries": {}`
in `components.json`).

**New shadcn component required for this phase:** `alert-dialog` — used for the
re-sync and disconnect confirmation modals. Install via
`bunx shadcn@latest add alert-dialog` (official registry; no vetting gate
required).

---

## Screens In Scope

| Screen | Route | States | Source |
|--------|-------|--------|--------|
| Empty-state Connect-QBO callout | `/dash/<slug>` (within existing page) | single state — shown only when tenant has zero `qbo-*.md` files; hidden once connected | D-10, QBO-01 |
| Sticky reconnect banner | `/dash/<slug>` (within existing layout) | single state — rendered by `DashLayout` when `qbo_connection_status = 'revoked'` | D-09, QBO-05 |
| QuickBooks connections page | `/connections/quickbooks` | `connected` / `revoked` / `none` connection status; `re-syncing` (button spinner) | D-10, QBO-01, QBO-05 |
| Sync-progress screen | `/dash/<slug>/sync` (or equivalent post-callback route — exact route name at planner discretion) | `queued` → `running` (5 phases) → `done` → `error` — delegated to existing `<JobProgress>` | D-07, QBO-04 |
| Re-sync confirmation modal | Inline on `/connections/quickbooks` | `idle` → `confirming` (modal open) → `confirmed` (submit + close) | D-08, SPEC req 5 |
| Disconnect confirmation modal | Inline on `/connections/quickbooks` | `idle` → `confirming` (modal open) → `confirmed` (submit + close) | D-09, SPEC req 8 |

**Layout contract for the sync-progress screen:** reuse the centered-card
pattern verbatim —
`<main className="min-h-screen flex items-center justify-center bg-background px-4 py-12">`
wrapping `<div className="w-full max-w-md mx-auto space-y-4">` with a single
shadcn `Card`. This matches `app/sign-in/page.tsx` and `app/onboard/page.tsx`.

**Layout contract for `/connections/quickbooks`:** standard page container
`<main className="max-w-2xl mx-auto px-4 py-8 space-y-6">` — same horizontal
constraint as the dashboard's insight-cards region, no new grid system.

---

## Spacing Scale

Inherited verbatim from Phase 6 — do not re-specify.

| Token | Value | Usage | Source |
|-------|-------|-------|--------|
| xs | 4px | `space-y-1` — inline metadata gaps (e.g. last-synced timestamp label-to-value) | inherit-06 |
| sm | 8px | `space-y-2` — compact intra-card spacing, button-to-button gap | inherit-06 |
| md | 16px | `space-y-4` — default: section content spacing, `px-4` page gutter | inherit-06 |
| lg | 24px | `space-y-6` — page-level vertical rhythm (`/connections/quickbooks`) | inherit-06 |
| xl | 32px | `px-8` — large-CTA horizontal padding | inherit-06 |
| 2xl | 48px | `py-12` page-block vertical padding (sync-progress screen) | inherit-06 |
| 3xl | 64px | Reserved — not used by this phase | inherit-06 |

**Exceptions:** The sticky reconnect banner uses `px-4 py-3` (12px vertical) —
a compact stripe height distinct from card padding. This is the only Phase-7
exception to the 8-point scale; 12px is still a multiple of 4.

---

## Typography

Inherited verbatim from Phase 6. Exactly 4 roles, 2 declared weights.

| Role | Size | Weight | Line Height | Tailwind | Source |
|------|------|--------|-------------|----------|--------|
| Display | 36px | 700 (bold) | 1.2 | `text-4xl font-bold tracking-tight` | inherit-06 (landing `<h1>` only — not used by Phase 7 screens) |
| Heading | 20px | 600 (semibold) | 1.2 | shadcn `CardTitle` — page headings and modal titles | inherit-06 |
| Body | 16px | 400 (regular) | 1.5 | `CardDescription`, status copy, banner text (`text-base`) | inherit-06 |
| Label | 14px | 500 (medium) | 1.5 | `text-sm font-medium` — metadata labels (Last synced, Status), button labels, badge text | inherit-06 |

**Weight rule:** regular (400) and semibold (600) are the two declared weights.
Label `font-medium` (500) is a pre-existing shadcn convention carried forward.
Do not introduce any additional weight.

---

## Color

Inherited verbatim from Phase 6 (`base-nova` / `neutral` oklch token set in
`app/globals.css`). Light mode is the only theme this phase ships.

| Role | Token | Usage | Source |
|------|-------|-------|--------|
| Dominant (60%) | `--background` `oklch(1 0 0)` (white) | Page background (`bg-background`) | inherit-06 |
| Secondary (30%) | `--card` `oklch(1 0 0)` + `--muted` `oklch(0.97 0 0)` | Card surfaces, `text-muted-foreground` secondary copy, `/connections/quickbooks` page container | inherit-06 |
| Accent (10%) | `--primary` `oklch(0.205 0 0)` (near-black) | Primary buttons only — see reserved list | inherit-06 |
| Destructive | `--destructive` `oklch(0.577 0.245 27.325)` | Disconnect button (`variant="destructive"`); destructive action copy in modals | phase-7 |
| Warning (banner only) | `bg-yellow-50 border border-yellow-200 text-yellow-900` | Sticky reconnect banner stripe — the only surface in the app using this treatment | phase-7 |

**Accent (`--primary`) reserved for:**
1. "Connect QuickBooks" primary CTA on the empty-state callout (dashboard)
2. "Connect QuickBooks" primary CTA on `/connections/quickbooks` (status: `none` / `revoked`)
3. "Reconnect" CTA inside the sticky reconnect banner

**Destructive (`--destructive`) reserved for:**
1. "Disconnect" button on `/connections/quickbooks` (`variant="destructive"`)
2. Destructive-confirm modal body copy ("This will replace…" / "Disconnect QuickBooks?")

**Warning (yellow tint) reserved for:** the sticky reconnect banner stripe only.
Use `bg-yellow-50 border-b border-yellow-200 text-yellow-900` for the full-width
banner `<div>` at the top of `DashLayout`. Do not use yellow anywhere else.

**Error styling:** reuse the existing inline-error treatment from
`components/onboard/error-banner.tsx` —
`bg-red-50 border border-red-200 text-red-900 p-4 rounded-md` — for any
request-level failure on `/connections/quickbooks` (e.g. disconnect API call
fails). The `<JobProgress>` component's own error state is already styled
correctly; do not override it.

---

## Component Inventory

All from `components/ui/` (shadcn `base-nova`) unless noted.

| UI element | Component | Props / Notes | Source |
|------------|-----------|---------------|--------|
| Connect-QBO empty-state callout | `Card`, `CardContent` | Reuse `PnlCard`'s "No P&L data yet" visual treatment: `<div className="text-sm text-muted-foreground">` for body copy + full-width `Button variant="default"` CTA below. No icon illustration. | inherit-06 + phase-7 |
| Sticky reconnect banner | Plain `<div>` (not a `Card`) | `flex items-center justify-between px-4 py-3 bg-yellow-50 border-b border-yellow-200 text-yellow-900 text-sm`. Contains banner text (left) + `Button variant="outline" size="sm"` "Reconnect" CTA (right). Inserted into `DashLayout` header region immediately below the `<header>`. | phase-7 |
| `/connections/quickbooks` status card | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent` | Displays status badge + last-synced metadata | inherit-06 |
| Connection status badge | `Badge variant="secondary"` (connected) / `Badge variant="outline"` (revoked) / `Badge variant="outline"` (not connected) | Text: "Connected" / "Reconnect required" / "Not connected". Green text for connected: `className="text-green-600"` on the Badge text node only — do not override Badge background. | phase-7 |
| Primary CTA (connect / reconnect) | `Button variant="default"` | Full-width (`className="w-full"`) on empty-state callout; standard width on `/connections/quickbooks` | inherit-06 |
| Re-sync button | `Button variant="outline"` | Standard width; disabled + spinner while `re-syncing` state | phase-7 |
| Disconnect button | `Button variant="destructive"` | Standard width; only shown when `qbo_connection_status = 'connected'` | phase-7 |
| Re-sync confirmation modal | `AlertDialog`, `AlertDialogTrigger`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogFooter`, `AlertDialogCancel`, `AlertDialogAction` | **New: `bunx shadcn@latest add alert-dialog`** (official registry). AlertDialogAction inherits destructive styling via `buttonVariants({ variant: "destructive" })`. | phase-7 |
| Disconnect confirmation modal | Same `AlertDialog` set | Same component; different copy. | phase-7 |
| Last-synced metadata | Plain `<p className="text-sm text-muted-foreground">` | Format: "Last synced: March 4, 2026 at 2:14 PM" — date-fns `format` or `Intl.DateTimeFormat`. Show "Never synced" if `qbo_last_synced_at` is null. | phase-7 |
| Sync-progress screen | `<JobProgress>` component (reuse as-is) | Pass `jobId` + `allStages` matching QBO ingest phases (see Interaction Contract). Wrap in centered-card page layout. Pass `onViewResults` callback that redirects to `/dash/<slug>`. | inherit-05 |
| Loading spinner in buttons | `Loader2` from lucide-react + `animate-spin` | Matches `<JobProgress>` and existing button-loading pattern in `app/onboard/page.tsx` | inherit-06 |
| Error banner (request failure) | `ErrorBanner` from `components/onboard/error-banner.tsx` | Used for disconnect / resync API failures on `/connections/quickbooks` | inherit-06 |

**New components to create** (consistent with `components/` folder conventions):
- `components/connections/reconnect-banner.tsx` — client component, the sticky
  yellow banner rendered by `DashLayout` when `qbo_connection_status = 'revoked'`.
- `components/connections/qbo-empty-callout.tsx` — server-renderable island,
  the conditional empty-state card section on `app/dash/[id]/page.tsx`.

---

## Interaction Contract

### Empty-state Connect-QBO callout (`/dash/<slug>`)

- Rendered by `DashPage` (server component) when `stat` on
  `brainHome(slug)/brain-repo/originals/` returns no `qbo-*.md` files. Placed
  above `<InsightCardsRow>`.
- Single state: `Card` with heading "Connect your QuickBooks" + one-sentence
  body + full-width "Connect QuickBooks" `Button variant="default"`.
- Button is an `<a href="/connections/quickbooks">` navigation link (no AJAX),
  not a form submit — it takes the user to the connections page to initiate
  OAuth. Rationale: the connect flow involves an Intuit redirect; the button
  must not appear to submit data.
- Once any `qbo-*.md` file exists, this callout is not rendered — no loading
  state required (server-side stat at render time).

### Sticky reconnect banner (`DashLayout`)

- `DashLayout` reads `qbo_connection_status` from the session-resolved tenant
  row. If `= 'revoked'`, render the yellow banner `<div>` immediately below the
  existing `<header>` (sign-out row).
- Banner text (left): "Your QuickBooks connection needs attention."
- Banner CTA (right): `Button variant="outline" size="sm"` label "Reconnect" —
  navigates to `/connections/quickbooks` (standard `<a>` link, no AJAX).
- The banner is sticky at the top of the viewport content area — it is not
  absolutely positioned; it stays in normal document flow below the header.
- If `qbo_connection_status` is `null` or `'connected'`, the banner is not
  rendered. No toggle or dismiss affordance — it disappears automatically when
  the user reconnects and the page re-renders.

### `/connections/quickbooks` page (three connection states)

**State: `none`** (user has never connected)
- Card with title "QuickBooks" + `Badge variant="outline"` "Not connected".
- Body: one-sentence explanation (see Copywriting).
- Full-width `Button variant="default"` "Connect QuickBooks".
- No last-synced line, no Disconnect button.

**State: `connected`**
- Card with title "QuickBooks" + `Badge variant="secondary" className="text-green-600"` "Connected".
- Last-synced line: `<p className="text-sm text-muted-foreground">Last synced: {formatted date}</p>`.
- Two buttons (side by side, `flex gap-2`):
  - `Button variant="outline"` "Re-sync from QuickBooks" — opens the re-sync
    confirmation modal (`AlertDialog`).
  - `Button variant="destructive"` "Disconnect" — opens the disconnect
    confirmation modal (`AlertDialog`).
- If a re-sync is in progress: "Re-sync" button shows `Loader2` spinner +
  disabled; "Disconnect" button also disabled.

**State: `revoked`**
- Card with title "QuickBooks" + `Badge variant="outline"` "Reconnect required".
- Body: one-sentence explanation (see Copywriting).
- Last-synced line (if previously synced): shown as above.
- `Button variant="default"` "Reconnect QuickBooks" — initiates OAuth flow.
- `Button variant="destructive" variant="outline"` "Remove connection" —
  opens disconnect confirmation modal. (Destructive styling applies because this
  wipes the stored credentials; use `variant="destructive"` per the color
  contract.)

### Re-sync confirmation modal (`AlertDialog`)

- Trigger: clicking "Re-sync from QuickBooks" on `/connections/quickbooks`.
- Modal content:
  - Title (AlertDialogTitle): "Replace QuickBooks data?"
  - Body (AlertDialogDescription): "This will delete and re-import the last 12 months of data from QuickBooks. Your other brain data — including manually added files — is not affected."
  - Cancel (AlertDialogCancel): "Cancel" — closes modal, no action.
  - Confirm (AlertDialogAction with `buttonVariants({ variant: "destructive" })`):
    "Yes, re-sync" — closes modal, calls `POST /api/connections/quickbooks/resync`,
    transitions "Re-sync" button to loading/disabled state.
- No "destructive" copy overrides beyond what the AlertDialog defaults provide.

### Disconnect confirmation modal (`AlertDialog`)

- Trigger: clicking "Disconnect" (or "Remove connection") on
  `/connections/quickbooks`.
- Modal content:
  - Title (AlertDialogTitle): "Disconnect QuickBooks?"
  - Body (AlertDialogDescription): "Your existing QuickBooks data stays in your brain — it is not deleted. Re-sync any time after reconnecting to refresh it."
  - Cancel (AlertDialogCancel): "Cancel" — closes modal, no action.
  - Confirm (AlertDialogAction with `buttonVariants({ variant: "destructive" })`):
    "Disconnect" — closes modal, calls `POST /api/connections/quickbooks/disconnect`,
    transitions page to `none` state after success.

### Sync-progress screen (`/dash/<slug>/sync`)

- Centered-card layout (see Screens In Scope).
- `<JobProgress>` component rendered with:
  - `jobId`: the Inngest job ID returned from the OAuth callback redirect.
  - `allStages`: custom QBO-specific stage list (see below).
  - `onViewResults`: callback that does `router.push('/dash/<slug>')`.
  - `title`: "Syncing your QuickBooks…" (shown in the running/queued `CardTitle`).
- **QBO stage list** (passed as `allStages`):

  ```ts
  const QBO_STAGES = [
    { id: "connecting",  label: "Connecting to QuickBooks…" },
    { id: "vendors",     label: "Fetching vendors" },
    { id: "invoices",    label: "Fetching invoices and bills" },
    { id: "writing",     label: "Writing brain documents…" },
    { id: "indexing",    label: "Indexing for search…" },
  ]
  ```

  The terminal "Sync complete" message is the `done` state rendered natively by
  `<JobProgress>` (CardTitle turns green "Ready"). The executor may change the
  green "Ready" copy to "Sync complete" via the `title` prop or by adjusting
  the `done` render — planner's discretion. The stage IDs must match the values
  the Inngest job emits via `updateProgress`.

- Error state: `<JobProgress>` renders `<ErrorBanner>` automatically. No extra
  error UI needed on this screen.

---

## Copywriting Contract

| Element | Copy | Source |
|---------|------|--------|
| Primary CTA — empty-state callout | **Connect QuickBooks** | phase-7 |
| Primary CTA — `/connections/quickbooks` (state: none) | **Connect QuickBooks** | phase-7 |
| Primary CTA — `/connections/quickbooks` (state: revoked) | **Reconnect QuickBooks** | phase-7 |
| Empty-state callout heading | **Connect your QuickBooks** | phase-7 |
| Empty-state callout body | Connect your QuickBooks account to see insights powered by your real business data. | phase-7 |
| Sticky reconnect banner text | **Your QuickBooks connection needs attention.** | phase-7 |
| Sticky reconnect banner CTA | **Reconnect** | phase-7 |
| `/connections/quickbooks` card title | **QuickBooks** | phase-7 |
| Status badge — connected | **Connected** | phase-7 |
| Status badge — revoked | **Reconnect required** | phase-7 |
| Status badge — none | **Not connected** | phase-7 |
| `/connections/quickbooks` body (state: none) | Connect your QuickBooks Online account to import invoices, vendors, and transactions into your brain. | phase-7 |
| `/connections/quickbooks` body (state: revoked) | Your QuickBooks connection was revoked. Reconnect to resume syncing your data. | phase-7 |
| Last-synced label | Last synced: {date at time} | phase-7 |
| Last-synced — never | **Never synced** | phase-7 |
| Re-sync button label | **Re-sync from QuickBooks** | phase-7 |
| Re-sync button — in progress | Re-syncing… | phase-7 |
| Disconnect button label | **Disconnect** | phase-7 |
| Remove connection (revoked state) | **Remove connection** | phase-7 |
| Sync-progress screen card title (running) | **Syncing your QuickBooks…** | phase-7 |
| Sync-progress done state | **Sync complete** (override `<JobProgress>` "Ready" label via `title` prop or done-state adjustment — planner discretion) | phase-7 |
| View results button (post-sync) | **View results** (existing `<JobProgress>` `onViewResults` button copy — do not change) | inherit-05 |
| Re-sync confirmation modal title | **Replace QuickBooks data?** | phase-7 |
| Re-sync confirmation modal body | This will delete and re-import the last 12 months of data from QuickBooks. Your other brain data — including manually added files — is not affected. | phase-7 |
| Re-sync confirmation cancel | **Cancel** | shadcn |
| Re-sync confirmation confirm | **Yes, re-sync** | phase-7 |
| Disconnect confirmation modal title | **Disconnect QuickBooks?** | phase-7 |
| Disconnect confirmation modal body | Your existing QuickBooks data stays in your brain — it is not deleted. Re-sync any time after reconnecting to refresh it. | phase-7 |
| Disconnect confirmation cancel | **Cancel** | shadcn |
| Disconnect confirmation confirm | **Disconnect** | phase-7 |
| Error state — connect/resync/disconnect API failure (banner) | We couldn't complete that action. Check your connection and try again. | phase-7 |
| Error state — sync job failed (via `<JobProgress>`) | Something went wrong while we were setting things up. (existing `<ErrorBanner>` copy in `<JobProgress>` — do not change) | inherit-05 |
| 409 connector_revoked — insights/chat inline | Not shown as a UI element in this phase — the revoked state surfaces via the dashboard banner and connections page only. The 409 response is an API contract consumed by the frontend; no separate toast or inline copy is required. | phase-7 |

**Tone:** same as Phase 6 — plain, calm, non-technical (SMB-owner audience).
Never expose "OAuth", "realm", "token", "API", or "Inngest" in user-facing copy.
"QuickBooks" is always capitalized exactly as shown (Intuit brand requirement).
Avoid "sync" as a noun in prominent headings; prefer "connection" as the object
the user manages.

---

## Accessibility Contract

Inherited from Phase 6. Phase-7-specific additions:

- The sticky reconnect banner `<div>` must include `role="alert"` so screen
  readers announce it when it appears after a page navigation.
- The `AlertDialog` (shadcn/Radix) is focus-trapped and keyboard-dismissible
  by default — do not override these behaviors.
- The "Re-sync" and "Disconnect" buttons in loading/disabled states must retain
  accessible names (`aria-label` or visible text label change, not
  `aria-label=""` or `aria-hidden`).
- The `<JobProgress>` component already manages `aria-live` regions — no
  additional live-region work required for the sync-progress screen.
- Color is never the sole signal — the "Connected" status is expressed both by
  badge text and green-tinted label text, not green color alone. The banner is
  expressed by both yellow background and explicit text ("needs attention").

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | `alert-dialog` (new), `card`, `button`, `badge`, `skeleton` (all others already installed) | not required — official registry |

`components.json` declares `"registries": {}` — no third-party registries are
configured. No third-party blocks are used by this phase. The registry vetting
gate is **not applicable**.

**`alert-dialog` install command:** `bunx shadcn@latest add alert-dialog`
(official registry; runs synchronously; no network vetting required).

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
