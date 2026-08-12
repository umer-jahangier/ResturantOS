package io.restaurantos.auth.dto.response;

import java.util.UUID;

/**
 * One person who works a branch and whose role grants a named capability there.
 *
 * <p>Answers {@code GET /internal/auth/branches/{branchId}/staff?permission=…}. Deliberately thin:
 * enough to render a picker and nothing else. No password state, no TOTP state, no assignment
 * history — a caller that needs those has {@code GET /internal/auth/users/{id}}.
 *
 * @param userId   the id a caller will send back (e.g. as the cashier a till is opened for)
 * @param email    the login address, and the fallback label when a user has no full name
 * @param fullName may be null for an account created without one; the caller falls back to email
 * @param roleCode the role that grants the requested permission AT THIS BRANCH — a person can hold
 *                 different roles at different branches, so it is meaningless without the branch
 */
public record BranchStaffResponse(UUID userId, String email, String fullName, String roleCode) {}
