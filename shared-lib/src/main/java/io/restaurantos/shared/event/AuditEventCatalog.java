package io.restaurantos.shared.event;

import java.util.Set;

/**
 * THE list of event types that must produce a row in {@code audit_events}, and the services whose
 * every event is audited regardless of type.
 *
 * <h2>Why this is in shared-lib and not in audit-service</h2>
 *
 * <p>Because the two vocabularies it reconciles live at opposite ends of the repository. The
 * allow-list was owned by {@code AuditIngestionService}, the publishers are 43 call sites in 10
 * other services, and nothing compared them. Measured on 2026-08-07, four of the eight allow-listed
 * types were published by <b>no service at all</b>:
 *
 * <ul>
 *   <li>{@code VOID_CREATED} — pos-service publishes {@code ORDER_VOIDED}</li>
 *   <li>{@code REFUND_CREATED} — pos-service publishes {@code ORDER_REFUNDED}</li>
 *   <li>{@code RBAC_CHANGED} — no service published any role-change event whatsoever</li>
 *   <li>{@code IMPERSONATION_STARTED} — recorded only in {@code platform_db.impersonation_logs}</li>
 * </ul>
 *
 * <p>Voids and refunds — the two operations an auditor looks at first, and the two that move money
 * out of the till — were unaudited because of a two-word string mismatch that no test could see. A
 * type in the allow-list that nobody publishes fails silently and forever: ingestion runs, matches
 * nothing, logs nothing, and the table stays empty while every dashboard says the pipeline is
 * healthy.
 *
 * <p>Putting the list here gives it a home both sides can see, which is what lets
 * {@code AuditAllowListClosureTest} compare them mechanically and fail the build on drift — the same
 * move {@code PermissionCatalogClosureTest} made for permission codes after five outages of exactly
 * this shape.
 *
 * <h2>Adding an event type</h2>
 *
 * <p>If it is security- or money-relevant, add it to {@link #MUST_AUDIT} <em>and</em> publish it.
 * The closure test fails if you do either one without the other. If it is genuinely operational
 * telemetry and not audit material, add it to {@link #NOT_AUDIT_RELEVANT} with a reason — an
 * explicit, reviewable opt-out rather than an omission nobody can distinguish from an oversight.
 */
public final class AuditEventCatalog {

    private AuditEventCatalog() {}

    /**
     * Event types that must always produce an audit row, whichever service publishes them.
     *
     * <p>Every entry here is published by a service in this repository; that is a build-enforced
     * property, not an intention.
     */
    public static final Set<String> MUST_AUDIT = Set.of(
            // ── Identity and credentials (auth-service) ──────────────────────────────
            "USER_LOGIN_SUCCEEDED",
            "USER_LOGIN_FAILED",
            "PASSWORD_CHANGED",
            "PASSWORD_RESET_REQUESTED",
            "ADMIN_PASSWORD_RESET",

            // ── User lifecycle and privilege (auth-service, added by 15-01) ──────────
            // The highest-privilege operations in the system. Before 15-01 they produced no
            // event anywhere: an account could be created, given OWNER, and deactivated with
            // no trace in any central record.
            "USER_CREATED",
            "USER_UPDATED",
            "USER_DEACTIVATED",
            "USER_REACTIVATED",
            "ROLE_GRANTED",
            "ROLE_REVOKED",

            // ── Platform tier (platform-admin-service) ───────────────────────────────
            "TENANT_PROVISIONED",
            "IMPERSONATION_STARTED",

            // ── Money movement at the till (pos-service) ─────────────────────────────
            // ORDER_VOIDED / ORDER_REFUNDED are the real published names. The allow-list used
            // to read VOID_CREATED / REFUND_CREATED, which nothing published.
            "ORDER_VOIDED",
            "ORDER_REFUNDED",
            // D-2. Giving money away is the single most abusable action at a till, and until B3
            // shipped it was impossible, so nothing here covered it. Measured 2026-08-12: of the
            // 27 actions this vocabulary offered, none mentioned discount, comp, price or
            // override — a manager could take 10% off any check in the building and the log had
            // no way to say so. REMOVED is not decoration: applyDiscount replaces rather than
            // stacks, so swapping "Rs 500 off" for "10% off" hands the guest back Rs 400 and used
            // to leave no trace but a vanished row.
            "ORDER_DISCOUNT_APPLIED",
            "ORDER_DISCOUNT_REMOVED",
            "TILL_OPENED",
            "TILL_CLOSED",
            "TILL_REVIEWED",

            // ── The kitchen board (kitchen-service) ──────────────────────────────────
            // A bulk state change a cook makes to a wall display, and the only operation in the
            // kitchen that takes work off a board without the POS asking. It touches no money, but
            // "who cleared last night's board, and what was on it" is a question a manager asks the
            // morning after a disputed check, and the kitchen's own cleared_by column is a
            // convenience rather than an append-only record.
            "KDS_STALE_TICKETS_CLEARED",

            // ── The ledger (finance-service) ─────────────────────────────────────────
            "PERIOD_CLOSED",
            "JOURNAL_POSTED",

            // ── Spend (purchasing-service) ───────────────────────────────────────────
            "PO_APPROVED",
            "PO_CLOSED",
            "AP_PAYMENT_PROCESSED",
            "VENDOR_INVOICE_MATCHED",

            // ── Payroll (hr-service) ─────────────────────────────────────────────────
            // PAYROLL_RUN_APPROVED / PAYROLL_RUN_PAID, not PAYROLL_APPROVED / PAYROLL_PAID.
            // The shorter names appear in the 2026-08-07 research document and are published by
            // nothing; the closure test is what caught the difference.
            "PAYROLL_RUN_APPROVED",
            "PAYROLL_RUN_PAID"
    );

    /**
     * Services whose every event is audited regardless of type.
     *
     * <p>Inert until 15-01, because {@code DomainEventPublisher} stamped {@code "shared-lib"} on
     * every event and neither of these names could ever match. It works now, and it is the reason
     * an auth-service event type that someone forgets to add to {@link #MUST_AUDIT} is still
     * captured — belt and braces, in the direction that fails safe.
     */
    public static final Set<String> ALWAYS_AUDIT_SOURCES = Set.of(
            "auth-service",
            "platform-admin-service"
    );

    /**
     * Published event types that are deliberately NOT audit material, each with its reason.
     *
     * <p>This set exists so that "not audited" is a decision somebody made and can be argued with,
     * rather than an absence indistinguishable from a mistake. {@code AuditAllowListClosureTest}
     * requires every published type that looks security- or money-relevant to appear either here or
     * in {@link #MUST_AUDIT}.
     */
    public static final Set<String> NOT_AUDIT_RELEVANT = Set.of(
            // Operational stock telemetry: high volume, no privilege or money semantics, and the
            // authoritative record is the stock ledger itself.
            "STOCK_DEPLETED", "STOCK_RECEIVED", "LOW_STOCK_ALERT", "EXPIRY_ALERT",
            "COUNT_VARIANCE_POSTED", "WASTAGE_RECORDED", "TRANSFER_SHIPPED",
            "TRANSFER_RECEIVED", "TRANSFER_VARIANCE", "DEPLETION_INCOMPLETE",
            "GRN_RECEIVED",
            // Order flow. ORDER_CLOSED is the sale itself and is reconstructable from the orders
            // table; the audit-relevant exceptions to it (void, refund) are audited above.
            "ORDER_CREATED", "ORDER_SENT_TO_KDS", "ORDER_CLOSED",
            "ORDER_ITEM_SERVED", "ORDER_ITEM_CANCELLED", "ORDER_READY",
            "KITCHEN_ITEM_STATUS_CHANGED",
            // Menu and roster maintenance: business config, versioned in its own tables.
            "MENU_ITEM_UPSERTED", "MENU_ITEM_DELETED",
            "EMPLOYEE_CREATED", "EMPLOYEE_UPDATED", "EMPLOYEE_DEACTIVATED",
            "ATTENDANCE_PUNCHED"
    );

    /**
     * Word fragments that make a published event type audit-relevant on its face.
     *
     * <p>Used by the closure test to decide which published types must be classified. Deliberately
     * broad: a false positive costs one line in {@link #NOT_AUDIT_RELEVANT} and a sentence saying
     * why, and a false negative costs an unaudited privilege change.
     */
    public static final Set<String> SECURITY_RELEVANT_FRAGMENTS = Set.of(
            "LOGIN", "PASSWORD", "ROLE_", "RBAC", "USER_", "PERMISSION", "IMPERSONAT",
            "VOID", "REFUND", "TILL", "PERIOD_CLOSED", "JOURNAL", "PAYROLL",
            // D-2. So the NEXT price-moving event cannot ship unclassified the way the first one
            // did. Deliberately the bare stem: DISCOUNT_OVERRIDDEN, ORDER_DISCOUNT_APPLIED and a
            // future LINE_DISCOUNT_VOIDED all have to be argued about rather than forgotten.
            "DISCOUNT", "COMP_", "PRICE_OVERRIDE",
            "PAYMENT", "PO_APPROVED", "PO_CLOSED", "INVOICE_MATCHED", "TENANT_"
    );
}
