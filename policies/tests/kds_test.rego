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
#
# These four codes are the ACCOUNTANT role's REAL grants, read from role_permissions on
# 2026-08-12 (the role holds 27 in total). They used to read `finance.report.view` and
# `finance.period.manage`, neither of which is in the permissions catalog and neither of which
# any role has ever held — so the "accountant" these tests denied was a user holding NOTHING,
# and the denial proved nothing about an accountant.
#
# `pos.order.view` is the load-bearing one and is why the list is not just finance codes. A real
# ACCOUNTANT holds it. It is the nearest miss to `pos.kds.view` in the whole catalogue — same
# module, same verb — so if kds.rego were ever widened to accept it, THIS is the test that has to
# go red. With the old fixture it stayed green.

accountant_permissions := [
    "finance.journal.view",
    "finance.coa.view",
    "finance.period.close",
    "pos.order.view",
]

test_accountant_denied_view if {
    not kds.allow with input as {
        "user":     base_user(accountant_permissions),
        "resource": kds_resource,
        "action":   "pos.kds.view",
    }
}

test_accountant_denied_update if {
    not kds.allow with input as {
        "user":     base_user(accountant_permissions),
        "resource": kds_resource,
        "action":   "pos.kds.update",
    }
}

# ── A finance read code on its own ───────────────────────────────────────────
#
# Was headed "FINANCE_VIEWER (finance.report.view only)" — doubly fictional. FINANCE_VIEWER is a
# role that deliberately does NOT exist: changeset 082 deleted its orphan grants and
# RoleCatalogClosureTest now fails the build if a role_code reappears without a roles row. And
# `finance.report.view` is in no catalogue. So this asserted that a nonexistent role holding a
# nonexistent permission is refused.
#
# What it is actually worth testing is the single-code case: holding exactly one real finance read
# grant is not enough for a board. `finance.journal.view` is that code — ACCOUNTANT, OWNER and
# TENANT_ADMIN all hold it.

test_single_finance_read_code_denied_view if {
    not kds.allow with input as {
        "user":     base_user(["finance.journal.view"]),
        "resource": kds_resource,
        "action":   "pos.kds.view",
    }
}

test_single_finance_read_code_denied_update if {
    not kds.allow with input as {
        "user":     base_user(["finance.journal.view"]),
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
