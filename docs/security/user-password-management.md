# WMS user credentials are managed in Business Central

## Source of truth

User IDs, account status, password hash/salt/iteration metadata, roles, direct permissions, and warehouse assignments are maintained in Business Central. Passwords are stored in `VWMS User` (table 50104), not in the standard Business Central employee/user sign-in records. Plaintext passwords are never saved.

## Set the initial WMS password

1. Open **WMS Setup → WMS Users** in Business Central.
2. Create the WMS user, set the status to **Active**, assign roles and warehouse access.
3. Use the **Set Password** action from that page. Enter and confirm a password of at least 12 characters.
4. The `VWMS Authentication API` codeunit hashes the password inside Business Central and saves only the hash, salt and iteration metadata in `VWMS User`.
5. The user signs in to Velvotix WMS with the WMS User ID and password.

There is no WMS-side password-reset form or password-provisioning CLI. WMS only forwards submitted credentials from its server to the published `VWMSAuth_Login` ODataV4 action over HTTPS. Business Central performs password verification and updates failed-login/lockout metadata. Password hashes and salts are not exposed through the `authUsers` read-only API.

## API publishing

The extension registers `VWMSAuth` and `VWMSWorker` ODataV4 codeunit services during install and upgrade by calling `Codeunit "Web Service Management".CreateTenantWebService`. The custom API pages (`/api/velvotix/wms/v1.0/...`) are exposed as extension API pages and do not need a separate Web Services list registration. No assisted-login or connection button is required in the WMS UI.

## Security note

The login endpoint stores a salted iterative SHA-512 digest generated and verified inside AL, instead of copying the Sales App sample's reversible Base64 password comparison. This is a custom WMS credential mechanism, not a Microsoft Entra user credential. Restrict permission to **WMS Users**, **Set Password**, and the `VWMSAuth` service to trusted administrators and the integration application. A modern, standard password KDF supported by the Business Central runtime should be preferred if available in the target BC version; validate hashing performance and security before production rollout.
