import { randomBytes } from "node:crypto";

/**
 * TEST-DATA ISOLATION.
 *
 * Two different problems, two different mechanisms — conflating them is how a suite becomes
 * un-rerunnable:
 *
 * 1. RESOURCES THIS SUITE CREATES (a tenant, a user) get a run-unique name, so a second run
 *    never collides with the first and a failed run leaves an identifiable orphan rather
 *    than a landmine. `runId()` is that name.
 *
 * 2. SEEDED RESOURCES THIS SUITE MUTATES (a tenant's feature flags) are RESTORED, because
 *    they are shared with every other spec and with the seed's own verification. That is
 *    `withRestored`, below. Creating a throwaway tenant instead would be cleaner in theory
 *    and much worse in practice: provisioning runs a saga that creates branches and a chart
 *    of accounts, takes tens of seconds, and cannot be undone by deleting a row.
 */

/**
 * One id per PROCESS, not per test: a Playwright worker runs many tests, and a single id
 * makes every artifact from one run greppable together.
 *
 * Includes a random component rather than only a timestamp, because two workers can start
 * inside the same millisecond.
 */
let cached: string | null = null;

export function runId(): string {
  if (!cached) {
    const stamp = new Date()
      .toISOString()
      .replace(/[-:.TZ]/g, "")
      .slice(2, 12);
    cached = `${stamp}${randomBytes(2).toString("hex")}`;
  }
  return cached;
}

/** A tenant brand name that cannot collide with a seeded tenant or a previous run. */
export function e2eBrandName(): string {
  return `E2E Probe ${runId()}`;
}

/** An email in a domain no seeded persona uses. */
export function e2eEmail(local: string): string {
  return `${local}-${runId()}@e2e.local`;
}

/**
 * A password satisfying shared-lib's @StrongPassword (>=8 chars, upper, lower, digit,
 * special) and distinct per run so password HISTORY (depth 5) can never refuse it.
 */
export function e2ePassword(): string {
  return `E2e#${runId()}aA1`;
}

/**
 * Run `body`, then put a mutated value back the way it was — even if `body` threw.
 *
 * Used for feature-flag toggles on SEEDED tenants. Without it, one failed run leaves a
 * tenant permanently missing a module and every later spec (and the seed's own pairwise
 * divergence assertion) starts failing for a reason that has nothing to do with its subject.
 */
export async function withRestored<T>(
  restore: () => Promise<void>,
  body: () => Promise<T>,
): Promise<T> {
  try {
    return await body();
  } finally {
    // A restore failure must be LOUD: the environment is now dirty for every later spec.
    await restore();
  }
}
