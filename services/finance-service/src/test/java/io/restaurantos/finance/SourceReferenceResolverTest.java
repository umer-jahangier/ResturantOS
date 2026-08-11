package io.restaurantos.finance;

import io.restaurantos.finance.dto.InternalOrderSummary;
import io.restaurantos.finance.dto.SourceReferenceDto;
import io.restaurantos.finance.feign.PosLookupClient;
import io.restaurantos.finance.service.SourceReferenceResolver;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 37-04 task 2 — a journal entry names what produced it, or says plainly that it cannot.
 *
 * <p>The load-bearing property is that FOUR outcomes stay distinguishable without reading free
 * text. Collapsing them is how a screen ends up printing one dash that means "entered by hand",
 * "we can't look this type up" and "pos-service is down" — three situations demanding three
 * different reactions from an owner.
 */
class SourceReferenceResolverTest {

    private AtomicInteger callCount;
    private PosLookupClient stubClient;
    private SourceReferenceResolver resolver;

    private static final UUID ORDER_ID = UUID.randomUUID();
    private static final Instant CLOSED_AT = Instant.parse("2026-08-07T00:46:24Z");

    @BeforeEach
    void setUp() {
        callCount = new AtomicInteger();
    }

    private void givenPosReturns(InternalOrderSummary summary) {
        stubClient = orderId -> {
            callCount.incrementAndGet();
            return summary;
        };
        resolver = new SourceReferenceResolver(stubClient);
    }

    private void givenPosThrows(RuntimeException e) {
        stubClient = orderId -> {
            callCount.incrementAndGet();
            throw e;
        };
        resolver = new SourceReferenceResolver(stubClient);
    }

    // ── State 1: RESOLVED ─────────────────────────────────────────────────────────────────────
    @Test
    void entrySourcedFromAClosedOrder_namesTheOrderBranchCashierAndClosingTime() {
        givenPosReturns(new InternalOrderSummary(
                ORDER_ID, "ORD-20260807-0001", UUID.randomUUID(), UUID.randomUUID(), CLOSED_AT));

        SourceReferenceDto ref = resolver.resolve("ORDER_REVENUE", ORDER_ID);

        assertThat(ref.state()).isEqualTo(SourceReferenceDto.State.RESOLVED);
        assertThat(ref.orderNo()).isEqualTo("ORD-20260807-0001");
        assertThat(ref.branchId()).isNotNull();
        assertThat(ref.cashierId()).isNotNull();
        assertThat(ref.closedAt()).isEqualTo(CLOSED_AT);
        assertThat(ref.reason()).isNull();
    }

    // ── State 2: NOT_APPLICABLE — a hand-written adjustment ───────────────────────────────────
    @Test
    void entryWithNoSourceAtAll_reportsEnteredByHand_andIsNotAFailure() {
        givenPosReturns(null);

        SourceReferenceDto ref = resolver.resolve(null, null);

        assertThat(ref.state())
                .as("\"entered by hand\" must be distinguishable from \"could not be read\"")
                .isEqualTo(SourceReferenceDto.State.NOT_APPLICABLE);
        assertThat(ref.state()).isNotEqualTo(SourceReferenceDto.State.LOOKUP_FAILED);
        assertThat(callCount).hasValue(0);
    }

    // ── State 3: UNSUPPORTED_SOURCE_TYPE ──────────────────────────────────────────────────────
    @Test
    void sourceTypeWithNoLookup_saysSoAndNamesTheType_ratherThanGuessingAShape() {
        givenPosReturns(null);

        SourceReferenceDto ref = resolver.resolve("STOCK_RECEIPT", UUID.randomUUID());

        assertThat(ref.state()).isEqualTo(SourceReferenceDto.State.UNSUPPORTED_SOURCE_TYPE);
        assertThat(ref.reason()).contains("STOCK_RECEIPT");
        assertThat(ref.orderNo()).as("no invented display value").isNull();
        assertThat(callCount).as("no pointless network call for a type we cannot resolve").hasValue(0);
    }

    // ── State 4: LOOKUP_FAILED — and the ledger survives it ───────────────────────────────────
    @Test
    void unavailablePos_degradesToLookupFailedWithAReason_andNeverThrows() {
        givenPosThrows(new IllegalStateException("connect timed out"));

        SourceReferenceDto ref = resolver.resolve("ORDER_REVENUE", ORDER_ID);

        assertThat(ref.state()).isEqualTo(SourceReferenceDto.State.LOOKUP_FAILED);
        assertThat(ref.reason()).contains("connect timed out");
        assertThat(ref.sourceId())
                .as("the raw identifier survives, so a client can still link even unresolved")
                .isEqualTo(ORDER_ID);
        assertThat(ref.orderNo())
                .as("D-37-05: no invented display value — not a dash, not the raw id dressed "
                        + "as an order number")
                .isNull();
    }

    @Test
    void posReturningNoOrder_isAFailureNotAResolvedBlank() {
        givenPosReturns(null);

        SourceReferenceDto ref = resolver.resolve("ORDER_REFUND", ORDER_ID);

        assertThat(ref.state()).isEqualTo(SourceReferenceDto.State.LOOKUP_FAILED);
        assertThat(ref.reason()).contains("no order");
    }

    // ── The four states are distinguishable without parsing prose ─────────────────────────────
    @Test
    void allFourOutcomesAreDistinguishableFromTheStateFieldAlone() {
        givenPosReturns(new InternalOrderSummary(ORDER_ID, "ORD-1", UUID.randomUUID(),
                UUID.randomUUID(), CLOSED_AT));
        SourceReferenceDto resolved = resolver.resolve("ORDER_COGS", ORDER_ID);
        SourceReferenceDto absent = resolver.resolve(null, null);
        SourceReferenceDto unsupported = resolver.resolve("PAYROLL", UUID.randomUUID());

        givenPosThrows(new IllegalStateException("boom"));
        SourceReferenceDto failed = resolver.resolve("ORDER_REVENUE", ORDER_ID);

        assertThat(java.util.Set.of(
                resolved.state(), absent.state(), unsupported.state(), failed.state()))
                .as("four outcomes must yield four distinct states")
                .hasSize(4);
    }

    // ── Every order source type is actually attempted ─────────────────────────────────────────
    @Test
    void everyOrderSourceTypeIsAttempted_notJustRevenue() {
        givenPosReturns(new InternalOrderSummary(ORDER_ID, "ORD-1", UUID.randomUUID(),
                UUID.randomUUID(), CLOSED_AT));

        for (String type : java.util.List.of("ORDER_REVENUE", "ORDER_COGS", "ORDER_REFUND")) {
            assertThat(resolver.resolve(type, ORDER_ID).state())
                    .as("a cost-of-sales entry and a refund entry name their order too")
                    .isEqualTo(SourceReferenceDto.State.RESOLVED);
        }
        assertThat(callCount).hasValue(3);
    }
}
