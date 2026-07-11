package io.restaurantos.purchasing.service;

import io.restaurantos.purchasing.domain.enums.PoStatus;
import io.restaurantos.purchasing.domain.model.PurchaseOrder;
import io.restaurantos.purchasing.domain.model.PurchaseOrderLine;
import io.restaurantos.purchasing.dto.CreatePurchaseOrderRequest;
import io.restaurantos.purchasing.dto.PurchaseOrderDto;
import io.restaurantos.purchasing.exception.ApprovalLimitExceededException;
import io.restaurantos.purchasing.exception.InvalidPoStateException;
import io.restaurantos.purchasing.feign.AuthorizationClient;
import io.restaurantos.purchasing.repository.PurchaseOrderRepository;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@Service
public class PurchaseOrderService {

    private final PurchaseOrderRepository purchaseOrderRepository;
    private final TenantContext tenantContext;
    private final TenantSetupService tenantSetupService;
    private final AuthorizationClient authorizationClient;
    private final EventPublisher eventPublisher;

    public PurchaseOrderService(PurchaseOrderRepository purchaseOrderRepository,
                                TenantContext tenantContext,
                                TenantSetupService tenantSetupService,
                                AuthorizationClient authorizationClient,
                                EventPublisher eventPublisher) {
        this.purchaseOrderRepository = purchaseOrderRepository;
        this.tenantContext = tenantContext;
        this.tenantSetupService = tenantSetupService;
        this.authorizationClient = authorizationClient;
        this.eventPublisher = eventPublisher;
    }

    @Transactional
    public PurchaseOrderDto create(CreatePurchaseOrderRequest req) {
        tenantSetupService.ensureDefaults();
        UUID tenantId = tenantContext.requireTenantId();
        PurchaseOrder po = new PurchaseOrder();
        po.setTenantId(tenantId);
        po.setVendorId(req.vendorId());
        po.setBranchId(req.branchId());
        po.setExpectedDeliveryDate(req.expectedDeliveryDate());
        po.setNotes(req.notes());
        po.setRequesterId(tenantContext.getUserId().orElse(null));
        for (CreatePurchaseOrderRequest.Line lineReq : req.lines()) {
            PurchaseOrderLine line = new PurchaseOrderLine();
            line.setTenantId(tenantId);
            line.setPurchaseOrder(po);
            line.setIngredientId(lineReq.ingredientId());
            line.setQty(lineReq.qty());
            line.setUom(lineReq.uom());
            line.setUnitPricePaisa(lineReq.unitPricePaisa());
            line.setLineTotalPaisa(lineReq.qty().multiply(BigDecimal.valueOf(lineReq.unitPricePaisa())).longValue());
            po.getLines().add(line);
        }
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
        PurchaseOrder po = purchaseOrderRepository.findById(id).orElseThrow();
        if (po.getStatus() != PoStatus.PENDING_APPROVAL) {
            throw new InvalidPoStateException("Only PENDING_APPROVAL can be withdrawn");
        }
        po.setStatus(PoStatus.DRAFT);
        po.setTiersApproved(0);
        return toDto(purchaseOrderRepository.save(po));
    }

    @Transactional
    public PurchaseOrderDto send(UUID id) {
        PurchaseOrder po = purchaseOrderRepository.findById(id).orElseThrow();
        if (po.getStatus() != PoStatus.APPROVED) {
            throw new InvalidPoStateException("Only APPROVED PO can be sent");
        }
        po.setStatus(PoStatus.SENT);
        return toDto(purchaseOrderRepository.save(po));
    }

    @Transactional(readOnly = true)
    public PurchaseOrderDto get(UUID id) {
        return toDto(purchaseOrderRepository.findById(id).orElseThrow());
    }

    @Transactional
    public PurchaseOrderDto close(UUID id, String reason) {
        PurchaseOrder po = purchaseOrderRepository.findById(id).orElseThrow();
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
                        "vendor.po.close",
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
        PurchaseOrder po = purchaseOrderRepository.findById(id).orElseThrow();
        if (po.getStatus() != PoStatus.DRAFT) {
            throw new InvalidPoStateException("PO must be DRAFT");
        }
        return po;
    }

    PurchaseOrderDto toDto(PurchaseOrder po) {
        return new PurchaseOrderDto(
                po.getId(), po.getVendorId(), po.getBranchId(), po.getStatus(),
                po.getExpectedDeliveryDate(), po.getTotalPaisa(), po.getNotes(),
                po.getRequesterId(), po.getSubmittedAt(), po.getRequiredTiers(), po.getTiersApproved(),
                po.getClosedAt(), po.getCloseReason(),
                po.getLines().stream().map(l -> new PurchaseOrderDto.LineDto(
                        l.getId(), l.getIngredientId(), l.getQty(), l.getUom(),
                        l.getUnitPricePaisa(), l.getLineTotalPaisa())).toList());
    }
}
