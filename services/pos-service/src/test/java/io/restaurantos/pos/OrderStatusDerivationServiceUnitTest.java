package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.DerivedOrderStatus;
import io.restaurantos.pos.domain.enums.OrderItemStatus;
import io.restaurantos.pos.domain.model.OrderItem;
import io.restaurantos.pos.service.OrderStatusDerivationService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for OrderStatusDerivationService — pure aggregate-status computation
 * from line-level OrderItemStatus, no DB / no Spring context.
 */
class OrderStatusDerivationServiceUnitTest {

    private final OrderStatusDerivationService service = new OrderStatusDerivationService();

    private static OrderItem itemWith(OrderItemStatus status) {
        OrderItem item = new OrderItem();
        item.setItemStatus(status);
        return item;
    }

    // ── Boundary case: no lines / all PENDING -> DRAFT ─────────────────────────

    @Test
    void noLines_derivesDraft() {
        assertThat(service.derive(List.of())).isEqualTo(DerivedOrderStatus.DRAFT);
    }

    @Test
    void allLinesPending_derivesDraft() {
        List<OrderItem> items = List.of(
                itemWith(OrderItemStatus.PENDING),
                itemWith(OrderItemStatus.PENDING)
        );
        assertThat(service.derive(items)).isEqualTo(DerivedOrderStatus.DRAFT);
    }

    // ── Boundary case: >=1 SENT/ACCEPTED/PREPARING/READY, none SERVED -> IN_PROGRESS ──

    @ParameterizedTest
    @EnumSource(value = OrderItemStatus.class, names = {"SENT", "ACCEPTED", "PREPARING", "READY"})
    void anyKitchenPipelineStatus_noneServed_derivesInProgress(OrderItemStatus pipelineStatus) {
        List<OrderItem> items = List.of(
                itemWith(pipelineStatus),
                itemWith(OrderItemStatus.PENDING)
        );
        assertThat(service.derive(items)).isEqualTo(DerivedOrderStatus.IN_PROGRESS);
    }

    // ── Boundary case: >=1 SERVED AND >=1 non-cancelled not-yet-SERVED -> PARTIALLY_SERVED ──

    @Test
    void oneServedOneNotServed_derivesPartiallyServed() {
        List<OrderItem> items = List.of(
                itemWith(OrderItemStatus.SERVED),
                itemWith(OrderItemStatus.PREPARING)
        );
        assertThat(service.derive(items)).isEqualTo(DerivedOrderStatus.PARTIALLY_SERVED);
    }

    // ── Boundary case: all non-cancelled SERVED -> SERVED ──────────────────────

    @Test
    void allLinesServed_derivesServed() {
        List<OrderItem> items = List.of(
                itemWith(OrderItemStatus.SERVED),
                itemWith(OrderItemStatus.SERVED)
        );
        assertThat(service.derive(items)).isEqualTo(DerivedOrderStatus.SERVED);
    }

    // ── CANCELLED lines excluded entirely ───────────────────────────────────────

    @Test
    void allCancelled_derivesDraft() {
        List<OrderItem> items = List.of(
                itemWith(OrderItemStatus.CANCELLED),
                itemWith(OrderItemStatus.CANCELLED)
        );
        assertThat(service.derive(items)).isEqualTo(DerivedOrderStatus.DRAFT);
    }

    @Test
    void cancelledLinesIgnored_servedAmongActive_derivesServed() {
        List<OrderItem> items = List.of(
                itemWith(OrderItemStatus.SERVED),
                itemWith(OrderItemStatus.SERVED),
                itemWith(OrderItemStatus.CANCELLED)
        );
        assertThat(service.derive(items)).isEqualTo(DerivedOrderStatus.SERVED);
    }

    @Test
    void cancelledLinesIgnored_pendingAmongActive_derivesDraft() {
        List<OrderItem> items = List.of(
                itemWith(OrderItemStatus.PENDING),
                itemWith(OrderItemStatus.CANCELLED)
        );
        assertThat(service.derive(items)).isEqualTo(DerivedOrderStatus.DRAFT);
    }

    // ── Mixed 3-line case ────────────────────────────────────────────────────

    @Test
    void threeLines_oneServed_derivesPartiallyServed() {
        List<OrderItem> items = List.of(
                itemWith(OrderItemStatus.SERVED),
                itemWith(OrderItemStatus.PREPARING),
                itemWith(OrderItemStatus.SENT)
        );
        assertThat(service.derive(items)).isEqualTo(DerivedOrderStatus.PARTIALLY_SERVED);
    }

    @Test
    void threeLines_allServed_derivesServed() {
        List<OrderItem> items = List.of(
                itemWith(OrderItemStatus.SERVED),
                itemWith(OrderItemStatus.SERVED),
                itemWith(OrderItemStatus.SERVED)
        );
        assertThat(service.derive(items)).isEqualTo(DerivedOrderStatus.SERVED);
    }

    // ── Property-based backstop over randomized line-status vectors ────────────

    @Test
    void randomizedVectors_alwaysValidStatus_andPartiallyServedInvariantHolds() {
        Random random = new Random(42L); // fixed seed — deterministic
        OrderItemStatus[] allStatuses = OrderItemStatus.values();

        for (int trial = 0; trial < 500; trial++) {
            int lineCount = 1 + random.nextInt(8);
            List<OrderItem> items = new ArrayList<>(lineCount);
            for (int i = 0; i < lineCount; i++) {
                OrderItemStatus status = allStatuses[random.nextInt(allStatuses.length)];
                items.add(itemWith(status));
            }

            DerivedOrderStatus result = service.derive(items);

            // Always a valid enum value (non-null; assertion below documents intent explicitly)
            assertThat(result).isIn((Object[]) DerivedOrderStatus.values());

            if (result == DerivedOrderStatus.PARTIALLY_SERVED) {
                boolean anyServed = items.stream()
                        .anyMatch(i -> i.getItemStatus() == OrderItemStatus.SERVED);
                boolean anyNonServedNonCancelled = items.stream()
                        .anyMatch(i -> i.getItemStatus() != OrderItemStatus.SERVED
                                && i.getItemStatus() != OrderItemStatus.CANCELLED);
                assertThat(anyServed)
                        .as("PARTIALLY_SERVED implies at least one SERVED line (trial %d)", trial)
                        .isTrue();
                assertThat(anyNonServedNonCancelled)
                        .as("PARTIALLY_SERVED implies at least one non-SERVED non-cancelled line (trial %d)", trial)
                        .isTrue();
            }
        }
    }
}
