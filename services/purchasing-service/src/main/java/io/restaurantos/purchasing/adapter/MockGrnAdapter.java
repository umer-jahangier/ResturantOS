package io.restaurantos.purchasing.adapter;

import io.restaurantos.purchasing.domain.model.MockGrnReceipt;
import io.restaurantos.purchasing.domain.model.PurchaseOrderLine;
import io.restaurantos.purchasing.port.GrnDataPort;
import io.restaurantos.purchasing.repository.MockGrnReceiptRepository;
import io.restaurantos.purchasing.repository.PurchaseOrderLineRepository;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;

@Component
@ConditionalOnProperty(name = "restaurantos.inventory.integration-mode", havingValue = "mock", matchIfMissing = true)
public class MockGrnAdapter implements GrnDataPort {

    private final MockGrnReceiptRepository mockGrnReceiptRepository;
    private final PurchaseOrderLineRepository lineRepository;

    public MockGrnAdapter(MockGrnReceiptRepository mockGrnReceiptRepository,
                            PurchaseOrderLineRepository lineRepository) {
        this.mockGrnReceiptRepository = mockGrnReceiptRepository;
        this.lineRepository = lineRepository;
    }

    @Override
    public Optional<GrnSummary> getSummary(UUID poLineId) {
        return mockGrnReceiptRepository.findTopByPoLineIdOrderByReceivedAtDesc(poLineId)
                .flatMap(receipt -> lineRepository.findById(poLineId)
                        .map(line -> new GrnSummary(
                                poLineId,
                                receipt.getPurchaseOrderId(),
                                receipt.getGrnId(),
                                receipt.getReceivedQty(),
                                line.getQty(),
                                receipt.getReceivedAt())));
    }

    public BigDecimal totalReceivedForLine(UUID poLineId) {
        return mockGrnReceiptRepository.sumReceivedQtyByPoLineId(poLineId);
    }
}
