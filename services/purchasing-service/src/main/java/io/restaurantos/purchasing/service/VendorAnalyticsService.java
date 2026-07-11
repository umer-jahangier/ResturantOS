package io.restaurantos.purchasing.service;

import io.restaurantos.purchasing.domain.enums.InvoiceStatus;
import io.restaurantos.purchasing.domain.model.MockGrnReceipt;
import io.restaurantos.purchasing.domain.model.PurchaseOrder;
import io.restaurantos.purchasing.domain.model.PurchaseOrderLine;
import io.restaurantos.purchasing.domain.model.Vendor;
import io.restaurantos.purchasing.domain.model.VendorInvoice;
import io.restaurantos.purchasing.domain.model.VendorInvoiceLine;
import io.restaurantos.purchasing.dto.SpendAnalyticsDto;
import io.restaurantos.purchasing.dto.SpendBucketDto;
import io.restaurantos.purchasing.dto.VendorScorecardDto;
import io.restaurantos.purchasing.repository.MockGrnReceiptRepository;
import io.restaurantos.purchasing.repository.PurchaseOrderLineRepository;
import io.restaurantos.purchasing.repository.PurchaseOrderRepository;
import io.restaurantos.purchasing.repository.VendorInvoiceRepository;
import io.restaurantos.purchasing.repository.VendorRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
public class VendorAnalyticsService {

    private static final List<InvoiceStatus> SPEND_STATUSES = List.of(InvoiceStatus.MATCHED, InvoiceStatus.PAID);

    private final PurchaseOrderRepository purchaseOrderRepository;
    private final MockGrnReceiptRepository mockGrnReceiptRepository;
    private final VendorInvoiceRepository invoiceRepository;
    private final PurchaseOrderLineRepository purchaseOrderLineRepository;
    private final VendorRepository vendorRepository;
    private final IngredientCategoryResolver ingredientCategoryResolver;
    private final TenantContext tenantContext;

    public VendorAnalyticsService(PurchaseOrderRepository purchaseOrderRepository,
                                  MockGrnReceiptRepository mockGrnReceiptRepository,
                                  VendorInvoiceRepository invoiceRepository,
                                  PurchaseOrderLineRepository purchaseOrderLineRepository,
                                  VendorRepository vendorRepository,
                                  IngredientCategoryResolver ingredientCategoryResolver,
                                  TenantContext tenantContext) {
        this.purchaseOrderRepository = purchaseOrderRepository;
        this.mockGrnReceiptRepository = mockGrnReceiptRepository;
        this.invoiceRepository = invoiceRepository;
        this.purchaseOrderLineRepository = purchaseOrderLineRepository;
        this.vendorRepository = vendorRepository;
        this.ingredientCategoryResolver = ingredientCategoryResolver;
        this.tenantContext = tenantContext;
    }

    @Transactional(readOnly = true)
    public VendorScorecardDto scorecard(UUID vendorId, UUID branchId) {
        UUID tenantId = tenantContext.requireTenantId();
        List<PurchaseOrder> pos = purchaseOrderRepository.findByTenantIdAndVendorIdAndBranchId(tenantId, vendorId, branchId);
        int totalPos = pos.size();
        int onTime = 0;
        int withReceipt = 0;

        List<VendorInvoice> vendorInvoices = invoiceRepository.findByTenantIdAndBranchIdOrderByInvoiceDateDesc(tenantId, branchId)
                .stream()
                .filter(i -> i.getVendorId().equals(vendorId))
                .toList();

        long totalSpend = vendorInvoices.stream().mapToLong(VendorInvoice::getTotalPaisa).sum();

        for (PurchaseOrder po : pos) {
            List<MockGrnReceipt> receipts = mockGrnReceiptRepository.findByPurchaseOrderId(po.getId());
            if (receipts.isEmpty()) {
                continue;
            }
            withReceipt++;
            MockGrnReceipt first = receipts.getFirst();
            if (po.getExpectedDeliveryDate() != null) {
                var deadline = po.getExpectedDeliveryDate().plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant();
                if (!first.getReceivedAt().isAfter(deadline)) {
                    onTime++;
                }
            }
        }

        double onTimePct = withReceipt == 0 ? 0.0 : (100.0 * onTime / withReceipt);
        double fillRate = totalPos == 0 ? 0.0 : (100.0 * withReceipt / totalPos);

        List<VendorInvoice> matchedOrPaidInvoices = vendorInvoices.stream()
                .filter(i -> SPEND_STATUSES.contains(i.getStatus()))
                .toList();
        double priceVariancePct = computePriceVariancePct(matchedOrPaidInvoices);

        return new VendorScorecardDto(vendorId, branchId, onTimePct, fillRate, priceVariancePct, totalSpend, totalPos);
    }

    /**
     * PUR-05 third scorecard metric: spend-weighted mean price variance across a vendor's MATCHED/PAID
     * invoice lines, expressed as a percentage. Per-line variance reuses the exact ratio
     * {@code ThreeWayMatchService.matchLine()} computes ({@code invoiceUnitPricePaisa / poUnitPricePaisa},
     * BigDecimal scale 6 HALF_UP) minus 1 — this is a *metric*, not a tolerance check, so no
     * LineMatchStatus is involved. Each line is weighted by its {@code lineTotalPaisa} so a large line
     * moves the number more than a trivial one. Lines whose PO price is 0 are skipped to avoid
     * divide-by-zero. Returns 0.0 (never NaN) when there are no qualifying lines.
     */
    private double computePriceVariancePct(List<VendorInvoice> invoices) {
        BigDecimal weightedVarianceSum = BigDecimal.ZERO;
        BigDecimal totalWeight = BigDecimal.ZERO;

        for (VendorInvoice invoice : invoices) {
            for (VendorInvoiceLine line : invoice.getLines()) {
                PurchaseOrderLine poLine = purchaseOrderLineRepository.findById(line.getPoLineId()).orElse(null);
                if (poLine == null || poLine.getUnitPricePaisa() == 0) {
                    continue;
                }
                BigDecimal priceRatio = BigDecimal.valueOf(line.getUnitPricePaisa())
                        .divide(BigDecimal.valueOf(poLine.getUnitPricePaisa()), 6, RoundingMode.HALF_UP);
                BigDecimal lineVariancePct = priceRatio.subtract(BigDecimal.ONE).multiply(BigDecimal.valueOf(100));
                BigDecimal weight = BigDecimal.valueOf(line.getLineTotalPaisa());

                weightedVarianceSum = weightedVarianceSum.add(lineVariancePct.multiply(weight));
                totalWeight = totalWeight.add(weight);
            }
        }

        if (totalWeight.compareTo(BigDecimal.ZERO) == 0) {
            return 0.0;
        }
        return weightedVarianceSum.divide(totalWeight, 6, RoundingMode.HALF_UP).doubleValue();
    }

    /**
     * PUR-06: spend aggregated by vendor and by category over [from, to], with a prior-period comparison.
     * Spend is drawn only from MATCHED/PAID vendor invoices. Category is resolved mock-first via
     * invoiceLine.poLineId -> PurchaseOrderLine.ingredientId -> {@link IngredientCategoryResolver}, so this
     * has no Phase 8 / inventory-service dependency.
     *
     * <p>When {@code compareFrom}/{@code compareTo} are not supplied, the prior window defaults to an
     * equal-length window ending the day before {@code from}.
     *
     * <p>deltaPct is {@code null} when the prior-period spend for a bucket is zero (new spend has no
     * meaningful percent change) rather than an infinite/undefined sentinel.
     */
    @Transactional(readOnly = true)
    public SpendAnalyticsDto spendReport(UUID branchId, LocalDate from, LocalDate to,
                                         LocalDate compareFrom, LocalDate compareTo) {
        UUID tenantId = tenantContext.requireTenantId();

        LocalDate resolvedCompareTo = compareTo != null ? compareTo : from.minusDays(1);
        LocalDate resolvedCompareFrom = compareFrom != null ? compareFrom
                : resolvedCompareTo.minusDays(ChronoUnit.DAYS.between(from, to));

        List<VendorInvoice> currentInvoices = invoiceRepository.findForSpendReport(tenantId, branchId, SPEND_STATUSES, from, to);
        List<VendorInvoice> priorInvoices = invoiceRepository.findForSpendReport(
                tenantId, branchId, SPEND_STATUSES, resolvedCompareFrom, resolvedCompareTo);

        Map<UUID, PurchaseOrderLine> poLinesById = loadPoLines(currentInvoices, priorInvoices);
        Map<UUID, String> vendorNamesById = loadVendorNames(currentInvoices, priorInvoices);

        Map<UUID, Long> currentByVendor = new HashMap<>();
        Map<String, Long> currentByCategory = new HashMap<>();
        aggregate(currentInvoices, poLinesById, currentByVendor, currentByCategory);

        Map<UUID, Long> priorByVendor = new HashMap<>();
        Map<String, Long> priorByCategory = new HashMap<>();
        aggregate(priorInvoices, poLinesById, priorByVendor, priorByCategory);

        List<SpendBucketDto> byVendor = buildVendorBuckets(currentByVendor, priorByVendor, vendorNamesById);
        List<SpendBucketDto> byCategory = buildLabelBuckets(currentByCategory, priorByCategory);

        return new SpendAnalyticsDto(branchId, from, to, resolvedCompareFrom, resolvedCompareTo, byVendor, byCategory);
    }

    private Map<UUID, PurchaseOrderLine> loadPoLines(List<VendorInvoice> current, List<VendorInvoice> prior) {
        Set<UUID> poLineIds = new HashSet<>();
        collectPoLineIds(current, poLineIds);
        collectPoLineIds(prior, poLineIds);
        if (poLineIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, PurchaseOrderLine> result = new HashMap<>();
        for (PurchaseOrderLine line : purchaseOrderLineRepository.findAllById(poLineIds)) {
            result.put(line.getId(), line);
        }
        return result;
    }

    private void collectPoLineIds(List<VendorInvoice> invoices, Set<UUID> out) {
        for (VendorInvoice invoice : invoices) {
            for (VendorInvoiceLine line : invoice.getLines()) {
                out.add(line.getPoLineId());
            }
        }
    }

    private Map<UUID, String> loadVendorNames(List<VendorInvoice> current, List<VendorInvoice> prior) {
        Set<UUID> vendorIds = new HashSet<>();
        current.forEach(i -> vendorIds.add(i.getVendorId()));
        prior.forEach(i -> vendorIds.add(i.getVendorId()));
        if (vendorIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, String> result = new HashMap<>();
        for (Vendor vendor : vendorRepository.findAllById(vendorIds)) {
            result.put(vendor.getId(), vendor.getName());
        }
        return result;
    }

    private void aggregate(List<VendorInvoice> invoices, Map<UUID, PurchaseOrderLine> poLinesById,
                           Map<UUID, Long> byVendor, Map<String, Long> byCategory) {
        for (VendorInvoice invoice : invoices) {
            for (VendorInvoiceLine line : invoice.getLines()) {
                byVendor.merge(invoice.getVendorId(), line.getLineTotalPaisa(), Long::sum);

                PurchaseOrderLine poLine = poLinesById.get(line.getPoLineId());
                UUID ingredientId = poLine != null ? poLine.getIngredientId() : null;
                String category = ingredientCategoryResolver.resolve(ingredientId);
                byCategory.merge(category, line.getLineTotalPaisa(), Long::sum);
            }
        }
    }

    private List<SpendBucketDto> buildVendorBuckets(Map<UUID, Long> current, Map<UUID, Long> prior,
                                                     Map<UUID, String> vendorNamesById) {
        Set<UUID> vendorIds = new HashSet<>();
        vendorIds.addAll(current.keySet());
        vendorIds.addAll(prior.keySet());

        List<SpendBucketDto> buckets = new ArrayList<>();
        for (UUID vendorId : vendorIds) {
            long spend = current.getOrDefault(vendorId, 0L);
            long priorSpend = prior.getOrDefault(vendorId, 0L);
            String label = vendorNamesById.getOrDefault(vendorId, vendorId.toString());
            buckets.add(toBucket(label, vendorId, spend, priorSpend));
        }
        buckets.sort(Comparator.comparingLong(SpendBucketDto::spendPaisa).reversed());
        return buckets;
    }

    private List<SpendBucketDto> buildLabelBuckets(Map<String, Long> current, Map<String, Long> prior) {
        Set<String> labels = new HashSet<>();
        labels.addAll(current.keySet());
        labels.addAll(prior.keySet());

        List<SpendBucketDto> buckets = new ArrayList<>();
        for (String label : labels) {
            long spend = current.getOrDefault(label, 0L);
            long priorSpend = prior.getOrDefault(label, 0L);
            buckets.add(toBucket(label, null, spend, priorSpend));
        }
        buckets.sort(Comparator.comparingLong(SpendBucketDto::spendPaisa).reversed());
        return buckets;
    }

    private SpendBucketDto toBucket(String label, UUID id, long spend, long priorSpend) {
        long delta = spend - priorSpend;
        Double deltaPct = priorSpend == 0 ? null : (delta * 100.0 / priorSpend);
        return new SpendBucketDto(label, id, spend, priorSpend, delta, deltaPct);
    }
}
