# Velvotix WMS

Warehouse management for Microsoft Dynamics 365 Business Central (Next.js + AL extension). Phase 2: integration foundation only.

```bash
cp .env.example .env.local     # WMS_BC_MODE=mock works locally; blank session secret is generated for local development
# Demo logins work by default in development mock mode (listed on the sign-in screen).
# Optional: set WMS_MOCK_ADMIN_PASSWORD to override the demo admin password.
npm install
npm test && npm run typecheck && npm run lint
npm run dev          # web tier (sessions reset on restart if the local fallback secret is used)
npm run worker       # separate long-running worker process (live mode)
```

Mock demo credentials are for local development only: `admin / MockAdmin!2026`, `manager / Manager!2026`, `receiver / Operator!2026`, `picker / Operator!2026`, `shipper / Operator!2026`, `auditor / Auditor!2026`. Do not expose these accounts on a network or use them in live mode. Mock mode is disabled in production; live mode reads users and effective roles from Business Central.

For repeatable local sessions, set `WMS_SESSION_SECRET` to a unique random value of at least 32 characters. Live/production mode always requires an explicit secret.

Docs: `docs/architecture/` (phase 2 foundation, phase 4 product slice) and `docs/business-central/phase-3-al-foundation.md`. AL sources in `al/`, AL tests in `al-test/`. `npm test` (unit), `npm run e2e` (browser, see phase-4 doc).

## Current workflow implementation status

See `docs/architecture/wms-workflow-completion-status.md` for the current role-specific workspaces, scanner/shipment capabilities, configuration, and live-mode gaps. The app includes receiving, put-away, inventory movement, cycle counting, adjustments, picking, packing, shipping, returns, quality inspection, item lookup, transaction audit, and integration monitoring. Business Central remains the source of users, roles, permissions, warehouse assignments, and inventory truth. In live mode, any operation without a native AL handler fails visibly rather than falsely reporting a stock posting; see the status document before production rollout.


### Connecting to your Business Central sandbox

1. Set `WMS_BC_MODE=live` in `.env.local` and replace the tenant ID, client ID, and client secret with the real Entra app values.
2. Set `BC_ENV_NAME` to the exact sandbox environment name and set `BC_COMPANY_NAME` to the exact company name. You can leave `BC_COMPANY_ID` blank; the WMS resolves the canonical GUID from the authenticated companies API.
3. In Business Central, register the Entra application and assign `VWMS INTEGRATION`; publish/upgrade the WMS extension to version `0.1.2.0` so the upgrade codeunit publishes `VWMSAuth` and `VWMSWorker`.
4. Run `npm run check:bc` to check token acquisition, company resolution, the `authUsers` custom API, and ODataV4 service metadata. This diagnostic does not sign in as a WMS user or post inventory.
5. In **WMS Setup**, enable WMS. Create and activate a user under **WMS Users**, set its password in Business Central, then assign roles and warehouse access.

Local development generates a temporary session secret if omitted; a full server restart rotates it and invalidates old sessions. Production requires a stable `WMS_SESSION_SECRET` of at least 32 characters.

## WMS user passwords and Business Central APIs

WMS users, credentials, roles, permissions and warehouse assignments are managed in Business Central. Use **WMS Setup → WMS Users → Set Password** to set the initial WMS password; WMS never reads or writes password hashes. The extension publishes `VWMSAuth` and `VWMSWorker` ODataV4 services automatically on install/upgrade via `Web Service Management`. See `docs/security/user-password-management.md`.
