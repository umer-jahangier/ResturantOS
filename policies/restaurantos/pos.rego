package restaurantos.pos

import data.restaurantos.common

default allow := false

# Every rule below guards on input.action. The two void rules originally did not, which made them
# match ANY action routed to this module: a holder of pos.order.void.any was allowed the refund,
# discount-override and split-bill actions outright, without the approval-limit test the refund rule
# exists to apply. Latent only because authorizeVoid was the module's sole caller at the time.
# PolicyReachabilityTest now fails the build on an unguarded rule.

# The statuses in which a cashier may void their OWN check.
#
# B2 — this set used to be the single literal "OPEN", and that one word was the register's headline
# defect. A restaurant's ordinary correction is a guest who leaves after the check has gone to the
# pass; the policy allowed a cashier to cancel only a check that had never been fired, so the most
# common void in the trade required a manager. The Void button rendered (the client guards on
# permission, and the cashier genuinely holds pos.order.void.own), the call answered
# 403 "Not permitted: pos.void", and the check stayed open — which then blocked closeTill, which is
# how the seeded drawer reached 133 uncloseable orders.
#
# The line is drawn at MONEY and at the PASS, not at whether the kitchen has been told:
#   DRAFT       — rung, no order number yet. The Cancel control on a draft row calls this same
#                 void endpoint, so excluding DRAFT broke that button for the only persona that
#                 creates drafts.
#   OPEN        — rung, not fired.
#   SENT_TO_KDS — fired, nothing plated yet. The guest walked out; the cashier writes it off.
# and stops there. From PARTIAL_READY onward food exists in the world, and deciding to write off
# food that was cooked is a manager's call — void.any, unchanged by this.
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
allow if {
    input.action == "void"
    common.has_permission(input, "pos.order.void.own")
    input.resource.created_by == input.user.id
    input.resource.status in cashier_voidable_statuses
    input.resource.amount_paid_paisa == 0
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
