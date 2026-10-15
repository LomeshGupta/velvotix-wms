# Phase 3 — Business Central AL Foundation (status report)

**Status: written, NOT compiled.** No AL compiler was available where this was produced. A static cross-reference check
(`python3 tools/al-static-check.py`) confirms: 48 objects, unique IDs inside 50100-50249, every referenced object exists,
every record-field reference resolves. That is not a substitute for compiling. Treat the first compile as the real test.

## Assumptions to confirm (these decide whether the code compiles unchanged)

| Assumption | Where | If wrong |
|---|---|---|
| BC 26 / runtime 15 (namespaced base app) | `app.json`, `using Microsoft.Inventory.Location/Item;` in tables | Change versions or remove/adjust `using` lines |
| Object ID range 50100-50199 (tests 50200-50249) | `app.json`, all objects | Renumber to the range assigned for the customer/licence |
| Table `Web Service` and its fields (`Object Type`, `Object ID`, `Service Name`, `Published`) | `VWMSInstall` | Adjust, or register `VWMSWorker` manually on the Web Services page |
| Error classification texts/codes | `VWMSProcessor.IsTransient` | Tune from observed errors; default is permanent (no retry loops) |
| Page `OnInsertRecord` + `exit(false)` after `Insert(true)` on a DelayedInsert API page with a deep-insert `lines` part | `VWMSTransactionsAPI` | If the platform rejects it, move submission to a bound `submit` action |
| Enum values appear OData-escaped (`Requires_x0020_Reconciliation`, `Put_x002D_away`) | API pages | The web tier must map them (see follow-ups) |

## Object inventory (Phase 3 slice)

| Type | Objects |
|---|---|
| Tables | 50100 Setup, 50101 Staging Header, 50102 Staging Line, 50103 Transaction Log (append-only), 50104 User, 50105 User Warehouse, 50106 User Permission (legacy direct grants), 50107 Session, 50108 Role, 50109 Role Permission, 50110 User Role |
| Enums | 50100 Transaction Status, 50101 Operation Type (implements handler interface), 50102 Error Class, 50103 Process Result, 50104 User Status |
| Interface | `VWMS Operation Handler` |
| Codeunits | 50100 Transaction Mgt (state machine), 50101 Authorization, 50102 Processor, 50103 Handler Diagnostic, 50104 Handler Not Implemented, 50105 Install, 50106 Worker API (web service `VWMSWorker`), 50108 Process Runner |
| Admin pages | 50100 Setup Card, 50101 User List, 50102 User Warehouses, 50103 User Permissions, 50104 Transaction List, 50105 Transaction Log, 50106 Role List, 50107 Role Permissions, 50108 User Roles |
| API pages (`velvotix/wms/v1.0`) | 50110 transactions (+ deep-insert `lines`), 50111 transactionLines, 50112 transactionLogs, 50113 authUsers, 50114 userWarehouses, 50115 userPermissions, 50116 sessions, 50117 roles, 50118 rolePermissions, 50119 userRoles |
| Permission sets | 50100 VWMS ADMIN, 50101 VWMS INTEGRATION (service principal), 50102 VWMS READ |
| Tests (`al-test/`) | 50200 Transaction Tests (15 tests) |

**Not yet built** (from the Phase 1 inventory): user bin assignments, warehouse configuration, device/scanner configuration, task/package/pick-batch/count/replenishment/QC tables, dead-letter page (Failed rows are the dead letter for now), job-queue entry for retention purge, upgrade codeunit, real operation handlers (Phase 4).

## State machine

`Draft -> Submitted -> (Queued) -> Processing -> Completed | Failed | Queued (transient retry) | Awaiting Approval | Requires Reconciliation`;
`Failed` and `Requires Reconciliation` can be returned to `Queued` by an administrator; `Completed` and `Cancelled` are terminal.
Every change goes through `SetStatus`, which rejects illegal transitions and appends to the immutable log.

## Guarantees implemented

- **Durable journal:** a transaction (with lines, via deep insert) is one DB transaction; the worker cannot see a header without its lines.
- **Idempotency:** unique key on `Idempotency Key` plus an explicit check that raises `VWMS_DUPLICATE`.
- **No double claim:** `LockTable` around claim; second worker gets nothing (tested).
- **Atomic outcome:** handler work and the final status write commit together; only the `Process Started` marker commits earlier.
- **Handler errors roll back:** handlers run under `Codeunit.Run`; an error undoes their writes and is recorded as a failure.
- **No silent success:** operations without a real handler fail permanently with `OPERATION_NOT_IMPLEMENTED`. Only `Diagnostic` completes, and it posts nothing.
- **Abandoned work:** expired lease + handler never started -> requeued; handler had started -> `Requires Reconciliation`, never blindly retried.
- **Poison messages:** transient failures back off 5s doubling to 5 min, then `Failed/MAX_ATTEMPTS` after `Max Attempts`.
- **BC-managed identity and RBAC:** users are stored in `VWMS User`; administrators maintain role templates (`VWMS Role` + `VWMS Role Permission`) and assign them through `VWMS User Role`. The WMS server resolves enabled-role permissions from BC; AL independently checks direct grants plus enabled assigned-role grants. Existing per-user permission rows remain supported as compatibility grants.
- **AL-side authorization:** active user, warehouse assignment (empty = none) and `transactions:submit` re-checked on submit; cancel and admin actions re-check permissions.
- **Audit:** log is append-only (modify/delete raise errors). Raw AL error text goes only to the log; the header holds a sanitised message.
- **Passwords:** Credentials are administered and verified inside AL through the published `VWMSAuth_Login` action. Password hashes and salts are not exposed in `authUsers`; that API is read-only user metadata only.

## Worker API (web service `VWMSWorker`, unbound actions)

`ClaimBatch(workerId, leaseSeconds, maxCount)` -> JSON array; `ProcessTransaction(transactionId, workerId)` -> JSON outcome;
`Heartbeat(transactionId, workerId, leaseSeconds)` -> Boolean; `CancelTransaction(transactionId, userId)`;
`ResolveTransaction(transactionId, action[retry|complete|fail], userId, resultDocumentNo, note)`.

## Build, publish, verify (sandbox only)

1. Open `al/` in VS Code with the AL Language extension, download symbols for the target BC version, fix any compile findings (see assumptions).
2. Publish `al/` then `al-test/` to a sandbox. Assign `VWMS INTEGRATION` to the Entra app registration's user; `VWMS ADMIN` to administrators.
3. Open **WMS Setup**, enable WMS. Create a role in **WMS Roles**, add its `module:action` permissions, create an active WMS User, assign the role through the user’s **Roles** action, and assign one or more warehouse locations. Direct per-user permissions remain available for compatibility, but role templates are preferred.
4. Run the AL tests from the Test Tool (codeunit 50200). Expect 15 passing.
5. Smoke test the API: POST a `Diagnostic` transaction, call `VWMSWorker_ClaimBatch` then `VWMSWorker_ProcessTransaction`, confirm `Completed` with `DIAG-n`.

## Web tier wiring (done, tested against the mock only)

The Next.js side now speaks this contract. Verified by `tests/unit` (111 tests, including `al-contract.test.ts`, which
parses the AL sources and fails if an entity, field, patchable field, action name, parameter name or return type drifts):

- **Duplicates:** a rejected `VWMS_DUPLICATE` submission is reconciled by idempotency key and returned as `duplicate: true`.
  The AL error text is read only server-side to detect the marker; it is never logged or forwarded.
- **Worker actions:** registry operations `worker.*` call `ODataV4/VWMSWorker_<Action>?Company=<name>`; parameters are checked
  against the declared names/types before any request.
- **BC-backed identity:** `BcUserDirectory` (authUsers + userWarehouses + userPermissions), `BcSessionStore` (sessions),
  `BcStagingRepository` (worker actions). Live mode uses these; mock mode keeps in-process stand-ins.
- **BC specifics handled:** upper-cased Code fields (permissions lower-cased, hashes compared case-insensitively), OData-escaped
  enum names (encoded in filters/bodies, decoded in results), PATCH with `If-Match: *`, `null` to clear `lockedUntil`.
- **Worker process:** `npm run worker` (`src/lib/queue/worker-main.ts`): lease-based claim, graceful SIGTERM drain, jittered polling,
  fails fast on bad config. AL is the authority on outcomes; the worker only observes them.
- **Staleness bounds:** session records cached 15 s, user profiles 30 s and the role catalog (enabled roles and role permissions) 30 s. Changes to a user's role assignment take effect after the profile cache expires; role disablement or permission-template changes take effect after the role catalog and profile caches expire. Revocation on the serving instance is immediate.

## Still unverified (needs a real sandbox)

1. AL compiles and the 15 AL tests pass. 2. The exact `$filter` syntax BC accepts for enum fields (the web tier sends the
quoted, escaped name, e.g. `status eq 'Requires_x0020_Reconciliation'`). 3. Unbound action URL shape and parameter-name casing
(`?Company=` form, as used by the earlier reference app). 4. That `PATCH` with `If-Match: *` and `null` DateTime are accepted by
the API pages. 5. The response envelope for Text/Boolean actions (`{"value": ...}`). 6. Real latency: every authenticated request
costs one BC read on a cache miss (3 for profiles), so measure cache hit ratios before sizing.

## Operational notes

- An idle worker polls BC every `WMS_WORKER_POLL_MS` (default 2 s) per worker. Keep worker count small, or raise the interval.
- Worker calls use the scheduler's *background* lane (`WMS_BC_MAX_BACKGROUND`, default 1). Raise it, within your measured BC budget,
  to process transactions in parallel.
- Administrators set the initial WMS password on the Business Central WMS Users page. There is no WMS-side reset-password form or CLI. The extension automatically registers `VWMSAuth` and `VWMSWorker` ODataV4 services during install and upgrade.
