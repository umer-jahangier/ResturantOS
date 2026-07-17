package io.restaurantos.nlq.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * The ENTIRE inbound request body: just the natural-language question.
 *
 * <p>Deliberately no {@code tenantId}, no {@code branchId}, no {@code role}, no {@code sql} field.
 * Every scoping value is derived server-side from the validated JWT (decision 10-10-B's
 * "impossible-by-construction tenant isolation"). A {@code sql} passthrough would hand an attacker
 * a way around Claude entirely, making the validator the ONLY gate against otherwise-arbitrary
 * SQL; a client-supplied {@code tenantId} would hand them another tenant's data. Neither exists,
 * and neither should ever be added.
 */
public record NlqQueryRequest(
        @NotBlank(message = "question must not be blank")
        @Size(max = 2000, message = "question must be at most 2000 characters")
        String question) {
}
