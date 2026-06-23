package io.restaurantos.auth.exception;

public class BranchSwitchDeniedException extends RuntimeException {

    public BranchSwitchDeniedException(String message) {
        super(message);
    }
}
