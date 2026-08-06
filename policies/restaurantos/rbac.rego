package restaurantos.rbac

import data.restaurantos.common

default allow := false

# Tenant administration is authorised by the umbrella code OR by any one of the three fine-grained
# codes phase 13 split out of it. TENANT_ADMIN holds the three and deliberately does NOT hold
# rbac.manage — that code is the TOTP step-up trigger in AuthServiceImpl.requiresTotpStepUp, so
# granting it to make this policy pass would have forced TOTP on every tenant admin.
#
# The four codes are ENUMERATED, one rule each, rather than collapsed into a list comprehension or
# a startswith("rbac.") prefix test. Two reasons, both learned here:
#   * A prefix test would silently authorise every future rbac.* code the day it is declared,
#     including one deliberately scoped narrower than tenant administration.
#   * PermissionCatalogClosureTest scans this file for the quoted code inside each has_permission
#     call and checks it against the permissions catalog. A code that only ever appears as an
#     element of a Rego array is invisible to that scan, which is how an enforced-but-undeclared
#     permission gets into the tree — the exact defect class that test exists to catch.

allow if {
    common.has_permission(input, "rbac.manage")
    common.same_tenant_and_branch(input)
}

allow if {
    common.has_permission(input, "rbac.user.manage")
    common.same_tenant_and_branch(input)
}

allow if {
    common.has_permission(input, "rbac.role.manage")
    common.same_tenant_and_branch(input)
}

allow if {
    common.has_permission(input, "branch.manage")
    common.same_tenant_and_branch(input)
}
