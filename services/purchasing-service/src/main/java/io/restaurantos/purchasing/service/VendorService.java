package io.restaurantos.purchasing.service;

import io.restaurantos.purchasing.domain.model.Vendor;
import io.restaurantos.purchasing.dto.CreateVendorRequest;
import io.restaurantos.purchasing.dto.VendorDto;
import io.restaurantos.purchasing.repository.VendorRepository;
import io.restaurantos.shared.security.EncryptionService;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;
import java.util.UUID;
import java.util.Base64;

@Service
public class VendorService {

    private final VendorRepository vendorRepository;
    private final TenantContext tenantContext;
    private final Optional<EncryptionService> encryptionService;
    private final TenantSetupService tenantSetupService;

    public VendorService(VendorRepository vendorRepository,
                         TenantContext tenantContext,
                         Optional<EncryptionService> encryptionService,
                         TenantSetupService tenantSetupService) {
        this.vendorRepository = vendorRepository;
        this.tenantContext = tenantContext;
        this.encryptionService = encryptionService;
        this.tenantSetupService = tenantSetupService;
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
        tenantSetupService.ensureDefaultTiers();
        UUID tenantId = tenantContext.requireTenantId();
        Vendor vendor = new Vendor();
        vendor.setTenantId(tenantId);
        apply(vendor, req);
        return toDto(vendorRepository.save(vendor));
    }

    @Transactional
    public VendorDto update(UUID id, CreateVendorRequest req) {
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
        vendor.setPaymentTerms(req.paymentTerms());
        vendor.setNtn(req.ntn());
        vendor.setStrn(req.strn());
        vendor.setLeadTimeDays(req.leadTimeDays());
        vendor.setNotes(req.notes());
        if (req.bankAccountNo() != null && !req.bankAccountNo().isBlank()) {
            encryptionService.ifPresentOrElse(svc -> {
                vendor.setBankAccountNo(Base64.getEncoder().encodeToString(svc.encrypt(req.bankAccountNo())));
                String digits = req.bankAccountNo().replaceAll("\\D", "");
                vendor.setBankAccountLast4(digits.length() >= 4
                        ? digits.substring(digits.length() - 4) : digits);
            }, () -> {
                vendor.setBankAccountNo(null);
                vendor.setBankAccountLast4(null);
            });
        }
    }

    private VendorDto toDto(Vendor v) {
        return new VendorDto(
                v.getId(), v.getName(), v.getContactPerson(), v.getPhone(), v.getEmail(),
                v.getAddress(), v.getPaymentTerms(), v.getNtn(), v.getStrn(), v.getLeadTimeDays(),
                v.getBankAccountLast4(), v.getNotes(), v.isActive());
    }
}
