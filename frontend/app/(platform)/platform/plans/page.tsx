"use client";

import * as React from "react";

import { PageHeader } from "@/components/ui/page-header";
import { PlanCatalogue } from "@/components/platform/plan-catalogue";

/**
 * URL: `/platform/plans` — the catalogue.
 *
 * <h3>What this route answers</h3>
 *
 * What can a tenant be sold, what does each one cost, and what does it actually let them do. The
 * catalogue and the side-by-side ceiling comparison live in `PlanCatalogue`; this file is the
 * route and the heading.
 *
 * <h3>Read-only, and that is a decision rather than an unfinished screen</h3>
 *
 * The API has `POST /plans`, `PATCH /plans/{code}`, `/archive` and `/restore`. None of them is
 * wired to a control here, because editing a plan's ceilings **does not restamp the tenants already
 * on it** — the backend says so explicitly and the reason is sound: silently re-tiering a fleet
 * whenever somebody corrected a typo in a price would be an entitlement change nobody chose, made
 * at an indeterminate moment. Re-tiering is a plan CHANGE, made per tenant, with a reason, on the
 * subscription screen. A catalogue editor that looked like it moved a fleet and did not would be
 * worse than not having one, so the console offers the operation that actually works.
 *
 * <h3>What this route will never show</h3>
 *
 * No revenue, no MRR, no ARR, no invoices, no payment status, no failed payments and no churn
 * value. There is no billing integration and no payment entity anywhere in this product — sixteen
 * services were enumerated for one — so a "PKR 1.4M annualised" figure derived from list price times
 * subscriber count would be arithmetic performed on data the system does not have, rendered in the
 * product's own confident voice, on the screen where pricing decisions are made. The one tile where
 * an operator would look for it states the absence instead.
 */
export default function PlatformPlansPage() {
  return (
    <div className="flex flex-col gap-(--space-lg)">
      <PageHeader
        title="Plans"
        description="What each plan is sold at, what it lets a tenant do, and how many restaurants are on it."
      />
      <PlanCatalogue />
    </div>
  );
}
