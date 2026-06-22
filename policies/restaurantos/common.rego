package restaurantos.common

# Rego v1 syntax (OPA 1.x default) — rule bodies use the `if` keyword.
# Real per-domain policies (pos.rego, finance.rego, …) arrive in Phase 2.
# This placeholder ensures `GET /v1/policies | grep restaurantos` returns a hit.

# True when the resource and the requesting user belong to the same tenant AND branch.
same_tenant_and_branch(input) if {
    input.resource.tenant_id == input.user.tenant_id
    input.resource.branch_id == input.user.branch_id
}

# True when the resource and the requesting user belong to the same tenant
# (tenant-wide operations that span branches, e.g. period close).
same_tenant(input) if {
    input.resource.tenant_id == input.user.tenant_id
}

# True when the user's permission set contains the requested permission string.
has_permission(input, perm) if {
    some p in input.user.permissions
    p == perm
}
