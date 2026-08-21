import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * JOURNEY — the Guide tab, read and then acted on (37-13, D-37-03).
 *
 * <h3>Why reading it is not enough</h3>
 *
 * A component test can prove the guide renders the sentence in the registry. It cannot prove the
 * sentence is TRUE of the running product — the registry gate does that by binding each claim to a
 * test, but every one of those tests lives inside the service that implements the behaviour. So
 * this journey reads a rule off the page in a browser and then does what it says, through the
 * gateway, exactly as an owner would after reading it. That is where a guide is either right or
 * worthless.
 */

const MANAGER = { email: "manager@terrace.local", password: "Terrace#Manager1" };
const WAITER = { email: "waiter@terrace.local", password: "Terrace#Waiter1" };
const TENANT = "floating-terrace";
const GATEWAY = process.env.GATEWAY_URL ?? "http://localhost:8080";
const SHOTS = "../.planning/phases/37-finance-orders-integration";

/** Keeps this spec inside the gateway's shared 2/s auth bucket. */
async function pace(): Promise<void> {
  await new Promise((r) => setTimeout(r, 700));
}

async function signIn(page: import("@playwright/test").Page, who: typeof MANAGER) {
  await pace();
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/app\//, { timeout: 25_000 });
}

async function apiToken(request: APIRequestContext, who: typeof MANAGER): Promise<string> {
  await pace();
  const res = await request.post(`${GATEWAY}/api/v1/auth/login`, {
    data: { email: who.email, password: who.password, tenantSlug: TENANT },
  });
  expect(res.status(), `login for ${who.email}`).toBe(200);
  const body = await res.json();
  return body.data?.accessToken ?? body.accessToken;
}

/** The branch a token is scoped to. The order endpoints require it explicitly. */
function branchFromToken(token: string): string {
  const payload = token.split(".")[1]!;
  const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString();
  return JSON.parse(json).branch_id;
}

test.describe.configure({ mode: "serial" });

test.describe("The Guide explains the module, and its rules hold", () => {
  test("A · every tab in the tab bar has a section, and the four rules are on the page", async ({
    page,
  }, testInfo) => {
    await signIn(page, MANAGER);
    await page.goto("/app/finance/guide");
    await expect(page.getByRole("heading", { name: "How Finance works", level: 1 })).toBeVisible();

    // Read the tab bar the reader can actually see, and demand a section for each of its tabs.
    // Asserting against a hard-coded list would only prove the guide agrees with this file.
    const tabBar = page.getByTestId("finance-tabs");
    const labels = (await tabBar.getByRole("link").allInnerTexts()).map((t) => t.trim());
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      const section = page.locator("section[id]").filter({
        has: page.getByRole("heading", { level: 2, name: label, exact: true }),
      });
      await expect(section, `no guide section for the "${label}" tab`).toHaveCount(1);
    }

    // The tab bar is permission-filtered, so a manager sees two entries and the loop above would
    // pass on a two-section page. The guide covers the WHOLE module regardless of who is reading,
    // so every section must be present — the ledger tabs a manager cannot open are exactly the
    // ones they are most likely to be asking about.
    const sections = await page.locator("section[id]").count();
    expect(sections, "the guide must explain every finance tab, not only the visible ones").toBe(
      11,
    );

    // The four rules D-37-03 names, each where an owner will meet it.
    await expect(page.locator('[data-claim-id="FIN-GUIDE-0001"]').first()).toBeVisible();
    await expect(page.locator('[data-claim-id="FIN-GUIDE-0002"]').first()).toBeVisible();
    await expect(page.locator('[data-claim-id="FIN-GUIDE-0003"]').first()).toBeVisible();
    await expect(page.locator('[data-claim-id="FIN-GUIDE-0004"]').first()).toBeVisible();

    // Nothing on the page is an unresolved reference. A rule that quietly renders as nothing is
    // the exact failure the registry exists to prevent.
    await expect(page.getByTestId("claim-missing")).toHaveCount(0);

    // Accessibility: one h1, and no heading level is skipped.
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    expect(await page.getByRole("heading", { level: 2 }).count()).toBe(sections);

    // A section can be linked to directly, so a screen can point at its own explanation.
    await page.goto("/app/finance/guide#periods");
    await expect(page.locator("#periods")).toBeVisible();

    const shot = await page.screenshot({
      fullPage: true,
      path: `${SHOTS}/37-13-finance-guide.png`,
    });
    await testInfo.attach("finance-guide.png", { body: shot, contentType: "image/png" });
  });

  test("B · the open-till rule, read off the page and then followed", async ({ page, request }) => {
    await signIn(page, MANAGER);
    await page.goto("/app/finance/guide");

    // Read the rule as the owner reads it, and take the words from the page rather than from a
    // constant in this file — a paraphrase here would prove nothing about what they were told.
    const rule = page.locator('[data-claim-id="FIN-GUIDE-0001"]').first();
    const text = await rule.innerText();
    expect(text).toContain("Settling in cash needs an open till");
    expect(text).toContain("NO_OPEN_TILL");

    // ── Now do what it says, as far as a shared development database honestly allows ─────────
    //
    // WHAT THIS FOUND, and it is the reason the journey was worth writing: the registry's original
    // explanation said a WAITER settling in cash is refused with NO_OPEN_TILL. Driven here, a
    // waiter is refused **403 PERMISSION_DENIED** — waiting staff may not take payments at all, so
    // they never reach the till rule. The headline claim was true and the illustration was not,
    // which is precisely the kind of sentence that generates the support ticket it was written to
    // prevent. The registry now says what the product does; this asserts it.
    const waiterToken = await apiToken(request, WAITER);
    const waiterAuth = { Authorization: `Bearer ${waiterToken}` };
    const branchId = branchFromToken(waiterToken);

    const created = await request.post(`${GATEWAY}/api/v1/pos/orders`, {
      headers: waiterAuth,
      data: { branchId, clientOrderId: crypto.randomUUID(), type: "DINE_IN", coverCount: 1 },
    });
    expect(created.status(), "a waiter may take an order").toBe(201);
    const orderId = (await created.json()).data.id;

    const refused = await request.post(`${GATEWAY}/api/v1/pos/orders/${orderId}/payments`, {
      headers: waiterAuth,
      data: { method: "CASH", amountPaisa: 100 },
    });
    expect(refused.status(), "waiting staff are turned away before the till rule").toBe(403);
    expect(JSON.stringify(await refused.json())).toContain("PERMISSION_DENIED");
    expect(
      text,
      "the guide must say waiting staff are refused for a DIFFERENT reason, not by the till rule",
    ).toContain("not permitted to take payments");

    // Leave nothing behind. The order was never settled, so voiding it is a clean exit.
    await request.post(`${GATEWAY}/api/v1/pos/orders/${orderId}/void`, {
      headers: { ...waiterAuth, "Idempotency-Key": crypto.randomUUID() },
      data: { reason: "e2e: finance-guide open-till rule check" },
    });

    // The NO_OPEN_TILL half of the rule is asserted by `CashPaymentRequiresTillIT`, which the
    // registry binds and `make verify-guide-claims` checks is live and not skipped. Reproducing it
    // here would mean CLOSING the seeded cashier's open till on a database nine workstreams read,
    // and a journey that vandalises shared state to prove a point is a journey nobody can run
    // twice. The boundary is stated rather than quietly skipped.
  });

  test("C · the guide is reachable by someone who has not been given the ledger", async ({
    page,
  }) => {
    // The person most likely to need an explanation of this module is the one who has seen the
    // least of it. A manager holds no `finance.journal.view`; the Guide must still open.
    await signIn(page, MANAGER);
    await page.goto("/app/finance/guide");
    await expect(page.getByRole("heading", { name: "How Finance works", level: 1 })).toBeVisible();
    await expect(page.getByText("You do not have permission")).toHaveCount(0);
  });
});
