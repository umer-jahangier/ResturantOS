package restaurantos.rbac

import data.restaurantos.common

default allow := false

allow if {
    common.has_permission(input, "rbac.manage")
    common.same_tenant_and_branch(input)
}
