package io.restaurantos.purchasing.service;

import io.restaurantos.purchasing.domain.enums.PoStatus;
import io.restaurantos.purchasing.domain.model.PurchaseOrder;
import io.restaurantos.purchasing.domain.model.PurchaseOrderLine;
import io.restaurantos.purchasing.domain.model.VendorItem;
import io.restaurantos.purchasing.domain.model.VendorItemPrice;
import io.restaurantos.purchasing.dto.CreatePurchaseOrderRequest;
import io.restaurantos.purchasing.dto.PurchaseOrderDto;
import io.restaurantos.purchasing.exception.ApprovalLimitExceededException;
import io.restaurantos.purchasing.exception.InvalidPoStateException;
import io.restaurantos.purchasing.exception.VendorItemCatalogMismatchException;
import io.restaurantos.purchasing.feign.AuthorizationClient;
import io.restaurantos.purchasing.repository.PurchaseOrderRepository;
import io.restaurantos.purchasing.repository.VendorItemPriceRepository;
import io.restaurantos.purchasing.repository.MockGrnReceiptRepository;
import io.restaurantos.purchasing.repository.VendorItemRepository;
import io.restaurantos.purchasing.repository.VendorRepository;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class PurchaseOrderService {

    // Canonical OPA action vocabulary (decision 10-07-A): the rego short verb, distinct from the
    // dotted permission code ("vendor.po.close") checked inside the policy via common.has_permission.
    // -> policies/restaurantos/vendor.rego: allow if input.action == "close_po"
    private static final String OPA_ACTION_CLOSE_PO = "close_po";

    private final PurchaseOrderRepository purchaseOrderRepository;
    private final TenantContext tenantContext;
    private final TenantSetupService tenantSetupService;
    private final AuthorizationClient authorizationClient;
    private final EventPublisher eventPublisher;
    private final VendorItemRepository vendorItemRepository;
    private final VendorItemPriceRepository vendorItemPriceRepository;
    private final VendorRepository vendorRepository;
    private final MockGrnReceiptRepository mockGrnReceiptRepository;
    private final PoLineValidityGate poLineValidityGate;

    public PurchaseOrderService(PurchaseOrderRepository purchaseOrderRepository,
                                TenantContext tenantContext,
                                TenantSetupService tenantSetupService,
                                AuthorizationClient authorizationClient,
                                EventPublisher eventPublisher,
                                VendorItemRepository vendorItemRepository,
                                VendorItemPriceRepository vendorItemPriceRepository,
                                VendorRepository vendorRepository,
                                MockGrnReceiptRepository mockGrnReceiptRepository,
                                PoLineValidityGate poLineValidityGate) {
        this.purchaseOrderRepository = purchaseOrderRepository;
        this.tenantContext = tenantContext;
        this.tenantSetupService = tenantSetupService;
        this.authorizationClient = authorizationClient;
        this.eventPublisher = eventPublisher;
        this.vendorItemRepository = vendorItemRepository;
        this.vendorItemPriceRepository = vendorItemPriceRepository;
        this.vendorRepository = vendorRepository;
        this.mockGrnReceiptRepository = mockGrnReceiptRepository;
        this.poLineValidityGate = poLineValidityGate;
    }

    @Transactional
    public PurchaseOrderDto create(CreatePurchaseOrderRequest req) {
        tenantSetupService.ensureDefaults();
        UUID tenantId = tenantContext.requireTenantId();

        // 08.2 code-review WR-02: resolve and tenant-check the vendor before building the PO,
        // mirroring VendorItemService.requireVendor which every catalog write goes through. Without
        // this, a nonexistent or foreign vendorId on the legacy ingredient-typed line path (which has
        // no empty-catalog 422 backstop) would persist an orphan PO pointing at a vendor that does
        // not exist for this tenant.
        vendorRepository.findById(req.vendorId())
                .filter(v -> tenantId.equals(v.getTenantId()))
                .orElseThrow(() -> new ResourceNotFoundException("Vendor", req.vendorId()));

        PurchaseOrder po = new PurchaseOrder();
        po.setTenantId(tenantId);
        po.setVendorId(req.vendorId());
        po.setBranchId(req.branchId());
        po.setExpectedDeliveryDate(req.expectedDeliveryDate());
        po.setNotes(req.notes());
        po.setRequesterId(tenantContext.getUserId().orElse(null));

        // Cross-vendor guard (T-08.2-101) + tenant scoping (T-08.2-102) + the DoS mitigation
        // (T-08.2-105): ONE query for the whole request, scoped to this PO's own vendor and
        // excluding archived rows. A foreign-vendor, foreign-tenant, archived or nonexistent
        // vendorItemId is simply absent from this map and rejected below, all indistinguishably.
        // Never keyed or filtered by category — category tags are a UI filter only (D-01).
        boolean referencesCatalog = req.lines().stream().anyMatch(l -> l.vendorItemId() != null);
        Map<UUID, VendorItem> catalogById = referencesCatalog
                ? vendorItemRepository.findByTenantIdAndVendorIdAndArchivedAtIsNull(tenantId, req.vendorId()).stream()
                        .collect(Collectors.toMap(VendorItem::getId, v -> v))
                : Map.of();

        List<UUID> idsNeedingDerivedPrice = req.lines().stream()
                .filter(l -> l.vendorItemId() != null && l.unitPricePaisa() == null)
                .map(CreatePurchaseOrderRequest.Line::vendorItemId)
                .distinct()
                .toList();
        Map<UUID, VendorItemPrice> currentPriceById =
                currentPricesByItem(tenantId, idsNeedingDerivedPrice, po.getBranchId());

        for (CreatePurchaseOrderRequest.Line lineReq : req.lines()) {
            PurchaseOrderLine line = new PurchaseOrderLine();
            line.setTenantId(tenantId);
            line.setPurchaseOrder(po);
            line.setQty(lineReq.qty());

            if (lineReq.vendorItemId() != null) {
                VendorItem catalogItem = catalogById.get(lineReq.vendorItemId());
                if (catalogItem == null) {
                    throw new VendorItemCatalogMismatchException(
                            "vendorItemId " + lineReq.vendorItemId() + " is not in vendor " + req.vendorId()
                                    + "'s active catalog");
                }
                line.setVendorItemId(catalogItem.getId());
                line.setIngredientId(catalogItem.getIngredientId());
                line.setUom(lineReq.uom() != null && !lineReq.uom().isBlank()
                        ? lineReq.uom() : catalogItem.getOrderUom());
                if (lineReq.unitPricePaisa() != null) {
                    line.setUnitPricePaisa(lineReq.unitPricePaisa());
                } else {
                    // A catalog line with no caller-supplied price MUST resolve to a real current
                    // price. Defaulting to 0 here silently under-reports po.totalPaisa, which
                    // submit() feeds straight into requiredTiersForAmount(...) — a zero-priced line
                    // could lower a real PO's required approval tiers (08.2 code-review CR-2).
                    VendorItemPrice currentPrice = currentPriceById.get(lineReq.vendorItemId());
                    if (currentPrice == null) {
                        throw new VendorItemCatalogMismatchException(
                                "vendorItemId " + lineReq.vendorItemId() + " has no current catalog price;"
                                        + " supply unitPricePaisa explicitly");
                    }
                    line.setUnitPricePaisa(currentPrice.getUnitPricePaisa());
                }
            } else {
                line.setIngredientId(lineReq.ingredientId());
                line.setUom(lineReq.uom());
                line.setUnitPricePaisa(lineReq.unitPricePaisa() != null ? lineReq.unitPricePaisa() : 0L);
            }

            line.setLineTotalPaisa(lineReq.qty().multiply(BigDecimal.valueOf(line.getUnitPricePaisa())).longValue());
            po.getLines().add(line);
        }

        // THE GATE (D-36-04). After the catalog resolution loop, so both line shapes arrive in the
        // same form — and before anything is persisted, so a refusal leaves no partial order.
        //
        // The unit handed over is the one that will TRAVEL on the goods-receipt event, which is not
        // the same field for the two shapes: a catalog line's receipt carries the vendor item's
        // packUom, never the orderUom the price is quoted in and never line.uom (which defaults to
        // orderUom). A hand-typed line's receipt carries its own free-text uom. Validating the
        // wrong one would pass a line that still receives at face value.
        List<PoLineValidityGate.ResolvedLine> toCheck = new ArrayList<>();
        int lineNumber = 0;
        for (PurchaseOrderLine line : po.getLines()) {
            lineNumber++;
            String receiptUom = line.getVendorItemId() == null
                    ? line.getUom()
                    : java.util.Optional.ofNullable(catalogById.get(line.getVendorItemId()))
                            .map(VendorItem::getPackUom)
                            .orElse(line.getUom());
            toCheck.add(new PoLineValidityGate.ResolvedLine(lineNumber, line.getIngredientId(), receiptUom));
        }
        poLineValidityGate.requireAllLinesValid(toCheck);

        po.setTotalPaisa(po.getLines().stream().mapToLong(PurchaseOrderLine::getLineTotalPaisa).sum());
        return toDto(purchaseOrderRepository.save(po));
    }

    @Transactional
    public PurchaseOrderDto submit(UUID id) {
        PurchaseOrder po = getDraft(id);
        po.setStatus(PoStatus.PENDING_APPROVAL);
        po.setSubmittedAt(Instant.now());
        po.setRequiredTiers(tenantSetupService.requiredTiersForAmount(po.getTotalPaisa()));
        po.setTiersApproved(0);
        return toDto(purchaseOrderRepository.save(po));
    }

    @Transactional
    public PurchaseOrderDto withdraw(UUID id) {
        PurchaseOrder po = purchaseOrderRepository.findByIdAndTenantId(id, tenantContext.requireTenantId())
                .orElseThrow(() -> new ResourceNotFoundException("PurchaseOrder", id));
        if (po.getStatus() != PoStatus.PENDING_APPROVAL) {
            throw new InvalidPoStateException("Only PENDING_APPROVAL can be withdrawn");
        }
        po.setStatus(PoStatus.DRAFT);
        po.setTiersApproved(0);
        return toDto(purchaseOrderRepository.save(po));
    }

    @Transactional
    public PurchaseOrderDto send(UUID id) {
        PurchaseOrder po = purchaseOrderRepository.findByIdAndTenantId(id, tenantContext.requireTenantId())
                .orElseThrow(() -> new ResourceNotFoundException("PurchaseOrder", id));
        if (po.getStatus() != PoStatus.APPROVED) {
            throw new InvalidPoStateException("Only APPROVED PO can be sent");
        }
        po.setStatus(PoStatus.SENT);
        return toDto(purchaseOrderRepository.save(po));
    }

    @Transactional(readOnly = true)
    public PurchaseOrderDto get(UUID id) {
        return toDto(purchaseOrderRepository.findByIdAndTenantId(id, tenantContext.requireTenantId())
                .orElseThrow(() -> new ResourceNotFoundException("PurchaseOrder", id)));
    }

    /**
     * 10-10 list endpoint. Tenant is ALWAYS resolved from {@link TenantContext}, never from a
     * request parameter (a caller-supplied tenantId would be a cross-tenant hole).
     */
    @Transactional(readOnly = true)
    public List<PurchaseOrderDto> list(UUID branchId, List<PoStatus> statuses) {
        UUID tenantId = tenantContext.requireTenantId();
        List<PurchaseOrder> pos = (statuses == null || statuses.isEmpty())
                ? purchaseOrderRepository.findByTenantIdAndBranchIdOrderByCreatedAtDesc(tenantId, branchId)
                : purchaseOrderRepository.findByTenantIdAndBranchIdAndStatusInOrderByCreatedAtDesc(
                        tenantId, branchId, statuses);
        return pos.stream().map(this::toDto).toList();
    }

    @Transactional
    public PurchaseOrderDto close(UUID id, String reason) {
        PurchaseOrder po = purchaseOrderRepository.findByIdAndTenantId(id, tenantContext.requireTenantId())
                .orElseThrow(() -> new ResourceNotFoundException("PurchaseOrder", id));
        if (po.getStatus() != PoStatus.FULLY_RECEIVED && po.getStatus() != PoStatus.PARTIALLY_RECEIVED) {
            throw new InvalidPoStateException("Only FULLY_RECEIVED or PARTIALLY_RECEIVED PO can be closed");
        }
        boolean shortClosed = po.getStatus() == PoStatus.PARTIALLY_RECEIVED;
        if (shortClosed) {
            if (reason == null || reason.isBlank()) {
                throw new InvalidPoStateException("Short-close requires a reason");
            }
            assertOpaAllowsClose(po);
        }
        po.setStatus(PoStatus.CLOSED);
        po.setClosedAt(Instant.now());
        po.setClosedBy(tenantContext.getUserId().orElse(null));
        po.setCloseReason(reason);
        PurchaseOrder saved = purchaseOrderRepository.save(po);
        publishPoClosed(saved, shortClosed, reason);
        return toDto(saved);
    }

    private void assertOpaAllowsClose(PurchaseOrder po) {
        ApiResponse<AuthorizationClient.AuthorizeResult> response = authorizationClient.authorize(
                new AuthorizationClient.AuthorizePayload(
                        "vendor",
                        OPA_ACTION_CLOSE_PO,
                        new AuthorizationClient.Resource(
                                "purchase_order", po.getId(), po.getTenantId(), po.getBranchId(),
                                po.getRequesterId(), po.getStatus().name(), po.getTotalPaisa())));
        if (response.data() == null || !response.data().allow()) {
            throw new ApprovalLimitExceededException();
        }
    }

    private void publishPoClosed(PurchaseOrder po, boolean shortClosed, String reason) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("poId", po.getId());
        payload.put("vendorId", po.getVendorId());
        payload.put("branchId", po.getBranchId());
        payload.put("totalPaisa", po.getTotalPaisa());
        payload.put("closedBy", po.getClosedBy());
        payload.put("shortClosed", shortClosed);
        payload.put("reason", reason);
        eventPublisher.publish("purchasing.topic", "purchasing.po.closed", "PO_CLOSED", po.getBranchId(), payload);
    }

    private PurchaseOrder getDraft(UUID id) {
        PurchaseOrder po = purchaseOrderRepository.findByIdAndTenantId(id, tenantContext.requireTenantId())
                .orElseThrow(() -> new ResourceNotFoundException("PurchaseOrder", id));
        if (po.getStatus() != PoStatus.DRAFT) {
            throw new InvalidPoStateException("PO must be DRAFT");
        }
        return po;
    }

    /**
     * The current price per vendor item as it applies to {@code branchId}, in ONE batched call.
     *
     * <p>Keyed on the PURCHASE ORDER's branch, not the caller's ambient one — a PO raised for the
     * Gulberg branch must derive Gulberg's prices whoever is typing it. Resolution order (branch
     * price, then tenant-wide) is {@link CurrentPriceResolver}'s, shared with the catalog list,
     * order suggestions and the single-item price endpoint so the four can never disagree about
     * the price of the same item.
     */
    private Map<UUID, VendorItemPrice> currentPricesByItem(UUID tenantId, List<UUID> vendorItemIds, UUID branchId) {
        if (vendorItemIds.isEmpty()) {
            return Map.of();
        }
        return CurrentPriceResolver.byVendorItem(
                vendorItemPriceRepository.findCurrentForVendorItems(tenantId, vendorItemIds, Instant.now()),
                branchId);
    }

    PurchaseOrderDto toDto(PurchaseOrder po) {
        UUID tenantId = tenantContext.requireTenantId();
        List<UUID> vendorItemIds = po.getLines().stream()
                .map(PurchaseOrderLine::getVendorItemId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        // Denormalization lookups (vendorSku/packDescription/priceOverridden), also ONE query
        // each — bounded by the PO's own distinct catalog references, not per line. Not filtered
        // by archivedAt: an already-archived catalog item's SKU/pack still belongs on a PO that
        // referenced it before archival.
        Map<UUID, VendorItem> catalogById = vendorItemIds.isEmpty()
                ? Map.of()
                : vendorItemRepository.findAllById(vendorItemIds).stream()
                        .filter(v -> tenantId.equals(v.getTenantId()))
                        .collect(Collectors.toMap(VendorItem::getId, v -> v));
        Map<UUID, VendorItemPrice> currentPriceById =
                currentPricesByItem(tenantId, vendorItemIds, po.getBranchId());
        // ONE grouped query for the whole PO, never one per line.
        Map<UUID, BigDecimal> receivedByLine = new java.util.HashMap<>();
        for (Object[] row : mockGrnReceiptRepository.sumReceivedQtyByPurchaseOrderGroupedByLine(po.getId())) {
            receivedByLine.put((UUID) row[0], (BigDecimal) row[1]);
        }

        return new PurchaseOrderDto(
                po.getId(), po.getVendorId(), po.getBranchId(), po.getStatus(),
                po.getExpectedDeliveryDate(), po.getTotalPaisa(), po.getNotes(),
                po.getRequesterId(), po.getSubmittedAt(), po.getRequiredTiers(), po.getTiersApproved(),
                po.getClosedAt(), po.getCloseReason(),
                po.getLines().stream().map(l -> {
                    VendorItem catalogItem = l.getVendorItemId() != null ? catalogById.get(l.getVendorItemId()) : null;
                    VendorItemPrice currentPrice = l.getVendorItemId() != null
                            ? currentPriceById.get(l.getVendorItemId()) : null;
                    // priceOverridden is derived, not persisted (no new column in scope for this
                    // plan): a supplied price that mismatches the catalog's currently effective
                    // price is a booked one-off deal. If the catalog price later changes, this
                    // recomputes against the new current price rather than the price at order
                    // time — an accepted, documented trade-off for a display-only flag.
                    boolean overridden = currentPrice != null
                            && currentPrice.getUnitPricePaisa() != l.getUnitPricePaisa();
                    return new PurchaseOrderDto.LineDto(
                            l.getId(), l.getIngredientId(), l.getQty(), l.getUom(),
                            l.getUnitPricePaisa(), l.getLineTotalPaisa(),
                            l.getVendorItemId(),
                            catalogItem != null ? catalogItem.getVendorSku() : null,
                            catalogItem != null ? catalogItem.getPackDescription() : null,
                            overridden,
                            receivedByLine.getOrDefault(l.getId(), BigDecimal.ZERO));
                }).toList());
    }
}
