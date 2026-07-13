package io.restaurantos.purchasing.service;

import io.restaurantos.purchasing.config.InventoryIntegrationProperties;
import io.restaurantos.purchasing.domain.enums.LineMatchStatus;
import io.restaurantos.purchasing.domain.model.PurchaseOrderLine;
import io.restaurantos.purchasing.domain.model.TenantMatchTolerance;
import io.restaurantos.purchasing.domain.model.VendorInvoiceLine;
import io.restaurantos.purchasing.port.GrnDataPort;
import io.restaurantos.purchasing.repository.MockGrnReceiptRepository;
import io.restaurantos.purchasing.repository.PurchaseOrderLineRepository;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;

@Service
public class ThreeWayMatchService {

    private final GrnDataPort grnDataPort;
    private final PurchaseOrderLineRepository lineRepository;
    private final TenantSetupService tenantSetupService;
    private final MockGrnReceiptRepository mockGrnReceiptRepository;
    private final InventoryIntegrationProperties integrationProperties;

    public ThreeWayMatchService(GrnDataPort grnDataPort,
                                PurchaseOrderLineRepository lineRepository,
                                TenantSetupService tenantSetupService,
                                MockGrnReceiptRepository mockGrnReceiptRepository,
                                InventoryIntegrationProperties integrationProperties) {
        this.grnDataPort = grnDataPort;
        this.lineRepository = lineRepository;
        this.tenantSetupService = tenantSetupService;
        this.mockGrnReceiptRepository = mockGrnReceiptRepository;
        this.integrationProperties = integrationProperties;
    }

    public LineMatchStatus matchLine(VendorInvoiceLine invoiceLine) {
        TenantMatchTolerance tol = tenantSetupService.ensureDefaultTolerances();
        PurchaseOrderLine poLine = lineRepository.findById(invoiceLine.getPoLineId()).orElseThrow();

        BigDecimal receivedQty = receivedQtyForLine(invoiceLine.getPoLineId());
        if (receivedQty.compareTo(BigDecimal.ZERO) <= 0) {
            invoiceLine.setMatchStatus(LineMatchStatus.MISSING_GRN);
            return LineMatchStatus.MISSING_GRN;
        }

        BigDecimal invQty = invoiceLine.getQty();
        if (invQty.compareTo(receivedQty.multiply(BigDecimal.ONE.add(tol.getQtyOverPct()))) > 0) {
            invoiceLine.setMatchStatus(LineMatchStatus.QTY_OVER);
            return LineMatchStatus.QTY_OVER;
        }
        if (invQty.compareTo(receivedQty.multiply(BigDecimal.ONE.subtract(tol.getQtyUnderPct()))) < 0) {
            invoiceLine.setMatchStatus(LineMatchStatus.QTY_UNDER);
            return LineMatchStatus.QTY_UNDER;
        }

        long poPrice = poLine.getUnitPricePaisa();
        long invPrice = invoiceLine.getUnitPricePaisa();
        BigDecimal priceRatio = BigDecimal.valueOf(invPrice)
                .divide(BigDecimal.valueOf(poPrice), 6, RoundingMode.HALF_UP);
        if (priceRatio.compareTo(BigDecimal.ONE.add(tol.getPriceOverPct())) > 0) {
            invoiceLine.setMatchStatus(LineMatchStatus.PRICE_OVER);
            return LineMatchStatus.PRICE_OVER;
        }
        if (priceRatio.compareTo(BigDecimal.ONE.subtract(tol.getPriceUnderPct())) < 0) {
            invoiceLine.setMatchStatus(LineMatchStatus.PRICE_UNDER);
            return LineMatchStatus.PRICE_UNDER;
        }

        invoiceLine.setMatchStatus(LineMatchStatus.OK);
        return LineMatchStatus.OK;
    }

    private BigDecimal receivedQtyForLine(java.util.UUID poLineId) {
        if (integrationProperties.isMockMode()) {
            return mockGrnReceiptRepository.sumReceivedQtyByPoLineId(poLineId);
        }
        return grnDataPort.getSummary(poLineId)
                .map(GrnDataPort.GrnSummary::receivedQty)
                .orElse(BigDecimal.ZERO);
    }
}
