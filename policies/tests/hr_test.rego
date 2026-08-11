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

# ── attendance_view / attendance_manage ─────────────────────────────────────

test_attendance_view_allow if {
    hr.allow with input as {
        "action": "attendance_view",
        "user": base_user(["hr.attendance.view"]),
        "resource": base_resource({}),
    }
}

test_attendance_view_missing_permission_deny if {
    not hr.allow with input as {
        "action": "attendance_view",
        "user": base_user(["hr.employee.view"]),
        "resource": base_resource({}),
    }
}

test_attendance_view_cross_tenant_deny if {
    not hr.allow with input as {
        "action": "attendance_view",
        "user": base_user(["hr.attendance.view"]),
        "resource": base_resource({"tenant_id": other_tenant}),
    }
}

test_attendance_manage_allow if {
    hr.allow with input as {
        "action": "attendance_manage",
        "user": base_user(["hr.attendance.manage"]),
        "resource": base_resource({}),
    }
}

# View must NOT imply manage — the punch-edit path is a fraud surface.
test_attendance_manage_with_only_view_deny if {
    not hr.allow with input as {
        "action": "attendance_manage",
        "user": base_user(["hr.attendance.view"]),
        "resource": base_resource({}),
    }
}

test_attendance_manage_cross_branch_deny if {
    not hr.allow with input as {
        "action": "attendance_manage",
        "user": base_user(["hr.attendance.manage"]),
        "resource": base_resource({"branch_id": other_branch}),
    }
}

# ── leave_view ───────────────────────────────────────────────────────────────

test_leave_view_allow if {
    hr.allow with input as {
        "action": "leave_view",
        "user": base_user(["hr.leave.view"]),
        "resource": base_resource({}),
    }
}

test_leave_view_missing_permission_deny if {
    not hr.allow with input as {
        "action": "leave_view",
        "user": base_user(["hr.employee.view"]),
        "resource": base_resource({}),
    }
}

test_leave_view_cross_tenant_deny if {
    not hr.allow with input as {
        "action": "leave_view",
        "user": base_user(["hr.leave.view"]),
        "resource": base_resource({"tenant_id": other_tenant}),
    }
}

# ── payroll_view / payroll_run ───────────────────────────────────────────────

test_payroll_view_allow if {
    hr.allow with input as {
        "action": "payroll_view",
        "user": base_user(["hr.payroll.view"]),
        "resource": base_resource({}),
    }
}

test_payroll_view_missing_permission_deny if {
    not hr.allow with input as {
        "action": "payroll_view",
        "user": base_user(["hr.employee.view"]),
        "resource": base_resource({}),
    }
}

test_payroll_view_cross_tenant_deny if {
    not hr.allow with input as {
        "action": "payroll_view",
        "user": base_user(["hr.payroll.view"]),
        "resource": base_resource({"tenant_id": other_tenant}),
    }
}

test_payroll_run_allow if {
    hr.allow with input as {
        "action": "payroll_run",
        "user": base_user(["hr.payroll.run"]),
        "resource": base_resource({}),
    }
}

# Read-only payroll access must not be able to execute a run.
test_payroll_run_with_only_view_deny if {
    not hr.allow with input as {
        "action": "payroll_run",
        "user": base_user(["hr.payroll.view"]),
        "resource": base_resource({}),
    }
}

test_payroll_run_cross_branch_deny if {
    not hr.allow with input as {
        "action": "payroll_run",
        "user": base_user(["hr.payroll.run"]),
        "resource": base_resource({"branch_id": other_branch}),
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

# An empty permission set must never satisfy any HR rule.
test_no_permissions_deny_all if {
    every action in [
        "employee_view", "employee_manage",
        "attendance_view", "attendance_manage",
        "leave_view", "leave_approve",
        "payroll_view", "payroll_run", "payroll_approve",
    ] {
        not hr.allow with input as {
            "action": action,
            "user": base_user([]),
            "resource": base_resource({}),
        }
    }
}

# ── HR configuration: tenant-scoped ON PURPOSE (35-03) ──────────────────────
#
# config_view and config_manage are the only hr actions without a branch predicate. That is a
# deliberate scoping decision, documented in hr.rego, and these tests pin BOTH halves of it: the
# branch is genuinely ignored, and the tenant is genuinely not.

test_config_view_allow if {
    hr.allow with input as {
        "action": "config_view",
        "user": base_user(["hr.config.view"]),
        "resource": base_resource({}),
    }
}

test_config_manage_allow if {
    hr.allow with input as {
        "action": "config_manage",
        "user": base_user(["hr.config.manage"]),
        "resource": base_resource({}),
    }
}

# The behaviour this plan deliberately introduces. Asserted explicitly and named clearly, because
# a future reader who finds a cross-branch allow in an HR policy will otherwise assume it is a bug
# and "fix" it — which would leave an owner able to edit the department list only while switched
# to one particular branch.
test_config_view_allowed_across_branches_deliberately if {
    hr.allow with input as {
        "action": "config_view",
        "user": base_user(["hr.config.view"]),
        "resource": base_resource({"branch_id": other_branch}),
    }
}

test_config_manage_allowed_across_branches_deliberately if {
    hr.allow with input as {
        "action": "config_manage",
        "user": base_user(["hr.config.manage"]),
        "resource": base_resource({"branch_id": other_branch}),
    }
}

# Dropping the branch predicate is a scoping decision. Dropping the tenant predicate would be a
# cross-tenant leak of another business's tax table.
test_config_view_cross_tenant_deny if {
    not hr.allow with input as {
        "action": "config_view",
        "user": base_user(["hr.config.view"]),
        "resource": base_resource({"tenant_id": other_tenant}),
    }
}

test_config_manage_cross_tenant_deny if {
    not hr.allow with input as {
        "action": "config_manage",
        "user": base_user(["hr.config.manage"]),
        "resource": base_resource({"tenant_id": other_tenant}),
    }
}

test_config_view_without_permission_deny if {
    not hr.allow with input as {
        "action": "config_view",
        "user": base_user(["hr.employee.view"]),
        "resource": base_resource({}),
    }
}

# The separation of the two codes is the whole reason there are two. A caller who may read the
# lists must not thereby be able to rewrite the tax table.
test_config_manage_with_only_view_permission_deny if {
    not hr.allow with input as {
        "action": "config_manage",
        "user": base_user(["hr.config.view"]),
        "resource": base_resource({}),
    }
}

test_config_unknown_action_deny if {
    not hr.allow with input as {
        "action": "config_delete_everything",
        "user": base_user(["hr.config.manage"]),
        "resource": base_resource({}),
    }
}

# ── Regression: the nine operational actions are STILL branch-isolated ───────
#
# Stated out loud rather than left to be inferred from an absence. The point of this phase is not
# to loosen branch isolation, and the one file that could silently do so is this one.

test_all_operational_actions_still_deny_cross_branch if {
    every case in [
        {"action": "employee_view", "perm": "hr.employee.view"},
        {"action": "employee_manage", "perm": "hr.employee.manage"},
        {"action": "attendance_view", "perm": "hr.attendance.view"},
        {"action": "attendance_manage", "perm": "hr.attendance.manage"},
        {"action": "leave_view", "perm": "hr.leave.view"},
        {"action": "leave_approve", "perm": "hr.leave.approve"},
        {"action": "payroll_view", "perm": "hr.payroll.view"},
        {"action": "payroll_run", "perm": "hr.payroll.run"},
        {"action": "payroll_approve", "perm": "hr.payroll.approve"},
    ] {
        not hr.allow with input as {
            "action": case.action,
            "user": base_user([case.perm]),
            "resource": base_resource({"branch_id": other_branch}),
        }
    }
}

test_all_operational_actions_still_allow_same_branch if {
    every case in [
        {"action": "employee_view", "perm": "hr.employee.view"},
        {"action": "employee_manage", "perm": "hr.employee.manage"},
        {"action": "attendance_view", "perm": "hr.attendance.view"},
        {"action": "attendance_manage", "perm": "hr.attendance.manage"},
        {"action": "leave_view", "perm": "hr.leave.view"},
        {"action": "leave_approve", "perm": "hr.leave.approve"},
        {"action": "payroll_view", "perm": "hr.payroll.view"},
        {"action": "payroll_run", "perm": "hr.payroll.run"},
        {"action": "payroll_approve", "perm": "hr.payroll.approve"},
    ] {
        hr.allow with input as {
            "action": case.action,
            "user": base_user([case.perm]),
            "resource": base_resource({}),
        }
    }
}
