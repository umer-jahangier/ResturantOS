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

# ── HR configuration (35-03) ────────────────────────────────────────────────
#
# These two rules use common.same_tenant alone, without the branch conjunction, and that is the
# only place in this file where the branch predicate is deliberately absent.
#
# HR configuration is a property of the TENANT. A department list, a designation list, a leave
# type, a salary component and above all the income-tax table belong to the business, not to one
# of its locations. A caller's token always carries exactly one branch, so requiring the
# resource's branch to equal it would mean an owner can edit the department list only while
# switched to whichever branch they happen to be viewing — and a tenant with four branches would
# need four department lists that immediately drift apart.
#
# The tenant predicate is what carries the isolation here and it is NOT optional: dropping it
# would make every tenant's tax table readable by every other tenant. Dropping the branch
# predicate is a scoping decision; dropping the tenant predicate would be a cross-tenant leak.
#
# The nine rules above are unchanged and stay branch-isolated. Employees, attendance, leave and
# payroll are operational records that belong to a branch, and phase 18b made that enforcement
# real. This plan does not loosen it.

allow if {
    input.action == "config_view"
    common.has_permission(input, "hr.config.view")
    common.same_tenant(input)
}

allow if {
    input.action == "config_manage"
    common.has_permission(input, "hr.config.manage")
    common.same_tenant(input)
}
