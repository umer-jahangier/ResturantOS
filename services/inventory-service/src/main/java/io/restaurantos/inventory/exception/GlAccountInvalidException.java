package io.restaurantos.inventory.exception;

import io.restaurantos.inventory.feign.GlAccountDto;
import io.restaurantos.inventory.service.GlAccountUsage;
import io.restaurantos.shared.exception.RestaurantOsException;

/**
 * A category's GL account reference does not resolve to a usable account in finance-service's
 * chart of accounts. Maps to HTTP 422 via {@code InventoryExceptionHandler}, alongside the
 * category and unit-of-measure validation failures it sits beside.
 *
 * <p>These three inputs were free text with NO validation of any kind: {@code '1400'},
 * {@code '14OO'} (letter O) and {@code 'banana'} all saved identically. Because nothing reads
 * these accounts yet, a typo stayed invisible until Phase 9 began posting journal entries — at
 * which point the failure would surface far from its cause, with no way to tell which category was
 * mistyped or when. Each case gets its own error code so the form can mark the exact field.
 */
public class GlAccountInvalidException extends RestaurantOsException {

    private final String field;

    private GlAccountInvalidException(String code, String field, String message) {
        super(code, message);
        this.field = field;
    }

    public String getField() {
        return field;
    }

    public static GlAccountInvalidException notFound(GlAccountUsage usage, String code) {
        return new GlAccountInvalidException("GL_ACCOUNT_NOT_FOUND", usage.name(),
                "No account \"" + code + "\" exists in your chart of accounts — pick one from the list.");
    }

    public static GlAccountInvalidException inactive(GlAccountUsage usage, GlAccountDto account) {
        return new GlAccountInvalidException("GL_ACCOUNT_INACTIVE", usage.name(),
                "Account " + account.code() + " · " + account.name()
                        + " is archived and can't be used as the " + usage.label() + ".");
    }

    /**
     * The account exists and is active, but is the wrong kind — a revenue account chosen as the
     * inventory asset account, say. Silently accepting this is how a chart of accounts ends up
     * unbalanced in ways nobody can trace back to a category form.
     */
    public static GlAccountInvalidException wrongType(GlAccountUsage usage, GlAccountDto account) {
        return new GlAccountInvalidException("GL_ACCOUNT_TYPE_INVALID", usage.name(),
                "Account " + account.code() + " · " + account.name() + " is "
                        + account.accountType() + "; the " + usage.label() + " must be "
                        + String.join(" or ", usage.accountTypes()) + ".");
    }
}
