package restaurantos.vendor

import data.restaurantos.common

default allow := false

allow if {
    input.action == "manage"
    common.has_permission(input, "vendor.manage")
    common.same_tenant_and_branch(input)
}

allow if {
    input.action == "approve_po"
    common.has_permission(input, "vendor.po.approve")
    common.same_tenant_and_branch(input)
    input.resource.amount_paisa <= input.user.attributes.approval_limit_paisa
}

# Short-close is a reason-mandated state transition, not a spend decision — no
# amount comparison here (see decision 10-04-A).
allow if {
    input.action == "close_po"
    common.has_permission(input, "vendor.po.close")
    common.same_tenant_and_branch(input)
}
