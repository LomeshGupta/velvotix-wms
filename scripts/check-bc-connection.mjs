#!/usr/bin/env node

const apiBaseUrl = (process.env.BC_API_BASE_URL || "https://api.businesscentral.dynamics.com/v2.0").replace(/\/+$/, "");
const tenantId = (process.env.BC_TENANT_ID || "").trim();
const clientId = (process.env.BC_CLIENT_ID || "").trim();
const clientSecret = process.env.BC_CLIENT_SECRET || "";
const envName = (process.env.BC_ENV_NAME || "").trim();
const scope = process.env.BC_SCOPE || "https://api.businesscentral.dynamics.com/.default";
const companyIdInput = (process.env.BC_COMPANY_ID || "").trim();
const companyNameInput = (process.env.BC_COMPANY_NAME || "").trim();
const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const zeroGuid = "00000000-0000-0000-0000-000000000000";
const placeholderName = /^(my company|your company|company name|replace-me)$/i;

function fail(message) {
  console.error(`FAIL  ${message}`);
  process.exitCode = 1;
}
function pass(message) {
  console.log(`PASS  ${message}`);
}

async function run() {
  if ((process.env.WMS_BC_MODE || "mock").toLowerCase() !== "live") {
    fail("WMS_BC_MODE is not 'live'. Set WMS_BC_MODE=live in .env.local to check the sandbox connection.");
    return;
  }
  if (!/^https:\/\//i.test(apiBaseUrl)) fail("BC_API_BASE_URL must use HTTPS.");
  for (const [label, value] of [["BC_TENANT_ID", tenantId], ["BC_CLIENT_ID", clientId], ["BC_CLIENT_SECRET", clientSecret], ["BC_ENV_NAME", envName]]) {
    if (!value || value === zeroGuid || value === "replace-me") fail(`${label} is missing or still contains a placeholder.`);
  }
  if (tenantId && !guidPattern.test(tenantId)) fail("BC_TENANT_ID must be a tenant GUID.");
  if (clientId && !guidPattern.test(clientId)) fail("BC_CLIENT_ID must be an application/client GUID.");
  const nameIsPlaceholder = !companyNameInput || placeholderName.test(companyNameInput);
  const companyHint = !nameIsPlaceholder ? companyNameInput : companyIdInput;
  if (!companyHint || (nameIsPlaceholder && !companyIdInput)) fail("Set BC_COMPANY_NAME to the exact BC company name or BC_COMPANY_ID to the GUID from /api/v2.0/companies.");
  if (process.exitCode) return;

  let tokenResponse;
  try {
    tokenResponse = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, scope }),
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
  } catch (error) {
    fail(`Could not reach Microsoft Entra token endpoint (${error instanceof Error ? error.message : "network error"}).`);
    return;
  }
  const tokenJson = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || typeof tokenJson.access_token !== "string") {
    fail(`Token acquisition failed (HTTP ${tokenResponse.status}; ${String(tokenJson.error || "unknown_error")}: ${String(tokenJson.error_description || "no details returned")}). Check tenant, client ID/secret, and API permissions.`);
    return;
  }
  const token = tokenJson.access_token;
  pass("Microsoft Entra client-credentials token acquired.");

  const root = `${apiBaseUrl}/${tenantId}/${envName}`;
  let companiesResponse;
  try {
    companiesResponse = await fetch(`${root}/api/v2.0/companies?$select=id,name,displayName`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json", "data-access-intent": "ReadOnly" },
      signal: AbortSignal.timeout(20000), cache: "no-store",
    });
  } catch (error) {
    fail(`Companies API request failed (${error instanceof Error ? error.message : "network error"}). Check the environment name and network.`);
    return;
  }
  const companiesJson = await companiesResponse.json().catch(() => ({}));
  if (!companiesResponse.ok) {
    fail(`Companies API returned HTTP ${companiesResponse.status}. Check the sandbox environment and register the Entra application in Business Central with the required permission set.`);
    return;
  }
  const companies = Array.isArray(companiesJson.value) ? companiesJson.value : [];
  const guidHint = guidPattern.test(companyIdInput) ? companyIdInput.toLowerCase() : "";
  const byId = guidHint ? companies.find((company) => String(company.id || "").toLowerCase() === guidHint) : undefined;
  const byName = companies.filter((company) => [company.name, company.displayName].some((name) => typeof name === "string" && name.trim().toLowerCase() === companyHint.toLowerCase()));
  const company = byId || (byName.length === 1 ? byName[0] : undefined);
  if (!company || !guidPattern.test(String(company.id || ""))) {
    fail(byName.length > 1 ? `Company name '${companyHint}' matched multiple companies. Set BC_COMPANY_ID to the correct GUID.` : `No company matched '${companyHint}'. Available company names: ${companies.map((c) => c.name || c.displayName).filter(Boolean).join(", ") || "(none returned)"}.`);
    return;
  }
  pass(`Companies API returned company '${company.name || company.displayName}' (${company.id}).`);

  const companyId = String(company.id);
  const apiUrl = `${root}/api/velvotix/wms/v1.0/companies(${companyId})/authUsers?$top=1&$select=id,userId,displayName,status`;
  let apiResponse;
  try {
    apiResponse = await fetch(apiUrl, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json", "data-access-intent": "ReadOnly" },
      signal: AbortSignal.timeout(20000), cache: "no-store",
    });
  } catch (error) {
    fail(`WMS authUsers API request failed (${error instanceof Error ? error.message : "network error"}).`);
    return;
  }
  if (!apiResponse.ok) {
    const body = await apiResponse.text().catch(() => "");
    fail(`WMS authUsers API returned HTTP ${apiResponse.status}. Verify extension v0.1.2.0 is installed/updated and the Entra application has VWMS INTEGRATION. ${body.slice(0, 250)}`);
    return;
  }
  const usersPayload = await apiResponse.json().catch(() => ({}));
  if (!Array.isArray(usersPayload.value)) {
    fail("WMS authUsers API responded but did not return the expected OData 'value' array.");
    return;
  }
  pass(`WMS custom API is reachable (${usersPayload.value.length} user record(s) returned on the probe).`);

  const metadataUrl = `${root}/ODataV4/$metadata?Company=${encodeURIComponent(String(company.name || company.displayName))}`;
  let metadataResponse;
  try {
    metadataResponse = await fetch(metadataUrl, {
      headers: { authorization: `Bearer ${token}`, accept: "application/xml" },
      signal: AbortSignal.timeout(20000), cache: "no-store",
    });
  } catch (error) {
    fail(`ODataV4 metadata request failed (${error instanceof Error ? error.message : "network error"}).`);
    return;
  }
  if (!metadataResponse.ok) {
    fail(`ODataV4 metadata returned HTTP ${metadataResponse.status}. The BC OData service is not accessible to this Entra app.`);
    return;
  }
  const metadata = await metadataResponse.text();
  if (/VWMSAuth_Login/.test(metadata) && /VWMSWorker_ClaimBatch/.test(metadata)) {
    pass("VWMSAuth_Login and VWMSWorker_ClaimBatch are present in ODataV4 metadata.");
  } else {
    fail("ODataV4 metadata is reachable, but VWMSAuth_Login and/or VWMSWorker_ClaimBatch were not found. Upgrade/publish the WMS extension so the install/upgrade codeunit registers the services.");
    return;
  }

  console.log("\nConnection probe completed. It did not attempt a real WMS login or post inventory.");
  console.log("Next: in Business Central, enable WMS Setup, create/activate a WMS user, set its password, assign roles and warehouse access, then sign in to WMS.");
}

run().catch((error) => {
  fail(error instanceof Error ? error.message : "Unexpected connection check failure.");
});
