"use client";

import * as React from "react";
import { RotateCcw, Undo2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { InsetRow } from "@/components/ui/inset-row";
import { Label } from "@/components/ui/label";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDestructiveDialog } from "@/components/platform/confirm-destructive-dialog";
import { ConsoleNote, ConsoleSection } from "@/components/platform/console-section";
import { ApiError, formatUserFacingError } from "@/lib/errors";
import { formatDateTime, formatNumber } from "@/lib/format/locale";
import { usePlatformPlans } from "@/lib/hooks/use-platform-plans";
import {
  useAssignPlan,
  useCancelScheduledChange,
  useCancelSubscription,
  useRenewSubscription,
  useTenantSubscription,
} from "@/lib/hooks/use-platform-subscription";
import {
  billingPeriodLabel,
  perPeriodLabel,
  type PlatformTenant,
  type SubscriptionDetail,
  type SubscriptionPlan,
} from "@/lib/models/platform.model";

const DATE_ONLY: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
};

/**
 * The five writes that move a tenant's commercial arrangement, each stating what changes and when.
 *
 * <h3>Why the choices are made on the page and only the CONSEQUENCE is in the dialog</h3>
 *
 * A confirmation whose body is a form is not a confirmation — the operator is still deciding while
 * being asked to commit, and the sentence they are agreeing to changes under them as they type.
 * So the plan, the date and the reason are chosen in the panel, and the dialog then states the
 * finished decision in one sentence: which plan, from which plan, on which date, and what that
 * does to the tenant's ceilings. That is the thing being confirmed.
 *
 * <h3>Nothing here changes whether the restaurant can trade</h3>
 *
 * A subscription is a commercial record laid beside an entitlement that already exists. The gateway
 * enforces the tenant's TIER; cancelling a subscription changes no tenant status, revokes no feature
 * and stops no till — `POST /tenants/{id}/cancel`, on the tenant's own screen, is the separate
 * operation that takes a restaurant out of service. Every dialog below says so, because the two
 * live one click apart on this console and conflating them is how a pricing decision takes a
 * kitchen offline.
 *
 * <h3>A renewal is an ASSERTION, and the panel says whose</h3>
 *
 * The scheduler deliberately never rolls a period forward. Advancing a renewal date would claim the
 * tenant paid, and this product observes no payments anywhere — there is no invoice entity, no
 * payment entity and no processor integration in any of its sixteen services. So a renewal is a
 * person stating that an agreement continues; it lands in the append-only trail with their account
 * attached, and this panel is written so nobody presses it believing it recorded a payment.
 *
 * <h3>A trial can be started and can never be extended</h3>
 *
 * `startTrial` stamps a window from the plan's `trialDays`, and only when the plan declares one AND
 * the subscription has never had a trial. There is no extend-trial endpoint, so this panel offers
 * no extend-trial button — a control that silently did nothing would be worse than its absence, and
 * the absence is stated rather than left to be discovered.
 */
export function SubscriptionLifecycleActions({ tenant }: { tenant: PlatformTenant }) {
  const subscription = useTenantSubscription(tenant.id);
  /*
   * Archived plans INCLUDED, and this is a correctness requirement rather than a courtesy.
   *
   * A tenant can be sitting on a plan that was archived after it was assigned — archiving is refused
   * while a subscription names it, but a subscription can outlive one that was closed while empty
   * and later restored, and history rows name archived codes routinely. Fetching only live plans
   * would leave the renewal panel unable to name the billing period of the plan the tenant is
   * actually on, and would make an operator searching for a closed plan conclude the catalogue lost
   * it. They are offered as DISABLED options instead, which says "this exists and cannot be chosen"
   * — the answer the assign endpoint gives anyway, with a named `PLAN_ARCHIVED` 409.
   */
  const plans = usePlatformPlans(true);

  return (
    <ConsoleSection
      anchorId="subscription-lifecycle"
      eyebrow="Lifecycle"
      title="Change this subscription"
      description={
        <>
          Every write here demands a reason and lands in the append-only trail below with your
          account attached. None of them changes whether {tenant.brandName} can trade — a
          subscription is the commercial record beside the entitlement, not the thing that gates a
          till.
        </>
      }
      data-testid="subscription-lifecycle"
    >
      <QueryBoundary
        query={[subscription, plans]}
        what="this tenant's subscription and the plan catalogue"
        moduleLabel="Subscriptions"
        loading={<Skeleton className="h-64" />}
      >
        {subscription.data && plans.data ? (
          tenant.status === "PURGED" ? (
            <ConsoleNote tone="warning" data-testid="subscription-lifecycle-purged">
              {tenant.brandName} is closed. A closed tenant cannot be given a subscription — the API
              refuses it — and nothing on this console reopens one. Its existing records stay
              readable so historical prices and transitions still resolve.
            </ConsoleNote>
          ) : (
            <LifecyclePanels
              tenant={tenant}
              detail={subscription.data.subscription}
              plans={plans.data}
            />
          )
        ) : null}
      </QueryBoundary>
    </ConsoleSection>
  );
}

function LifecyclePanels({
  tenant,
  detail,
  plans,
}: {
  tenant: PlatformTenant;
  detail: SubscriptionDetail | null;
  plans: SubscriptionPlan[];
}) {
  return (
    <div className="flex flex-col gap-(--space-lg)">
      <PlanChangePanel tenant={tenant} detail={detail} plans={plans} />
      <PeriodAndTrialPanel tenant={tenant} detail={detail} plans={plans} />
      <EndingPanel tenant={tenant} detail={detail} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1 · Assign or move a plan.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The one control that changes what a tenant is entitled to.
 *
 * <h3>The 409 is the useful behaviour, and `force` only appears after it</h3>
 *
 * An immediate move to a plan whose ceilings fall below what the tenant MEASURABLY uses is refused,
 * naming each violated limit with its usage. That refusal is the default and the point: a downgrade
 * applied over a limit nobody looked at is exactly what the four-state limit report exists to
 * prevent. The override is offered only once the server has actually refused, so it is a second,
 * deliberate act against a stated reason rather than a checkbox sitting there inviting a tick.
 *
 * <p>A refusal is also not a pass mark in reverse. Only MEASURABLE dimensions can produce a
 * violation — four of the six ceilings cannot be read from the platform plane at all — so a change
 * that is NOT refused is not a statement that the tenant fits. The panel says that where an
 * operator will read it, next to the button.
 *
 * <h3>A future date SCHEDULES, and is deliberately not limit-checked</h3>
 *
 * A scheduled change moves nothing until the scheduler applies it, and the check is skipped at
 * schedule time on purpose: it would be against today's usage for a change landing in six weeks, so
 * passing it would be a reassurance with no shelf life. The scheduler re-checks when it falls due
 * and refuses there, leaving the pending change in place. Both halves are stated in the dialog.
 */
function PlanChangePanel({
  tenant,
  detail,
  plans,
}: {
  tenant: PlatformTenant;
  detail: SubscriptionDetail | null;
  plans: SubscriptionPlan[];
}) {
  const assign = useAssignPlan(tenant.id);
  const openedAt = useClockAtMount();

  const [planCode, setPlanCode] = React.useState("");
  const [effectiveOn, setEffectiveOn] = React.useState("");
  const [startTrial, setStartTrial] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [force, setForce] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);

  // Archived plans are offered as DISABLED rows rather than dropped: an operator looking for a plan
  // that no longer accepts new tenants needs to see that it exists and is closed, not conclude the
  // catalogue lost it. The API refuses one with a named `PLAN_ARCHIVED` 409 regardless.
  const options = React.useMemo(
    () =>
      plans.map((plan) => ({
        value: plan.code,
        label: plan.active ? plan.name : `${plan.name} — archived`,
        disabled: !plan.active,
      })),
    [plans],
  );

  const target = plans.find((plan) => plan.code === planCode) ?? null;
  const current = detail?.plan ?? null;

  /*
   * A CANCELLED or ENDED subscription is not "the current one" for any of the decisions below.
   *
   * The backend closes such a row out and writes a NEW subscription rather than reusing it — its
   * cancellation date, its reason and its period are the record of an agreement that ended, and
   * overwriting them to start another would erase it. Two consequences follow, and getting either
   * wrong disables a control that should work:
   *
   *   · re-assigning the SAME plan to a cancelled subscription is a real operation (it starts a new
   *     agreement on the plan the tenant was already sold), so it must not be blocked as a no-op —
   *     the no-op only exists for a LIVE subscription already on that plan;
   *   · the new subscription may take a trial even though the ended one had one, because the trial
   *     window is stamped on the row being created, not on the tenant.
   */
  const live = detail !== null && detail.status !== "CANCELLED" && detail.status !== "ENDED";
  const sameAsCurrent = live && current !== null && target !== null && current.code === target.code;
  const trialAlreadyUsed = live && detail !== null && detail.trialStartAt !== null;

  const trialAvailable = target !== null && target.trialDays > 0 && !trialAlreadyUsed;
  const trialBlockedReason =
    target === null
      ? "Choose a plan first."
      : target.trialDays === 0
        ? `${target.name} declares no trial length, so there is no window to stamp.`
        : trialAlreadyUsed
          ? "This subscription has already had a trial. A trial is stamped once and cannot be extended."
          : null;

  const scheduled = effectiveOn !== "";
  const effectiveAt = scheduled ? utcMidnight(effectiveOn) : undefined;
  const dateIsFuture = effectiveAt === undefined || new Date(effectiveAt).getTime() > openedAt;

  const limitRefusal =
    assign.error instanceof ApiError && assign.error.code === "SUBSCRIPTION_LIMIT_EXCEEDED";

  const ready =
    target !== null && target.active && reason.trim().length > 0 && !sameAsCurrent && dateIsFuture;

  const reset = () => {
    setConfirming(false);
    setForce(false);
    assign.reset();
  };

  return (
    <section className="flex flex-col gap-(--space-md)" data-testid="subscription-plan-change">
      <div className="flex flex-col gap-1">
        <p className="text-label font-semibold tracking-eyebrow text-foreground-secondary uppercase">
          {detail === null
            ? "Assign a plan"
            : live
              ? "Move to a different plan"
              : "Start a new subscription"}
        </p>
        <p className="text-small text-muted-foreground">
          {detail === null
            ? `${tenant.brandName} has no subscription. Assigning a plan creates one and applies that plan's ceilings to the tenant — its tier moves with it.`
            : live
              ? `Currently on ${current?.name ?? "a plan that could not be resolved"}. Moving applies the new plan's ceilings and tier; the billing period is left exactly where it is, because this product cannot compute a proration and re-cutting the period would move a date nobody agreed to move.`
              : `The previous subscription ended and is kept as the record of it. Choosing a plan — including ${current?.name ?? "the one it was on"} — starts a fresh agreement rather than reopening the old row.`}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-(--space-md) md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="assign-plan">Plan</Label>
          <Select
            id="assign-plan"
            options={options}
            value={planCode}
            onValueChange={setPlanCode}
            placeholder="Choose a plan…"
            emptyLabel="No plans in the catalogue"
            data-testid="assign-plan-select"
          />
          {target ? (
            <p className="text-label text-foreground-tertiary" data-testid="assign-plan-summary">
              {target.tier} tier · ceilings {formatNumber(target.maxBranches)} branches,{" "}
              {formatNumber(target.maxUsers)} users, {formatNumber(target.storageGb)} GB,{" "}
              {formatNumber(target.nlqQuota)} NLQ queries · sold at{" "}
              {perPeriodLabel(target.billingPeriod)}.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="assign-effective">Effective date</Label>
          <Input
            id="assign-effective"
            type="date"
            value={effectiveOn}
            onChange={(event) => setEffectiveOn(event.target.value)}
            data-testid="assign-effective-date"
          />
          {/*
            A platform session has no tenant and therefore no branch, so there is no local business
            day to cut on. The boundary is UTC midnight and it is written on the screen rather than
            guessed at — the same statement the impersonation screen makes about its date filters,
            and for the same reason: a boundary silently a few hours out is the defect.
          */}
          <p className="text-label text-foreground-tertiary">
            Leave empty to apply now. A date schedules the change for UTC midnight on that day and
            nothing moves until then. A past date is refused — backdating would put an effective
            date in the trail the entitlement never had.
          </p>
          {scheduled && !dateIsFuture && (
            <p className="text-label font-medium text-warning" data-testid="assign-date-past">
              That date is not in the future. Pick a later one, or clear the field to apply now.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="flex items-start gap-2" htmlFor="assign-start-trial">
          <input
            id="assign-start-trial"
            type="checkbox"
            className="mt-0.5 size-4 rounded-sm border-border-interactive"
            checked={trialAvailable && startTrial}
            disabled={!trialAvailable}
            onChange={(event) => setStartTrial(event.target.checked)}
            data-testid="assign-start-trial"
          />
          <span className="text-small">
            Start this plan&apos;s trial
            {target && target.trialDays > 0 ? ` (${formatNumber(target.trialDays)} days)` : ""}
          </span>
        </label>
        {trialBlockedReason ? (
          <p className="text-label text-foreground-tertiary">{trialBlockedReason}</p>
        ) : (
          <p className="text-label text-foreground-tertiary">
            The window is stamped from the plan&apos;s trial length and no renewal date is set while
            it runs — a null renewal date is exactly true here, and deriving one would assert a
            billing date nobody has agreed to.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="assign-reason">Reason for this change</Label>
        <Input
          id="assign-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          data-testid="assign-reason"
        />
        <p className="text-label text-foreground-tertiary">
          Required by the API and recorded on the history row below with your account. This is the
          half that did not exist before: a tier used to be a column an operator overwrote with no
          record of the previous value anywhere in the product.
        </p>
      </div>

      {sameAsCurrent && (
        <ConsoleNote data-testid="assign-same-plan">
          {tenant.brandName} is already on {current?.name}. Re-applying the same plan does nothing
          and writes no history row — the API treats it as a no-op rather than an error, so a retry
          is safe, but nothing would be recorded.
        </ConsoleNote>
      )}

      <div className="flex flex-wrap items-center gap-(--space-sm)">
        <Button
          disabled={!ready}
          onClick={() => setConfirming(true)}
          data-testid="assign-plan-review"
        >
          {!live ? "Assign plan…" : scheduled ? "Schedule change…" : "Apply change…"}
        </Button>
        <p className="text-label text-foreground-tertiary">
          A change that is not refused is not a statement that the tenant fits: only four of the six
          ceilings can be measured at all.
        </p>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => !open && reset()}
        tone="neutral"
        title={
          live
            ? `Move ${tenant.brandName} to ${target?.name ?? "this plan"}?`
            : `Put ${tenant.brandName} on ${target?.name ?? "this plan"}?`
        }
        confirmLabel={
          limitRefusal && force
            ? "Apply over the limits"
            : scheduled
              ? "Schedule the change"
              : live
                ? "Apply the change"
                : "Assign plan"
        }
        isPending={assign.isPending}
        body={
          <>
            <span className="block">
              {scheduled ? (
                <>
                  Booked for {formatDateTime(effectiveAt, DATE_ONLY)} at UTC midnight.{" "}
                  <span className="font-medium">Nothing moves until then</span> — the scheduler
                  applies it, and it re-checks the plan&apos;s ceilings at that moment rather than
                  now, because a limit check today would be about usage six weeks out of date.
                </>
              ) : (
                <>
                  Takes effect <span className="font-medium">immediately</span>. {tenant.brandName}
                  &apos;s ceilings become {target ? formatNumber(target.maxBranches) : "—"}{" "}
                  branches, {target ? formatNumber(target.maxUsers) : "—"} users,{" "}
                  {target ? formatNumber(target.storageGb) : "—"} GB and{" "}
                  {target ? formatNumber(target.nlqQuota) : "—"} NLQ queries, and its tier becomes{" "}
                  {target?.tier ?? "—"}.
                </>
              )}
            </span>
            <span className="mt-2 block">
              {startTrial && trialAvailable
                ? `A ${formatNumber(target?.trialDays ?? 0)}-day trial starts and no renewal date is set while it runs — which is exactly true, because there is nothing to renew until somebody decides there is. `
                : live
                  ? "The billing period is left exactly where it is: this product cannot prorate anything, because it has no invoice to prorate against, and silently re-cutting the period would move a commercial date nobody agreed to move. "
                  : `The first period is taken from the plan's billing period starting today — that is the shape of the agreement being recorded, not a claim that anybody has paid. `}
            </span>
            <span className="mt-2 block text-foreground-secondary">
              This does not suspend, cancel or otherwise interrupt the restaurant. Nothing is
              deleted, and every previous plan this tenant held stays in the trail.
            </span>
          </>
        }
        error={
          assign.isError ? (
            <span className="flex flex-col gap-2">
              <span>{formatUserFacingError(assign.error)}</span>
              {limitRefusal && (
                <>
                  <span className="text-foreground-secondary">
                    The refusal is the default and it is measured, not guessed — only ceilings this
                    platform can actually count produce one. Applying anyway is recorded on the
                    history row as forced.
                  </span>
                  <label className="flex items-start gap-2 text-foreground" htmlFor="assign-force">
                    <input
                      id="assign-force"
                      type="checkbox"
                      className="mt-0.5 size-4 rounded-sm border-border-interactive"
                      checked={force}
                      onChange={(event) => setForce(event.target.checked)}
                      data-testid="assign-force"
                    />
                    <span>
                      Apply {target?.name ?? "this plan"} anyway, over the ceilings named above.
                      Nothing is taken away from the tenant — a plan gates, it never deletes.
                    </span>
                  </label>
                </>
              )}
            </span>
          ) : undefined
        }
        onConfirm={() => {
          if (!target) return;
          if (limitRefusal && !force) return;
          assign.mutate(
            {
              planCode: target.code,
              reason: reason.trim(),
              ...(effectiveAt ? { effectiveAt } : {}),
              ...(startTrial && trialAvailable ? { startTrial: true } : {}),
              ...(force ? { force: true } : {}),
            },
            {
              onSuccess: () => {
                setConfirming(false);
                setForce(false);
                setReason("");
                setEffectiveOn("");
                setStartTrial(false);
              },
            },
          );
        }}
      />
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2 · The period, and the trial that cannot be extended.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Recording a renewal, and stating what this product cannot do about trials.
 *
 * <h3>Why a renewal is a form and not a one-click button</h3>
 *
 * The new period end is REQUIRED and is not inferred by default, because nothing here observes a
 * payment: an operator asserting a renewal has to say what they are asserting. Deriving it from the
 * plan's billing period is offered — it is the ordinary case — but it is a deliberate tick rather
 * than a silent default, so the trail records which of the two happened.
 */
function PeriodAndTrialPanel({
  tenant,
  detail,
  plans,
}: {
  tenant: PlatformTenant;
  detail: SubscriptionDetail | null;
  plans: SubscriptionPlan[];
}) {
  const renew = useRenewSubscription(tenant.id);
  const openedAt = useClockAtMount();

  const [derive, setDerive] = React.useState(true);
  const [periodEndOn, setPeriodEndOn] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [confirming, setConfirming] = React.useState(false);

  const plan = detail?.plan ?? null;
  const planRecord = plans.find((candidate) => candidate.code === plan?.code) ?? null;

  const renewable = detail !== null && detail.status !== "CANCELLED" && detail.status !== "ENDED";
  const currentPeriodEndAt = derive ? undefined : utcMidnight(periodEndOn);
  const dateIsFuture =
    derive ||
    (currentPeriodEndAt !== undefined && new Date(currentPeriodEndAt).getTime() > openedAt);

  const ready =
    renewable && reason.trim().length > 0 && dateIsFuture && (derive || periodEndOn !== "");

  return (
    <section
      className="flex flex-col gap-(--space-md) border-t border-border pt-(--space-lg)"
      data-testid="subscription-period"
    >
      <div className="flex flex-col gap-1">
        <p className="text-label font-semibold tracking-eyebrow text-foreground-secondary uppercase">
          Period and trial
        </p>
        <p className="text-small text-muted-foreground">
          {detail === null
            ? "There is no subscription to renew. Assign a plan above to create one."
            : detail.currentPeriodEndAt
              ? `The current period ends ${formatDateTime(detail.currentPeriodEndAt, DATE_ONLY)}${
                  detail.renewalOverdue
                    ? " — that date has passed and nobody has confirmed a renewal. It is a worklist item, not a payment failure."
                    : "."
                }`
              : "No renewal date is set. That is exactly true during a trial: deriving one would assert a billing date nobody has agreed to."}
        </p>
      </div>

      {renewable ? (
        <>
          <div className="grid grid-cols-1 gap-(--space-md) md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="flex items-start gap-2" htmlFor="renew-derive">
                <input
                  id="renew-derive"
                  type="checkbox"
                  className="mt-0.5 size-4 rounded-sm border-border-interactive"
                  checked={derive}
                  onChange={(event) => setDerive(event.target.checked)}
                  data-testid="renew-derive"
                />
                <span className="text-small">
                  Take the new period end from the plan&apos;s billing period
                  {planRecord
                    ? ` (${billingPeriodLabel(planRecord.billingPeriod).toLowerCase()})`
                    : ""}
                </span>
              </label>
              <p className="text-label text-foreground-tertiary">
                Untick to state the date outright. Either way the derivation is recorded, so the
                trail says which of the two an operator chose rather than leaving it implicit.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="renew-period-end">New period end</Label>
              <Input
                id="renew-period-end"
                type="date"
                value={periodEndOn}
                disabled={derive}
                onChange={(event) => setPeriodEndOn(event.target.value)}
                data-testid="renew-period-end"
              />
              <p className="text-label text-foreground-tertiary">
                UTC midnight on the day you choose. It has to be in the future — a period that has
                already ended is not a renewal.
              </p>
              {!derive && periodEndOn !== "" && !dateIsFuture && (
                <p className="text-label font-medium text-warning" data-testid="renew-date-past">
                  That date is not in the future.
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="renew-reason">What are you asserting?</Label>
            <Input
              id="renew-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              data-testid="renew-reason"
            />
            <p className="text-label text-foreground-tertiary">
              Required. This product cannot see a payment, so a renewal is your statement that the
              agreement continues — write what a colleague would need to check it in six months.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-(--space-sm)">
            <Button
              variant="outline"
              disabled={!ready}
              onClick={() => setConfirming(true)}
              data-testid="renew-review"
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              Record a renewal…
            </Button>
          </div>
        </>
      ) : detail !== null ? (
        <ConsoleNote data-testid="renew-unavailable">
          A {detail.status === "CANCELLED" ? "cancelled" : "superseded"} subscription cannot be
          renewed. Assign a plan above to start a new one — the ended agreement is closed out rather
          than reused, so its cancellation date, its reason and its period survive as the record of
          what happened.
        </ConsoleNote>
      ) : null}

      {/*
        The absence that has to be stated rather than discovered. There is no extend-trial endpoint
        anywhere in this product, and a button that appeared to extend one and silently did nothing
        would be worse than not having it: the operator would believe a restaurant had more time.
      */}
      <ConsoleNote data-testid="trial-extension-note">
        <span className="font-medium">A trial cannot be extended.</span> A window is stamped once,
        from the plan&apos;s trial length, when the plan is assigned — there is no endpoint that
        moves its end date and this console does not pretend otherwise.{" "}
        {detail && detail.trialEndAt
          ? `This one ${detail.trialEndAt.getTime() > openedAt ? "runs until" : "ran until"} ${formatDateTime(detail.trialEndAt, DATE_ONLY)}.`
          : "This subscription has never had one."}{" "}
        When a trial elapses the status becomes <span className="font-medium">Trial ended</span>,
        which changes no entitlement at all: it is a worklist state produced by the clock, saying a
        decision is due. Recording a renewal or moving the plan resolves it.
      </ConsoleNote>

      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open) {
            setConfirming(false);
            renew.reset();
          }
        }}
        tone="neutral"
        title={`Record a renewal for ${tenant.brandName}?`}
        confirmLabel="Record the renewal"
        isPending={renew.isPending}
        body={
          <>
            <span className="block">
              {derive
                ? `The new period end is taken from the ${planRecord ? billingPeriodLabel(planRecord.billingPeriod).toLowerCase() : "plan's"} billing period and starts from the end of the current one.`
                : `The period will be recorded as ending ${formatDateTime(currentPeriodEndAt, DATE_ONLY)}.`}
            </span>
            <span className="mt-2 block font-medium">
              This records that you know a renewal happened. It is not a payment, it does not create
              an invoice, and nothing in this product charged anybody.
            </span>
            <span className="mt-2 block text-foreground-secondary">
              The trail will name your account as the operator who asserted it. If the subscription
              is on an elapsed trial, this also moves it to Active — which is the decision the
              worklist state exists to prompt.
            </span>
          </>
        }
        error={renew.isError ? formatUserFacingError(renew.error) : undefined}
        onConfirm={() =>
          renew.mutate(
            {
              reason: reason.trim(),
              ...(derive
                ? { deriveFromBillingPeriod: true }
                : { currentPeriodEndAt: currentPeriodEndAt! }),
            },
            {
              onSuccess: () => {
                setConfirming(false);
                setReason("");
                setPeriodEndOn("");
              },
            },
          )
        }
      />
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 3 · Withdrawing what is booked, and ending the agreement.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The two ways a subscription stops moving: withdraw what is scheduled, or cancel it.
 *
 * <h3>Cancelling a SUBSCRIPTION is not cancelling a TENANT, and this is where that matters most</h3>
 *
 * The button below is one click from `TenantLifecycleActions`' "Cancel" on the neighbouring screen,
 * and the two words are identical. One is a commercial record ending; the other takes a restaurant
 * out of service. The dialog names the difference explicitly and points at the other operation,
 * because an operator who cancels the wrong one here has either failed to stop billing or stopped a
 * kitchen.
 */
function EndingPanel({
  tenant,
  detail,
}: {
  tenant: PlatformTenant;
  detail: SubscriptionDetail | null;
}) {
  const cancel = useCancelSubscription(tenant.id);
  const withdraw = useCancelScheduledChange(tenant.id);
  const openedAt = useClockAtMount();

  const [cancelOn, setCancelOn] = React.useState("");
  const [pending, setPending] = React.useState<"cancel" | "withdraw" | null>(null);

  const hasSubscription = detail !== null;
  const live = hasSubscription && detail.status !== "CANCELLED" && detail.status !== "ENDED";
  const hasScheduledChange = detail?.pendingPlan != null && detail.pendingChangeAt != null;
  const hasScheduledCancellation = detail?.cancelAt != null && detail.cancelledAt == null;
  const anythingScheduled = hasScheduledChange || hasScheduledCancellation;

  const cancelAt = cancelOn === "" ? undefined : utcMidnight(cancelOn);
  const cancelDateIsFuture = cancelAt === undefined || new Date(cancelAt).getTime() > openedAt;

  return (
    <section
      className="flex flex-col gap-(--space-md) border-t border-border pt-(--space-lg)"
      data-testid="subscription-ending"
    >
      <p className="text-label font-semibold tracking-eyebrow text-foreground-secondary uppercase">
        Scheduled items and cancellation
      </p>

      <ul className="flex flex-col gap-(--space-sm)">
        <InsetRow
          as="li"
          leading={
            <span className="text-foreground-tertiary">
              <Undo2 className="size-4" aria-hidden="true" />
            </span>
          }
          primary="Withdraw what is scheduled"
          secondary={
            anythingScheduled
              ? [
                  hasScheduledChange
                    ? `A move to ${detail?.pendingPlan?.code} on ${formatDateTime(detail?.pendingChangeAt, DATE_ONLY)}`
                    : null,
                  hasScheduledCancellation
                    ? `A cancellation on ${formatDateTime(detail?.cancelAt, DATE_ONLY)}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "Nothing is booked on this subscription, so there is nothing to withdraw. The API refuses this call rather than answering with a silent no-op."
          }
          trailing={
            <Button
              variant="outline"
              size="sm"
              disabled={!anythingScheduled}
              onClick={() => setPending("withdraw")}
              data-testid="withdraw-scheduled"
            >
              Withdraw
            </Button>
          }
          className={anythingScheduled ? undefined : "opacity-70"}
        />

        <InsetRow
          as="li"
          leading={
            <span className="text-foreground-tertiary">
              <XCircle className="size-4" aria-hidden="true" />
            </span>
          }
          primary="Cancel the subscription"
          secondary={
            live
              ? "Ends the commercial record. The restaurant keeps its status, its data, its modules and its ceilings — nothing about its service changes."
              : hasSubscription
                ? "This subscription has already ended. Assign a plan above to start a new one."
                : "There is no subscription to cancel."
          }
          trailing={
            <Button
              variant="destructive"
              size="sm"
              disabled={!live}
              onClick={() => setPending("cancel")}
              data-testid="cancel-subscription"
            >
              Cancel subscription
            </Button>
          }
          className={live ? undefined : "opacity-70"}
        />
      </ul>

      {live && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cancel-effective">Cancellation date (optional)</Label>
          <Input
            id="cancel-effective"
            type="date"
            value={cancelOn}
            onChange={(event) => setCancelOn(event.target.value)}
            className="md:max-w-xs"
            data-testid="cancel-effective-date"
          />
          <p className="text-label text-foreground-tertiary">
            Leave empty to cancel now. A future date books it at UTC midnight and the subscription
            stays live until then — the ordinary &ldquo;cancel at period end&rdquo; case. Set this
            before opening the confirmation; the dialog states which of the two you are about to do.
          </p>
          {cancelOn !== "" && !cancelDateIsFuture && (
            <p className="text-label font-medium text-warning" data-testid="cancel-date-past">
              That date is not in the future, so this would cancel immediately.
            </p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={pending === "withdraw"}
        onOpenChange={(open) => {
          if (!open) {
            setPending(null);
            withdraw.reset();
          }
        }}
        tone="neutral"
        title={`Withdraw the scheduled items for ${tenant.brandName}?`}
        confirmLabel="Withdraw them"
        isPending={withdraw.isPending}
        body={
          <>
            <span className="block">
              {hasScheduledChange
                ? `The plan move to ${detail?.pendingPlan?.code} booked for ${formatDateTime(detail?.pendingChangeAt, DATE_ONLY)} will not happen. `
                : ""}
              {hasScheduledCancellation
                ? `The cancellation booked for ${formatDateTime(detail?.cancelAt, DATE_ONLY)} will not happen. `
                : ""}
              The subscription carries on exactly as it is today.
            </span>
            <span className="mt-2 block text-foreground-secondary">
              A withdrawal is itself recorded in the trail below, so the fact that something was
              booked and then called off stays readable. This endpoint takes no reason, so the row
              will name you and the time and nothing about why — note the decision wherever your
              team keeps them.
            </span>
          </>
        }
        error={withdraw.isError ? formatUserFacingError(withdraw.error) : undefined}
        onConfirm={() => withdraw.mutate(undefined, { onSuccess: () => setPending(null) })}
      />

      <ConfirmDestructiveDialog
        open={pending === "cancel"}
        onOpenChange={(open) => {
          if (!open) {
            setPending(null);
            cancel.reset();
          }
        }}
        title={
          cancelAt && cancelDateIsFuture
            ? `Book a cancellation for ${tenant.brandName}?`
            : `Cancel ${tenant.brandName}'s subscription now?`
        }
        confirmPhrase={tenant.brandName}
        confirmLabel={
          cancelAt && cancelDateIsFuture ? "Book the cancellation" : "Cancel subscription"
        }
        reasonLabel="Reason for cancelling"
        isPending={cancel.isPending}
        error={cancel.isError ? formatUserFacingError(cancel.error) : undefined}
        data-testid="cancel-subscription-dialog"
        consequence={
          <>
            <p>
              {cancelAt && cancelDateIsFuture ? (
                <>
                  The subscription is booked to end on{" "}
                  <span className="font-semibold">{formatDateTime(cancelAt, DATE_ONLY)}</span> and
                  stays live until then. Withdrawing it before that date is one click on this page.
                </>
              ) : (
                <>
                  The subscription ends <span className="font-semibold">immediately</span>. Its
                  cancellation date, its reason and its period are kept as the record of an
                  agreement that ended.
                </>
              )}
            </p>
            <p>
              <span className="font-semibold">This does not cancel {tenant.brandName}.</span> The
              restaurant keeps its status, its users, its data, its modules and its entitlement
              ceilings — the point of sale carries on serving. Taking a tenant out of service is a
              separate decision on its own lifecycle panel, and the two are deliberately different
              operations.
            </p>
            <p className="text-foreground-secondary">
              Nothing is deleted. The reason you give is recorded on the history row below with your
              account, which is what makes this auditable rather than a silent overwrite.
            </p>
          </>
        }
        onConfirm={(reason) =>
          cancel.mutate(
            {
              reason,
              ...(cancelAt && cancelDateIsFuture ? { effectiveAt: cancelAt } : {}),
            },
            {
              onSuccess: () => {
                setPending(null);
                setCancelOn("");
              },
            },
          )
        }
      />
    </section>
  );
}

/**
 * The wall clock, read once when the panel mounts.
 *
 * <h3>Why not `Date.now()` where it is used</h3>
 *
 * A clock read in a component body is an impure render: the React compiler rejects it outright, and
 * it is genuinely wrong — two reads in the same render can disagree and neither ever updates. A lazy
 * `useState` initialiser runs once and is pure at render, which is the shape `dashboard-shell.tsx`
 * settled on for the same problem.
 *
 * <h3>Why a fixed instant is the RIGHT answer here, not merely the compliant one</h3>
 *
 * Everything this feeds is a date-entry guard — "is the effective date you typed in the future?" —
 * and the authority on that question is the server, which re-checks it and refuses a past instant
 * with a message naming the date. This value only decides whether to warn before the request is
 * sent. A ticking clock would buy nothing and would re-render three panels of form state to move a
 * boundary the operator will cross by typing, not by waiting.
 */
function useClockAtMount(): number {
  const [openedAt] = React.useState(() => Date.now());
  return openedAt;
}

/**
 * A `<input type="date">` value → the ISO instant the API expects.
 *
 * <h3>Why UTC midnight, stated on screen rather than inferred</h3>
 *
 * The API takes an `Instant`; the control gives a bare `YYYY-MM-DD`. Something has to choose which
 * midnight that is, and the choice cannot be left to `new Date("2027-03-14")`-style local parsing:
 * an operator in Karachi and one in London would then send instants five hours apart for the same
 * visible date, and a scheduled change would fall due on different days depending on who typed it.
 *
 * <p>UTC, because a platform session has no tenant and therefore no branch — there is no local
 * business day available to cut on. That is the same boundary the impersonation screen states for
 * its date filters, and every caller here writes it next to the field, because a date boundary
 * silently a few hours out is precisely the defect the takings screen shipped.
 */
function utcMidnight(value: string): string | undefined {
  if (!value) return undefined;
  const instant = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(instant.getTime()) ? instant.toISOString() : undefined;
}
