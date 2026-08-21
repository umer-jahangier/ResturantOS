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

# ── pos.order.add_item — the per-user MENU CATEGORY boundary (Program A) ──────────────────────
#
# WHAT THIS IS FOR. A restaurant runs a counter till that may only sell drinks and a waiter who may
# sell everything. Before this rule the product could CONFIGURE that (V15's pos_terminal_categories,
# written by the admin screen since phase 28) and could not ENFORCE it: MenuController.listItems
# took (categoryId, branchId, pageable) and OrderServiceImpl.addItem made no authorization call at
# all, so the whole menu was one POST away regardless of what any screen showed. Hiding a button is
# not a boundary — the user asked for the server to REFUSE.
#
# WHY THE ALLOW-LIST IS ON input.user AND NOT ON input.resource. It is a fact about the PERSON, and
# only input.user is trustworthy. shared-lib's AuthorizationService builds input.user from the
# verified JwtClaims; authorization-service's AuthorizeService — the endpoint exposed to anyone —
# does the same, and builds input.resource from the untrusted request body. An allow-list carried on
# the resource is therefore fail-OPEN by construction: send a wider list, walk through. The category
# being rung is the opposite kind of fact — it is about the ITEM — so it rides the resource, where
# pos-service sets it from the server-resolved MenuItem and never from the request.
#
# WHY THERE IS NO input.resource.terminal_id CLAUSE. Nothing signed says which terminal you are.
# There is no user→terminal table, no terminal claim and no orders.terminal_id, so a terminal id can
# only ever be client-asserted — and KdsAuthorizationService already wrote the rule for that case:
# "a view scope a client can assert is not a view scope, it is a suggestion". Terminal category
# scope survives as a device-level FILTER on the grid (MenuCategoryScope in pos-service), which is
# the one thing a client-asserted id may safely do, because it can only narrow.
#
# THE PERMISSION IS pos.order.update, UNCHANGED. That is exactly what OrderController's
# @PreAuthorize on POST /orders/{id}/items already requires. Naming it here widens nothing and
# narrows nothing; it means an OPA that is reachable cannot answer "allow" for a caller the
# @PreAuthorize would have refused, which is what makes this a second line rather than a fork.

# The categories this caller may ring, as a SET — and DEFINED ONLY when the token carries a
# well-formed, non-empty list of them.
#
# READ THE UNDEFINED CASES, THEY ARE THE WHOLE RULE. Every one of these leaves this undefined, and
# therefore leaves the caller UNRESTRICTED:
#
#   attributes absent          input.user.attributes.menu_categories  -> undefined
#   attributes JSON null       key lookup on null                     -> undefined
#   attributes {}              missing key                            -> undefined
#   key present, []            is_array passes, the set is empty      -> count 0, undefined
#   key present, "DRINKS"      is_array fails                         -> undefined
#   key present, [1, 2]        no string survives the comprehension   -> count 0, undefined
#
# That asymmetry is not laziness, it is the entire back-compatibility story and it is the single
# highest-blast-radius decision in this file. Every user in the product today carries no such claim.
#
# MEASURED, not assumed. The naive spelling — `not input.user.attributes.menu_categories` written
# straight into the allow body — was substituted for the two lines below and `opa test policies/`
# re-run. It handles the absent and JSON-null cases correctly (a key lookup on null is undefined, so
# the negation still succeeds), which is the opposite of what the design predicted. What it gets
# WRONG is the three malformed-but-present shapes: `[]`, a bare string, and a list holding no
# string. Each of those is truthy to a bare negation, so the naive rule DENIES, and a token carrying
# `menu_categories: []` would stop that operator ringing anything at all:
#
#   FAIL test_add_item_empty_list_allow
#   FAIL test_add_item_non_list_claim_allow
#   FAIL test_add_item_list_of_non_strings_allow
#
# PermissionResolver never mints those shapes today, so the naive form would have shipped green and
# waited for the first hand-edited token or half-finished migration. That is the defect class this
# branch keeps finding, so the check is written against the VALUE, not against the key's presence.
#
# A set comprehension is a `{…}` literal, so this MUST live at package level: PolicyReachabilityTest
# scans rule bodies with `allow\s+if\s*\{([^}]*)}` and a brace inside an allow body truncates the
# scan, silently dropping the rule from the reachability and action-guard checks. Same trap, same
# answer, as cashier_voidable_statuses above.
menu_category_scope := scope if {
    raw := input.user.attributes.menu_categories
    is_array(raw)
    scope := {c | some c in raw; is_string(c)}
    count(scope) > 0
}

# True only when the caller genuinely carries a usable scope. Undefined (hence `not` succeeds) in
# every degenerate case above, because count() of an undefined value is undefined.
menu_scope_restricted if {
    count(menu_category_scope) > 0
}

# add_item, UNRESTRICTED: the caller carries no usable menu-category scope. This is every user in
# the product today and must stay the do-nothing default.
allow if {
    input.action == "pos.order.add_item"
    common.has_permission(input, "pos.order.update")
    common.same_tenant_and_branch(input)
    not menu_scope_restricted
}

# add_item, SCOPED: the caller carries a scope, and the item's category is in it.
#
# `in` against the set rather than a negation, deliberately, for the same reason void.own writes
# `any_line_plated == false` rather than `not …`: an ABSENT input.resource.category_id makes this
# expression undefined, the body fails, and the rule denies. A caller that cannot say what category
# it is ringing does not get the benefit of the doubt — which is load-bearing for
# authorization-service, whose 7-arg Resource constructor leaves category_id null.
allow if {
    input.action == "pos.order.add_item"
    common.has_permission(input, "pos.order.update")
    common.same_tenant_and_branch(input)
    input.resource.category_id in menu_category_scope
}
