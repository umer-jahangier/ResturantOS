package io.restaurantos.inventory.service;

import io.restaurantos.inventory.config.InventoryRabbitConfig;
import io.restaurantos.inventory.domain.model.IngredientBranchStock;
import io.restaurantos.inventory.domain.model.InventoryMovement;
import io.restaurantos.inventory.domain.model.StockLot;
import io.restaurantos.inventory.domain.model.StockTransfer;
import io.restaurantos.inventory.domain.model.StockTransferLine;
import io.restaurantos.inventory.dto.TransferDtos.CreateTransferRequest;
import io.restaurantos.inventory.dto.TransferDtos.ReceiveLineRequest;
import io.restaurantos.inventory.dto.TransferDtos.ReceiveTransferRequest;
import io.restaurantos.inventory.dto.TransferDtos.TransferDto;
import io.restaurantos.inventory.dto.TransferDtos.TransferLineDto;
import io.restaurantos.inventory.dto.TransferDtos.TransferLineRequest;
import io.restaurantos.inventory.event.InventoryEventPayloads;
import io.restaurantos.inventory.event.InventoryEventPayloads.TransferLine;
import io.restaurantos.inventory.event.InventoryEventPayloads.TransferReceivedPayload;
import io.restaurantos.inventory.event.InventoryEventPayloads.TransferShippedPayload;
import io.restaurantos.inventory.event.InventoryEventPayloads.TransferVarianceLine;
import io.restaurantos.inventory.event.InventoryEventPayloads.TransferVariancePayload;
import io.restaurantos.inventory.repository.IngredientBranchStockRepository;
import io.restaurantos.inventory.repository.InventoryMovementRepository;
import io.restaurantos.inventory.repository.StockLotRepository;
import io.restaurantos.inventory.repository.StockTransferLineRepository;
import io.restaurantos.inventory.repository.StockTransferRepository;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;

/**
 * Inter-branch stock transfers (INV-05) — ship (decrement source, mark in-transit), receive
 * (increment destination, recompute destination MAC), and variance handling for shipped-vs-received
 * shortfalls. Reuses the sorted-{@code findForUpdate} deadlock-avoidance convention from
 * {@link DepletionService} (Pitfall 6) and the FEFO-floor-at-zero walk from
 * {@link DepletionService#walkFefoAndFloor}. Publishes {@code TRANSFER_SHIPPED} /
 * {@code TRANSFER_RECEIVED} / {@code TRANSFER_VARIANCE} through the transactional outbox as the
 * LAST statement of each {@code @Transactional} method — every line carries {@code unitCostPaisa}
 * (the source branch's avg cost at ship time), the Inventory-in-Transit (account {@code 1320})
 * valuation Phase 9's finance consumer needs to post the GL entries from. Phase 8 never posts
 * synchronously and never calls finance-service directly (GL posting is Phase 9's scope).
 */
@Service
public class TransferService {

    private final StockTransferRepository transferRepository;
    private final StockTransferLineRepository transferLineRepository;
    private final IngredientBranchStockRepository stockRepository;
    private final StockLotRepository lotRepository;
    private final InventoryMovementRepository movementRepository;
    private final EventPublisher eventPublisher;
    private final TenantContext tenantContext;

    public TransferService(StockTransferRepository transferRepository,
                            StockTransferLineRepository transferLineRepository,
                            IngredientBranchStockRepository stockRepository,
                            StockLotRepository lotRepository,
                            InventoryMovementRepository movementRepository,
                            EventPublisher eventPublisher,
                            TenantContext tenantContext) {
        this.transferRepository = transferRepository;
        this.transferLineRepository = transferLineRepository;
        this.stockRepository = stockRepository;
        this.lotRepository = lotRepository;
        this.movementRepository = movementRepository;
        this.eventPublisher = eventPublisher;
        this.tenantContext = tenantContext;
    }

    @Transactional
    public TransferDto ship(CreateTransferRequest request) {
        UUID tenantId = tenantContext.requireTenantId();

        // Sorted-lock deadlock avoidance (Pitfall 6, reused from DepletionService): accumulate
        // required qty per ingredientId, then lock the DISTINCT ingredientId set in natural UUID
        // order — never lock lazily in per-line encounter order.
        Map<UUID, BigDecimal> qtyByIngredient = new TreeMap<>();
        for (TransferLineRequest line : request.lines()) {
            qtyByIngredient.merge(line.ingredientId(), line.qty(), BigDecimal::add);
        }

        StockTransfer transfer = new StockTransfer();
        transfer.setTenantId(tenantId);
        transfer.setFromBranchId(request.fromBranchId());
        transfer.setToBranchId(request.toBranchId());
        transfer.setStatus("SHIPPED");
        transfer.setShippedAt(Instant.now());
        StockTransfer savedTransfer = transferRepository.save(transfer);

        List<StockTransferLine> savedLines = new ArrayList<>();
        List<TransferLine> eventLines = new ArrayList<>();

        for (Map.Entry<UUID, BigDecimal> entry : qtyByIngredient.entrySet()) {
            UUID ingredientId = entry.getKey();
            BigDecimal qty = entry.getValue();

            IngredientBranchStock stock = stockRepository
                    .findForUpdate(tenantId, request.fromBranchId(), ingredientId)
                    .orElseGet(() -> stockRepository.save(newStockRow(tenantId, request.fromBranchId(), ingredientId)));

            long unitCostPaisa = stock.getAvgCostPaisa();

            // FEFO floor-at-zero walk over the source branch's lots (D-02), mirroring
            // DepletionService's shape; the aggregate on-hand still drops by the FULL shipped qty.
            walkFefoOverSourceLots(stock.getId(), qty);
            stock.setQtyOnHand(stock.getQtyOnHand().subtract(qty));
            stockRepository.save(stock);

            InventoryMovement movement = new InventoryMovement();
            movement.setTenantId(tenantId);
            movement.setBranchId(request.fromBranchId());
            movement.setIngredientId(ingredientId);
            movement.setMovementType("TRANSFER_OUT");
            movement.setQty(qty.negate());
            movement.setUnitCostPaisa(unitCostPaisa);
            movement.setTotalCostPaisa(roundCostPaisa(qty, unitCostPaisa));
            movement.setReferenceType("TRANSFER");
            movement.setReferenceId(savedTransfer.getId());
            movementRepository.save(movement);

            StockTransferLine line = new StockTransferLine();
            line.setTenantId(tenantId);
            line.setTransferId(savedTransfer.getId());
            line.setIngredientId(ingredientId);
            line.setQtyShipped(qty);
            line.setUnitCostPaisa(unitCostPaisa);
            line.setVarianceQty(BigDecimal.ZERO);
            savedLines.add(transferLineRepository.save(line));

            eventLines.add(new TransferLine(ingredientId, qty, unitCostPaisa));
        }

        // Last statement: publish TRANSFER_SHIPPED through the transactional outbox — carries
        // unitCostPaisa per line, the in-transit (1320) valuation Phase 9's finance consumer needs.
        eventPublisher.publish(
                InventoryRabbitConfig.INVENTORY_TOPIC_EXCHANGE,
                InventoryEventPayloads.TRANSFER_SHIPPED_ROUTING_KEY,
                InventoryEventPayloads.TRANSFER_SHIPPED,
                request.fromBranchId(),
                new TransferShippedPayload(savedTransfer.getId(), request.fromBranchId(), request.toBranchId(), eventLines));

        return toDto(savedTransfer, savedLines);
    }

    @Transactional
    public TransferDto receive(ReceiveTransferRequest request) {
        UUID tenantId = tenantContext.requireTenantId();

        StockTransfer transfer = transferRepository.findByIdAndTenantId(request.transferId(), tenantId)
                .orElseThrow(() -> new IllegalArgumentException("Unknown transferId: " + request.transferId()));

        List<StockTransferLine> transferLines = transferLineRepository.findByTransferId(transfer.getId());

        Map<UUID, BigDecimal> qtyReceivedByIngredient = new HashMap<>();
        for (ReceiveLineRequest line : request.lines()) {
            qtyReceivedByIngredient.merge(line.ingredientId(), line.qtyReceived(), BigDecimal::add);
        }

        // Sorted-lock deadlock avoidance (Pitfall 6): lock the DISTINCT destination ingredientId
        // set in natural UUID order, never in per-line encounter order.
        List<StockTransferLine> sortedLines = new ArrayList<>(transferLines);
        sortedLines.sort((a, b) -> a.getIngredientId().compareTo(b.getIngredientId()));

        List<TransferLine> receivedEventLines = new ArrayList<>();
        List<TransferVarianceLine> varianceEventLines = new ArrayList<>();

        for (StockTransferLine line : sortedLines) {
            BigDecimal qtyReceived = qtyReceivedByIngredient.get(line.getIngredientId());
            if (qtyReceived == null) {
                throw new IllegalArgumentException(
                        "Missing receive line for ingredientId: " + line.getIngredientId());
            }

            IngredientBranchStock stock = stockRepository
                    .findForUpdate(tenantId, transfer.getToBranchId(), line.getIngredientId())
                    .orElseGet(() -> stockRepository.save(newStockRow(tenantId, transfer.getToBranchId(), line.getIngredientId())));

            BigDecimal oldQty = stock.getQtyOnHand();
            long newAvgCostPaisa = MacCalculator.recomputeAvgCostPaisa(
                    oldQty, stock.getAvgCostPaisa(), qtyReceived, line.getUnitCostPaisa());

            stock.setQtyOnHand(oldQty.add(qtyReceived));
            stock.setAvgCostPaisa(newAvgCostPaisa);
            IngredientBranchStock savedStock = stockRepository.save(stock);

            StockLot lot = new StockLot();
            lot.setTenantId(tenantId);
            lot.setBranchId(transfer.getToBranchId());
            lot.setIngredientId(line.getIngredientId());
            lot.setStockId(savedStock.getId());
            lot.setQty(qtyReceived);
            lot.setReceiptUnitCostPaisa(line.getUnitCostPaisa());
            lotRepository.save(lot);

            InventoryMovement movement = new InventoryMovement();
            movement.setTenantId(tenantId);
            movement.setBranchId(transfer.getToBranchId());
            movement.setIngredientId(line.getIngredientId());
            movement.setMovementType("TRANSFER_IN");
            movement.setQty(qtyReceived);
            movement.setUnitCostPaisa(line.getUnitCostPaisa());
            movement.setTotalCostPaisa(roundCostPaisa(qtyReceived, line.getUnitCostPaisa()));
            movement.setReferenceType("TRANSFER");
            movement.setReferenceId(transfer.getId());
            movementRepository.save(movement);

            BigDecimal varianceQty = line.getQtyShipped().subtract(qtyReceived);
            line.setQtyReceived(qtyReceived);
            line.setVarianceQty(varianceQty);
            transferLineRepository.save(line);

            receivedEventLines.add(new TransferLine(line.getIngredientId(), qtyReceived, line.getUnitCostPaisa()));

            if (varianceQty.signum() != 0) {
                long varianceCostPaisa = varianceQty
                        .multiply(BigDecimal.valueOf(line.getUnitCostPaisa()))
                        .setScale(0, RoundingMode.HALF_UP)
                        .longValueExact();
                varianceEventLines.add(new TransferVarianceLine(line.getIngredientId(), varianceQty, varianceCostPaisa));
            }
        }

        transfer.setStatus("RECEIVED");
        transfer.setReceivedAt(Instant.now());
        StockTransfer savedTransfer = transferRepository.save(transfer);

        // Publish TRANSFER_RECEIVED — the second-to-last (or last, if no variance) statement.
        eventPublisher.publish(
                InventoryRabbitConfig.INVENTORY_TOPIC_EXCHANGE,
                InventoryEventPayloads.TRANSFER_RECEIVED_ROUTING_KEY,
                InventoryEventPayloads.TRANSFER_RECEIVED,
                transfer.getToBranchId(),
                new TransferReceivedPayload(savedTransfer.getId(), transfer.getToBranchId(), receivedEventLines));

        // No auto-post threshold suppression (Claude's-Discretion, 08-CONTEXT.md): publish
        // TRANSFER_VARIANCE for ANY non-zero variance and let Phase 9 decide GL posting.
        if (!varianceEventLines.isEmpty()) {
            eventPublisher.publish(
                    InventoryRabbitConfig.INVENTORY_TOPIC_EXCHANGE,
                    InventoryEventPayloads.TRANSFER_VARIANCE_ROUTING_KEY,
                    InventoryEventPayloads.TRANSFER_VARIANCE,
                    transfer.getToBranchId(),
                    new TransferVariancePayload(savedTransfer.getId(), varianceEventLines));
        }

        return toDto(savedTransfer, sortedLines);
    }

    /** FEFO floor-at-zero walk over the source branch's lots — mirrors DepletionService's shape. */
    private void walkFefoOverSourceLots(UUID stockId, BigDecimal demand) {
        List<StockLot> lots = lotRepository.findByStockIdOrderByExpiryDateAsc(stockId);
        DepletionService.walkFefoAndFloor(lots, demand);
        lotRepository.saveAll(lots);
    }

    private static long roundCostPaisa(BigDecimal qty, long unitCostPaisa) {
        return qty.multiply(BigDecimal.valueOf(unitCostPaisa))
                .setScale(0, RoundingMode.HALF_UP)
                .longValueExact();
    }

    private static IngredientBranchStock newStockRow(UUID tenantId, UUID branchId, UUID ingredientId) {
        IngredientBranchStock stock = new IngredientBranchStock();
        stock.setTenantId(tenantId);
        stock.setBranchId(branchId);
        stock.setIngredientId(ingredientId);
        stock.setQtyOnHand(BigDecimal.ZERO);
        stock.setAvgCostPaisa(0L);
        return stock;
    }

    private static TransferDto toDto(StockTransfer transfer, List<StockTransferLine> lines) {
        List<TransferLineDto> lineDtos = lines.stream()
                .map(l -> new TransferLineDto(l.getIngredientId(), l.getQtyShipped(), l.getQtyReceived(),
                        l.getVarianceQty(), l.getUnitCostPaisa()))
                .toList();
        return new TransferDto(transfer.getId(), transfer.getFromBranchId(), transfer.getToBranchId(),
                transfer.getStatus(), lineDtos);
    }
}
