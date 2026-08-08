package restaurantos.hr

import data.restaurantos.common

# HR authorization — every hr.* action maps to its permission and is tenant+branch isolated.
# Fail-closed: an unknown action, a missing permission, or a cross-tenant/cross-branch resource
# all fall through to `default allow := false`.

default allow := false

allow if {
    input.action == "employee_view"
    common.has_permission(input, "hr.employee.view")
    common.same_tenant_and_branch(input)
}

allow if {
    input.action == "employee_manage"
    common.has_permission(input, "hr.employee.manage")
    common.same_tenant_and_branch(input)
}

allow if {
    input.action == "attendance_view"
    common.has_permission(input, "hr.attendance.view")
    common.same_tenant_and_branch(input)
}

allow if {
    input.action == "attendance_manage"
    common.has_permission(input, "hr.attendance.manage")
    common.same_tenant_and_branch(input)
}

allow if {
    input.action == "leave_view"
    common.has_permission(input, "hr.leave.view")
    common.same_tenant_and_branch(input)
}

allow if {
    input.action == "leave_approve"
    common.has_permission(input, "hr.leave.approve")
    common.same_tenant_and_branch(input)
}

allow if {
    input.action == "payroll_view"
    common.has_permission(input, "hr.payroll.view")
    common.same_tenant_and_branch(input)
}

allow if {
    input.action == "payroll_run"
    common.has_permission(input, "hr.payroll.run")
    common.same_tenant_and_branch(input)
}

allow if {
    input.action == "payroll_approve"
    common.has_permission(input, "hr.payroll.approve")
    common.same_tenant_and_branch(input)
}
