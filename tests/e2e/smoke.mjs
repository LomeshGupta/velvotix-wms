// End-to-end smoke test in a real browser against the running app (mock mode).
// Usage: BASE=http://localhost:3113 PW=/path/to/playwright node tests/e2e/smoke.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW ?? "playwright");
const BASE = process.env.BASE ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS ?? "/tmp/shots";
const PASSWORD = process.env.WMS_MOCK_ADMIN_PASSWORD ?? "MockAdmin!2026";

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };

const browser = await chromium.launch();
async function signIn(page, user, password) {
  for (let i = 0; i < 8; i++) {
    await page.getByLabel("User ID").fill(user);
    await page.getByLabel("Password").fill(password);
    if (await page.getByRole("button", { name: "Sign in" }).isEnabled()) break;
    await page.waitForTimeout(750); // page not hydrated yet: typed values were not seen by React
  }
  await page.getByRole("button", { name: "Sign in" }).click();
}
const errors = [];
const notFound = [];
async function newPage(viewport, scheme = "light") {
  const ctx = await browser.newContext({ viewport, colorScheme: scheme });
  const page = await ctx.newPage();
  page.on("response", (r) => { if (r.status() === 404) notFound.push(r.url()); });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
  return { ctx, page };
}

// ---- desktop ----
const { ctx, page } = await newPage({ width: 1366, height: 860 });

await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
await page.waitForURL(/\/login/, { timeout: 60000 });
check("unauthenticated visit redirects to sign in", page.url().includes("/login"));
await page.screenshot({ path: `${SHOTS}/01-login.png` });

await page.getByLabel("User ID").fill("admin");
await page.getByLabel("Password").fill("wrong-password-here");
await page.getByRole("button", { name: "Sign in" }).click();
const loginAlert = page.getByRole("alert").filter({ hasText: /not correct/ });
await loginAlert.waitFor({ timeout: 30000 });
check("wrong password shows a plain-language error", (await loginAlert.count()) === 1);

await signIn(page, "admin", PASSWORD);
await page.waitForURL(/\/dashboard/, { timeout: 60000 });
await page.getByRole("heading", { name: "Floor" }).waitFor();
check("sign in lands on the Floor dashboard", true);
await page.getByText(/Mock mode/).first().waitFor();
check("mock mode is announced on screen", true);
await page.getByText(/No transactions yet/).first().waitFor({ timeout: 30000 });
await page.screenshot({ path: `${SHOTS}/02-dashboard-empty.png` });

// ---- receiving ----
await page.getByRole("link", { name: "Receive" }).first().click();
await page.getByRole("heading", { name: "Receive stock" }).waitFor();
const scan = page.getByLabel("Scan or type an item").first();
await scan.fill("5901234123457"); await scan.press("Enter");          // barcode -> Bicycle
await page.getByText("Bicycle").first().waitFor({ timeout: 30000 });
await scan.fill("1100"); await scan.press("Enter");                    // item number -> Front Wheel
await page.getByText("Front Wheel").first().waitFor({ timeout: 30000 });
await scan.fill("1100"); await scan.press("Enter");                    // same item again -> qty 2
await page.waitForFunction(() => document.querySelector('input[aria-label="Quantity for 1100"]')?.value === "2", null, { timeout: 15000 });
check("scanning by barcode and item number adds lines; a repeat scan increments", true);

await scan.fill("1200"); await scan.press("Enter");                    // blocked item
await page.getByText(/blocked and cannot be received/).waitFor({ timeout: 15000 });
check("a blocked item is refused with a clear message", true);
await scan.fill("NOPE"); await scan.press("Enter");
await page.getByText(/No item matches this code/).waitFor({ timeout: 15000 });
check("an unknown code is reported", true);

await page.getByLabel("Purchase order (optional)").fill("po-1001");
await page.waitForTimeout(600); // let MUI label/notch transitions finish before capturing
await page.screenshot({ path: `${SHOTS}/03-receiving-lines.png` });

// reload keeps the draft
await page.reload({ waitUntil: "domcontentloaded" });
await page.getByText("Front Wheel").first().waitFor({ timeout: 30000 });
check("scanned lines survive a page reload (draft)", true);

await page.getByRole("button", { name: "Submit receipt" }).click();
await page.getByRole("dialog").getByRole("button", { name: "Submit receipt" }).click();
await page.getByText("Receipt saved in Business Central").waitFor({ timeout: 30000 });
check("submission shows the transaction status timeline", true);
await page.getByText(/Receipt completed, document RCPT-/).waitFor({ timeout: 60000 });
check("receipt reaches Completed with a result document (real status, not assumed)", true);
await page.screenshot({ path: `${SHOTS}/04-receiving-completed.png` });

// start a new receipt resets
await page.getByRole("button", { name: "Start a new receipt" }).click();
await page.getByText(/Nothing scanned yet/).waitFor();
check("starting a new receipt clears the draft", true);

// ---- unimplemented operation is shown honestly (submit via API as the same session) ----
const apiResult = await page.evaluate(async () => {
  const s = await (await fetch("/api/auth/session")).json();
  const body = JSON.stringify({ clientKey: crypto.randomUUID(), locationCode: "MAIN", lines: [{ itemNo: "1000", quantity: 1 }] });
  const r = await fetch("/api/wms/receiving", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": s.csrfToken }, body });
  const noCsrf = await fetch("/api/wms/receiving", { method: "POST", headers: { "content-type": "application/json" }, body });
  const foreign = await fetch("/api/wms/receiving", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": s.csrfToken }, body: JSON.stringify({ clientKey: crypto.randomUUID(), locationCode: "ZZZ", lines: [{ itemNo: "1000", quantity: 1 }] }) });
  return { status: r.status, noCsrf: noCsrf.status, foreign: foreign.status };
});
check("API accepts a valid receipt (202)", apiResult.status === 202, String(apiResult.status));
check("API rejects a missing CSRF token (403)", apiResult.noCsrf === 403, String(apiResult.noCsrf));
check("API rejects a location the user is not assigned to (403)", apiResult.foreign === 403, String(apiResult.foreign));

// ---- other screens ----
await page.getByRole("link", { name: "Transactions" }).first().click();
await page.getByRole("heading", { name: "Transactions" }).waitFor();
await page.getByText("Completed").first().waitFor({ timeout: 30000 });
check("Transactions lists the submitted receipts with status", true);
await page.screenshot({ path: `${SHOTS}/05-transactions.png` });

await page.getByRole("link", { name: "Items" }).first().click();
await page.getByLabel("Search items").fill("wheel");
await page.getByText("Front Wheel").first().waitFor({ timeout: 30000 });
check("Items search returns matches and hides blocked items", (await page.getByText("Frame Kit").count()) === 0);

await page.getByRole("link", { name: "Floor" }).first().click();
await page.getByText("Where work sits").waitFor({ timeout: 30000 });
await page.getByRole("img", { name: /Work by state/ }).waitFor();
check("Floor shows the queue ribbon with a text alternative", true);
await page.screenshot({ path: `${SHOTS}/06-dashboard.png` });

await page.getByRole("link", { name: "Integration" }).first().click();
await page.getByRole("heading", { name: "Integration" }).waitFor();
await page.getByText("Requests by operation").waitFor({ timeout: 30000 });
check("Integration monitor shows connection, queue and per-operation timings", true);
await page.screenshot({ path: `${SHOTS}/07-monitor.png` });

// dark mode
await page.getByRole("button", { name: "Toggle colour mode" }).click();
await page.getByRole("link", { name: "Floor" }).first().click();
await page.getByText("Where work sits").waitFor({ timeout: 30000 });
await page.screenshot({ path: `${SHOTS}/08-dashboard-dark.png` });
check("dark mode renders", true);

// sign out
await page.getByRole("button", { name: "Sign out" }).click();
await page.waitForURL(/\/login/, { timeout: 30000 });
await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
await page.waitForURL(/\/login/, { timeout: 30000 });
const leftover = await page.evaluate(() => {
  const raw = sessionStorage.getItem("wms-receipt-draft");
  return raw ? JSON.parse(raw).state?.draft ?? null : null;
});
check("sign out ends the session and clears the on-device draft", page.url().includes("/login") && leftover === null);
await ctx.close();

// ---- mobile ----
const m = await newPage({ width: 390, height: 844 }, "light");
await m.page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await signIn(m.page, "admin", PASSWORD);
await m.page.waitForURL(/\/dashboard/, { timeout: 60000 });
await m.page.getByText(/Where work sits|No transactions yet/).first().waitFor({ timeout: 30000 });
check("mobile shows bottom navigation and hides the desktop rail", await m.page.locator(".MuiBottomNavigation-root").isVisible() && !(await m.page.locator(".MuiDrawer-paper").isVisible()));
await m.page.screenshot({ path: `${SHOTS}/09-mobile-dashboard.png` });
await m.page.locator(".MuiBottomNavigation-root").getByText("Receive").click();
await m.page.getByRole("heading", { name: "Receive stock" }).waitFor();
const ms = m.page.getByLabel("Scan or type an item").first();
await ms.fill("1000"); await ms.press("Enter");
await m.page.getByText("Bicycle").first().waitFor({ timeout: 30000 });
await m.page.waitForTimeout(600);
await m.page.screenshot({ path: `${SHOTS}/10-mobile-receiving.png` });
const overflow = await m.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
check("mobile receiving has no horizontal scroll", !overflow);
const h = await m.page.getByRole("button", { name: "Submit receipt" }).boundingBox();
check("primary action is a large touch target (>= 44px tall)", (h?.height ?? 0) >= 44, `${h?.height}px`);
await m.ctx.close();

await browser.close();
// 401/403 responses are expected here (wrong password, CSRF and scope checks); they are asserted explicitly above.
const unexpected404 = [...new Set(notFound)].filter((u) => !u.includes("/api/wms/items/lookup?code=NOPE"));
const bad = errors.filter((e) => !/Download the React DevTools|status of 40[134]/.test(e));
if (unexpected404.length) bad.push(`unexpected 404s: ${unexpected404.join(", ")}`);
check("no browser console errors or uncaught exceptions", bad.length === 0, bad.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
