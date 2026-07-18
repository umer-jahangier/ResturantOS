package restaurantos.inventory

import data.restaurantos.common

default allow := false

# View inventory items/stock — requires inventory.item.view on same tenant+branch
allow if {
    input.action == "inventory.item.view"
    common.has_permission(input, "inventory.item.view")
    common.same_tenant_and_branch(input)
}

# Manage inventory items/stock (create/update/receipts/transfers/counts) —
# requires inventory.item.manage on same tenant+branch
allow if {
    input.action == "inventory.item.manage"
    common.has_permission(input, "inventory.item.manage")
    common.same_tenant_and_branch(input)
}
