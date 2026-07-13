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
    "attributes": {"approval_limit_paisa": 1000000},
}

base_user_with_limit(permissions, limit) := {
    "tenant_id": tenant,
    "branch_id": branch,
    "permissions": permissions,
    "attributes": {"approval_limit_paisa": limit},
}

base_resource(extra) := object.union({
    "tenant_id": tenant,
    "branch_id": branch,
    "amount_paisa": 500000,
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

test_approve_po_within_limit_allow if {
    vendor.allow with input as {
        "action": "approve_po",
        "user": base_user_with_limit(["vendor.po.approve"], 1000000),
        "resource": base_resource({"amount_paisa": 500000}),
    }
}

test_approve_po_over_limit_deny if {
    not vendor.allow with input as {
        "action": "approve_po",
        "user": base_user_with_limit(["vendor.po.approve"], 1000000),
        "resource": base_resource({"amount_paisa": 1500000}),
    }
}

test_approve_po_missing_limit_attribute_deny if {
    not vendor.allow with input as {
        "action": "approve_po",
        "user": {
            "tenant_id": tenant,
            "branch_id": branch,
            "permissions": ["vendor.po.approve"],
            "attributes": {},
        },
        "resource": base_resource({"amount_paisa": 500000}),
    }
}

test_close_po_allow if {
    vendor.allow with input as {
        "action": "close_po",
        "user": base_user(["vendor.po.close"]),
        "resource": base_resource({}),
    }
}

test_close_po_missing_permission_deny if {
    not vendor.allow with input as {
        "action": "close_po",
        "user": base_user(["vendor.po.approve"]),
        "resource": base_resource({}),
    }
}

test_close_po_cross_tenant_deny if {
    not vendor.allow with input as {
        "action": "close_po",
        "user": base_user(["vendor.po.close"]),
        "resource": base_resource({"tenant_id": other_tenant}),
    }
}
