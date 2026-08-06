package io.restaurantos.platform.exception;

/**
 * The one and only way a platform login can fail.
 *
 * <p><b>It deliberately carries no reason.</b> Unknown email, wrong password, deactivated account,
 * insufficient role and "locked out" all throw this same type with no discriminating field, so
 * there is nothing for a future handler, log formatter or error mapper to accidentally surface to
 * the caller. The reason is recorded in the service's own log line, next to the platform user id
 * and the source address, where it is useful to an operator and invisible to an attacker.
 *
 * <p>Deliberately <i>not</i> a subclass of {@code RestaurantOsException}: that base type is mapped
 * by shared-lib's {@code GlobalExceptionHandler} to a 400 whose body echoes {@code getCode()} and
 * {@code getMessage()}. A credential refusal must be a 401 with a body that is a function of
 * nothing at all — see {@link PlatformAuthExceptionHandler}.
 */
public class PlatformAuthenticationFailedException extends RuntimeException {

    public PlatformAuthenticationFailedException() {
        // No message, no cause, no stack trace: this is thrown on a hot, attacker-reachable path
        // several times per lockout window, and nothing downstream reads any of the three.
        super(null, null, false, false);
    }
}
