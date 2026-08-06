package io.restaurantos.shared.validation;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

import java.util.ArrayList;
import java.util.List;

/**
 * Enforces {@link StrongPassword}.
 *
 * <p><b>The message is built from constants only.</b> Every fragment below is either a literal or
 * the configured minimum — an {@code int} from the annotation, not from the request. The submitted
 * value is read to decide <i>which</i> fragments apply and is never itself concatenated into
 * anything. That is what lets the same message be logged and returned to the caller safely, and it
 * is asserted directly by {@code StrongPasswordValidatorTest}.
 *
 * <p>It also means the template handed to
 * {@link ConstraintValidatorContext#buildConstraintViolationWithTemplate(String)} can never contain
 * attacker-supplied text. That matters more than it looks: a provider interpolates
 * <code>{...}</code> and <code>${...}</code> in a message template, so building a template out of
 * user input is an expression-injection sink. Nothing here is capable of reaching it.
 */
public class StrongPasswordValidator implements ConstraintValidator<StrongPassword, CharSequence> {

    private int min;

    @Override
    public void initialize(StrongPassword constraint) {
        this.min = constraint.min();
        if (min < 1 || min > StrongPassword.MAX_LENGTH) {
            // A misconfigured use site fails at context startup rather than silently enforcing
            // something nobody wrote — a min above the max would reject every possible value.
            throw new IllegalArgumentException(
                "@StrongPassword min must be between 1 and " + StrongPassword.MAX_LENGTH + ", was " + min);
        }
    }

    @Override
    public boolean isValid(CharSequence value, ConstraintValidatorContext context) {
        // Null is NotBlank's business, not this constraint's. See the StrongPassword javadoc.
        if (value == null) {
            return true;
        }

        List<String> unmet = unmetRequirements(value);
        if (unmet.isEmpty()) {
            return true;
        }

        context.disableDefaultConstraintViolation();
        context.buildConstraintViolationWithTemplate(describe(unmet)).addConstraintViolation();
        return false;
    }

    private List<String> unmetRequirements(CharSequence value) {
        boolean lower = false;
        boolean upper = false;
        boolean digit = false;
        boolean symbol = false;

        // Iterated by code point, not by char, so a supplementary-plane character counts once and
        // is classified by what it actually is rather than by its surrogate halves.
        for (int i = 0; i < value.length(); ) {
            int cp = Character.codePointAt(value, i);
            i += Character.charCount(cp);
            if (Character.isLowerCase(cp)) {
                lower = true;
            } else if (Character.isUpperCase(cp)) {
                upper = true;
            } else if (Character.isDigit(cp)) {
                digit = true;
            } else if (!Character.isLetterOrDigit(cp)) {
                // Whitespace lands here on purpose: a passphrase separated by spaces satisfies the
                // non-alphanumeric requirement, and refusing it would push users towards shorter,
                // denser and more memorable-to-a-cracker strings.
                symbol = true;
            }
            // A letter that is neither upper nor lower case (Chinese, Arabic, Hebrew, and the
            // title-case forms) satisfies none of the four classes and is simply not counted.
        }

        List<String> unmet = new ArrayList<>(6);
        if (value.length() < min) {
            unmet.add("must be at least " + min + " characters long");
        }
        if (value.length() > StrongPassword.MAX_LENGTH) {
            unmet.add("must be at most " + StrongPassword.MAX_LENGTH + " characters long");
        }
        if (!lower) {
            unmet.add("must contain a lowercase letter");
        }
        if (!upper) {
            unmet.add("must contain an uppercase letter");
        }
        if (!digit) {
            unmet.add("must contain a digit");
        }
        if (!symbol) {
            unmet.add("must contain a symbol");
        }
        return unmet;
    }

    private static String describe(List<String> unmet) {
        return "does not meet the required complexity: " + String.join("; ", unmet);
    }
}
