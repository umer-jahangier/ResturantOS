package io.restaurantos.shared.validation;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;

import java.lang.annotation.Documented;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

import static java.lang.annotation.ElementType.ANNOTATION_TYPE;
import static java.lang.annotation.ElementType.CONSTRUCTOR;
import static java.lang.annotation.ElementType.FIELD;
import static java.lang.annotation.ElementType.METHOD;
import static java.lang.annotation.ElementType.PARAMETER;
import static java.lang.annotation.ElementType.TYPE_USE;

/**
 * The one password-strength rule for this platform. Apply it to every field that accepts a
 * <b>new</b> password, and to no field that accepts an <b>existing</b> one.
 *
 * <p><b>Why "new only" is part of the contract.</b> A strength rule placed on a login or
 * re-authentication field validates a credential the user already has against a policy that did not
 * exist when it was chosen. Every account whose password predates a tightening then fails
 * validation before the encoder is ever consulted — a self-inflicted lockout of the entire user
 * base, delivered as a 400. The rule belongs where a password is being <i>chosen</i>.
 *
 * <p><b>The policy.</b> At least {@link #DEFAULT_MIN_LENGTH} characters, at most
 * {@link #MAX_LENGTH}, and at least one lowercase letter, one uppercase letter, one digit and one
 * non-alphanumeric character.
 *
 * <p><b>Why there is a maximum at all.</b> It is a denial-of-service bound, not a security bound.
 * Hashing is deliberately expensive (bcrypt cost 12), so an unbounded field lets one request buy an
 * arbitrary amount of CPU. It is emphatically <i>not</i> a strength ceiling: bcrypt reads at most
 * <b>72 bytes</b> of the input and silently ignores the remainder, so two passwords sharing a
 * 72-byte prefix are the same password to the encoder. Nothing above 72 bytes adds entropy, and
 * the limit here (measured in {@code char}s) is simply a request-shaped cap well clear of it.
 *
 * <p><b>Null is valid.</b> The validator accepts {@code null} so that "must be present" stays the
 * job of {@link jakarta.validation.constraints.NotBlank}. Two annotations that both police
 * nullability produce two violations for one mistake, and disagree the first time one of them
 * changes.
 *
 * <p><b>The violation message never contains the submitted value.</b> It is assembled from
 * constants describing the unmet rules only. A validation message is routinely logged and
 * routinely returned to the caller; a message that quoted the value would put a password in both
 * places. {@code StrongPasswordValidatorTest} asserts this directly, and asserts the stronger
 * property it rests on: two different values that break the same rules produce byte-identical
 * messages, so the message carries no information about the value beyond which rules it failed.
 *
 * <p>{@link #min()} is overridable per use so a deliberately looser context is possible without a
 * second annotation and a second implementation to keep in step. The maximum is not overridable:
 * a looser maximum has no legitimate use, being purely a resource bound.
 */
@Documented
@Constraint(validatedBy = StrongPasswordValidator.class)
@Target({METHOD, FIELD, ANNOTATION_TYPE, CONSTRUCTOR, PARAMETER, TYPE_USE})
@Retention(RetentionPolicy.RUNTIME)
public @interface StrongPassword {

    /** Minimum length applied unless a use site overrides {@link #min()}. */
    int DEFAULT_MIN_LENGTH = 12;

    /** Maximum length, in {@code char}s. A resource bound; see the type javadoc. */
    int MAX_LENGTH = 128;

    /**
     * Fallback message. Never used in practice — the validator disables the default violation and
     * builds a message naming the unmet rules — but a literal (rather than a resource-bundle key)
     * so that a future call site which reports the default gets a sentence rather than a
     * {@code {braced.key}} that failed to resolve.
     */
    String message() default "does not meet the required complexity";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    /** Minimum length for this use site. Must be between 1 and {@link #MAX_LENGTH}. */
    int min() default DEFAULT_MIN_LENGTH;
}
