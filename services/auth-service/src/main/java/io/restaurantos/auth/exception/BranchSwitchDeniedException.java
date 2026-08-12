package io.restaurantos.auth.exception;

public class BranchSwitchDeniedException extends RuntimeException {

    /** The code every pre-existing throw site has always produced. */
    public static final String DEFAULT_CODE = "BRANCH_ACCESS_DENIED";

    /**
     * The branch exists and is assigned to this user, but it has been deactivated.
     *
     * <p>A separate code rather than a different sentence under {@code BRANCH_ACCESS_DENIED},
     * because the two refusals have different remedies and only a machine-readable code lets a
     * screen offer the right one. "You are not assigned to that branch" is answered by an
     * administrator granting a role; "that branch has been deactivated" is answered by reactivating
     * the branch, or by not going there. A client that receives one code for both can only render
     * the prose — which is how the Branches dialog came to promise something no caller could
     * detect.
     */
    public static final String BRANCH_DEACTIVATED = "BRANCH_DEACTIVATED";

    private final String code;

    public BranchSwitchDeniedException(String message) {
        this(DEFAULT_CODE, message);
    }

    public BranchSwitchDeniedException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
