package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.service.OrderStateMachine;
import io.restaurantos.shared.exception.StateInvalidException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class OrderStateMachineUnitTest {

    private OrderStateMachine stateMachine;

    @BeforeEach
    void setUp() {
        stateMachine = new OrderStateMachine();
    }

    // ── Legal transitions ─────────────────────────────────────

    @Test
    void draftToOpenIsAllowed() {
        assertThatCode(() -> stateMachine.assertTransition(OrderStatus.DRAFT, OrderStatus.OPEN))
                .doesNotThrowAnyException();
    }

    @Test
    void openToSentToKdsIsAllowed() {
        assertThatCode(() -> stateMachine.assertTransition(OrderStatus.OPEN, OrderStatus.SENT_TO_KDS))
                .doesNotThrowAnyException();
    }

    @Test
    void sentToKdsToReadyIsAllowed() {
        assertThatCode(() -> stateMachine.assertTransition(OrderStatus.SENT_TO_KDS, OrderStatus.READY))
                .doesNotThrowAnyException();
    }

    @Test
    void openToClosedIsAllowed() {
        assertThatCode(() -> stateMachine.assertTransition(OrderStatus.OPEN, OrderStatus.CLOSED))
                .doesNotThrowAnyException();
    }

    @Test
    void sentToKdsToClosedIsAllowed() {
        assertThatCode(() -> stateMachine.assertTransition(OrderStatus.SENT_TO_KDS, OrderStatus.CLOSED))
                .doesNotThrowAnyException();
    }

    @Test
    void readyToClosedIsAllowed() {
        assertThatCode(() -> stateMachine.assertTransition(OrderStatus.READY, OrderStatus.CLOSED))
                .doesNotThrowAnyException();
    }

    @Test
    void servedToClosedIsAllowed() {
        assertThatCode(() -> stateMachine.assertTransition(OrderStatus.SERVED, OrderStatus.CLOSED))
                .doesNotThrowAnyException();
    }

    @Test
    void closedToRefundedIsAllowed() {
        assertThatCode(() -> stateMachine.assertTransition(OrderStatus.CLOSED, OrderStatus.REFUNDED))
                .doesNotThrowAnyException();
    }

    // ── Illegal transitions ───────────────────────────────────

    @Test
    void openToReadyIsIllegal() {
        assertThatThrownBy(() -> stateMachine.assertTransition(OrderStatus.OPEN, OrderStatus.READY))
                .isInstanceOf(StateInvalidException.class);
    }

    // ── Self-loop transitions (POS-12 revisions: repeated sendToKds fires) ─────

    @Test
    void sentToKdsToSentToKdsIsAllowed() {
        assertThatCode(() -> stateMachine.assertTransition(OrderStatus.SENT_TO_KDS, OrderStatus.SENT_TO_KDS))
                .doesNotThrowAnyException();
    }

    @Test
    void partialReadyToPartialReadyIsAllowed() {
        assertThatCode(() -> stateMachine.assertTransition(OrderStatus.PARTIAL_READY, OrderStatus.PARTIAL_READY))
                .doesNotThrowAnyException();
    }

    @Test
    void readyToReadyIsAllowed() {
        assertThatCode(() -> stateMachine.assertTransition(OrderStatus.READY, OrderStatus.READY))
                .doesNotThrowAnyException();
    }

    // ── Prior transitions preserved (regression guard) ──────────────────────

    @Test
    void sentToKdsToPartialReadyIsStillAllowed() {
        assertThatCode(() -> stateMachine.assertTransition(OrderStatus.SENT_TO_KDS, OrderStatus.PARTIAL_READY))
                .doesNotThrowAnyException();
    }

    @Test
    void partialReadyToReadyIsStillAllowed() {
        assertThatCode(() -> stateMachine.assertTransition(OrderStatus.PARTIAL_READY, OrderStatus.READY))
                .doesNotThrowAnyException();
    }

    @Test
    void closedToOpenIsIllegal() {
        assertThatThrownBy(() -> stateMachine.assertTransition(OrderStatus.CLOSED, OrderStatus.OPEN))
                .isInstanceOf(StateInvalidException.class);
    }

    @Test
    void voidedToOpenIsIllegal() {
        assertThatThrownBy(() -> stateMachine.assertTransition(OrderStatus.VOIDED, OrderStatus.OPEN))
                .isInstanceOf(StateInvalidException.class);
    }

    @Test
    void refundedToAnyIsIllegal() {
        assertThatThrownBy(() -> stateMachine.assertTransition(OrderStatus.REFUNDED, OrderStatus.OPEN))
                .isInstanceOf(StateInvalidException.class);
        assertThatThrownBy(() -> stateMachine.assertTransition(OrderStatus.REFUNDED, OrderStatus.CLOSED))
                .isInstanceOf(StateInvalidException.class);
    }

    @Test
    void draftToClosedIsIllegal() {
        assertThatThrownBy(() -> stateMachine.assertTransition(OrderStatus.DRAFT, OrderStatus.CLOSED))
                .isInstanceOf(StateInvalidException.class);
    }
}
