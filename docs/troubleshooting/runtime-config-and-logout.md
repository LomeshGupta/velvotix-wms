# WMS local configuration and logout troubleshooting

## Local mock mode

Use mock mode only for local development. In `.env.local`:

```env
WMS_BC_MODE=mock
WMS_SESSION_SECRET=PASTE_A_RANDOM_SECRET_OF_AT_LEAST_32_CHARACTERS
```

Generate a value with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

In mock mode, BC tenant/client/company values are not used by the mock data layer. Invalid/blank UUID placeholders are ignored by the config loader. Do not use mock mode in production.

## Live Business Central mode

Set `WMS_BC_MODE=live` and provide actual values for `BC_TENANT_ID`, `BC_CLIENT_ID`, `BC_CLIENT_SECRET`, `BC_COMPANY_ID`, `BC_COMPANY_NAME`, and `BC_ENV_NAME`, plus `WMS_SESSION_SECRET`.

`BC_COMPANY_ID` must be the GUID returned as the `id` field by Business Central's `companies` API. Do not use the company display name or a URL-encoded company name. `WMS_SESSION_SECRET` must be a stable, randomly generated value of at least 32 characters and must remain the same across app instances and restarts.

Never put credentials or secrets in `NEXT_PUBLIC_*` variables or commit `.env.local`.

## `sessionSecret` missing or invalid

If the app is in live mode, add a stable `WMS_SESSION_SECRET` in `.env.local`. After changing the environment, restart `npm run dev`, then sign in again. Changing the secret invalidates CSRF tokens and sessions signed with the previous value.

## `companyId: Invalid UUID`

Check `BC_COMPANY_ID`. It must look like a UUID, e.g. `aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee` (example format only, not a real company). Find the actual ID in the Business Central `GET .../api/v2.0/companies` response.

## Logout `Request could not be verified`

The logout endpoint requires a same-origin browser request and revokes the server session associated with the session cookie when the server store/configuration is available. It can clear the browser cookie even if server-side revocation is unavailable, but returns a service error in that case. The UI still clears local state and avoids an unhandled promise rejection. If server revocation cannot be confirmed, fix the configuration and sign in again; do not assume a server-side session was revoked until the endpoint succeeds.
