package io.restaurantos.purchasing.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * How purchasing talks to inventory. <b>Two independent questions</b>, which used to be one
 * setting and must never be merged again.
 *
 * <p><b>Why they were split (36-04, finding F-31-02).</b> {@link #integrationMode} answers "where
 * does goods-receipt data come from?" — and its live value is {@code mock}, because
 * {@code MockGrnController} is the only receiving path in the fleet and it answers 404 outside
 * simulation mode. The cross-service <em>reference</em> check was conditioned on the same property,
 * so it has <b>never once run in production</b>. A purchase order naming an ingredient id inventory
 * had never seen was accepted, submitted, approved, sent, received, and closed as
 * {@code FULLY_RECEIVED}, producing no stock row, no movement and no journal entry — the message
 * dead-lettered twenty seconds later into a queue with no consumer and no monitor.
 *
 * <p>Whether goods receipts are simulated and whether a reference is real are unrelated questions.
 * A dev stack can simulate receipts and still have a perfectly reachable inventory-service to ask
 * "does this ingredient exist?" — and on this project it always did.
 */
@Getter
@Setter
@Component
@ConfigurationProperties(prefix = "restaurantos.inventory")
public class InventoryIntegrationProperties {

    /**
     * WHERE GOODS-RECEIPT DATA COMES FROM, and nothing else since 36-04.
     *
     * <p>{@code mock} = the {@code mock_grn_receipts} table plus an Uncategorized-only fallback for
     * spend-analytics category resolution; {@code feign} = call inventory-service for GRN summaries
     * (Phase 8) and ingredient-category lookups (08.2-11).
     *
     * <p>Default and meaning are deliberately unchanged. Flipping this to {@code feign} would make
     * {@code MockGrnController} answer 404 and remove the only way anything in this fleet can
     * receive goods.
     */
    private String integrationMode = "mock";

    /**
     * WHETHER A CROSS-SERVICE REFERENCE IS CHECKED BEFORE IT IS PERSISTED. Default: yes.
     *
     * <p>Governs which {@code IngredientReferenceValidator} bean is created. Set to {@code false}
     * only in a context that genuinely has no inventory-service to ask — an integration test with a
     * single service under Testcontainers, for instance. On any stack where inventory-service is
     * running, leaving this on is the difference between a purchase order refused at creation with
     * a message naming the problem, and one that silently evaporates after everyone has signed off.
     *
     * <p>Turning it off does NOT make purchasing tolerant of unknown ingredients further down the
     * chain: inventory still cannot resolve them, and the receipt still dead-letters. It only moves
     * where the failure is discovered, from a person to a queue.
     */
    private boolean validateReferences = true;

    public boolean isMockMode() {
        return "mock".equalsIgnoreCase(integrationMode);
    }
}
