package io.restaurantos.shared.validation;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import jakarta.validation.constraints.NotBlank;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.Locale;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The password-strength policy (D-20), specified against a real Bean Validation provider rather
 * than by calling {@code isValid} directly — the message the caller receives is produced by the
 * provider's interpolator, and that message is half of what this constraint promises.
 *
 * <p>The information-disclosure assertions are the reason this class exists in the shape it does.
 * "The message does not contain the value" is checked two ways, because the obvious check alone is
 * weak: a message that quoted only the value's <i>length</i>, or only its first character, would
 * pass a naive substring scan while still leaking. So the scan is paired with the invariant it
 * rests on — two different values breaking the same rules must produce byte-identical messages,
 * which means the message is a function of the unmet rule set and of nothing else.
 *
 * <p>Test values are built from characters that do not occur in English words on purpose. A
 * substring scan against a natural-language message will otherwise report a false positive the
 * moment someone submits a value like {@code "least"} or {@code "contain"}, and a test that fails
 * for a reason unrelated to its subject gets weakened rather than read.
 */
class StrongPasswordValidatorTest {

    private static ValidatorFactory factory;
    private static Validator validator;

    /** Meets every rule: 12 chars, lower + upper + digit + symbol. */
    private static final String COMPLIANT = "Xq7#zv2$Lm5&";

    @BeforeAll
    static void startProvider() {
        factory = Validation.buildDefaultValidatorFactory();
        validator = factory.getValidator();
    }

    @AfterAll
    static void stopProvider() {
        factory.close();
    }

    // ---------------------------------------------------------------- behaviour 1: too short

    @ParameterizedTest
    @ValueSource(strings = {"Xq7#zv2$Lm5", "Xq7#z", "X"})
    void shorterThanTheMinimum_isRejected(String value) {
        assertThat(messagesFor(value)).singleElement(org.assertj.core.api.InstanceOfAssertFactories.STRING)
            .contains("at least 12 characters");
    }

    @Test
    void exactlyTheMinimum_isAccepted() {
        assertThat(COMPLIANT).hasSize(StrongPassword.DEFAULT_MIN_LENGTH);
        assertThat(messagesFor(COMPLIANT)).isEmpty();
    }

    // ---------------------------------------------------------------- behaviour 2: too long

    @Test
    void longerThanTheMaximum_isRejected() {
        String tooLong = COMPLIANT.repeat(11).substring(0, StrongPassword.MAX_LENGTH + 1);
        assertThat(tooLong).hasSize(StrongPassword.MAX_LENGTH + 1);

        assertThat(messagesFor(tooLong)).singleElement(org.assertj.core.api.InstanceOfAssertFactories.STRING)
            .contains("at most 128 characters");
    }

    @Test
    void exactlyTheMaximum_isAccepted() {
        String atLimit = COMPLIANT.repeat(11).substring(0, StrongPassword.MAX_LENGTH);
        assertThat(messagesFor(atLimit)).isEmpty();
    }

    // ------------------------------------------------- behaviour 3: missing character classes

    @ParameterizedTest(name = "[{index}] {0} is missing {1}")
    @CsvSource({
        "'XQ7#ZV2$LM5&', a lowercase letter",
        "'xq7#zv2$lm5&', an uppercase letter",
        "'Xq_#zv_$Lm_&', a digit",
        "'Xq7azv2bLm5c', a symbol",
    })
    void missingCharacterClass_isRejectedAndTheMessageNamesIt(String value, String missing) {
        assertThat(messagesFor(value)).singleElement(org.assertj.core.api.InstanceOfAssertFactories.STRING)
            .contains("must contain " + missing)
            .doesNotContain(value);
    }

    @Test
    void severalMissingClasses_areAllNamedInOneMessage() {
        String value = "qqqqqqqqqqqq"; // 12 chars, lowercase only

        assertThat(messagesFor(value)).singleElement(org.assertj.core.api.InstanceOfAssertFactories.STRING)
            .contains("must contain an uppercase letter")
            .contains("must contain a digit")
            .contains("must contain a symbol")
            .doesNotContain("must contain a lowercase letter");
    }

    @Test
    void aShortValueMissingClasses_reportsBothTheLengthAndTheClasses() {
        assertThat(messagesFor("qqq")).singleElement(org.assertj.core.api.InstanceOfAssertFactories.STRING)
            .contains("at least 12 characters")
            .contains("must contain an uppercase letter");
    }

    // ------------------------------------------------------------- behaviour 4: compliant value

    @ParameterizedTest
    @ValueSource(strings = {
        "Xq7#zv2$Lm5&",
        "Zk9!wq4^Rt6*Bn8(",
        "Vv3 qq7 Zx9 mm2",      // whitespace counts as the non-alphanumeric character: a
                                // passphrase is a good password and must not be refused
        "Ééé9!ßvvqqzzXx",       // non-ASCII letters are letters; case detection is not ASCII-only
    })
    void aValueMeetingEveryRule_isAccepted(String value) {
        assertThat(messagesFor(value)).isEmpty();
    }

    // ----------------------------------------------------- behaviour 5: null is somebody else's job

    @Test
    void nullIsAcceptedByThisConstraint_soNotBlankOwnsNullability() {
        Set<ConstraintViolation<StrongPasswordOnly>> violations =
            validator.validate(new StrongPasswordOnly(null));

        assertThat(violations).isEmpty();
    }

    @Test
    void nullOnAFieldCarryingBothConstraints_yieldsExactlyOneViolation_fromNotBlank() {
        Set<ConstraintViolation<NotBlankAndStrong>> violations =
            validator.validate(new NotBlankAndStrong(null));

        assertThat(violations).hasSize(1);
        assertThat(violations.iterator().next().getConstraintDescriptor().getAnnotation())
            .isInstanceOf(NotBlank.class);
    }

    // ------------------------------------------- behaviour 6: the message never carries the value

    @ParameterizedTest
    @ValueSource(strings = {"Xq7#zv", "qqzzvvxxqqzz", "9797979797979797", "#$#$#$#$#$#$"})
    void theMessageContainsNoFragmentOfTheSubmittedValue(String value) {
        String message = onlyMessageFor(value);

        for (int length = 3; length <= value.length(); length++) {
            for (int start = 0; start + length <= value.length(); start++) {
                String fragment = value.substring(start, start + length);
                assertThat(message.toLowerCase(Locale.ROOT))
                    .as("message must not contain the fragment '%s' of the submitted value", fragment)
                    .doesNotContain(fragment.toLowerCase(Locale.ROOT));
            }
        }
    }

    /**
     * The property the scan above rests on. If the message depended on the value in any way at all
     * — its length, its first character, a count of anything — two different values that break the
     * same rules would produce different messages. They must not.
     */
    @Test
    void twoDifferentValuesBreakingTheSameRules_produceIdenticalMessages() {
        String lowercaseOnlyA = "qqqqqqqqqqqq";
        String lowercaseOnlyB = "zvzvzvzvzvzvzvzvzvzvzv";

        assertThat(onlyMessageFor(lowercaseOnlyA)).isEqualTo(onlyMessageFor(lowercaseOnlyB));
        assertThat(onlyMessageFor("Xq7#zv")).isEqualTo(onlyMessageFor("Zk9!wq"));
    }

    @Test
    void theMessageDoesNotDiscloseTheLengthOfTheSubmittedValue() {
        assertThat(onlyMessageFor("qqq")).isEqualTo(onlyMessageFor("qqqqqqqqq"));
    }

    // ------------------------------------------------------------------ the overridable minimum

    @Test
    void aUseSiteMayLowerTheMinimum() {
        assertThat(validator.validate(new LooserMinimum("Xq7#zv2$"))).isEmpty();
        assertThat(validator.validate(new LooserMinimum("Xq7#zv"))).isNotEmpty();
    }

    @Test
    void aUseSiteLoweringTheMinimum_stillEnforcesEveryCharacterClass() {
        assertThat(messagesOf(validator.validate(new LooserMinimum("qqqqqqqq"))))
            .singleElement(org.assertj.core.api.InstanceOfAssertFactories.STRING)
            .contains("must contain an uppercase letter");
    }

    @Test
    void aUseSiteLoweringTheMinimum_reportsItsOwnMinimumNotTheDefault() {
        assertThat(onlyMessageOf(validator.validate(new LooserMinimum("Xq7#zv"))))
            .contains("at least 8 characters")
            .doesNotContain("12");
    }

    // ---------------------------------------------------------------------------------- helpers

    private Set<String> messagesFor(String value) {
        return messagesOf(validator.validate(new StrongPasswordOnly(value)));
    }

    private String onlyMessageFor(String value) {
        return onlyMessageOf(validator.validate(new StrongPasswordOnly(value)));
    }

    private static <T> Set<String> messagesOf(Set<ConstraintViolation<T>> violations) {
        return violations.stream().map(ConstraintViolation::getMessage)
            .collect(java.util.stream.Collectors.toCollection(java.util.LinkedHashSet::new));
    }

    private static <T> String onlyMessageOf(Set<ConstraintViolation<T>> violations) {
        assertThat(violations).hasSize(1);
        return violations.iterator().next().getMessage();
    }

    private record StrongPasswordOnly(@StrongPassword String newPassword) {}

    private record NotBlankAndStrong(@NotBlank @StrongPassword String newPassword) {}

    private record LooserMinimum(@StrongPassword(min = 8) String newPassword) {}
}
