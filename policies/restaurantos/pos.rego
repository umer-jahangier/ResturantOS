package restaurantos.pos

import data.restaurantos.common

default allow := false

allow if {
    common.has_permission(input, "pos.order.void.own")
    input.resource.created_by == input.user.id
    input.resource.status == "OPEN"
    common.same_tenant_and_branch(input)
}

allow if {
    common.has_permission(input, "pos.order.void.any")
    common.same_tenant_and_branch(input)
}
