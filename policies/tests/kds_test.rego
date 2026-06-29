package restaurantos.kds_test

import data.restaurantos.kds

tenant       := "a0000001-0000-4000-8000-000000000001"
other_tenant := "c0000003-0000-4000-8000-000000000003"
branch       := "b0000001-0000-4000-8000-000000000001"
other_branch := "b0000002-0000-4000-8000-000000000002"
user_id      := "c0000001-0000-4000-8000-000000000001"

kds_resource := {
    "tenant_id": tenant,
    "branch_id": branch,
}

# ── helper ────────────────────────────────────────────────────────────────────

base_user(permissions) := {
    "id":          user_id,
    "tenant_id":   tenant,
    "branch_id":   branch,
    "permissions": permissions,
    "attributes":  {},
}

# ── KITCHEN_STAFF (pos.kds.view + pos.kds.update) ────────────────────────────

test_kitchen_staff_can_view if {
    kds.allow with input as {
        "user":     base_user(["pos.kds.view", "pos.kds.update"]),
        "resource": kds_resource,
        "action":   "pos.kds.view",
    }
}

test_kitchen_staff_can_update if {
    kds.allow with input as {
        "user":     base_user(["pos.kds.view", "pos.kds.update"]),
        "resource": kds_resource,
        "action":   "pos.kds.update",
    }
}

# ── OWNER (all permissions) ───────────────────────────────────────────────────

test_owner_can_view if {
    kds.allow with input as {
        "user":     base_user(["pos.kds.view", "pos.kds.update", "pos.order.update"]),
        "resource": kds_resource,
        "action":   "pos.kds.view",
    }
}

test_owner_can_update if {
    kds.allow with input as {
        "user":     base_user(["pos.kds.view", "pos.kds.update", "pos.order.update"]),
        "resource": kds_resource,
        "action":   "pos.kds.update",
    }
}

# ── MANAGER (pos.kds.view only — read-only oversight) ────────────────────────

test_manager_can_view if {
    kds.allow with input as {
        "user":     base_user(["pos.kds.view"]),
        "resource": kds_resource,
        "action":   "pos.kds.view",
    }
}

test_manager_denied_update if {
    not kds.allow with input as {
        "user":     base_user(["pos.kds.view"]),
        "resource": kds_resource,
        "action":   "pos.kds.update",
    }
}

# ── CASHIER (pos.order.* — no kds perms) ─────────────────────────────────────

test_cashier_denied_view if {
    not kds.allow with input as {
        "user":     base_user(["pos.order.update", "pos.order.send_to_kds"]),
        "resource": kds_resource,
        "action":   "pos.kds.view",
    }
}

test_cashier_denied_update if {
    not kds.allow with input as {
        "user":     base_user(["pos.order.update", "pos.order.send_to_kds"]),
        "resource": kds_resource,
        "action":   "pos.kds.update",
    }
}

# ── ACCOUNTANT (finance perms — no kds perms) ────────────────────────────────

test_accountant_denied_view if {
    not kds.allow with input as {
        "user":     base_user(["finance.report.view", "finance.period.manage"]),
        "resource": kds_resource,
        "action":   "pos.kds.view",
    }
}

test_accountant_denied_update if {
    not kds.allow with input as {
        "user":     base_user(["finance.report.view", "finance.period.manage"]),
        "resource": kds_resource,
        "action":   "pos.kds.update",
    }
}

# ── FINANCE_VIEWER (finance.report.view only) ────────────────────────────────

test_finance_viewer_denied_view if {
    not kds.allow with input as {
        "user":     base_user(["finance.report.view"]),
        "resource": kds_resource,
        "action":   "pos.kds.view",
    }
}

test_finance_viewer_denied_update if {
    not kds.allow with input as {
        "user":     base_user(["finance.report.view"]),
        "resource": kds_resource,
        "action":   "pos.kds.update",
    }
}

# ── Cross-branch isolation ────────────────────────────────────────────────────

test_cross_branch_denied_view if {
    not kds.allow with input as {
        "user":     base_user(["pos.kds.view", "pos.kds.update"]),
        "resource": {"tenant_id": tenant, "branch_id": other_branch},
        "action":   "pos.kds.view",
    }
}

test_cross_branch_denied_update if {
    not kds.allow with input as {
        "user":     base_user(["pos.kds.view", "pos.kds.update"]),
        "resource": {"tenant_id": tenant, "branch_id": other_branch},
        "action":   "pos.kds.update",
    }
}

# ── Cross-tenant isolation ────────────────────────────────────────────────────

test_cross_tenant_denied_view if {
    not kds.allow with input as {
        "user":     base_user(["pos.kds.view", "pos.kds.update"]),
        "resource": {"tenant_id": other_tenant, "branch_id": branch},
        "action":   "pos.kds.view",
    }
}

test_cross_tenant_denied_update if {
    not kds.allow with input as {
        "user":     base_user(["pos.kds.view", "pos.kds.update"]),
        "resource": {"tenant_id": other_tenant, "branch_id": branch},
        "action":   "pos.kds.update",
    }
}

# ── No permissions at all ─────────────────────────────────────────────────────

test_no_perms_denied_view if {
    not kds.allow with input as {
        "user":     base_user([]),
        "resource": kds_resource,
        "action":   "pos.kds.view",
    }
}
