package io.restaurantos.purchasing;

import io.restaurantos.purchasing.domain.model.Vendor;
import io.restaurantos.purchasing.dto.CreateVendorRequest;
import io.restaurantos.purchasing.dto.VendorDto;
import io.restaurantos.purchasing.repository.VendorRepository;
import io.restaurantos.purchasing.service.VendorService;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.Base64;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

class VendorIT extends PurchasingTestBase {

    @Autowired
    private VendorService vendorService;

    @Autowired
    private VendorRepository vendorRepository;

    @Autowired
    private TenantContext tenantContext;

    private UUID tenantId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        tenantContext.set(tenantId, UUID.randomUUID(), UUID.randomUUID(), null);
        when(featureFlagService.isEnabled(any(), any())).thenReturn(true);
    }

    @Test
    void createVendor_encryptsBankAccount() {
        VendorDto dto = vendorService.create(new CreateVendorRequest(
                "Fresh Foods Ltd", "Ali", "03001234567", null, null,
                "NET30", null, null, 3, "1234567890123456", null));
        assertThat(dto.bankAccountLast4()).isEqualTo("3456");
        Vendor saved = vendorRepository.findById(dto.id()).orElseThrow();
        assertThat(saved.getBankAccountNo()).isNotEqualTo("1234567890123456");
        assertThat(saved.getBankAccountNo()).isNotBlank();
        byte[] decoded = Base64.getDecoder().decode(saved.getBankAccountNo());
        assertThat(decoded.length).isGreaterThan(12);
    }
}
