package io.restaurantos.auth.exception;

import java.util.List;

/**
 * The credential verified in more than one place, so the server cannot choose for the user.
 *
 * <h3>Why more than one place is legal at all</h3>
 * <p>{@code users} is unique on {@code (tenant_id, lower(email))}, not on the address alone, and
 * changeset 058 kept it that way on purpose: one human may hold an account in two restaurant groups
 * under one inbox. 16a-01 does not change that, it finally handles it.
 *
 * <h3>The one thing that must never be relaxed here</h3>
 * <p>{@link #options()} lists ONLY tenants whose stored hash the submitted password actually
 * matched. It is built from {@code LoginIdentityResolver.Resolution#matches()}, which is populated
 * after the bcrypt comparison and never before. A version of this that listed "tenants holding this
 * address" would turn the chooser into the account-enumeration oracle the whole design exists to
 * avoid — the list would then be obtainable by typing an address and any password at all.
 *
 * <p>It follows that this exception cannot be thrown before the password is verified, and that a
 * single-option list is not a thing that happens: one match is a login, not a choice.
 */
public class TenantSelectionRequiredException extends RuntimeException {

    private final List<Option> options;

    public TenantSelectionRequiredException(List<Option> options) {
        super("Select which restaurant to sign in to");
        this.options = List.copyOf(options);
    }

    public List<Option> options() {
        return options;
    }

    /**
     * @param slug the value the client echoes back as {@code tenantSlug} on the second attempt.
     *             The second attempt re-sends the password and re-verifies it in full — no
     *             selection token, no server-side pending-login state, and therefore nothing that
     *             could be replayed into a session the credential did not earn.
     * @param name the display name, for the human. Never the identifier.
     */
    public record Option(String slug, String name) {}
}
