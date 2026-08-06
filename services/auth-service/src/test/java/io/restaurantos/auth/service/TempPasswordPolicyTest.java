package io.restaurantos.auth.service;

import io.restaurantos.shared.validation.StrongPassword;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Every generated temporary password must satisfy the platform's own password policy.
 *
 * <p>A provisioned admin is handed this value and must then submit it through the forced-change or
 * reset endpoints, where {@code @StrongPassword} applies. If the generator can emit a value that
 * constraint rejects, provisioning issues a credential the platform's own API refuses — and it does
 * so intermittently, which is the worst version of that bug to diagnose in production.
 *
 * <p><b>Volume, deliberately.</b> The defect this pins was probabilistic: the old generator drew
 * every character from a single alphabet containing three symbols, and about 42% of outputs had no
 * symbol. A test that generated one password would have passed roughly three times in five. The
 * loop below makes a regression a certainty rather than a coin flip.
 */
class TempPasswordPolicyTest {

    private static final int DRAWS = 2_000;

    private static ValidatorFactory factory;
    private static Validator validator;

    @BeforeAll
    static void startValidator() {
        factory = Validation.buildDefaultValidatorFactory();
        validator = factory.getValidator();
    }

    @AfterAll
    static void stopValidator() {
        factory.close();
    }

    @Test
    void everyGeneratedTempPassword_satisfiesTheSharedPolicy() {
        Set<String> rejected = new HashSet<>();

        for (int i = 0; i < DRAWS; i++) {
            String candidate = ProvisioningAdminService.generateTempPassword();
            Set<ConstraintViolation<Holder>> violations = validator.validate(new Holder(candidate));
            if (!violations.isEmpty()) {
                // Record the MESSAGE, never the candidate — a rejected temp password is still a
                // credential, and test output is not a place to print one.
                rejected.addAll(violations.stream()
                        .map(ConstraintViolation::getMessage)
                        .collect(Collectors.toSet()));
            }
        }

        assertThat(rejected)
                .as("generated temp passwords rejected by @StrongPassword across %d draws", DRAWS)
                .isEmpty();
    }

    @Test
    void generatedTempPasswords_areNotAllTheSame() {
        // Guards the degenerate pass: a generator returning one constant would satisfy the policy
        // check above forever.
        Set<String> distinct = IntStream.range(0, 100)
                .mapToObj(i -> ProvisioningAdminService.generateTempPassword())
                .collect(Collectors.toSet());

        assertThat(distinct).hasSize(100);
    }

    @Test
    void theRequiredClassesAreNotAlwaysInTheSamePositions() {
        // Seeding one character per class then appending would leave the first four positions with
        // fixed classes, shrinking the search space. The shuffle is what prevents that, and without
        // this assertion its removal would be silent.
        Set<Character> firstChars = IntStream.range(0, 200)
                .mapToObj(i -> ProvisioningAdminService.generateTempPassword().charAt(0))
                .collect(Collectors.toSet());

        boolean upper = firstChars.stream().anyMatch(Character::isUpperCase);
        boolean lower = firstChars.stream().anyMatch(Character::isLowerCase);
        boolean digit = firstChars.stream().anyMatch(Character::isDigit);

        assertThat(upper && lower && digit)
                .as("the leading character should vary across classes, i.e. the result is shuffled")
                .isTrue();
    }

    private record Holder(@StrongPassword String newPassword) {}
}
