package restaurantos.inventory_test

import data.restaurantos.inventory

tenant       := "a0000001-0000-4000-8000-000000000001"
other_tenant := "c0000003-0000-4000-8000-000000000003"
branch       := "b0000001-0000-4000-8000-000000000001"
other_branch := "b0000002-0000-4000-8000-000000000002"
user_id      := "c0000001-0000-4000-8000-000000000001"

inventory_resource := {
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

# ── INVENTORY_MANAGER (inventory.item.view + inventory.item.manage) ─────────

test_inventory_manager_can_view if {
    inventory.allow with input as {
        "user":     base_user(["inventory.item.view", "inventory.item.manage"]),
        "resource": inventory_resource,
        "action":   "inventory.item.view",
    }
}

test_inventory_manager_can_manage if {
    inventory.allow with input as {
        "user":     base_user(["inventory.item.view", "inventory.item.manage"]),
        "resource": inventory_resource,
        "action":   "inventory.item.manage",
    }
}

# ── View-only user (inventory.item.view only) ────────────────────────────────

test_view_only_can_view if {
    inventory.allow with input as {
        "user":     base_user(["inventory.item.view"]),
        "resource": inventory_resource,
        "action":   "inventory.item.view",
    }
}

test_view_only_denied_manage if {
    not inventory.allow with input as {
        "user":     base_user(["inventory.item.view"]),
        "resource": inventory_resource,
        "action":   "inventory.item.manage",
    }
}

# ── No permissions at all ─────────────────────────────────────────────────────

test_no_perms_denied_view if {
    not inventory.allow with input as {
        "user":     base_user([]),
        "resource": inventory_resource,
        "action":   "inventory.item.view",
    }
}

test_no_perms_denied_manage if {
    not inventory.allow with input as {
        "user":     base_user([]),
        "resource": inventory_resource,
        "action":   "inventory.item.manage",
    }
}

# ── Unrelated permissions (e.g. finance/kds) ─────────────────────────────────

test_unrelated_perms_denied_view if {
    not inventory.allow with input as {
        "user":     base_user(["finance.report.view", "pos.kds.view"]),
        "resource": inventory_resource,
        "action":   "inventory.item.view",
    }
}

test_unrelated_perms_denied_manage if {
    not inventory.allow with input as {
        "user":     base_user(["finance.report.view", "pos.kds.view"]),
        "resource": inventory_resource,
        "action":   "inventory.item.manage",
    }
}

# ── Cross-branch isolation (denied even with both permissions) ──────────────

test_cross_branch_denied_view if {
    not inventory.allow with input as {
        "user":     base_user(["inventory.item.view", "inventory.item.manage"]),
        "resource": {"tenant_id": tenant, "branch_id": other_branch},
        "action":   "inventory.item.view",
    }
}

test_cross_branch_denied_manage if {
    not inventory.allow with input as {
        "user":     base_user(["inventory.item.view", "inventory.item.manage"]),
        "resource": {"tenant_id": tenant, "branch_id": other_branch},
        "action":   "inventory.item.manage",
    }
}

# ── Cross-tenant isolation (denied even with both permissions) ──────────────

test_cross_tenant_denied_view if {
    not inventory.allow with input as {
        "user":     base_user(["inventory.item.view", "inventory.item.manage"]),
        "resource": {"tenant_id": other_tenant, "branch_id": branch},
        "action":   "inventory.item.view",
    }
}

test_cross_tenant_denied_manage if {
    not inventory.allow with input as {
        "user":     base_user(["inventory.item.view", "inventory.item.manage"]),
        "resource": {"tenant_id": other_tenant, "branch_id": branch},
        "action":   "inventory.item.manage",
    }
}
