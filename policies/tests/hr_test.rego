package restaurantos.hr_test

import data.restaurantos.hr

tenant := "a0000001-0000-4000-8000-000000000001"
other_tenant := "c0000003-0000-4000-8000-000000000003"
branch := "b0000001-0000-4000-8000-000000000001"
other_branch := "b0000002-0000-4000-8000-000000000002"

base_user(permissions) := {
    "tenant_id": tenant,
    "branch_id": branch,
    "permissions": permissions,
    "attributes": {},
}

base_resource(extra) := object.union({
    "tenant_id": tenant,
    "branch_id": branch,
}, extra)

# ── employee_view / employee_manage ─────────────────────────────────────────

test_employee_view_allow if {
    hr.allow with input as {
        "action": "employee_view",
        "user": base_user(["hr.employee.view"]),
        "resource": base_resource({}),
    }
}

test_employee_manage_allow if {
    hr.allow with input as {
        "action": "employee_manage",
        "user": base_user(["hr.employee.manage"]),
        "resource": base_resource({}),
    }
}

test_employee_manage_cross_tenant_deny if {
    not hr.allow with input as {
        "action": "employee_manage",
        "user": base_user(["hr.employee.manage"]),
        "resource": base_resource({"tenant_id": other_tenant}),
    }
}

test_employee_manage_cross_branch_deny if {
    not hr.allow with input as {
        "action": "employee_manage",
        "user": base_user(["hr.employee.manage"]),
        "resource": base_resource({"branch_id": other_branch}),
    }
}

test_employee_manage_missing_permission_deny if {
    not hr.allow with input as {
        "action": "employee_manage",
        "user": base_user(["hr.employee.view"]),
        "resource": base_resource({}),
    }
}

# ── leave_approve ────────────────────────────────────────────────────────────

test_leave_approve_allow if {
    hr.allow with input as {
        "action": "leave_approve",
        "user": base_user(["hr.leave.approve"]),
        "resource": base_resource({}),
    }
}

test_leave_approve_missing_permission_deny if {
    not hr.allow with input as {
        "action": "leave_approve",
        "user": base_user(["hr.leave.view"]),
        "resource": base_resource({}),
    }
}

test_leave_approve_cross_branch_deny if {
    not hr.allow with input as {
        "action": "leave_approve",
        "user": base_user(["hr.leave.approve"]),
        "resource": base_resource({"branch_id": other_branch}),
    }
}

# ── payroll_approve ──────────────────────────────────────────────────────────

test_payroll_approve_allow if {
    hr.allow with input as {
        "action": "payroll_approve",
        "user": base_user(["hr.payroll.approve"]),
        "resource": base_resource({}),
    }
}

test_payroll_approve_missing_permission_deny if {
    not hr.allow with input as {
        "action": "payroll_approve",
        "user": base_user(["hr.payroll.run"]),
        "resource": base_resource({}),
    }
}

test_payroll_approve_cross_tenant_deny if {
    not hr.allow with input as {
        "action": "payroll_approve",
        "user": base_user(["hr.payroll.approve"]),
        "resource": base_resource({"tenant_id": other_tenant}),
    }
}

# ── fail-closed on unknown action ───────────────────────────────────────────

test_unknown_action_deny if {
    not hr.allow with input as {
        "action": "employee_delete_everything",
        "user": base_user(["hr.employee.manage"]),
        "resource": base_resource({}),
    }
}
