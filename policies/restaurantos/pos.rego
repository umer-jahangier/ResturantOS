package restaurantos.pos

import data.restaurantos.common

default allow := false

# void.own: cashier can void their own OPEN order
allow if {
    common.has_permission(input, "pos.order.void.own")
    input.resource.created_by == input.user.id
    input.resource.status == "OPEN"
    common.same_tenant_and_branch(input)
}

# void.any: manager-level — can void any order regardless of creator/status
allow if {
    common.has_permission(input, "pos.order.void.any")
    common.same_tenant_and_branch(input)
}

# refund — requires pos.order.refund permission and approval_limit_paisa >= refund amount
allow if {
    input.action == "pos.order.refund"
    common.has_permission(input, "pos.order.refund")
    common.same_tenant_and_branch(input)
    input.user.attributes.approval_limit_paisa >= input.resource.amount_paisa
}

# discount override
allow if {
    input.action == "pos.order.discount.override"
    common.has_permission(input, "pos.order.discount.override")
    common.same_tenant_and_branch(input)
}

# split bill
allow if {
    input.action == "pos.order.split_bill"
    common.has_permission(input, "pos.order.split_bill")
    common.same_tenant_and_branch(input)
}
