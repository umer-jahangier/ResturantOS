package io.restaurantos.auth.dto.request;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.UUID;

/**
 * Create one user in a tenant (D-11).
 *
 * <p><b>There is no password field, and the absence is the enforcement.</b> Only a generated
 * temporary password is ever set here, so there is nothing for a caller to supply and no branch of
 * code that could honour it if they tried. {@link UpdateUserRequest} covers the other half — a
 * caller who sends one anyway is refused rather than quietly ignored — because a request field that
 * is silently discarded is how an administrator comes to believe they set a password they did not.
 *
 * <p>{@code branchId} and {@code roleCode} travel together: a role without a branch is not an
 * assignment, and a branch without a role is not one either. Both absent is legal and means "create
 * the account, assign later" — that user cannot log in until they have an assignment, which is
 * stated in the response rather than left to be discovered at their first login.
 */
public record CreateUserRequest(
    @NotBlank @Email @Size(max = 255) String email,
    @Size(max = 255) String fullName,
    @Size(max = 10) String locale,
    UUID branchId,
    String roleCode
) {}
