package restaurantos.pos

import data.restaurantos.common

default allow := false

# Every rule below guards on input.action. The two void rules originally did not, which made them
# match ANY action routed to this module: a holder of pos.order.void.any was allowed the refund,
# discount-override and split-bill actions outright, without the approval-limit test the refund rule
# exists to apply. Latent only because authorizeVoid was the module's sole caller at the time.
# PolicyReachabilityTest now fails the build on an unguarded rule.

# The order-lifecycle statuses in which a cashier may void their OWN check.
#
# B2 — this set used to be the single literal "OPEN", and that one word was the register's headline
# defect. A restaurant's ordinary correction is a guest who leaves after the check has gone to the
# pass; the policy allowed a cashier to cancel only a check that had never been fired, so the most
# common void in the trade required a manager. The Void button rendered (the client guards on
# permission, and the cashier genuinely holds pos.order.void.own), the call answered
# 403 "Not permitted: pos.void", and the check stayed open — which then blocked closeTill, which is
# how the seeded drawer reached 133 uncloseable orders.
#
#   DRAFT       — rung, no order number yet. The Cancel control on a draft row calls this same
#                 void endpoint, so excluding DRAFT broke that button for the only persona that
#                 creates drafts.
#   OPEN        — rung, not fired.
#   SENT_TO_KDS — fired.
#
# READ WHAT THIS SET IS, AND WHAT IT IS NOT (B2 re-open).
#
# It is the NON-TERMINAL set: it admits every status a live check can hold and excludes CLOSED,
# VOIDED and REFUNDED. That exclusion is real work and is why the set stays.
#
# It is NOT the kitchen boundary, and the comment that used to stand here said it was — it claimed
# the line was drawn "at the pass" because the set stopped before PARTIAL_READY. That was false.
# pos-service declares OrderStatus.PARTIAL_READY, READY and SERVED but has never written the first
# or the third, and stopped writing the second in fc6f389f ("no more order-level hand-set"), which
# moved kitchen progress to per-item statuses and a computed derivedStatus. A live check therefore
# sits at SENT_TO_KDS from the fryer to the table, so this set covered EVERY status an unpaid check
# can hold and constrained nothing at all. Measured on 2026-08-12: ORD-20260812-0340 — serve-all
# answered 200 with derivedStatus "SERVED" and status still "SENT_TO_KDS", and the cashier's own
# void then answered 200 on food that had been cooked AND carried to the table.
#
# The kitchen boundary is any_line_plated, below. Do not re-express it as a status here: no status
# in this enum distinguishes a plated check from a fired one, and adding names to this set cannot
# make one appear.
#
# Declared at package level rather than inline, deliberately: PolicyReachabilityTest scans rule
# bodies with `allow\s+if\s*\{([^}]*)}`, so a `{…}` set literal inside a body would truncate the
# scan at the first brace and silently drop this rule from the reachability and action-guard
# checks — the exact class of invisible failure that test exists to catch.
cashier_voidable_statuses := {"DRAFT", "OPEN", "SENT_TO_KDS"}

# void.own: a cashier may void their OWN check while it is still only a bill — rung but unpaid,
# fired or not — and never once money has been taken against it.
#
# amount_paid_paisa is the constraint the rule was missing. A void moves no money and writes no
# reversing entry, so voiding a paid check strands the tender: cash in the drawer, nothing on any
# report. OrderServiceImpl.voidOrder refuses that first, with a 409 that names the refund path, and
# that stays — it gives the operator a usable message where a 403 would not. This clause is the
# same rule stated where policy belongs, so the constraint survives a caller that is not
# voidOrder (authorization-service exposes /authorize to anyone) and survives someone reordering
# the service checks. It is fail-closed on an absent field: a caller that does not send
# amount_paid_paisa is denied rather than waved through, matching the approval_limit_paisa
# precedent pinned in approval_gated_actions_test.rego.
# any_line_plated is THE PASS, and it is the clause the status set was pretending to be. It is
# true when any non-cancelled line on the check has reached READY or SERVED — when cooked food
# exists in the world. Deciding to write that off is a manager's call: void.any, unchanged by this.
#
# It arrives as its own field because nothing already on the input can answer it. status is the
# settlement lifecycle and no longer tracks the kitchen (see above). derivedStatus is not sent, and
# would not help if it were: OrderStatusDerivationService.derive collapses SENT/ACCEPTED/PREPARING/
# READY into one IN_PROGRESS and only breaks out served, so a plate sitting under the heat lamp is
# indistinguishable from a ticket fired five seconds ago. pos-service computes this from the lines
# themselves at decision time (OrderStatusDerivationService.anyLinePlated) and sends the answer.
#
# `== false` rather than `not input.resource.any_line_plated`, deliberately: the negated form is
# also satisfied by an ABSENT field, which would silently re-open the hole for every caller that
# does not send it. Written this way an omission is undefined, the body fails, and the rule denies —
# the same fail-closed reading amount_paid_paisa gets, and it is load-bearing for
# authorization-service, which rebuilds this input from an HTTP body and cannot know the line
# statuses. Its void.own attempts deny; only pos-service's own call can allow.
allow if {
    input.action == "void"
    common.has_permission(input, "pos.order.void.own")
    input.resource.created_by == input.user.id
    input.resource.status in cashier_voidable_statuses
    input.resource.amount_paid_paisa == 0
    input.resource.any_line_plated == false
    common.same_tenant_and_branch(input)
}

# void.any: manager-level — can void any order regardless of creator/status
allow if {
    input.action == "void"
    common.has_permission(input, "pos.order.void.any")
    common.same_tenant_and_branch(input)
}

# refund — requires pos.order.refund permission and approval_limit_paisa >= refund amount
allow if {
    input.action == "pos.order.refund"
    common.has_permission(input, "pos.order.refund")
    common.same_tenant_and_branch(input)
    input.user.attributes.approval_limit_paisa >= input.resource.amount_paisa
}

# discount override
allow if {
    input.action == "pos.order.discount.override"
    common.has_permission(input, "pos.order.discount.override")
    common.same_tenant_and_branch(input)
}

# split bill
allow if {
    input.action == "pos.order.split_bill"
    common.has_permission(input, "pos.order.split_bill")
    common.same_tenant_and_branch(input)
}
