package io.restaurantos.crm;

import io.restaurantos.crm.dto.CrmDtos.CreatePromotionRequest;
import io.restaurantos.crm.dto.CrmDtos.EvaluatePromotionRequest;
import io.restaurantos.crm.entity.PromotionEntity;
import io.restaurantos.crm.service.PromotionEngine;
import io.restaurantos.shared.exception.FieldValidationException;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest(classes = CrmServiceApplication.class)
@Testcontainers
class PromotionEngineIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16"))
                    .withDatabaseName("crm_db")
                    .withUsername("crm_user")
                    .withPassword("crm_pass");

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
        r.add("spring.jpa.hibernate.ddl-auto", () -> "none");
        r.add("spring.liquibase.contexts", () -> "");
        r.add("eureka.client.enabled", () -> "false");
        // This test starts no RabbitMQ container. Mocking RabbitTemplate does not stop the
        // listener registry from opening a real broker connection, so keep listeners down.
        r.add("spring.rabbitmq.listener.simple.auto-startup", () -> "false");
        r.add("TESTCONTAINERS_RYUK_DISABLED", () -> "true");
    }

    @Autowired private PromotionEngine promotionEngine;
    @Autowired private TenantContext tenantContext;
    @Autowired private EntityManager entityManager;
    @Autowired private TransactionTemplate transactionTemplate;

    private UUID tenantId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        setRls(tenantId);
        tenantContext.set(tenantId, null, null, null);
    }

    /**
     * PERCENT's arithmetic: 10% of a Rs 500.00 check is Rs 50.00.
     *
     * <p>The instant is PINNED rather than {@code Instant.now()}, and that is a bug fix, not a
     * tidy-up. {@code isEligible} excludes the end hour ({@code hour >= hourEnd}) and this
     * promotion was written with {@code hourEnd = 23} to mean "all day" — so between 23:00 and
     * 23:59 Asia/Karachi the promotion was ineligible, the engine returned 0, and this test failed.
     * It was observed doing exactly that at 23:51 PKT on 2026-08-12. A test that is red for one
     * hour in every twenty-four is worse than no test: it trains whoever sees it to re-run rather
     * than read. 12:00Z is 17:00 in Asia/Karachi, comfortably inside the window, on a Monday so the
     * day-of-week filter passes too.
     */
    @Test
    void evaluate_appliesPercentDiscount_whenInWindow() {
        Instant now = Instant.parse("2026-06-15T12:00:00Z");
        promotionEngine.create(new CreatePromotionRequest(
                "Lunch 10%", "PERCENT", 10,
                now.minus(1, ChronoUnit.DAYS), now.plus(1, ChronoUnit.DAYS),
                new Integer[]{1, 2, 3, 4, 5, 6, 7},
                0, 23, null, null));

        var result = promotionEngine.evaluate(new EvaluatePromotionRequest(
                UUID.randomUUID(), null, 50_000, now, List.of()));

        assertThat(result.discountPaisa()).isEqualTo(5_000);
        assertThat(result.appliedPromotionIds()).hasSize(1);
    }

    @Test
    void evaluate_returnsZero_whenOutsideHourWindow() {
        Instant now = Instant.parse("2026-06-15T14:00:00Z");
        promotionEngine.create(new CreatePromotionRequest(
                "Morning only", "FIXED", 2_000,
                now.minus(30, ChronoUnit.DAYS), now.plus(30, ChronoUnit.DAYS),
                null, 6, 10, null, null));

        var result = promotionEngine.evaluate(new EvaluatePromotionRequest(
                UUID.randomUUID(), null, 50_000, now, List.of()));

        assertThat(result.discountPaisa()).isZero();
    }

    /**
     * FIXED's arithmetic, stated once so the unit cannot drift: {@code discountValue} is PAISA, and
     * the money that comes off is that figure exactly.
     *
     * <p>The existing FIXED test above only ever asserts zero, because its promotion is outside the
     * hour window — so before this test, no test in the repository had ever executed the FIXED
     * pricing arm. It was reachable only through the {@code else} that this change deleted.
     */
    @Test
    void evaluate_pricesFixed_asAnAmountInPaisa() {
        Instant now = Instant.now();
        promotionEngine.create(new CreatePromotionRequest(
                "Rs 20 off", "FIXED", 2_000,
                now.minus(1, ChronoUnit.DAYS), now.plus(1, ChronoUnit.DAYS),
                null, null, null, null, null));

        var result = promotionEngine.evaluate(new EvaluatePromotionRequest(
                UUID.randomUUID(), null, 50_000, now, List.of()));

        // Rs 20.00 off a Rs 500.00 check. Not 2,000 rupees, not 20 paisa.
        assertThat(result.discountPaisa()).isEqualTo(2_000);
    }

    /** A promotion worth more than the check takes the check to zero and never below it. */
    @Test
    void evaluate_capsFixedAtTheSubtotal() {
        Instant now = Instant.now();
        promotionEngine.create(new CreatePromotionRequest(
                "Rs 500 off", "FIXED", 50_000,
                now.minus(1, ChronoUnit.DAYS), now.plus(1, ChronoUnit.DAYS),
                null, null, null, null, null));

        var result = promotionEngine.evaluate(new EvaluatePromotionRequest(
                UUID.randomUUID(), null, 30_000, now, List.of()));

        assertThat(result.discountPaisa()).isEqualTo(30_000);
    }

    /**
     * THE REGRESSION. A stored promotion whose type has no pricing formula must refuse, not return
     * a number.
     *
     * <p>The row is persisted directly rather than through {@code create()}, because that is the
     * only way this case reaches production: {@code create()} now rejects the type at the door, but
     * {@code promotions.discount_type} is {@code VARCHAR(20)} with no CHECK, so every row written
     * before the guard existed — and anything inserted by a migration or by hand — is still in the
     * table waiting to be priced.
     *
     * <p><b>What the old code did with this exact row.</b> {@code computeDiscount} tested for
     * PERCENT and let everything else fall into an {@code else} that read {@code discountValue} as
     * paisa. A {@code SPEND_AND_SAVE} rule carrying {@code value = 150} — Rs 150, in the unit its
     * own rule is written in — was returned as {@code 150}, i.e. Rs 1.50, and pos-service wrote
     * that to {@code order_discounts.amount_paisa} and printed it on the bill. Assert the money, so
     * that reverting the production change fails here on the arithmetic and not on a message.
     */
    @Test
    void evaluate_refusesToPrice_whenStoredTypeHasNoFormula() {
        Instant now = Instant.now();
        storeRawPromotion("Spend Rs 1000 save Rs 150", "SPEND_AND_SAVE", 150,
                now.minus(1, ChronoUnit.DAYS), now.plus(1, ChronoUnit.DAYS));

        var request = new EvaluatePromotionRequest(
                UUID.randomUUID(), null, 50_000, now, List.of());

        assertThatThrownBy(() -> promotionEngine.evaluate(request))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("SPEND_AND_SAVE")
                // The old code answered 150 here — Rs 1.50 off a Rs 500.00 check — and looked
                // entirely healthy doing it. Nothing may return a priced answer for this row.
                .hasMessageContaining("Refusing to price");
    }

    /**
     * The same refusal for a plausible typo. {@code "PERCENTAGE"} is one keystroke from the only
     * type the old code recognised, and it fell through to the paisa branch: a 15%-off promotion
     * became 15 paisa off. Both directions of the error are silent.
     */
    @Test
    void evaluate_refusesToPrice_whenStoredTypeIsANearMissForPercent() {
        Instant now = Instant.now();
        storeRawPromotion("Fifteen percent", "PERCENTAGE", 15,
                now.minus(1, ChronoUnit.DAYS), now.plus(1, ChronoUnit.DAYS));

        var request = new EvaluatePromotionRequest(
                UUID.randomUUID(), null, 50_000, now, List.of());

        // Intended: Rs 75.00 off. Old behaviour: 15 paisa off. Correct behaviour: neither — refuse.
        assertThatThrownBy(() -> promotionEngine.evaluate(request))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("PERCENTAGE");
    }

    /**
     * An unpriceable row that is not eligible must still cost nothing and must NOT refuse: the
     * guard fires only when the bad row is actually a candidate for the guest's money. Without
     * this, one expired junk promotion would take down promotion evaluation for the whole tenant.
     */
    @Test
    void evaluate_ignoresUnpriceablePromotion_whenItIsNotEligibleAnyway() {
        Instant now = Instant.now();
        storeRawPromotion("Last year's BOGO", "BOGO", 150,
                now.minus(30, ChronoUnit.DAYS), now.minus(20, ChronoUnit.DAYS));

        var result = promotionEngine.evaluate(new EvaluatePromotionRequest(
                UUID.randomUUID(), null, 50_000, now, List.of()));

        assertThat(result.discountPaisa()).isZero();
    }

    /** The door: an unpriceable type is refused before it can ever become a row. */
    @Test
    void create_refusesADiscountTypeItCannotPrice() {
        Instant now = Instant.now();
        var request = new CreatePromotionRequest(
                "Buy one get one", "BOGO", 150,
                now.minus(1, ChronoUnit.DAYS), now.plus(1, ChronoUnit.DAYS),
                null, null, null, null, null);

        assertThatThrownBy(() -> promotionEngine.create(request))
                .isInstanceOf(FieldValidationException.class)
                .hasMessageContaining("BOGO");

        assertThat(promotionEngine.listActive()).isEmpty();
    }

    /**
     * Persist a promotion row WITHOUT going through {@code create()}, modelling a row that predates
     * the create-time guard. Its own transaction, so {@code evaluate()} reads it as committed data.
     */
    private void storeRawPromotion(String name, String discountType, long value,
                                   Instant startAt, Instant endAt) {
        transactionTemplate.executeWithoutResult(status -> {
            entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
                    .setParameter("tid", tenantId.toString())
                    .getSingleResult();
            PromotionEntity promo = new PromotionEntity();
            promo.setTenantId(tenantId);
            promo.setName(name);
            promo.setDiscountType(discountType);
            promo.setDiscountValue(value);
            promo.setStartAt(startAt);
            promo.setEndAt(endAt);
            promo.setActive(true);
            entityManager.persist(promo);
        });
    }

    private void setRls(UUID tenantId) {
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, false)")
                .setParameter("tid", tenantId.toString())
                .getSingleResult();
    }
}
