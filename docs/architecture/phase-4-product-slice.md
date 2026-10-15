# Phase 4 — Initial product slice (historical baseline, superseded)

This report records the earlier receiving-first product slice and is retained for implementation history. For the current multi-workflow WMS, role-specific workspaces, camera scanning, shipment reads, and current live-mode limits, use `wms-workflow-completion-status.md`.

## What the original product slice delivered

Sign in; see the **Floor** (where work sits across states, needs-attention list, latest activity, by-operation chart);
**Receive** stock by scanning (barcode or item number, repeat scan increments, optional lot and purchase order), review,
submit, and watch the real status until it is Completed or fails; browse **Transactions** with a status filter; search
**Items**; and (administrators) watch the **Integration** monitor. Light/dark, desktop rail and mobile bottom navigation,
installable-ready layout (manifest and service worker are not built yet, see limitations).

## How it behaves (and why)

- **Nothing is "received" until Business Central says so.** Submit returns 202 = "stored in BC staging". The timeline reads
  *Receipt completed, document X* only when status is Completed. Failed, Requires Reconciliation and Partially Completed are
  shown as such with plain-language explanations; raw BC/AL text never reaches the screen.
- **Retries are safe.** Each receipt has a client key created once and kept in `sessionStorage` with the draft. A reload,
  lost response or "Check and submit again" re-sends the same key; the server turns it into the same transaction. The same
  key with different contents is rejected as a conflict. Keys are namespaced per user and never stored raw.
- **The browser asks, the server decides.** Location comes from the session's assignments, user ID from the session, item and
  quantity are validated, every route enforces permission + CSRF + Origin. Warehouse scope is injected into BC queries.
- **Few BC calls.** Dashboard is one cached, shared read per scope per 30 s; transaction polling backs off (1.5 s growing to 8 s)
  and stops at a final status; item search is debounced; lists are paginated (latest 100).
- **Shared devices.** Sign-out clears the draft, query cache and CSRF state; a draft from another user is discarded.
- **Accessibility.** Status is text + icon (never colour alone); the queue ribbon has a text alternative; keyboard focus ring;
  live regions announce scans and status; touch targets >= 44 px; reduced-motion respected; CSS breakpoints (no layout flash).

## Verification

| Check | Result |
|---|---|
| `tsc --noEmit`, `eslint .`, `next build` | clean |
| Unit/integration tests (`npm test`) | 123 passing |
| Browser end-to-end (`npm run e2e`, Playwright/Chromium, mock mode) | 24/24 passing |

The browser run covers: auth redirect; wrong-password message; sign-in; scan by barcode and by number; repeat-scan increment;
blocked and unknown items; draft survives reload; submit -> timeline -> Completed with a document number; new receipt resets;
CSRF and out-of-scope-location rejections; Transactions, Items, Floor ribbon, Integration monitor; dark mode; sign-out clears
the draft; mobile bottom nav, no horizontal scroll, >= 44 px primary action; no unexpected console errors or 404s.
To run it: start `npm run dev` with `WMS_BC_MODE=mock`. A session secret is generated for local mock development if blank, and demo role credentials are seeded automatically, then
`BASE=http://localhost:3000 PW=<path to playwright> npm run e2e`.

Defects the browser run found and fixed this round: route handlers each got their own gateway/mock/metrics instance (now
process-wide singletons); transaction and item select lists referenced fields missing from the registry; the mock could not
evaluate an unquoted-GUID filter; mobile layout depended on a JS media query (now CSS); line-row layout and pluralisation.

## Historical limits at the time of this baseline

1. **Receiving is not complete in live mode.** The AL `Receipt` operation has no real handler yet: against Business Central a
   submitted receipt is saved and then **fails visibly** with `OPERATION_NOT_IMPLEMENTED`. In mock mode a development worker
   simulates a handler so the whole flow can be exercised. The real handler (purchase order / warehouse receipt posting through
   standard BC routines, lot/serial, over/under-receipt rules) is the next AL piece and depends on the customer's BC version and
   warehouse setup (basic vs directed put-away and pick).
2. The purchase order number is recorded but **not validated against BC**; there is no expected-vs-received comparison yet.
3. Offline: scanning continues and the draft survives a reload, but submission is blocked offline. There is no offline
   transaction queue, no service worker, no web app manifest or install prompt yet.
4. Camera scanning is not built (keyboard-wedge scanners work). The scan field is the single integration point.
5. The Floor dashboard summarises the latest 100 transactions per scope, not full counts, and labels itself accordingly. Stock,
   bin and put-away figures need the BC inventory/bin read APIs (Phase 3b AL) and are not shown.
6. User identities, passwords, role templates, permissions, user-role assignments and warehouse assignments are managed in Business Central. An administrator sets the initial password from the Business Central WMS Users page. The WMS calls the published `VWMSAuth_Login` ODataV4 action; password hashes are not returned by or writable through `authUsers`. There is no WMS-side password reset form or terminal provisioning command.
7. Everything above was verified against the **mock** Business Central only; the AL extension has still not been compiled.
