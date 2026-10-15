# Velvotix WMS — production readiness and remaining delivery gates

This document separates work present in the supplied Phase 4 baseline from work that cannot be claimed complete without implementation and verification against the customer's Business Central sandbox.

## Added in this delivery

- PWA manifest with WMS branding and scalable SVG icons.
- Production-only service-worker registration.
- Static asset caching only. The service worker explicitly excludes `/api/*`, navigation responses, and authenticated/transaction data to avoid leaking data across shared warehouse devices.

## Verified from the supplied baseline

- `python3 tools/al-static-check.py`: 39 AL objects, 39 files, 0 static cross-reference errors.
- The existing Phase 4 status document reports that the browser workflow was tested against mock BC only; it also explicitly says the AL extension has not been compiled.

## Blocking production gates

1. **Target BC environment:** confirm Business Central version, cloud/on-prem deployment, company, object ID range, and each warehouse location's basic versus directed put-away-and-pick setup.
2. **AL compile and sandbox install:** download symbols for the exact target version, compile `al/` and `al-test/`, fix compiler findings, publish to a non-production sandbox, and run the AL test suite.
3. **Real operation handlers:** `Receipt`, `Put-away`, `Movement`, `Pick`, `Pack`, `Ship`, `Cycle Count`, `Adjustment`, and `Return` currently use the not-implemented default handler. They must call the correct standard BC validation, registration, or posting routines. A mock success is not evidence of live completion.
4. **Warehouse API surface:** confirm and implement bin contents, warehouse documents, tracking, tasks, counts, QC holds, replenishment, package, and shipping APIs against the target BC symbols and configuration.
5. **Identity and administration:** user/role/permission and warehouse assignments are managed in Business Central; the WMS password reset screen and first-admin provisioning command are implemented. Before production, complete self-service password changes and enforce `mustChangePassword`, finalize device policy and support/recovery screens, and verify AL-side scope checks for every critical action.
6. **Offline capture:** the service worker added here caches static assets only. Offline transaction capture/synchronization with conflict resolution remains a separate feature and must not cache sensitive BC data.
7. **Hardware and integrations:** camera/barcode behavior, label printers, scales, carrier APIs, and proof-of-delivery require target devices and vendor credentials.
8. **Validation:** run unit, integration, AL, browser, security, duplicate/lost-response, and load tests at 200/250/300 concurrent users against mock and sandbox. Do not advertise a capacity figure until measured.

## Current acceptance rule

A transaction is successful only when BC returns a `Completed` status and a resulting document reference. HTTP 202 means accepted into staging, not posted or registered. If the worker reports a failed, partially completed, or reconciliation-required outcome, the UI must preserve that state and provide a controlled recovery path.
