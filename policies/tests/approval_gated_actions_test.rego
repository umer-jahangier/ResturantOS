package restaurantos.approval_gated_actions_test

import data.restaurantos.finance
import data.restaurantos.pos
import data.restaurantos.vendor

# The approval limit, as the policy engine actually sees it.
#
# WHY THIS FILE EXISTS
#
# `approval_limit_paisa` was NULL on every `user_branch_roles` row and unsettable from inside the
# product. All three policies below compare a resource amount against that attribute, and in Rego a
# comparison against an undefined value is simply not satisfied — so the rule does not fire and the
# request is denied. A MANAGER who held `vendor.po.approve` was refused on every purchase order, and
# it presented as a permission bug for months. It was not: it was fail-closed behaviour working
# exactly as designed, on a column nobody could fill.
#
# That fail-closed reading is CORRECT and this file pins it, because plan 36-03 makes the number
# settable and the temptation on the other side of that change is to "helpfully" default an absent
# limit to something. An absent limit means no approval authority. It must keep meaning that at any
# amount, including zero.
#
# It also enumerates which permissions are amount-gated. The form that asks for a limit derives its
# question from this set; if a fourth policy rule starts comparing an amount, this test fails here
# rather than surfacing months later as a form that forgot to ask.

tenant := "a0000001-0000-4000-8000-000000000001"

branch := "b0000001-0000-4000-8000-000000000001"

# A principal with NO approval_limit_paisa key at all — the shape a null column produces, because
# PermissionResolver omits the attribute entirely rather than emitting a null.
user_without_limit(permissions) := {
	"tenant_id": tenant,
	"branch_id": branch,
	"permissions": permissions,
	"attributes": {},
}

user_with_limit(permissions, limit) := {
	"tenant_id": tenant,
	"branch_id": branch,
	"permissions": permissions,
	"attributes": {"approval_limit_paisa": limit},
}

resource_worth(amount) := {
	"tenant_id": tenant,
	"branch_id": branch,
	"amount_paisa": amount,
}

# ── Fail-closed: an absent attribute denies at ANY amount, including zero ────────────────────

test_absent_limit_denies_po_approval_at_any_amount if {
	not vendor.allow with input as {
		"action": "approve_po",
		"user": user_without_limit(["vendor.po.approve"]),
		"resource": resource_worth(1),
	}

	not vendor.allow with input as {
		"action": "approve_po",
		"user": user_without_limit(["vendor.po.approve"]),
		"resource": resource_worth(100000000),
	}
}

# Zero is the case a "helpful" default would get wrong: an amount of zero costs nothing, so a reader
# might argue anyone may approve it. They may not. No limit means no approval authority.
test_absent_limit_denies_even_a_zero_amount if {
	not vendor.allow with input as {
		"action": "approve_po",
		"user": user_without_limit(["vendor.po.approve"]),
		"resource": resource_worth(0),
	}
}

test_absent_limit_denies_expense_approval if {
	not finance.allow with input as {
		"action": "approve",
		"user": user_without_limit(["finance.expense.approve"]),
		"resource": resource_worth(1),
	}

	not finance.allow with input as {
		"action": "approve",
		"user": user_without_limit(["finance.expense.approve"]),
		"resource": resource_worth(0),
	}
}

test_absent_limit_denies_refund if {
	not pos.allow with input as {
		"action": "pos.order.refund",
		"user": user_without_limit(["pos.order.refund"]),
		"resource": resource_worth(1),
	}

	not pos.allow with input as {
		"action": "pos.order.refund",
		"user": user_without_limit(["pos.order.refund"]),
		"resource": resource_worth(0),
	}
}

# ── The boundary, in both directions, at the limit exactly ───────────────────────────────────
#
# Asserted per module rather than once, because the three rules are written differently
# (`amount <= limit` in vendor and finance, `limit >= amount` in pos) and an inverted comparison in
# one of them is invisible to a reader and catastrophic in production.

test_limit_equal_to_amount_is_allowed if {
	vendor.allow with input as {
		"action": "approve_po",
		"user": user_with_limit(["vendor.po.approve"], 500000),
		"resource": resource_worth(500000),
	}

	finance.allow with input as {
		"action": "approve",
		"user": user_with_limit(["finance.expense.approve"], 500000),
		"resource": resource_worth(500000),
	}

	pos.allow with input as {
		"action": "pos.order.refund",
		"user": user_with_limit(["pos.order.refund"], 500000),
		"resource": resource_worth(500000),
	}
}

test_one_paisa_over_the_limit_is_denied if {
	not vendor.allow with input as {
		"action": "approve_po",
		"user": user_with_limit(["vendor.po.approve"], 500000),
		"resource": resource_worth(500001),
	}

	not finance.allow with input as {
		"action": "approve",
		"user": user_with_limit(["finance.expense.approve"], 500000),
		"resource": resource_worth(500001),
	}

	not pos.allow with input as {
		"action": "pos.order.refund",
		"user": user_with_limit(["pos.order.refund"], 500000),
		"resource": resource_worth(500001),
	}
}

# A limit of zero is a real, expressible decision — "you hold the permission but may approve
# nothing" — and it is NOT the same as an absent limit even though both deny every positive amount.
# The interface must keep them distinct because they mean different things to a human.
test_zero_limit_denies_every_positive_amount if {
	not vendor.allow with input as {
		"action": "approve_po",
		"user": user_with_limit(["vendor.po.approve"], 0),
		"resource": resource_worth(1),
	}
}

# ── The set of amount-gated permissions ──────────────────────────────────────────────────────
#
# `approval-limit-field.tsx` derives "does this role need a limit?" from exactly this set. Keeping
# the set here, next to the rules that create it, is what makes the form a consequence of the policy
# rather than a restatement of it.
amount_gated_permissions := {
	"vendor.po.approve", # policies/restaurantos/vendor.rego  — approve_po
	"finance.expense.approve", # policies/restaurantos/finance.rego — approve
	"pos.order.refund", # policies/restaurantos/pos.rego     — pos.order.refund
}

# Proven by construction rather than by transcription: for each permission claimed to be
# amount-gated, a principal holding it WITH a sufficient limit is allowed and the SAME principal
# without the attribute is denied. That difference is the definition of "amount-gated", and a
# permission that does not exhibit it does not belong in the set.
test_every_listed_permission_is_actually_amount_gated if {
	# vendor.po.approve
	vendor.allow with input as {
		"action": "approve_po",
		"user": user_with_limit(["vendor.po.approve"], 900000),
		"resource": resource_worth(500000),
	}

	not vendor.allow with input as {
		"action": "approve_po",
		"user": user_without_limit(["vendor.po.approve"]),
		"resource": resource_worth(500000),
	}

	# finance.expense.approve
	finance.allow with input as {
		"action": "approve",
		"user": user_with_limit(["finance.expense.approve"], 900000),
		"resource": resource_worth(500000),
	}

	not finance.allow with input as {
		"action": "approve",
		"user": user_without_limit(["finance.expense.approve"]),
		"resource": resource_worth(500000),
	}

	# pos.order.refund
	pos.allow with input as {
		"action": "pos.order.refund",
		"user": user_with_limit(["pos.order.refund"], 900000),
		"resource": resource_worth(500000),
	}

	not pos.allow with input as {
		"action": "pos.order.refund",
		"user": user_without_limit(["pos.order.refund"]),
		"resource": resource_worth(500000),
	}
}

# The other direction: an action that is NOT in the set must not acquire an amount comparison
# without this test noticing. Short-closing a purchase order is the deliberate example — decision
# 10-04-A calls it a reason-mandated state transition rather than a spend decision — and discounting
# is the same shape in pos. If either starts denying a principal with no limit, someone has added an
# amount gate and the form has not been told.
test_actions_outside_the_set_are_not_amount_gated if {
	vendor.allow with input as {
		"action": "close_po",
		"user": user_without_limit(["vendor.po.close"]),
		"resource": resource_worth(100000000),
	}

	pos.allow with input as {
		"action": "pos.order.discount.override",
		"user": user_without_limit(["pos.order.discount.override"]),
		"resource": resource_worth(100000000),
	}
}

# The set itself, pinned. Changing a policy without changing this line is a test failure; changing
# this line is a deliberate act a reviewer can see.
test_amount_gated_set_is_exactly_these_three if {
	count(amount_gated_permissions) == 3
	amount_gated_permissions == {"vendor.po.approve", "finance.expense.approve", "pos.order.refund"}
}
