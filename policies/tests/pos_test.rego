package restaurantos.pos_test

import data.restaurantos.pos

tenant := "a0000001-0000-4000-8000-000000000001"
other_tenant := "c0000003-0000-4000-8000-000000000003"
branch := "b0000001-0000-4000-8000-000000000001"
other_branch := "b0000002-0000-4000-8000-000000000002"
user_id := "c0000001-0000-4000-8000-000000000001"
other_user := "c0000002-0000-4000-8000-000000000002"

base_user(permissions) := {
    "id": user_id,
    "tenant_id": tenant,
    "branch_id": branch,
    "permissions": permissions,
    "attributes": {},
}

base_user_with_attrs(permissions, attrs) := {
    "id": user_id,
    "tenant_id": tenant,
    "branch_id": branch,
    "permissions": permissions,
    "attributes": attrs,
}

# `amount_paid_paisa` is part of the baseline because the void.own rule reads it and Rego denies
# on an undefined field. An order with no tender recorded against it carries 0, which is what
# PosAuthorizationService.authorizeVoid sends; see test_void_own_absent_amount_paid_deny for the
# fail-closed behaviour when a caller omits it entirely.
# `any_line_plated` joins the baseline for the same reason: void.own reads it and Rego denies on an
# undefined field. False is the state of a check the kitchen has not plated anything on, which is
# what PosAuthorizationService.authorizeVoid sends for a DRAFT, an OPEN check or one still cooking;
# see test_void_own_absent_any_line_plated_deny for the fail-closed behaviour on an omission.
base_resource(extra) := object.union({
    "tenant_id": tenant,
    "branch_id": branch,
    "created_by": user_id,
    "status": "OPEN",
    "amount_paid_paisa": 0,
    "any_line_plated": false,
}, extra)

# ── void.any tests ────────────────────────────────────────────────────────────

test_void_any_allow if {
    pos.allow with input as {
        "user": base_user(["pos.order.void.any"]),
        "resource": base_resource({}),
        "action": "void",
    }
}

test_void_any_cross_tenant_deny if {
    not pos.allow with input as {
        "user": base_user(["pos.order.void.any"]),
        "resource": base_resource({"tenant_id": other_tenant}),
        "action": "void",
    }
}

test_void_any_cross_branch_deny if {
    not pos.allow with input as {
        "user": base_user(["pos.order.void.any"]),
        "resource": base_resource({"branch_id": other_branch}),
        "action": "void",
    }
}

# `pos.order.view`, not the uncatalogued `pos.order.read` this used to name. The distinction is the
# whole test: a WAITER holds `pos.order.view` and must not be able to void, so this asserts the
# rule refuses a real, common, same-module caller rather than a user holding nothing.
test_void_any_missing_permission_deny if {
    not pos.allow with input as {
        "user": base_user(["pos.order.view"]),
        "resource": base_resource({}),
        "action": "void",
    }
}

# ── void.own tests ────────────────────────────────────────────────────────────

test_void_own_allow if {
    pos.allow with input as {
        "user": base_user(["pos.order.void.own"]),
        "resource": base_resource({}),
        "action": "void",
    }
}

test_void_own_cross_tenant_deny if {
    not pos.allow with input as {
        "user": base_user(["pos.order.void.own"]),
        "resource": base_resource({"tenant_id": other_tenant}),
        "action": "void",
    }
}

test_void_own_cross_branch_deny if {
    not pos.allow with input as {
        "user": base_user(["pos.order.void.own"]),
        "resource": base_resource({"branch_id": other_branch}),
        "action": "void",
    }
}

test_void_own_missing_permission_deny if {
    not pos.allow with input as {
        "user": base_user([]),
        "resource": base_resource({}),
        "action": "void",
    }
}

test_void_own_wrong_creator_deny if {
    not pos.allow with input as {
        "user": base_user(["pos.order.void.own"]),
        "resource": base_resource({"created_by": other_user}),
        "action": "void",
    }
}

test_void_own_wrong_status_deny if {
    not pos.allow with input as {
        "user": base_user(["pos.order.void.own"]),
        "resource": base_resource({"status": "CLOSED"}),
        "action": "void",
    }
}

# ── void.own across the STATUS boundary (B2) ──────────────────────────────────
#
# The whole of B2 lives in these eight cases. The rule used to read `status == "OPEN"`, so the
# first of them failed while every other test in this file passed — a cashier could void a check
# they had not fired and nothing else. `test_void_own_allow` above did not catch it because OPEN
# is precisely the one status that worked.

test_void_own_after_firing_allow if {
    pos.allow with input as {
        "user": base_user(["pos.order.void.own"]),
        "resource": base_resource({"status": "SENT_TO_KDS"}),
        "action": "void",
    }
}

# A draft row's Cancel control posts to the same void endpoint (order-management.tsx,
# CancelDraftAction). A cashier is the only persona that creates drafts.
test_void_own_draft_allow if {
    pos.allow with input as {
        "user": base_user(["pos.order.void.own"]),
        "resource": base_resource({"status": "DRAFT"}),
        "action": "void",
    }
}

# ── void.own and THE PASS (B2 re-open) ────────────────────────────────────────
#
# Three tests stood here — test_void_own_partial_ready_deny, _ready_deny and _served_deny — each
# feeding a status literal ("PARTIAL_READY", "READY", "SERVED") and asserting a denial. All three
# passed, and all three were theatre: pos-service cannot produce any of those statuses. It declares
# them on OrderStatus but has never written the first or third, and stopped writing the second in
# fc6f389f. A live check holds SENT_TO_KDS from the fryer to the table.
#
# So the suite proved the rule refuses inputs that never arrive, while the input that DOES arrive —
# SENT_TO_KDS on a check whose food is cooked and served — was allowed. ORD-20260812-0340: the
# cashier's own void answered 200 after serve-all. A test that can only be asked an impossible
# question cannot fail for the real reason.
#
# These drive the field that carries the actual answer.

test_void_own_plated_deny if {
    not pos.allow with input as {
        "user": base_user(["pos.order.void.own"]),
        "resource": base_resource({"status": "SENT_TO_KDS", "any_line_plated": true}),
        "action": "void",
    }
}

# The exact shape of ORD-20260812-0340: fired, served, nothing paid — and the status the persisted
# column really held while that was true. This is the case the old three could not express.
test_void_own_served_check_is_plated_deny if {
    not pos.allow with input as {
        "user": base_user(["pos.order.void.own"]),
        "resource": base_resource({"status": "SENT_TO_KDS", "any_line_plated": true, "amount_paid_paisa": 0}),
        "action": "void",
    }
}

# ...and a manager still may, in the same state. Without this the two denials above would also be
# satisfied by a policy that refused every void, and B2's widening would be silently undone.
test_void_any_plated_allow if {
    pos.allow with input as {
        "user": base_user(["pos.order.void.any"]),
        "resource": base_resource({"status": "SENT_TO_KDS", "any_line_plated": true}),
        "action": "void",
    }
}

# Fail-closed on omission. A caller that does not send the field — authorization-service rebuilds
# this input from an HTTP body and cannot know the line statuses — is refused, not waved through.
# This is what makes `== false` the right form and `not input.resource.any_line_plated` the wrong
# one: the negated form would allow this.
test_void_own_absent_any_line_plated_deny if {
    not pos.allow with input as {
        "user": base_user(["pos.order.void.own"]),
        "resource": {
            "tenant_id": tenant,
            "branch_id": branch,
            "created_by": user_id,
            "status": "SENT_TO_KDS",
            "amount_paid_paisa": 0,
        },
        "action": "void",
    }
}

# ── void.own and MONEY (B2) ───────────────────────────────────────────────────
#
# A void writes no reversing entry. Once a tender exists the corrective action is a refund, and
# the policy says so itself rather than trusting the service layer to check first.

test_void_own_with_payment_deny if {
    not pos.allow with input as {
        "user": base_user(["pos.order.void.own"]),
        "resource": base_resource({"status": "SENT_TO_KDS", "amount_paid_paisa": 168260}),
        "action": "void",
    }
}

# A single paisa is money. There is no "small enough to ignore" tender.
test_void_own_with_one_paisa_deny if {
    not pos.allow with input as {
        "user": base_user(["pos.order.void.own"]),
        "resource": base_resource({"status": "OPEN", "amount_paid_paisa": 1}),
        "action": "void",
    }
}

# Fail-closed on an absent field: a caller that never sends amount_paid_paisa is denied, not
# waved through. Same reading as approval_limit_paisa in approval_gated_actions_test.rego.
test_void_own_absent_amount_paid_deny if {
    not pos.allow with input as {
        "user": base_user(["pos.order.void.own"]),
        "resource": {
            "tenant_id": tenant,
            "branch_id": branch,
            "created_by": user_id,
            "status": "OPEN",
        },
        "action": "void",
    }
}

# void.any is untouched by B2: a manager still voids at any status, and the service layer's
# ORDER_HAS_PAYMENTS 409 is what stops them stranding a tender.
test_void_any_after_firing_still_allow if {
    pos.allow with input as {
        "user": base_user(["pos.order.void.any"]),
        "resource": base_resource({"status": "SERVED", "created_by": other_user}),
        "action": "void",
    }
}

# ── KITCHEN_STAFF role denied all pos.order.* actions ─────────────────────────

test_kitchen_staff_denied_void_own if {
    not pos.allow with input as {
        "user": base_user(["pos.kds.view", "pos.kds.update"]),
        "resource": base_resource({}),
        "action": "void",
    }
}

test_kitchen_staff_denied_void_any if {
    not pos.allow with input as {
        "user": base_user(["pos.kds.view", "pos.kds.update"]),
        "resource": base_resource({}),
        "action": "void",
    }
}

test_kitchen_staff_denied_refund if {
    not pos.allow with input as {
        "user": base_user_with_attrs(
            ["pos.kds.view", "pos.kds.update"],
            {"approval_limit_paisa": 99999}
        ),
        "resource": object.union(base_resource({"status": "CLOSED"}), {"amount_paisa": 1000}),
        "action": "pos.order.refund",
    }
}

test_kitchen_staff_denied_discount_override if {
    not pos.allow with input as {
        "user": base_user(["pos.kds.view", "pos.kds.update"]),
        "resource": base_resource({}),
        "action": "pos.order.discount.override",
    }
}

test_kitchen_staff_denied_split_bill if {
    not pos.allow with input as {
        "user": base_user(["pos.kds.view", "pos.kds.update"]),
        "resource": base_resource({}),
        "action": "pos.order.split_bill",
    }
}

# ── CASHIER denied void.any and refund ────────────────────────────────────────

test_cashier_denied_void_any if {
    not pos.allow with input as {
        "user": base_user(["pos.order.create", "pos.order.view", "pos.order.update", "pos.order.send_to_kds"]),
        "resource": base_resource({"created_by": other_user}),
        "action": "void",
    }
}

test_cashier_denied_refund_no_permission if {
    not pos.allow with input as {
        "user": base_user_with_attrs(
            ["pos.order.create", "pos.order.view", "pos.order.update", "pos.order.send_to_kds"],
            {"approval_limit_paisa": 99999}
        ),
        "resource": object.union(base_resource({"status": "CLOSED"}), {"amount_paisa": 1000}),
        "action": "pos.order.refund",
    }
}

# ── MANAGER refund with approval_limit_paisa threshold ────────────────────────

test_manager_refund_within_limit_allow if {
    pos.allow with input as {
        "user": base_user_with_attrs(
            ["pos.order.refund"],
            {"approval_limit_paisa": 10000}
        ),
        "resource": object.union(base_resource({"status": "CLOSED"}), {"amount_paisa": 5000}),
        "action": "pos.order.refund",
    }
}

test_manager_refund_exact_limit_allow if {
    pos.allow with input as {
        "user": base_user_with_attrs(
            ["pos.order.refund"],
            {"approval_limit_paisa": 10000}
        ),
        "resource": object.union(base_resource({"status": "CLOSED"}), {"amount_paisa": 10000}),
        "action": "pos.order.refund",
    }
}

test_manager_refund_over_limit_deny if {
    not pos.allow with input as {
        "user": base_user_with_attrs(
            ["pos.order.refund"],
            {"approval_limit_paisa": 10000}
        ),
        "resource": object.union(base_resource({"status": "CLOSED"}), {"amount_paisa": 15000}),
        "action": "pos.order.refund",
    }
}

test_manager_refund_cross_branch_deny if {
    not pos.allow with input as {
        "user": base_user_with_attrs(
            ["pos.order.refund"],
            {"approval_limit_paisa": 10000}
        ),
        "resource": object.union(
            base_resource({"status": "CLOSED", "branch_id": other_branch}),
            {"amount_paisa": 5000}
        ),
        "action": "pos.order.refund",
    }
}

# ── OWNER allowed everything ──────────────────────────────────────────────────

owner_perms := [
    "pos.order.void.own", "pos.order.void.any",
    "pos.order.refund", "pos.order.discount.override", "pos.order.split_bill",
    "pos.kds.view", "pos.kds.update"
]

test_owner_void_allow if {
    pos.allow with input as {
        "user": base_user(owner_perms),
        "resource": base_resource({}),
        "action": "void",
    }
}

test_owner_refund_allow if {
    pos.allow with input as {
        "user": base_user_with_attrs(owner_perms, {"approval_limit_paisa": 999999}),
        "resource": object.union(base_resource({"status": "CLOSED"}), {"amount_paisa": 50000}),
        "action": "pos.order.refund",
    }
}

test_owner_discount_override_allow if {
    pos.allow with input as {
        "user": base_user(owner_perms),
        "resource": base_resource({}),
        "action": "pos.order.discount.override",
    }
}

test_owner_split_bill_allow if {
    pos.allow with input as {
        "user": base_user(owner_perms),
        "resource": base_resource({}),
        "action": "pos.order.split_bill",
    }
}

# ── discount override tests ────────────────────────────────────────────────────

test_discount_override_allow if {
    pos.allow with input as {
        "user": base_user(["pos.order.discount.override"]),
        "resource": base_resource({}),
        "action": "pos.order.discount.override",
    }
}

test_discount_override_no_permission_deny if {
    not pos.allow with input as {
        "user": base_user(["pos.order.create"]),
        "resource": base_resource({}),
        "action": "pos.order.discount.override",
    }
}

test_discount_override_cross_branch_deny if {
    not pos.allow with input as {
        "user": base_user(["pos.order.discount.override"]),
        "resource": base_resource({"branch_id": other_branch}),
        "action": "pos.order.discount.override",
    }
}

# ── split bill tests ──────────────────────────────────────────────────────────

test_split_bill_allow if {
    pos.allow with input as {
        "user": base_user(["pos.order.split_bill"]),
        "resource": base_resource({}),
        "action": "pos.order.split_bill",
    }
}

test_split_bill_no_permission_deny if {
    not pos.allow with input as {
        "user": base_user(["pos.order.create"]),
        "resource": base_resource({}),
        "action": "pos.order.split_bill",
    }
}

test_split_bill_cross_branch_deny if {
    not pos.allow with input as {
        "user": base_user(["pos.order.split_bill"]),
        "resource": base_resource({"branch_id": other_branch}),
        "action": "pos.order.split_bill",
    }
}

# ── pos.order.add_item — the per-user MENU CATEGORY boundary (Program A) ──────
#
# The rule pair has exactly two live branches — "carries no usable scope" and "carries one" — and
# the whole risk sits in what counts as "usable". Seven degenerate token shapes must ALL degrade to
# unrestricted, because every user in the product carries none of this claim today and a rule that
# read one of those shapes as an empty allow-list would stop the tills. Each shape therefore gets
# its own test rather than one test and an argument.

drinks := "d0000001-0000-4000-8000-000000000001"
food := "d0000002-0000-4000-8000-000000000002"
desserts := "d0000003-0000-4000-8000-000000000003"

# The permission the endpoint already requires. Named once, so a widening shows up as a diff here.
add_item_perms := ["pos.order.update"]

add_item_input(attrs, category_id) := {
    "user": base_user_with_attrs(add_item_perms, attrs),
    "resource": base_resource({"category_id": category_id}),
    "action": "pos.order.add_item",
}

# ── the scoped path: a narrowed cashier ───────────────────────────────────────

test_add_item_scoped_in_scope_allow if {
    pos.allow with input as add_item_input({"menu_categories": [drinks, desserts]}, drinks)
}

test_add_item_scoped_second_entry_in_scope_allow if {
    pos.allow with input as add_item_input({"menu_categories": [drinks, desserts]}, desserts)
}

# THE POINT OF THE WHOLE PROGRAM: a counter cashier scoped to drinks rings a food item.
test_add_item_scoped_out_of_scope_deny if {
    not pos.allow with input as add_item_input({"menu_categories": [drinks]}, food)
}

# A single-entry scope is a real scope, not a degenerate one.
test_add_item_single_entry_scope_excludes_everything_else if {
    not pos.allow with input as add_item_input({"menu_categories": [desserts]}, drinks)
}

# ── the unrestricted path: every degenerate shape degrades PERMISSIVE ─────────
#
# R2. Getting any single one of these backwards is a total POS outage, not a policy nit.

# 1. attributes present, carrying no such key — the state of every user in the product today.
test_add_item_no_claim_allow if {
    pos.allow with input as add_item_input({}, food)
}

# 2. attributes carrying OTHER keys but not this one — e.g. a manager's approval limit.
test_add_item_other_attributes_only_allow if {
    pos.allow with input as add_item_input({"approval_limit_paisa": 50000}, food)
}

# 3. attributes explicitly JSON null. THIS is the case the naive negation gets backwards.
test_add_item_null_attributes_allow if {
    pos.allow with input as {
        "user": {
            "id": user_id,
            "tenant_id": tenant,
            "branch_id": branch,
            "permissions": add_item_perms,
            "attributes": null,
        },
        "resource": base_resource({"category_id": food}),
        "action": "pos.order.add_item",
    }
}

# 4. the attributes key absent from the user object entirely.
test_add_item_absent_attributes_allow if {
    pos.allow with input as {
        "user": {
            "id": user_id,
            "tenant_id": tenant,
            "branch_id": branch,
            "permissions": add_item_perms,
        },
        "resource": base_resource({"category_id": food}),
        "action": "pos.order.add_item",
    }
}

# 5. the key present holding an EMPTY list. An empty allow-list has no legitimate meaning, and
#    reading one as "permitted: nothing" is what turns a malformed token into a till that cannot
#    ring. PermissionResolver never mints this shape; a hand-edited or half-migrated one can exist.
test_add_item_empty_list_allow if {
    pos.allow with input as add_item_input({"menu_categories": []}, food)
}

# 6. the key present holding something that is not a list at all.
test_add_item_non_list_claim_allow if {
    pos.allow with input as add_item_input({"menu_categories": drinks}, food)
}

# 7. the key present holding a list with no usable string in it.
test_add_item_list_of_non_strings_allow if {
    pos.allow with input as add_item_input({"menu_categories": [1, 2]}, food)
}

# A list that MIXES a usable entry with junk is RESTRICTED, not unrestricted: the junk is dropped
# and the real entry still binds. The permissive degrade is only for tokens that say nothing usable
# at all — otherwise one bad element in a list would silently unlock the whole menu.
test_add_item_mixed_list_still_restricts if {
    not pos.allow with input as add_item_input({"menu_categories": [drinks, 7]}, food)
}

test_add_item_mixed_list_honours_the_usable_entry if {
    pos.allow with input as add_item_input({"menu_categories": [drinks, 7]}, drinks)
}

# ── fail-closed on a resource that cannot say what it is ──────────────────────
#
# authorization-service's 7-arg Resource constructor leaves category_id null, so its add_item
# attempts deny for a scoped caller. Only pos-service's own call — which sets the category from the
# MenuItem it just resolved under a tenant predicate — can allow one.

test_add_item_scoped_absent_category_deny if {
    not pos.allow with input as {
        "user": base_user_with_attrs(add_item_perms, {"menu_categories": [drinks]}),
        "resource": base_resource({}),
        "action": "pos.order.add_item",
    }
}

test_add_item_scoped_null_category_deny if {
    not pos.allow with input as add_item_input({"menu_categories": [drinks]}, null)
}

# An UNRESTRICTED caller does not need to say what category it is ringing — there is nothing to
# compare it against. This is what keeps the do-nothing default doing nothing.
test_add_item_unrestricted_absent_category_allow if {
    pos.allow with input as {
        "user": base_user(add_item_perms),
        "resource": base_resource({}),
        "action": "pos.order.add_item",
    }
}

# ── the guards this rule shares with every other rule in the module ───────────

test_add_item_no_permission_deny if {
    not pos.allow with input as {
        "user": base_user_with_attrs(["pos.order.view"], {}),
        "resource": base_resource({"category_id": food}),
        "action": "pos.order.add_item",
    }
}

test_add_item_cross_tenant_deny if {
    not pos.allow with input as {
        "user": base_user_with_attrs(add_item_perms, {}),
        "resource": base_resource({"tenant_id": other_tenant, "category_id": food}),
        "action": "pos.order.add_item",
    }
}

test_add_item_cross_branch_deny if {
    not pos.allow with input as {
        "user": base_user_with_attrs(add_item_perms, {}),
        "resource": base_resource({"branch_id": other_branch, "category_id": food}),
        "action": "pos.order.add_item",
    }
}

# The scope must not leak sideways into the other actions in this module: holding pos.order.update
# and a category scope is not a void permission, and a scope is not a discount.
test_add_item_scope_does_not_grant_void if {
    not pos.allow with input as {
        "user": base_user_with_attrs(["pos.order.update"], {"menu_categories": [drinks]}),
        "resource": base_resource({"category_id": drinks}),
        "action": "void",
    }
}

test_add_item_permission_does_not_grant_other_actions if {
    not pos.allow with input as {
        "user": base_user_with_attrs(add_item_perms, {}),
        "resource": base_resource({"category_id": drinks}),
        "action": "pos.order.split_bill",
    }
}
