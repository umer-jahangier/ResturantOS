package io.restaurantos.auth.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

import java.util.List;

/**
 * What a tenant's own role should be — its label and the exact set of permissions it grants (S3).
 *
 * <p>One request shape for create and for edit, because the two are the same statement: <b>this
 * role now grants exactly these codes</b>. An add/remove delta API would have needed the client to
 * hold a correct picture of the current set and diff against it, and a checkbox list that is one
 * stale read away from removing the wrong permission is not a control anybody should trust with
 * authorization. Replace semantics make sending it twice a no-op.
 *
 * <p>There is no {@code code} field. The code is derived from the name by the server — see
 * {@code RoleAdminService.deriveCode} — because it is an identifier that must not collide with a
 * platform role, must be stable across renames, and is not something an administrator composing a
 * role has any reason to think about.
 *
 * <p>{@code permissions} is {@code @NotEmpty} on purpose. A role granting nothing is not a role: it
 * is an account that can log in and see an empty product, which is the exact symptom
 * {@code UnknownRoleCodeException} exists to prevent someone creating by typo. Deleting the role is
 * how you stop using it.
 */
public record RoleWriteRequest(

    @NotBlank(message = "Enter a name for this role")
    @Size(min = 2, max = 60,
        message = "A role name is between 2 and 60 characters")
    String name,

    @NotEmpty(message = "Tick at least one permission — a role that grants nothing lets its "
        + "holders sign in to an empty product")
    List<String> permissions
) {}
