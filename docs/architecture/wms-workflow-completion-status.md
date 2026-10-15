# Velvotix WMS — Workflow, role and Business Central integration status

## Design source of truth

Business Central owns the WMS user directory, enabled role catalogue, user-to-role assignments, role permissions, direct per-user permission overrides retained for compatibility, and user-to-warehouse assignments. The web client never sends its own user ID or role as an authorization source. The server derives a principal from the validated session, resolves effective permissions using enabled BC roles, and checks the assigned warehouse on every workflow/API request.

## Separate role-specific workspaces

The shell filters navigation by effective permissions, and each route separately enforces its required permission, including when opened by direct URL. The control tower chooses a role-sensitive title and shows only the workspaces permitted to that principal. Available workspaces are Receiving, Put-away, Items/Inventory lookup, Movements, Cycle Count, Adjustments, Picking, Packing, Shipping, Returns, Quality Inspection, Transactions/Audit, and Integration Monitor. A role can intentionally have more than one workspace when it has multiple permissions; no display-name check is used as authorization.

The current seeded mock role examples are:

| Role | Typical workspaces | Access intent |
|---|---|---|
| WMS Administrator | Control tower, operational modules, integration monitor | All demo operational permissions; administration |
| Warehouse Manager | Control tower, operational modules, integration monitor | Supervisory access across assigned warehouses |
| Receiving Operator | Receiving and put-away | Inbound execution on MAIN |
| Picking Operator | Picking and movement | Outbound preparation on MAIN/EAST |
| Shipping Operator | Packing and shipping | Dispatch execution on EAST |
| WMS Auditor | Read-only items, dashboard and transaction audit | No write/submit permissions |

Mock credentials are development-only and must not be used in production. Live login, role assignments, role enablement and effective permission resolution come from Business Central tables `VWMS User`, `VWMS Role`, `VWMS User Role`, `VWMS Role Permission`, and the warehouse assignment records.

## Workflow surfaces implemented in the web tier

| Workspace | Current capability | Live integration boundary |
|---|---|---|
| Receiving | Scan item/GTIN, quantity, optional tracking data, submit/reconcile staged transaction | Real BC receipt creation/registration handler remains unimplemented |
| Put-away | Scan item, set destination bin, submit idempotent work | Real BC put-away document/action handler remains unimplemented |
| Inventory movement | Source bin, destination bin, optional destination warehouse; warehouse scope checks | Real BC movement worksheet/activity registration or equivalent base routine remains unimplemented |
| Picking | Select a released BC warehouse shipment and its actual lines; scan each item against quantity to ship | Does not create/register BC warehouse picks yet |
| Packing | Shipment-linked line/quantity verification | Does not create/register packages, handling units or carrier records yet |
| Shipping | Shipment-linked scan verification before staged request | Does not invoke standard BC warehouse shipment posting or post the sales shipment yet |
| Cycle count | Capture counted quantities as a staged operation | Does not create/register BC physical inventory journals or warehouse physical inventory records yet |
| Adjustments | Reason-coded, staged correction request | Does not post item journals or warehouse item journals yet |
| Returns | Capture source document/reason and scanned items | Does not create/post a BC return order, return receipt or credit memo yet |
| Quality inspection | Capture PASS/HOLD/REJECT inspection outcome | Does not update a BC quality/lot status extension unless implemented in the customer's app |
| Transactions | Idempotent submission, status history/reconciliation/error visibility | BC staging/status API; posting outcome depends on operation handler |
| Integration Monitor | Operational and worker visibility for integration issues | Health depends on environment and configured telemetry/worker setup |

## Shipment source and scanner behavior

Two read-only AL API pages expose standard BC `Warehouse Shipment Header` and `Warehouse Shipment Line` records. The shipment queue is restricted to the signed-in user's assigned location and released status. The web tier reads shipment lines, including line number, item, bin, quantity to ship, quantity picked and source reference. On the pick/pack/ship screens, the operator selects a real BC shipment and scans only items on its lines; over-scanning and completing with a quantity mismatch are blocked by the UI. The server still validates user role and warehouse scope before accepting the staged operation.

The scanner accepts barcode text from keyboard-wedge Bluetooth/USB scanners or manual input on all supported browsers. The camera scan dialog uses the browser's native `BarcodeDetector` with a rear-facing camera on secure contexts (HTTPS or localhost) and filters requested barcode formats against the formats reported by the browser. Camera decoding support therefore depends on browser/device support; it should be tested on the target handheld devices. A browser without native barcode decoding can still use manual entry or a keyboard-wedge scanner. No unsupported camera decoder is silently claimed.

## Transaction safety and Business Central calls

- Staged requests include a user-scoped idempotency key, canonical payload fingerprint, correlation ID and line-level data; replays with changed payloads are rejected.
- The server checks both the required effective role permission and source/destination warehouse assignment.
- Reads use an allow-listed endpoint/field registry, bounded `$top`, controlled filters and warehouse scoping. Outbound shipment APIs are read-only; the standard BC warehouse posting pipeline remains authoritative.
- The mock worker simulates workflow completion only in development mock mode; that does not change stock in a BC tenant.
- In live mode, operation types whose AL handler is not implemented return `OPERATION_NOT_IMPLEMENTED` with a permanent failure. This deliberately prevents a staged request from being falsely reported as a real inventory posting.

## Required implementation to call this production-ready

The next integration phase must implement and compile AL handlers using standard BC routines for each operation, with the customer's BC version and warehouse setup confirmed (basic vs. directed put-away and pick, bins, tracking, reservations, shipment posting rules and installed extensions). At minimum:

1. Receipt: validate purchase order/warehouse receipt, expected vs. scanned quantities, lot/serial/expiration, over/under receipt policy; create/register through standard BC routines.
2. Put-away and Movement: validate source/destination bins and inventory availability; create/perform the native warehouse activity/document and register the movement through BC.
3. Pick, Pack and Ship: create/register native warehouse picks; persist package/handling-unit and carrier data; invoke native warehouse shipment posting only after the scan manifest and quantities validate.
4. Cycle Count and Adjustments: use the supported BC physical inventory and item/warehouse journal workflow with approval, reason, posting preview and audit trail where configured.
5. Returns and Quality: map outcomes to the customer's return order/receipt and quality/lot-status implementation, with permissions and audit history.
6. Add test coverage against a sandbox tenant (including concurrency and idempotent retry), AL compilation against the target BC symbols, and browser verification on the actual handheld devices.

Until those native handlers are implemented and tenant-tested, this package is a workflow/integration foundation with mock-mode end-to-end simulation, not a production-ready warehouse posting engine. It is preferable to a fake green status or direct ledger manipulation.
