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
}

base_resource(extra) := object.union({
    "tenant_id": tenant,
    "branch_id": branch,
    "created_by": user_id,
    "status": "OPEN",
}, extra)

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

test_void_any_missing_permission_deny if {
    not pos.allow with input as {
        "user": base_user(["pos.order.read"]),
        "resource": base_resource({}),
        "action": "void",
    }
}

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
