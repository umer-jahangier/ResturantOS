package restaurantos.vendor_test

import data.restaurantos.vendor

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

test_manage_allow if {
    vendor.allow with input as {
        "action": "manage",
        "user": base_user(["vendor.manage"]),
        "resource": base_resource({}),
    }
}

test_manage_cross_tenant_deny if {
    not vendor.allow with input as {
        "action": "manage",
        "user": base_user(["vendor.manage"]),
        "resource": base_resource({"tenant_id": other_tenant}),
    }
}

test_manage_cross_branch_deny if {
    not vendor.allow with input as {
        "action": "manage",
        "user": base_user(["vendor.manage"]),
        "resource": base_resource({"branch_id": other_branch}),
    }
}

test_manage_missing_permission_deny if {
    not vendor.allow with input as {
        "action": "manage",
        "user": base_user([]),
        "resource": base_resource({}),
    }
}

test_approve_po_allow if {
    vendor.allow with input as {
        "action": "approve_po",
        "user": base_user(["vendor.po.approve"]),
        "resource": base_resource({}),
    }
}

test_approve_po_cross_tenant_deny if {
    not vendor.allow with input as {
        "action": "approve_po",
        "user": base_user(["vendor.po.approve"]),
        "resource": base_resource({"tenant_id": other_tenant}),
    }
}

test_approve_po_cross_branch_deny if {
    not vendor.allow with input as {
        "action": "approve_po",
        "user": base_user(["vendor.po.approve"]),
        "resource": base_resource({"branch_id": other_branch}),
    }
}

test_approve_po_missing_permission_deny if {
    not vendor.allow with input as {
        "action": "approve_po",
        "user": base_user(["vendor.manage"]),
        "resource": base_resource({}),
    }
}
