package restaurantos.finance_test

import data.restaurantos.finance

tenant := "a0000001-0000-4000-8000-000000000001"
other_tenant := "c0000003-0000-4000-8000-000000000003"
branch := "b0000001-0000-4000-8000-000000000001"
other_branch := "b0000002-0000-4000-8000-000000000002"

base_user(permissions, limit) := {
    "tenant_id": tenant,
    "branch_id": branch,
    "permissions": permissions,
    "attributes": {"approval_limit_paisa": limit},
}

base_resource(extra) := object.union({
    "tenant_id": tenant,
    "branch_id": branch,
    "amount_paisa": 50000,
}, extra)

test_approve_allow if {
    finance.allow with input as {
        "action": "approve",
        "user": base_user(["finance.expense.approve"], 100000),
        "resource": base_resource({}),
    }
}

test_approve_over_limit_deny if {
    not finance.allow with input as {
        "action": "approve",
        "user": base_user(["finance.expense.approve"], 10000),
        "resource": base_resource({"amount_paisa": 50000}),
    }
}

test_approve_cross_tenant_deny if {
    not finance.allow with input as {
        "action": "approve",
        "user": base_user(["finance.expense.approve"], 100000),
        "resource": base_resource({"tenant_id": other_tenant}),
    }
}

test_approve_cross_branch_deny if {
    not finance.allow with input as {
        "action": "approve",
        "user": base_user(["finance.expense.approve"], 100000),
        "resource": base_resource({"branch_id": other_branch}),
    }
}

test_approve_missing_permission_deny if {
    not finance.allow with input as {
        "action": "approve",
        "user": base_user([], 100000),
        "resource": base_resource({}),
    }
}

test_close_period_cross_branch_allow if {
    finance.allow with input as {
        "action": "close_period",
        "user": base_user(["finance.period.close"], 0),
        "resource": base_resource({"branch_id": other_branch}),
    }
}

test_close_period_cross_tenant_deny if {
    not finance.allow with input as {
        "action": "close_period",
        "user": base_user(["finance.period.close"], 0),
        "resource": base_resource({"tenant_id": other_tenant}),
    }
}

test_close_period_missing_permission_deny if {
    not finance.allow with input as {
        "action": "close_period",
        "user": base_user([], 0),
        "resource": base_resource({}),
    }
}
