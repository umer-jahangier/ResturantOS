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
