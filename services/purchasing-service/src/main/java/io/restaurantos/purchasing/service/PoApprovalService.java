package io.restaurantos.purchasing.service;

import io.restaurantos.purchasing.domain.enums.PoStatus;
import io.restaurantos.purchasing.domain.model.PoApprovalRecord;
import io.restaurantos.purchasing.domain.model.PurchaseOrder;
import io.restaurantos.purchasing.dto.PurchaseOrderDto;
import io.restaurantos.purchasing.exception.ApprovalLimitExceededException;
import io.restaurantos.purchasing.exception.InvalidPoStateException;
import io.restaurantos.purchasing.feign.AuthorizationClient;
import io.restaurantos.purchasing.repository.PoApprovalRecordRepository;
import io.restaurantos.purchasing.repository.PurchaseOrderRepository;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@Service
public class PoApprovalService {

    private final PurchaseOrderRepository purchaseOrderRepository;
    private final PoApprovalRecordRepository approvalRecordRepository;
    private final PurchaseOrderService purchaseOrderService;
    private final AuthorizationClient authorizationClient;
    private final EventPublisher eventPublisher;
    private final TenantContext tenantContext;

    public PoApprovalService(PurchaseOrderRepository purchaseOrderRepository,
                             PoApprovalRecordRepository approvalRecordRepository,
                             PurchaseOrderService purchaseOrderService,
                             AuthorizationClient authorizationClient,
                             EventPublisher eventPublisher,
                             TenantContext tenantContext) {
        this.purchaseOrderRepository = purchaseOrderRepository;
        this.approvalRecordRepository = approvalRecordRepository;
        this.purchaseOrderService = purchaseOrderService;
        this.authorizationClient = authorizationClient;
        this.eventPublisher = eventPublisher;
        this.tenantContext = tenantContext;
    }

    @Transactional
    public PurchaseOrderDto approve(UUID id) {
        PurchaseOrder po = purchaseOrderRepository.findById(id).orElseThrow();
        if (po.getStatus() != PoStatus.PENDING_APPROVAL) {
            throw new InvalidPoStateException("PO not pending approval");
        }
        assertOpaAllows(po);
        UUID approverId = tenantContext.getUserId().orElseThrow();
        int nextTier = po.getTiersApproved() + 1;
        PoApprovalRecord record = new PoApprovalRecord();
        record.setTenantId(po.getTenantId());
        record.setPurchaseOrderId(po.getId());
        record.setTier(nextTier);
        record.setApproverId(approverId);
        record.setAction("APPROVED");
        record.setActedAt(Instant.now());
        approvalRecordRepository.save(record);
        po.setTiersApproved(nextTier);
        if (po.getTiersApproved() >= po.getRequiredTiers()) {
            po.setStatus(PoStatus.APPROVED);
            publishPoApproved(po, approverId);
        }
        return purchaseOrderService.toDto(purchaseOrderRepository.save(po));
    }

    @Transactional
    public PurchaseOrderDto reject(UUID id, String reason) {
        if (reason == null || reason.isBlank()) {
            throw new InvalidPoStateException("Rejection reason required");
        }
        PurchaseOrder po = purchaseOrderRepository.findById(id).orElseThrow();
        if (po.getStatus() != PoStatus.PENDING_APPROVAL) {
            throw new InvalidPoStateException("PO not pending approval");
        }
        po.setStatus(PoStatus.REJECTED);
        PoApprovalRecord record = new PoApprovalRecord();
        record.setTenantId(po.getTenantId());
        record.setPurchaseOrderId(po.getId());
        record.setTier(po.getTiersApproved() + 1);
        record.setApproverId(tenantContext.getUserId().orElseThrow());
        record.setAction("REJECTED");
        record.setReason(reason);
        approvalRecordRepository.save(record);
        return purchaseOrderService.toDto(purchaseOrderRepository.save(po));
    }

    private void assertOpaAllows(PurchaseOrder po) {
        ApiResponse<AuthorizationClient.AuthorizeResult> response = authorizationClient.authorize(
                new AuthorizationClient.AuthorizePayload(
                        "vendor",
                        "vendor.po.approve",
                        new AuthorizationClient.Resource(
                                "purchase_order", po.getId(), po.getTenantId(), po.getBranchId(),
                                po.getRequesterId(), po.getStatus().name(), po.getTotalPaisa())));
        if (response.data() == null || !response.data().allow()) {
            throw new ApprovalLimitExceededException();
        }
    }

    private void publishPoApproved(PurchaseOrder po, UUID approvedBy) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("poId", po.getId());
        payload.put("vendorId", po.getVendorId());
        payload.put("totalPaisa", po.getTotalPaisa());
        payload.put("approvedBy", approvedBy);
        eventPublisher.publish("purchasing.topic", "purchasing.po.approved", "PO_APPROVED", po.getBranchId(), payload);
    }
}
