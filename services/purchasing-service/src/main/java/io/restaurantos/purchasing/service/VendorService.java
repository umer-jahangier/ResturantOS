package io.restaurantos.purchasing.service;

import io.restaurantos.purchasing.domain.model.Vendor;
import io.restaurantos.purchasing.dto.CreateVendorRequest;
import io.restaurantos.purchasing.dto.VendorDto;
import io.restaurantos.purchasing.feign.AuthorizationClient;
import io.restaurantos.purchasing.repository.VendorRepository;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.security.EncryptionService;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;
import java.util.Base64;

@Service
public class VendorService {

    /**
     * vendor.rego's {@code manage} rule. It was the module's one dead letter: {@code approve_po}
     * and {@code close_po} were both wired, while vendor creation and editing — which owns the
     * encrypted bank details POs are eventually paid into — was gated by {@code @PreAuthorize}
     * alone across seven endpoints, with no tenant/branch test from the policy.
     */
    private static final String OPA_MODULE_VENDOR = "vendor";
    private static final String OPA_ACTION_MANAGE = "manage";

    private final VendorRepository vendorRepository;
    private final TenantContext tenantContext;
    private final EncryptionService encryptionService;
    private final TenantSetupService tenantSetupService;
    private final AuthorizationClient authorizationClient;

    public VendorService(VendorRepository vendorRepository,
                         TenantContext tenantContext,
                         EncryptionService encryptionService,
                         TenantSetupService tenantSetupService,
                         AuthorizationClient authorizationClient) {
        this.vendorRepository = vendorRepository;
        this.tenantContext = tenantContext;
        this.encryptionService = encryptionService;
        this.tenantSetupService = tenantSetupService;
        this.authorizationClient = authorizationClient;
    }

    /**
     * Fail-closed: a denied decision, an empty body, or an unreachable authorization-service all
     * refuse. The Feign exception is translated rather than propagated so an unreachable policy
     * engine answers 403 instead of reporting a server fault for an authorization outcome.
     */
    private void assertOpaAllowsManage(UUID vendorId) {
        ApiResponse<AuthorizationClient.AuthorizeResult> response;
        try {
            response = authorizationClient.authorize(new AuthorizationClient.AuthorizePayload(
                    OPA_MODULE_VENDOR,
                    OPA_ACTION_MANAGE,
                    new AuthorizationClient.Resource(
                            "vendor", vendorId, tenantContext.requireTenantId(),
                            tenantContext.getBranchId().orElse(null), null, null, null)));
        } catch (RuntimeException e) {
            throw new PermissionDeniedException("Authorization service unavailable");
        }
        if (response == null || response.data() == null || !response.data().allow()) {
            throw new PermissionDeniedException("Not permitted: vendor.manage");
        }
    }

    @Transactional(readOnly = true)
    public Page<VendorDto> list(String search, Pageable pageable) {
        Page<Vendor> page = (search == null || search.isBlank())
                ? vendorRepository.findAll(pageable)
                : vendorRepository.findByNameContainingIgnoreCase(search.trim(), pageable);
        return page.map(this::toDto);
    }

    @Transactional
    public VendorDto create(CreateVendorRequest req) {
        assertOpaAllowsManage(null);
        tenantSetupService.ensureDefaultTiers();
        UUID tenantId = tenantContext.requireTenantId();
        Vendor vendor = new Vendor();
        vendor.setTenantId(tenantId);
        apply(vendor, req);
        return toDto(vendorRepository.save(vendor));
    }

    @Transactional
    public VendorDto update(UUID id, CreateVendorRequest req) {
        assertOpaAllowsManage(id);
        Vendor vendor = vendorRepository.findById(id).orElseThrow();
        apply(vendor, req);
        return toDto(vendorRepository.save(vendor));
    }

    private void apply(Vendor vendor, CreateVendorRequest req) {
        vendor.setName(req.name());
        vendor.setContactPerson(req.contactPerson());
        vendor.setPhone(req.phone());
        vendor.setEmail(req.email());
        vendor.setAddress(req.address());
        vendor.setPaymentTerms(normalizePaymentTerms(req.paymentTerms()));
        vendor.setNtn(req.ntn());
        vendor.setStrn(req.strn());
        vendor.setLeadTimeDays(req.leadTimeDays());
        vendor.setNotes(req.notes());
        if (req.bankAccountNo() != null && !req.bankAccountNo().isBlank()) {
            // EncryptionService is a required bean (see EncryptionRequiredConfig): a bank account
            // number is either encrypted successfully or the request fails loudly. It must never be
            // silently dropped because the encryption key was missing (PUR-01 field-encryption).
            vendor.setBankAccountNo(Base64.getEncoder().encodeToString(encryptionService.encrypt(req.bankAccountNo())));
            String digits = req.bankAccountNo().replaceAll("\\D", "");
            vendor.setBankAccountLast4(digits.length() >= 4
                    ? digits.substring(digits.length() - 4) : digits);
        }
    }

    /**
     * Folds the spellings of one payment term together: {@code net_30}, {@code NET 30} and
     * {@code NET30} are the same agreement and must not be three values.
     *
     * <p>This field is free text and the live table already showed the drift — {@code NET30},
     * {@code NET_30} and {@code CASH} across three vendors, two of which mean the same thing.
     * Nothing computes a due date from it yet, so the damage today is only that vendors cannot be
     * grouped or filtered by terms; the moment AP aging does compute one, dirty values become
     * wrong invoices. Converging now costs nothing, and the form offers a fixed list so most
     * values never need converging at all.
     *
     * <p>Deliberately normalizes rather than rejects. A tenant with a genuine term this list does
     * not cover ({@code EOM}, {@code 2/10NET30}) keeps it, uppercased — refusing the save would
     * make an unusual agreement unrecordable.
     */
    static String normalizePaymentTerms(String raw) {
        if (raw == null || raw.isBlank()) {
            return "NET30";
        }
        return raw.trim().toUpperCase(java.util.Locale.ROOT).replaceAll("[\\s_-]+", "");
    }

    private VendorDto toDto(Vendor v) {
        return new VendorDto(
                v.getId(), v.getName(), v.getContactPerson(), v.getPhone(), v.getEmail(),
                v.getAddress(), v.getPaymentTerms(), v.getNtn(), v.getStrn(), v.getLeadTimeDays(),
                v.getBankAccountLast4(), v.getNotes(), v.isActive());
    }
}
