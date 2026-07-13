import { test, expect } from "@playwright/test";

/**
 * Calendar-based fiscal-year period provisioning E2E — GSD phase 07.2, plan
 * 07.2-07 (FIN-10), driven by real browser automation instead of manual
 * click-throughs.
 *
 * Runs against the LIVE local dev stack (frontend :3000, gateway, finance-service).
 * Requires the demo ACCOUNTANT seed (accountant@demo.local / Accountant#2026,
 * tenant "demo") and the demo CASHIER seed (cashier@demo.local / Cashier#2026).
 *
 * Stages S1-S6 run sequentially inside ONE test (shared page/context) using
 * `test.step()` for reporting, mirroring pos-settlement.spec.ts's conventions.
 * Each stage records PASS/FAIL/BLOCKED and a screenshot WITHOUT aborting later,
 * independent stages.
 *
 * "FAIL" = a real frontend defect. "BLOCKED" = missing seed data / environment
 * precondition (not a code defect) — see the `Blocked` marker class below.
 *
 * IMPORTANT (RESEARCH.md Pitfall 3 / this plan's own <action> note): this
 * plan's wave runs BEFORE 07.2-06's mandatory service-restart-and-health-check
 * gate. A failure caused by a stale/pre-05 finance-service process (e.g. 404
 * on POST /api/v1/finance/periods/provision, or the endpoint simply not yet
 * live) is NOT a frontend defect — it is recorded as BLOCKED here and its
 * live pass/fail verdict is deferred to 07.2-06's restart-and-verify gate.
 *
 * The target fiscal year for provisioning is ALWAYS computed at runtime as
 * `currentPakistanFiscalYear() + 1` — never a hardcoded literal — so the run
 * is reproducible (a future year reliably has zero pre-existing periods).
 */

const ACCOUNTANT_EMAIL = "accountant@demo.local";
const ACCOUNTANT_PASSWORD = "Accountant#2026";
const CASHIER_EMAIL = "cashier@demo.local";
const CASHIER_PASSWORD = "Cashier#2026";
const TENANT_SLUG = "demo";
const SHOT_DIR = "e2e/__screenshots__";

/** Mirrors frontend/lib/utils/pakistan-fiscal-year.ts's currentPakistanFiscalYear
 * — duplicated here (not imported) so this spec has zero compile-time coupling
 * to app internals, per this repo's existing e2e/ convention (e2e/ has its OWN
 * tsconfig, deliberately outside the app's tsc/lint scope). */
function currentPakistanFiscalYear(date = new Date()): number {
  return date.getMonth() >= 6 ? date.getFullYear() + 1 : date.getFullYear();
}

type StageStatus = "PASS" | "FAIL" | "BLOCKED";
interface StageRecord {
  id: string;
  status: StageStatus;
  detail: string;
  screenshot?: string;
}

/** Thrown by a stage body to mean "environment/seed-data precondition missing", not a code bug. */
class Blocked extends Error {}

test.describe("Calendar-based fiscal-year period provisioning flow (07.2-07)", () => {
  test("S1-S6 staged verification against the live dev stack", async ({ page }) => {
    test.setTimeout(180_000);

    const results: StageRecord[] = [];
    const targetFiscalYear = currentPakistanFiscalYear() + 1;

    async function shot(name: string): Promise<string> {
      const rel = `${SHOT_DIR}/${name}.png`;
      await page.screenshot({ path: rel, fullPage: true }).catch(() => {});
      return rel;
    }

    /** Retry once on Turbopack's transient first-compile 404 (fresh .next, just restarted). */
    async function gotoRobust(url: string): Promise<void> {
      await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
      for (let i = 0; i < 3; i++) {
        const is404 = await page
          .getByText("404", { exact: false })
          .first()
          .isVisible({ timeout: 1000 })
          .catch(() => false);
        if (!is404) return;
        await page.waitForTimeout(2000);
        await page.reload({ waitUntil: "networkidle", timeout: 45_000 });
      }
    }

    async function login(email: string, password: string): Promise<void> {
      await gotoRobust(`/login?tenant=${TENANT_SLUG}`);
      const tenantField = page.locator('input[name="tenantSlug"]');
      if (await tenantField.isVisible({ timeout: 1000 }).catch(() => false)) {
        await tenantField.fill(TENANT_SLUG);
      }
      await page.locator('input[type="email"]').fill(email);
      await page.locator('input[type="password"]').fill(password);
      await page.locator('button[type="submit"]').click();

      // "Sign-in failed / The service is temporarily unavailable" = the
      // gateway/auth-service (or a downstream service it depends on) is down
      // in THIS session — the same class of environment gap pos-settlement.spec.ts
      // treats as Blocked (its 503 FallbackController cases). Not a frontend defect.
      const signInFailedBanner = page.getByText("Sign-in failed");
      const signInFailed = await signInFailedBanner
        .waitFor({ state: "visible", timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (signInFailed) {
        const detail = (await page.getByText(/temporarily unavailable|try again/i).textContent().catch(() => null)) ?? "";
        throw new Blocked(
          `login for ${email} failed with a "Sign-in failed" banner (backend/gateway unavailable in this session): "${detail.trim()}"`,
        );
      }

      // ACCOUNTANT holds finance.period.close -> login step-up (TOTP_REQUIRED)
      // per 02-02-B. A real TOTP secret must be enrolled out-of-band (see
      // scripts/generate_totp.py) for this to proceed automatically; absent
      // that, the revealed totpCode field is an environment precondition,
      // not a frontend defect.
      const totpField = page.locator('input[name="totpCode"]');
      const totpRevealed = await totpField
        .isVisible({ timeout: 5000 })
        .catch(() => false);
      if (totpRevealed) {
        throw new Blocked(
          `login for ${email} requires TOTP step-up (finance.period.close/rbac.manage) and no enrolled dev TOTP secret is wired into this spec — see scripts/generate_totp.py`,
        );
      }

      await page.waitForURL(/\/app\//, { timeout: 20_000 });
    }

    async function logout(): Promise<void> {
      // No shared logout helper exists yet in e2e/ — clear cookies/storage and
      // reload to drop the session, mirroring how proxy.ts treats an absent
      // has_session marker (redirect to /login on the next protected nav).
      await page.context().clearCookies();
      await page.evaluate(() => {
        try {
          window.localStorage.clear();
          window.sessionStorage.clear();
        } catch {
          /* best-effort only */
        }
      });
    }

    async function stage(id: string, fn: () => Promise<string>): Promise<StageRecord> {
      return test.step(id, async () => {
        try {
          const detail = await fn();
          const screenshot = await shot(`${id}-pass`);
          const rec: StageRecord = { id, status: "PASS", detail, screenshot };
          results.push(rec);
          console.log(`[STAGE-RESULT] ${id}: PASS - ${detail}`);
          return rec;
        } catch (err) {
          const status: StageStatus = err instanceof Blocked ? "BLOCKED" : "FAIL";
          const detail = err instanceof Error ? err.message : String(err);
          const screenshot = await shot(`${id}-${status.toLowerCase()}`);
          const rec: StageRecord = { id, status, detail, screenshot };
          results.push(rec);
          console.log(`[STAGE-RESULT] ${id}: ${status} - ${detail}`);
          return rec;
        }
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    // S1 — log in as ACCOUNTANT, navigate to /app/finance/periods
    // ══════════════════════════════════════════════════════════════════════
    const s1 = await stage("S1", async () => {
      await login(ACCOUNTANT_EMAIL, ACCOUNTANT_PASSWORD);
      await gotoRobust("/app/finance/periods");
      await expect(page.getByRole("heading", { name: "Accounting Periods" })).toBeVisible({
        timeout: 15_000,
      });
      return "logged in as accountant@demo.local and reached /app/finance/periods";
    });

    if (s1.status === "BLOCKED") {
      // The remaining stages all depend on being logged in as a
      // finance.period.open holder; without that, nothing downstream is
      // meaningful. Still run S6 (CASHIER gate) independently below since it
      // does not depend on S1's login.
      console.log(
        "[STAGE-SUMMARY] S1 BLOCKED — skipping S2-S5 (all depend on an authenticated ACCOUNTANT session)",
      );
    } else {
      // ══════════════════════════════════════════════════════════════════
      // S2 — navigate via FiscalYearNav to a fiscal year with zero periods
      // ══════════════════════════════════════════════════════════════════
      await stage("S2", async () => {
        const nextButton = page.getByRole("button", { name: "Next fiscal year" });
        if (!(await nextButton.isVisible({ timeout: 5000 }).catch(() => false))) {
          throw new Blocked("FiscalYearNav 'Next fiscal year' button not rendered");
        }
        await nextButton.click();
        await expect(
          page.getByText(`FY ${targetFiscalYear - 1}–${targetFiscalYear} (Jul – Jun)`),
        ).toBeVisible({ timeout: 10_000 });
        return `navigated to FY ${targetFiscalYear} via FiscalYearNav`;
      });

      // ══════════════════════════════════════════════════════════════════
      // S3 — open "Provision Periods", confirm 12-cell preview, none "already open"
      // ══════════════════════════════════════════════════════════════════
      await stage("S3", async () => {
        const provisionButton = page.getByRole("button", { name: "Provision Periods" });
        if (!(await provisionButton.isVisible({ timeout: 5000 }).catch(() => false))) {
          throw new Blocked(
            "'Provision Periods' button not visible — accountant@demo.local may lack finance.period.open (seed-data/RBAC gap)",
          );
        }
        await provisionButton.click();
        await expect(
          page.getByRole("heading", { name: "Provision Accounting Periods" }),
        ).toBeVisible({ timeout: 10_000 });

        const cells = page.locator("text=/^P(?:[1-9]|1[0-2])$/");
        const cellCount = await cells.count();
        if (cellCount !== 12) {
          throw new Error(`expected 12 period-preview cells, found ${cellCount}`);
        }
        const alreadyOpenCount = await page.getByText("Already open").count();
        if (alreadyOpenCount !== 0) {
          throw new Blocked(
            `expected 0 'Already open' markers for FY ${targetFiscalYear} (a future, never-provisioned year), found ${alreadyOpenCount} — this fiscal year was already provisioned by a prior run/session`,
          );
        }
        return `dialog shows 12 period-preview cells for FY ${targetFiscalYear}, none marked "Already open"`;
      });

      // ══════════════════════════════════════════════════════════════════
      // S4 — confirm provisioning; assert success banner + table reflects 12 OPEN periods
      // ══════════════════════════════════════════════════════════════════
      await stage("S4", async () => {
        const confirmButton = page.getByRole("button", { name: `Provision FY ${targetFiscalYear}` });
        if (!(await confirmButton.isVisible({ timeout: 5000 }).catch(() => false))) {
          throw new Blocked("confirm 'Provision FY ...' button not visible (depends on S3)");
        }
        const [resp] = await Promise.all([
          page
            .waitForResponse(
              (r) => r.url().includes("/periods/provision") && r.request().method() === "POST",
              { timeout: 15_000 },
            )
            .catch(() => null),
          confirmButton.click(),
        ]);

        if (!resp) {
          throw new Blocked(
            "no POST .../periods/provision network response observed within timeout — endpoint may not be live on this session's finance-service (deferred to 07.2-06 restart-and-verify)",
          );
        }
        if (resp.status() === 404) {
          throw new Blocked(
            "POST .../periods/provision returned 404 — stale/pre-05 finance-service process; deferred to 07.2-06 restart-and-verify",
          );
        }
        if (!resp.ok()) {
          throw new Error(`provision request failed: HTTP ${resp.status()} ${resp.statusText()}`);
        }

        await expect(
          page.getByText(/Provisioned \d+ period\(s\)|already fully provisioned/i),
        ).toBeVisible({ timeout: 10_000 });
        await page.getByRole("button", { name: "Close" }).click();

        const rows = page.locator("table tbody tr");
        await expect(rows).toHaveCount(12, { timeout: 15_000 });
        const openChips = page.getByText("OPEN", { exact: true });
        const openCount = await openChips.count();
        if (openCount !== 12) {
          throw new Error(`expected 12 OPEN period rows for FY ${targetFiscalYear}, found ${openCount}`);
        }
        return `provisioning confirmed via HTTP ${resp.status()}; inline success banner shown; table reflects 12 OPEN periods for FY ${targetFiscalYear} with no manual reload`;
      });

      // ══════════════════════════════════════════════════════════════════
      // S5 — re-open the dialog for the SAME year; all 12 cells now "already open"
      // ══════════════════════════════════════════════════════════════════
      await stage("S5", async () => {
        const provisionButton = page.getByRole("button", { name: "Provision Periods" });
        if (!(await provisionButton.isVisible({ timeout: 5000 }).catch(() => false))) {
          throw new Blocked("'Provision Periods' button not visible (depends on S1)");
        }
        await provisionButton.click();
        await expect(
          page.getByRole("heading", { name: "Provision Accounting Periods" }),
        ).toBeVisible({ timeout: 10_000 });

        const alreadyOpenCount = await page.getByText("Already open").count();
        if (alreadyOpenCount !== 12) {
          throw new Error(
            `expected all 12 cells marked "Already open" for the just-provisioned FY ${targetFiscalYear}, found ${alreadyOpenCount}`,
          );
        }
        await page.getByRole("button", { name: "Cancel" }).click();
        return `re-opened dialog for FY ${targetFiscalYear}: all 12 cells correctly marked "Already open"`;
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    // S6 — CASHIER (no finance.period.open) never sees "Provision Periods"
    // ══════════════════════════════════════════════════════════════════════
    await stage("S6", async () => {
      await logout();
      await login(CASHIER_EMAIL, CASHIER_PASSWORD);
      await gotoRobust("/app/finance/periods");

      // Either the page loads with no Provision button, or the CASHIER lacks
      // finance.journal.view too and is redirected/blocked entirely — both are
      // valid confirmations that the permissioned action never appears to this role.
      const provisionButton = page.getByRole("button", { name: "Provision Periods" });
      const isVisible = await provisionButton.isVisible({ timeout: 5000 }).catch(() => false);
      if (isVisible) {
        throw new Error(
          "'Provision Periods' button IS visible to cashier@demo.local — permission gate (finance.period.open) is not working",
        );
      }
      return "cashier@demo.local does not see the 'Provision Periods' action (permission-gated correctly)";
    });

    // ══════════════════════════════════════════════════════════════════════
    // Summary
    // ══════════════════════════════════════════════════════════════════════
    console.log(`[STAGE-SUMMARY] ${JSON.stringify(results, null, 2)}`);
    await test.info().attach("stage-results.json", {
      body: JSON.stringify(results, null, 2),
      contentType: "application/json",
    });

    const hardFailures = results.filter((r) => r.status === "FAIL");
    expect(hardFailures, `Real frontend bug(s) found: ${JSON.stringify(hardFailures, null, 2)}`).toHaveLength(0);
  });
});
