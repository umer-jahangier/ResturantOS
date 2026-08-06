package restaurantos.rbac_test

import data.restaurantos.rbac

tenant := "a0000001-0000-4000-8000-000000000001"
other_tenant := "c0000003-0000-4000-8000-000000000003"
branch := "b0000001-0000-4000-8000-000000000001"
other_branch := "b0000002-0000-4000-8000-000000000002"

base_user(permissions) := {
    "tenant_id": tenant,
    "branch_id": branch,
    "permissions": permissions,
}

base_resource(extra) := object.union({
    "tenant_id": tenant,
    "branch_id": branch,
}, extra)

test_rbac_manage_allow if {
    rbac.allow with input as {
        "user": base_user(["rbac.manage"]),
        "resource": base_resource({}),
        "action": "manage",
    }
}

test_rbac_cross_tenant_deny if {
    not rbac.allow with input as {
        "user": base_user(["rbac.manage"]),
        "resource": base_resource({"tenant_id": other_tenant}),
        "action": "manage",
    }
}

test_rbac_cross_branch_deny if {
    not rbac.allow with input as {
        "user": base_user(["rbac.manage"]),
        "resource": base_resource({"branch_id": other_branch}),
        "action": "manage",
    }
}

test_rbac_missing_permission_deny if {
    not rbac.allow with input as {
        "user": base_user(["pos.order.read"]),
        "resource": base_resource({}),
        "action": "manage",
    }
}

# ── Phase 13: the three codes split out of rbac.manage ────────────────────────
#
# TENANT_ADMIN holds these three and does NOT hold rbac.manage, so without a rule per code a tenant
# admin is denied every administrative action by this policy while the Spring @PreAuthorize gates
# let them through — the two enforcement layers would disagree, and only one of them would be
# visible in a stack trace.

test_rbac_user_manage_allow if {
    rbac.allow with input as {
        "user": base_user(["rbac.user.manage"]),
        "resource": base_resource({}),
        "action": "manage",
    }
}

test_rbac_role_manage_allow if {
    rbac.allow with input as {
        "user": base_user(["rbac.role.manage"]),
        "resource": base_resource({}),
        "action": "manage",
    }
}

test_branch_manage_allow if {
    rbac.allow with input as {
        "user": base_user(["branch.manage"]),
        "resource": base_resource({}),
        "action": "manage",
    }
}

# Tenant and branch scoping still binds on the new codes. A widened allow rule that forgot
# same_tenant_and_branch would pass every positive test above and let a tenant admin administer
# another tenant.
test_rbac_user_manage_cross_tenant_deny if {
    not rbac.allow with input as {
        "user": base_user(["rbac.user.manage"]),
        "resource": base_resource({"tenant_id": other_tenant}),
        "action": "manage",
    }
}

test_rbac_role_manage_cross_branch_deny if {
    not rbac.allow with input as {
        "user": base_user(["rbac.role.manage"]),
        "resource": base_resource({"branch_id": other_branch}),
        "action": "manage",
    }
}

test_branch_manage_cross_tenant_deny if {
    not rbac.allow with input as {
        "user": base_user(["branch.manage"]),
        "resource": base_resource({"tenant_id": other_tenant}),
        "action": "manage",
    }
}

# The negative that matters most: holding a plausible-looking administration-adjacent code, and
# none of the four enumerated ones, is still a deny. This is what a prefix match would have broken.
test_rbac_no_admin_permission_deny if {
    not rbac.allow with input as {
        "user": base_user(["rbac.user.view", "branch.view", "pos.order.create"]),
        "resource": base_resource({}),
        "action": "manage",
    }
}
