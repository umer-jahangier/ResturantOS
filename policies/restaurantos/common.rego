package restaurantos.common

# Rego v1 (OPA 1.x default): rule bodies use the `if` keyword.

same_tenant(inp) if {
    inp.resource.tenant_id == inp.user.tenant_id
}

same_branch(inp) if {
    inp.resource.branch_id == inp.user.branch_id
}

same_tenant_and_branch(inp) if {
    same_tenant(inp)
    same_branch(inp)
}

has_permission(inp, perm) if {
    some p in inp.user.permissions
    p == perm
}
