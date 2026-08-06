package io.restaurantos.shared.validation;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

/**
 * RED — the policy is specified by {@code StrongPasswordValidatorTest} and not yet implemented.
 * Accepting everything is the pre-implementation state on purpose: it is applied to no DTO at this
 * commit, so nothing is validated more weakly than it was before.
 */
public class StrongPasswordValidator implements ConstraintValidator<StrongPassword, CharSequence> {

    @Override
    public void initialize(StrongPassword constraint) {
        // no-op
    }

    @Override
    public boolean isValid(CharSequence value, ConstraintValidatorContext context) {
        return true;
    }
}
