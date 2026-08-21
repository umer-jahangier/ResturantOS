package restaurantos.finance

import data.restaurantos.common

default allow := false

allow if {
    input.action == "approve"
    common.has_permission(input, "finance.expense.approve")
    common.same_tenant_and_branch(input)
    input.resource.amount_paisa <= input.user.attributes.approval_limit_paisa
}

allow if {
    input.action == "close_period"
    common.has_permission(input, "finance.period.close")
    common.same_tenant(input)
}

allow if {
    input.action == "view_coa"
    common.has_permission(input, "finance.coa.view")
    common.same_tenant(input)
}

allow if {
    input.action == "manage_coa"
    common.has_permission(input, "finance.coa.manage")
    common.same_tenant(input)
}

allow if {
    input.action == "view_journal"
    common.has_permission(input, "finance.journal.view")
    common.same_tenant_and_branch(input)
}

allow if {
    input.action == "post_journal"
    common.has_permission(input, "finance.journal.post")
    common.same_tenant_and_branch(input)
}

allow if {
    input.action == "reverse_journal"
    common.has_permission(input, "finance.journal.reverse")
    common.same_tenant_and_branch(input)
}
