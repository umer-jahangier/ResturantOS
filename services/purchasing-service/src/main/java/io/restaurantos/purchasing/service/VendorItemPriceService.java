package io.restaurantos.purchasing.service;

import io.restaurantos.purchasing.domain.model.VendorItem;
import io.restaurantos.purchasing.domain.model.VendorItemPrice;
import io.restaurantos.purchasing.dto.RecordVendorItemPriceRequest;
import io.restaurantos.purchasing.dto.VendorItemPriceChangeDto;
import io.restaurantos.purchasing.dto.VendorItemPriceDto;
import io.restaurantos.purchasing.exception.BackdatedPriceException;
import io.restaurantos.purchasing.repository.VendorItemPriceRepository;
import io.restaurantos.purchasing.repository.VendorItemRepository;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Append-only, effective-dated vendor item pricing (D-01 / RESEARCH §9.3 call 5). {@link
 * #recordNewPrice} is the ONLY writer of {@link VendorItemPrice} rows in the application: it
 * closes the prior open row's {@code effectiveTo} and INSERTs a new row. It never copies {@code
 * VendorService.update}'s in-place {@code apply()} shape — that pattern is exactly the anti-pattern
 * this class exists to prevent. The prior row's {@code unitPricePaisa} is never written to twice.
 */
@Service
@Transactional(readOnly = true)
public class VendorItemPriceService {

    private final VendorItemPriceRepository vendorItemPriceRepository;
    private final VendorItemRepository vendorItemRepository;
    private final TenantContext tenantContext;

    public VendorItemPriceService(VendorItemPriceRepository vendorItemPriceRepository,
                                   VendorItemRepository vendorItemRepository,
                                   TenantContext tenantContext) {
        this.vendorItemPriceRepository = vendorItemPriceRepository;
        this.vendorItemRepository = vendorItemRepository;
        this.tenantContext = tenantContext;
    }

    @Transactional
    public VendorItemPriceDto recordNewPrice(UUID vendorItemId, RecordVendorItemPriceRequest request) {
        UUID tenantId = tenantContext.requireTenantId();
        VendorItem vendorItem = vendorItemRepository.findByTenantIdAndId(tenantId, vendorItemId)
                .orElseThrow(() -> new ResourceNotFoundException("VendorItem", vendorItemId));

        Instant effectiveFrom = request.effectiveFrom() != null ? request.effectiveFrom() : Instant.now();

        List<VendorItemPrice> history =
                vendorItemPriceRepository.findByTenantIdAndVendorItemIdOrderByEffectiveFromDesc(tenantId, vendorItemId);
        VendorItemPrice openRow = history.stream()
                .filter(p -> Objects.equals(p.getBranchId(), request.branchId()))
                .filter(p -> p.getEffectiveTo() == null)
                .findFirst()
                .orElse(null);

        if (openRow != null && !effectiveFrom.isAfter(openRow.getEffectiveFrom())) {
            throw new BackdatedPriceException();
        }

        // The only field ever written on the prior row: closing its window. unitPricePaisa on
        // `openRow` is never touched.
        if (openRow != null) {
            openRow.setEffectiveTo(effectiveFrom);
            vendorItemPriceRepository.save(openRow);
        }

        VendorItemPrice price = new VendorItemPrice();
        price.setTenantId(tenantId);
        price.setVendorItemId(vendorItemId);
        price.setBranchId(request.branchId());
        price.setUnitPricePaisa(request.unitPricePaisa());
        price.setPriceUom(request.priceUom() != null && !request.priceUom().isBlank()
                ? request.priceUom() : vendorItem.getOrderUom());
        price.setEffectiveFrom(effectiveFrom);
        price.setSource(request.source() != null && !request.source().isBlank() ? request.source() : "MANUAL");
        price.setContractPrice(Boolean.TRUE.equals(request.contractPrice()));

        return toDto(vendorItemPriceRepository.save(price));
    }

    public List<VendorItemPriceDto> listPrices(UUID vendorItemId) {
        UUID tenantId = tenantContext.requireTenantId();
        return vendorItemPriceRepository.findByTenantIdAndVendorItemIdOrderByEffectiveFromDesc(tenantId, vendorItemId)
                .stream()
                .map(VendorItemPriceService::toDto)
                .toList();
    }

    /** The row whose effective window covers {@code at}, if any. */
    public Optional<VendorItemPriceDto> currentPrice(UUID vendorItemId, Instant at) {
        UUID tenantId = tenantContext.requireTenantId();
        return vendorItemPriceRepository.findCurrentForVendorItems(tenantId, List.of(vendorItemId), at).stream()
                .findFirst()
                .map(VendorItemPriceService::toDto);
    }

    /**
     * The chronological price-change series for every non-archived catalog row of {@code
     * vendorId}, with the percentage delta between consecutive rows. All prices for the vendor's
     * items are loaded in ONE batched query. {@code deltaPct} is null on the first-ever price row
     * for an item (no previous row to compare against) or when the previous price was zero.
     */
    public List<VendorItemPriceChangeDto> priceChanges(UUID vendorId, Instant since) {
        UUID tenantId = tenantContext.requireTenantId();
        List<VendorItem> items = vendorItemRepository.findByTenantIdAndVendorIdAndArchivedAtIsNull(tenantId, vendorId);
        if (items.isEmpty()) {
            return List.of();
        }

        Map<UUID, VendorItem> itemsById = items.stream().collect(Collectors.toMap(VendorItem::getId, i -> i));
        List<UUID> ids = items.stream().map(VendorItem::getId).toList();
        List<VendorItemPrice> allPrices =
                vendorItemPriceRepository.findByTenantIdAndVendorItemIdInOrderByEffectiveFromDesc(tenantId, ids);
        Map<UUID, List<VendorItemPrice>> byItem = allPrices.stream()
                .collect(Collectors.groupingBy(VendorItemPrice::getVendorItemId));

        List<VendorItemPriceChangeDto> result = new ArrayList<>();
        for (Map.Entry<UUID, List<VendorItemPrice>> entry : byItem.entrySet()) {
            List<VendorItemPrice> ascending = new ArrayList<>(entry.getValue());
            Collections.reverse(ascending); // was ordered effectiveFrom DESC; walk chronologically

            VendorItem item = itemsById.get(entry.getKey());
            VendorItemPrice previous = null;
            for (VendorItemPrice current : ascending) {
                if (since == null || !current.getEffectiveFrom().isBefore(since)) {
                    result.add(new VendorItemPriceChangeDto(
                            item.getId(),
                            item.getVendorSku(),
                            item.getVendorDescription(),
                            previous != null ? previous.getUnitPricePaisa() : null,
                            current.getUnitPricePaisa(),
                            deltaPct(previous, current),
                            current.getEffectiveFrom()));
                }
                previous = current;
            }
        }

        return result.stream()
                .sorted(Comparator.comparing(VendorItemPriceChangeDto::effectiveFrom))
                .toList();
    }

    private static BigDecimal deltaPct(VendorItemPrice previous, VendorItemPrice current) {
        if (previous == null || previous.getUnitPricePaisa() == 0) {
            return null;
        }
        return BigDecimal.valueOf(current.getUnitPricePaisa() - previous.getUnitPricePaisa())
                .divide(BigDecimal.valueOf(previous.getUnitPricePaisa()), 6, RoundingMode.HALF_UP)
                .multiply(BigDecimal.valueOf(100))
                .setScale(2, RoundingMode.HALF_UP);
    }

    private static VendorItemPriceDto toDto(VendorItemPrice p) {
        return new VendorItemPriceDto(
                p.getId(), p.getVendorItemId(), p.getBranchId(), p.getUnitPricePaisa(), p.getPriceUom(),
                p.getEffectiveFrom(), p.getEffectiveTo(), p.getSource(), p.isContractPrice());
    }
}
