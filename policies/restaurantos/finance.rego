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
