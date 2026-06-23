package restaurantos.common_test

import data.restaurantos.common

tenant_a := "a0000001-0000-4000-8000-000000000001"
tenant_b := "b0000002-0000-4000-8000-000000000002"
branch_a := "b0000001-0000-4000-8000-000000000001"
branch_b := "b0000002-0000-4000-8000-000000000002"

test_same_tenant_true if {
    common.same_tenant({"user": {"tenant_id": tenant_a}, "resource": {"tenant_id": tenant_a}})
}

test_same_tenant_false if {
    not common.same_tenant({"user": {"tenant_id": tenant_a}, "resource": {"tenant_id": tenant_b}})
}

test_same_branch_true if {
    common.same_branch({"user": {"branch_id": branch_a}, "resource": {"branch_id": branch_a}})
}

test_same_branch_false if {
    not common.same_branch({"user": {"branch_id": branch_a}, "resource": {"branch_id": branch_b}})
}

test_same_tenant_and_branch_true if {
    common.same_tenant_and_branch({
        "user": {"tenant_id": tenant_a, "branch_id": branch_a},
        "resource": {"tenant_id": tenant_a, "branch_id": branch_a},
    })
}

test_same_tenant_and_branch_false_cross_branch if {
    not common.same_tenant_and_branch({
        "user": {"tenant_id": tenant_a, "branch_id": branch_a},
        "resource": {"tenant_id": tenant_a, "branch_id": branch_b},
    })
}

test_has_permission_true if {
    common.has_permission({"user": {"permissions": ["pos.order.void.any"]}}, "pos.order.void.any")
}

test_has_permission_false if {
    not common.has_permission({"user": {"permissions": ["pos.order.read"]}}, "pos.order.void.any")
}
