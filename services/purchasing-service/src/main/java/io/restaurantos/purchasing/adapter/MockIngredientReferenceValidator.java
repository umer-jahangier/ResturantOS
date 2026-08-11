package io.restaurantos.purchasing.adapter;

import io.restaurantos.purchasing.service.IngredientReferenceValidator;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * The permissive {@link IngredientReferenceValidator}, for a context that genuinely has no
 * inventory-service to ask. Active only when {@code restaurantos.inventory.validate-references} is
 * explicitly {@code false}.
 *
 * <p><b>The premise this class used to record was wrong, and the correction is the point of
 * 36-04.</b> It said mock mode "has no reachable inventory-service". That is true of an integration
 * test running one service under Testcontainers. It has never been true of the live stack, which
 * runs inventory-service on :8085 and has done since Phase 8 — and yet
 * {@code restaurantos.inventory.integration-mode} is {@code mock} there, because
 * {@code MockGrnController} is the fleet's only receiving path and answers 404 outside simulation
 * mode.
 *
 * <p>So a check written specifically to stop dangling ingredient references was disabled everywhere
 * it mattered, by a property about something else. Finding F-31-02 is the measured consequence: a
 * purchase order for a freshly generated UUID was accepted, submitted, approved, sent and received,
 * closed as {@code FULLY_RECEIVED}, and produced no stock row, no inventory movement and no journal
 * entry — dead-lettering twenty seconds later into a queue with no consumer and no monitor.
 *
 * <p>Turning validation off does not make the chain tolerant of an unknown ingredient. Inventory
 * still cannot resolve it and the receipt still dead-letters. It only moves the discovery of the
 * failure from a person who can fix it to a queue nobody watches.
 */
@Component
@ConditionalOnProperty(name = "restaurantos.inventory.validate-references", havingValue = "false")
public class MockIngredientReferenceValidator implements IngredientReferenceValidator {

    @Override
    public void requireIngredientInTenant(UUID ingredientId) {
        // No-op: this context has no inventory-service to ask, by explicit configuration.
    }
}
