package io.restaurantos.auth;

import io.restaurantos.auth.exception.RoleCeilingExceededException;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The ceiling refusals have to survive the trip to a screen.
 *
 * <h2>Why a test about a sentence length</h2>
 *
 * The frontend's {@code formatUserFacingError} replaces any server message longer than
 * <b>160 characters</b> with "Something went wrong. Please try again." — a cap that exists to keep
 * raw Zod and JSON dumps off the screen and which is right to exist. The consequence for this
 * service is a budget, not a suggestion: a refusal that exceeds it does not arrive truncated, it
 * arrives as a sentence that says nothing.
 *
 * <p>That is not hypothetical. The revoke refusal S2 added ran to 171 characters in its first
 * draft, and driven live against the running stack the confirmation dialog read exactly
 * "Something went wrong. Please try again." while the server had in fact explained precisely why
 * the role could not be removed. An owner reading that has no way to tell a refusal from an outage.
 *
 * <p>The role code is variable-length, so the budget is checked against the longest code the
 * catalogue actually contains rather than against a convenient short one — and against an
 * implausibly large permission count, so the number of digits cannot be what pushes it over.
 */
class RoleCeilingRefusalCopyTest {

    /** `formatUserFacingError`'s cap, in `frontend/lib/errors/user-facing.ts`. */
    private static final int USER_FACING_MESSAGE_BUDGET = 160;

    /** The longest system role code in changeset 030/055, plus headroom for a tenant's own. */
    private static final String LONGEST_ROLE_CODE = "INVENTORY_MANAGER_ASSISTANT";

    @Test
    void theRevokeRefusalFitsInsideWhatTheFrontendWillActuallyShow() {
        String message = RoleCeilingExceededException
            .forRevoke(LONGEST_ROLE_CODE, 9999)
            .getMessage();

        assertThat(message.length())
            .as("over %d characters the UI shows 'Something went wrong' INSTEAD of this: %s",
                USER_FACING_MESSAGE_BUDGET, message)
            .isLessThanOrEqualTo(USER_FACING_MESSAGE_BUDGET);
    }

    @Test
    void theAssignRefusalFitsToo() {
        String message = new RoleCeilingExceededException(LONGEST_ROLE_CODE, 9999).getMessage();

        assertThat(message.length()).isLessThanOrEqualTo(USER_FACING_MESSAGE_BUDGET);
    }

    /**
     * The refusal says which verb was refused. Reusing the assign wording on the revoke path is the
     * defect this exists to stop: "You cannot assign the role OWNER" is a confusing thing to read
     * after pressing Revoke, and on that path the message is the whole of what the administrator
     * has to act on.
     */
    @Test
    void eachRefusalNamesTheVerbTheCallerActuallyUsed() {
        assertThat(RoleCeilingExceededException.forRevoke("OWNER", 3).getMessage())
            .contains("revoke")
            .doesNotContain("assign");
        assertThat(new RoleCeilingExceededException("OWNER", 3).getMessage())
            .contains("assign")
            .doesNotContain("revoke");
    }

    /**
     * Both name the role and a COUNT, and neither names a permission code. Naming them would
     * republish exactly what the ceiling withholds — see {@link RoleCeilingExceededException}.
     */
    @Test
    void neitherRefusalNamesTheWithheldPermissionCodes() {
        for (String message : new String[] {
            RoleCeilingExceededException.forRevoke("OWNER", 3).getMessage(),
            new RoleCeilingExceededException("OWNER", 3).getMessage(),
        }) {
            assertThat(message).contains("OWNER").contains("3");
            assertThat(message).doesNotContain("rbac.").doesNotContain("pos.").doesNotContain("hr.");
        }
    }

    /** The code is what a client branches on, and it is the same for both verbs. */
    @Test
    void bothCarryTheSameCode() {
        assertThat(RoleCeilingExceededException.forRevoke("OWNER", 1).getCode())
            .isEqualTo("ROLE_CEILING_EXCEEDED");
        assertThat(new RoleCeilingExceededException("OWNER", 1).getCode())
            .isEqualTo("ROLE_CEILING_EXCEEDED");
    }
}
