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
base_resource(extra) := object.union({
    "tenant_id": tenant,
    "branch_id": branch,
    "created_by": user_id,
    "status": "OPEN",
    "amount_paid_paisa": 0,
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

# ...and the boundary holds on the other side. Once the kitchen has plated anything, writing the
# check off is void.any's business, not the cashier's.
test_void_own_partial_ready_deny if {
    not pos.allow with input as {
        "user": base_user(["pos.order.void.own"]),
        "resource": base_resource({"status": "PARTIAL_READY"}),
        "action": "void",
    }
}

test_void_own_ready_deny if {
    not pos.allow with input as {
        "user": base_user(["pos.order.void.own"]),
        "resource": base_resource({"status": "READY"}),
        "action": "void",
    }
}

test_void_own_served_deny if {
    not pos.allow with input as {
        "user": base_user(["pos.order.void.own"]),
        "resource": base_resource({"status": "SERVED"}),
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
