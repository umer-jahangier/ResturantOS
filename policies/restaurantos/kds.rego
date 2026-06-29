package restaurantos.kds

import data.restaurantos.common

default allow := false

# View KDS board / tickets — requires pos.kds.view on same tenant+branch
allow if {
    common.has_permission(input, "pos.kds.view")
    common.same_tenant_and_branch(input)
}

# Bump/progress ticket items — requires pos.kds.update on same tenant+branch
allow if {
    input.action == "pos.kds.update"
    common.has_permission(input, "pos.kds.update")
    common.same_tenant_and_branch(input)
}
