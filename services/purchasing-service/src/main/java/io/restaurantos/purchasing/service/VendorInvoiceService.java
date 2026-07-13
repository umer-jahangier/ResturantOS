package io.restaurantos.purchasing.service;

import io.restaurantos.purchasing.domain.enums.InvoiceStatus;
import io.restaurantos.purchasing.domain.enums.LineMatchStatus;
import io.restaurantos.purchasing.domain.model.PurchaseOrder;
import io.restaurantos.purchasing.domain.model.VendorInvoice;
import io.restaurantos.purchasing.domain.model.VendorInvoiceLine;
import io.restaurantos.purchasing.dto.CreateVendorInvoiceRequest;
import io.restaurantos.purchasing.dto.VendorInvoiceDto;
import io.restaurantos.purchasing.exception.InvalidPoStateException;
import io.restaurantos.purchasing.feign.FinanceInternalClient;
import io.restaurantos.purchasing.repository.PurchaseOrderRepository;
import io.restaurantos.purchasing.repository.VendorInvoiceRepository;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class VendorInvoiceService {

    private final VendorInvoiceRepository invoiceRepository;
    private final PurchaseOrderRepository purchaseOrderRepository;
    private final ThreeWayMatchService matchService;
    private final FinanceInternalClient financeInternalClient;
    private final EventPublisher eventPublisher;
    private final TenantContext tenantContext;
    private final TenantSetupService tenantSetupService;

    public VendorInvoiceService(VendorInvoiceRepository invoiceRepository,
                                PurchaseOrderRepository purchaseOrderRepository,
                                ThreeWayMatchService matchService,
                                FinanceInternalClient financeInternalClient,
                                EventPublisher eventPublisher,
                                TenantContext tenantContext,
                                TenantSetupService tenantSetupService) {
        this.invoiceRepository = invoiceRepository;
        this.purchaseOrderRepository = purchaseOrderRepository;
        this.matchService = matchService;
        this.financeInternalClient = financeInternalClient;
        this.eventPublisher = eventPublisher;
        this.tenantContext = tenantContext;
        this.tenantSetupService = tenantSetupService;
    }

    @Transactional
    public VendorInvoiceDto create(CreateVendorInvoiceRequest req) {
        tenantSetupService.ensureDefaults();
        UUID tenantId = tenantContext.requireTenantId();
        PurchaseOrder po = purchaseOrderRepository.findById(req.purchaseOrderId()).orElseThrow();
        if (po.getStatus() != io.restaurantos.purchasing.domain.enums.PoStatus.SENT
                && po.getStatus() != io.restaurantos.purchasing.domain.enums.PoStatus.PARTIALLY_RECEIVED
                && po.getStatus() != io.restaurantos.purchasing.domain.enums.PoStatus.FULLY_RECEIVED) {
            throw new InvalidPoStateException("PO must be sent before invoicing");
        }

        VendorInvoice invoice = new VendorInvoice();
        invoice.setTenantId(tenantId);
        invoice.setVendorId(po.getVendorId());
        invoice.setPurchaseOrderId(po.getId());
        invoice.setBranchId(po.getBranchId());
        invoice.setInvoiceNo(req.invoiceNo());
        invoice.setInvoiceDate(req.invoiceDate());

        for (CreateVendorInvoiceRequest.Line lineReq : req.lines()) {
            VendorInvoiceLine line = new VendorInvoiceLine();
            line.setTenantId(tenantId);
            line.setInvoice(invoice);
            line.setPoLineId(lineReq.poLineId());
            line.setQty(lineReq.qty());
            line.setUnitPricePaisa(lineReq.unitPricePaisa());
            line.setLineTotalPaisa(lineReq.qty()
                    .multiply(BigDecimal.valueOf(lineReq.unitPricePaisa()))
                    .longValue());
            invoice.getLines().add(line);
        }
        invoice.setTotalPaisa(invoice.getLines().stream().mapToLong(VendorInvoiceLine::getLineTotalPaisa).sum());
        invoice.setInputTaxPaisa(req.inputTaxPaisa() != null ? req.inputTaxPaisa() : 0L);

        runMatch(invoice);
        VendorInvoice saved = invoiceRepository.save(invoice);
        if (saved.getStatus() == InvoiceStatus.MATCHED) {
            postInvoiceJe(saved);
            publishMatched(saved);
        }
        return toDto(saved);
    }

    @Transactional
    public VendorInvoiceDto overrideMatch(UUID invoiceId, String justification) {
        if (justification == null || justification.isBlank()) {
            throw new InvalidPoStateException("Override justification required");
        }
        VendorInvoice invoice = invoiceRepository.findById(invoiceId).orElseThrow();
        if (invoice.getStatus() != InvoiceStatus.MISMATCHED) {
            throw new InvalidPoStateException("Only MISMATCHED invoices can be overridden");
        }
        invoice.setMatchOverrideReason(justification);
        invoice.setStatus(InvoiceStatus.APPROVED_FOR_PAYMENT);
        invoice.setMatchedAt(Instant.now());
        VendorInvoice saved = invoiceRepository.save(invoice);
        postInvoiceJe(saved);
        publishMatched(saved);
        return toDto(saved);
    }

    @Transactional(readOnly = true)
    public VendorInvoiceDto get(UUID id) {
        return toDto(invoiceRepository.findById(id).orElseThrow());
    }

    /**
     * 10-10 list endpoint. Tenant is ALWAYS resolved from {@link TenantContext}, never from a
     * request parameter (a caller-supplied tenantId would be a cross-tenant hole).
     */
    @Transactional(readOnly = true)
    public List<VendorInvoiceDto> list(UUID branchId, List<InvoiceStatus> statuses) {
        UUID tenantId = tenantContext.requireTenantId();
        List<VendorInvoice> invoices = (statuses == null || statuses.isEmpty())
                ? invoiceRepository.findByTenantIdAndBranchIdOrderByInvoiceDateDesc(tenantId, branchId)
                : invoiceRepository.findByTenantIdAndBranchIdAndStatusInOrderByInvoiceDateDesc(
                        tenantId, branchId, statuses);
        return invoices.stream().map(this::toDto).toList();
    }

    private void runMatch(VendorInvoice invoice) {
        boolean allOk = true;
        for (VendorInvoiceLine line : invoice.getLines()) {
            LineMatchStatus status = matchService.matchLine(line);
            if (status != LineMatchStatus.OK) {
                allOk = false;
            }
        }
        if (allOk) {
            invoice.setStatus(InvoiceStatus.MATCHED);
            invoice.setMatchedAt(Instant.now());
        } else {
            invoice.setStatus(InvoiceStatus.MISMATCHED);
        }
    }

    private void postInvoiceJe(VendorInvoice invoice) {
        long net = invoice.getTotalPaisa();
        long tax = invoice.getInputTaxPaisa();
        financeInternalClient.autoPost(invoice.getTenantId(), new FinanceInternalClient.AutoPostJeRequest(
                invoice.getBranchId(),
                invoice.getInvoiceDate(),
                "Vendor invoice " + invoice.getInvoiceNo(),
                "VENDOR_INVOICE",
                invoice.getId(),
                List.of(
                        new FinanceInternalClient.JeLine("1700", "GR/IR Clearing", net, 0L),
                        new FinanceInternalClient.JeLine("1710", "Input Tax", tax, 0L),
                        new FinanceInternalClient.JeLine("2100", "Accounts Payable", 0L, net + tax))));
    }

    private void publishMatched(VendorInvoice invoice) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("invoiceId", invoice.getId());
        payload.put("poId", invoice.getPurchaseOrderId());
        payload.put("amountPaisa", invoice.getTotalPaisa());
        payload.put("inputTaxPaisa", invoice.getInputTaxPaisa());
        payload.put("matchStatus", invoice.getStatus().name());
        eventPublisher.publish("purchasing.topic", "purchasing.invoice.matched", "VENDOR_INVOICE_MATCHED",
                invoice.getBranchId(), payload);
    }

    VendorInvoiceDto toDto(VendorInvoice invoice) {
        return new VendorInvoiceDto(
                invoice.getId(),
                invoice.getVendorId(),
                invoice.getPurchaseOrderId(),
                invoice.getBranchId(),
                invoice.getInvoiceNo(),
                invoice.getInvoiceDate(),
                invoice.getStatus(),
                invoice.getTotalPaisa(),
                invoice.getInputTaxPaisa(),
                invoice.getMatchOverrideReason(),
                invoice.getLines().stream().map(l -> new VendorInvoiceDto.LineDto(
                        l.getId(), l.getPoLineId(), l.getQty(), l.getUnitPricePaisa(),
                        l.getLineTotalPaisa(), l.getMatchStatus())).toList());
    }
}
