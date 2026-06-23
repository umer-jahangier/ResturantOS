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
}
