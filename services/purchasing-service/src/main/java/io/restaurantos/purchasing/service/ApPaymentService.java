package io.restaurantos.purchasing.service;

import io.restaurantos.purchasing.domain.enums.InvoiceStatus;
import io.restaurantos.purchasing.domain.model.ApPayment;
import io.restaurantos.purchasing.domain.model.ApPaymentAllocation;
import io.restaurantos.purchasing.domain.model.VendorInvoice;
import io.restaurantos.purchasing.dto.ApPaymentDto;
import io.restaurantos.purchasing.dto.CreateApPaymentRequest;
import io.restaurantos.purchasing.exception.InvalidPoStateException;
import io.restaurantos.purchasing.feign.FinanceInternalClient;
import io.restaurantos.purchasing.repository.ApPaymentRepository;
import io.restaurantos.purchasing.repository.VendorInvoiceRepository;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class ApPaymentService {

    private final ApPaymentRepository paymentRepository;
    private final VendorInvoiceRepository invoiceRepository;
    private final FinanceInternalClient financeInternalClient;
    private final EventPublisher eventPublisher;
    private final TenantContext tenantContext;

    public ApPaymentService(ApPaymentRepository paymentRepository,
                            VendorInvoiceRepository invoiceRepository,
                            FinanceInternalClient financeInternalClient,
                            EventPublisher eventPublisher,
                            TenantContext tenantContext) {
        this.paymentRepository = paymentRepository;
        this.invoiceRepository = invoiceRepository;
        this.financeInternalClient = financeInternalClient;
        this.eventPublisher = eventPublisher;
        this.tenantContext = tenantContext;
    }

    @Transactional
    public ApPaymentDto create(CreateApPaymentRequest req, String idempotencyKey) {
        UUID tenantId = tenantContext.requireTenantId();
        if (idempotencyKey != null && !idempotencyKey.isBlank()) {
            var existing = paymentRepository.findByTenantIdAndIdempotencyKey(tenantId, idempotencyKey);
            if (existing.isPresent()) {
                return toDto(existing.get());
            }
        }

        VendorInvoice invoice = invoiceRepository.findById(req.invoiceId()).orElseThrow();
        if (invoice.getStatus() != InvoiceStatus.MATCHED
                && invoice.getStatus() != InvoiceStatus.APPROVED_FOR_PAYMENT) {
            throw new InvalidPoStateException("Invoice must be matched before payment");
        }

        long payAmount = req.amountPaisa() != null ? req.amountPaisa() : invoice.getTotalPaisa() + invoice.getInputTaxPaisa();
        ApPayment payment = new ApPayment();
        payment.setTenantId(tenantId);
        payment.setVendorId(invoice.getVendorId());
        payment.setBranchId(invoice.getBranchId());
        payment.setPaymentDate(req.paymentDate());
        payment.setAmountPaisa(payAmount);
        payment.setBankAccountCode(req.bankAccountCode() != null ? req.bankAccountCode() : "1110");
        payment.setIdempotencyKey(idempotencyKey);

        ApPaymentAllocation allocation = new ApPaymentAllocation();
        allocation.setTenantId(tenantId);
        allocation.setPayment(payment);
        allocation.setInvoiceId(invoice.getId());
        allocation.setAmountPaisa(payAmount);
        payment.getAllocations().add(allocation);

        ApPayment saved = paymentRepository.save(payment);

        financeInternalClient.autoPost(tenantId, new FinanceInternalClient.AutoPostJeRequest(
                saved.getBranchId(),
                saved.getPaymentDate(),
                "AP payment " + saved.getId(),
                "AP_PAYMENT",
                saved.getId(),
                List.of(
                        new FinanceInternalClient.JeLine("2100", "Accounts Payable", payAmount, 0L),
                        new FinanceInternalClient.JeLine(saved.getBankAccountCode(), "Bank", 0L, payAmount))));

        invoice.setStatus(InvoiceStatus.PAID);
        invoice.setPaidAt(Instant.now());
        invoiceRepository.save(invoice);

        publishPaymentProcessed(saved, invoice.getId());
        return toDto(saved);
    }

    private void publishPaymentProcessed(ApPayment payment, UUID invoiceId) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("paymentId", payment.getId());
        payload.put("invoiceId", invoiceId);
        payload.put("amountPaisa", payment.getAmountPaisa());
        eventPublisher.publish("purchasing.topic", "purchasing.payment.processed", "AP_PAYMENT_PROCESSED",
                payment.getBranchId(), payload);
    }

    private ApPaymentDto toDto(ApPayment payment) {
        return new ApPaymentDto(
                payment.getId(),
                payment.getVendorId(),
                payment.getBranchId(),
                payment.getPaymentDate(),
                payment.getAmountPaisa(),
                payment.getBankAccountCode(),
                payment.getAllocations().stream().map(a -> new ApPaymentDto.AllocationDto(
                        a.getInvoiceId(), a.getAmountPaisa())).toList());
    }
}
