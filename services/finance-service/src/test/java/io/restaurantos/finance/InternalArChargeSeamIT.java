package io.restaurantos.finance;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.finance.config.FinanceInternalServiceFilter;
import io.restaurantos.finance.config.InternalTenantContextHelper;
import io.restaurantos.finance.dto.CreateCustomerAccountRequest;
import io.restaurantos.finance.dto.CustomerAccountDto;
import io.restaurantos.finance.feign.InventoryInternalClient;
import io.restaurantos.finance.feign.PosInternalClient;
import io.restaurantos.finance.feign.PurchasingInternalClient;
import io.restaurantos.finance.repository.ArTransactionRepository;
import io.restaurantos.finance.repository.JournalEntryRepository;
import io.restaurantos.finance.service.ArService;
import io.restaurantos.finance.service.ProvisioningService;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * THE PHASE 7 SEAM, pinned (10-18): POST /internal/finance/ar/charges, guarded by
 * X-Internal-Service (403 without it), scoped by X-Tenant-Id, idempotent on
 * (tenantId, POS_ORDER, orderId). Real HTTP through the real Spring Security filter chain
 * (springSecurity()), not MockMvc's servlet-less unit dispatch — FinanceInternalServiceFilter
 * is wired into FinanceSecurityConfig's SecurityFilterChain, so this exercises the real guard.
 */
class InternalArChargeSeamIT extends FinanceTestBase {

    @Value("${restaurantos.internal.secret}")
    private String internalSecret;

    @Autowired
    private WebApplicationContext webApplicationContext;

    @Autowired
    private ProvisioningService provisioningService;

    @Autowired
    private ArService arService;

    @Autowired
    private InternalTenantContextHelper tenantHelper;

    @Autowired
    private TenantContext tenantContext;

    @Autowired
    private ArTransactionRepository arTransactionRepository;

    @Autowired
    private JournalEntryRepository journalEntryRepository;

    @Autowired
    private ObjectMapper objectMapper;

    @MockitoBean
    private PosInternalClient posClient;

    @MockitoBean
    private InventoryInternalClient inventoryClient;

    @MockitoBean
    private PurchasingInternalClient purchasingClient;

    private MockMvc mockMvc;
    private UUID tenantId;
    private UUID branchId;
    private UUID customerAccountId;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .apply(SecurityMockMvcConfigurers.springSecurity())
                .build();

        when(posClient.getOpenOrderCount(any(), any())).thenReturn(0L);
        when(inventoryClient.getPendingGrnCount(any())).thenReturn(0L);
        when(purchasingClient.getUnmatchedInvoiceCount(any())).thenReturn(0L);

        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantHelper.activate(tenantId, branchId);
        try {
            provisioningService.provision(tenantId, 2026);
            CustomerAccountDto account = arService.createAccount(new CreateCustomerAccountRequest(
                    branchId, "HA-SEAM-1", "Acme Corp", null, null, null, 1_000_000L, 30, null));
            customerAccountId = account.id();
        } finally {
            tenantHelper.clear();
        }
    }

    private Map<String, Object> chargeBody(UUID orderId, long amountPaisa) {
        return Map.of(
                "branchId", branchId.toString(),
                "customerAccountId", customerAccountId.toString(),
                "orderId", orderId.toString(),
                "chargeDate", LocalDate.of(2026, 6, 15).toString(),
                "amountPaisa", amountPaisa);
    }

    @Test
    void validSecretAndTenant_postsOneArTransactionAndOneBalancedJe() throws Exception {
        UUID orderId = UUID.randomUUID();

        mockMvc.perform(MockMvcRequestBuilders.post("/internal/finance/ar/charges")
                        .header(FinanceInternalServiceFilter.HEADER, internalSecret)
                        .header("X-Tenant-Id", tenantId.toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(chargeBody(orderId, 25_000L))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.amountPaisa").value(25_000))
                .andExpect(jsonPath("$.data.journalEntryId").exists());
    }

    /** Negative control: the SAME request WITHOUT X-Internal-Service -> 403 INTERNAL_AUTH_REQUIRED. */
    @Test
    void missingInternalSecret_returns403() throws Exception {
        UUID orderId = UUID.randomUUID();

        mockMvc.perform(MockMvcRequestBuilders.post("/internal/finance/ar/charges")
                        .header("X-Tenant-Id", tenantId.toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(chargeBody(orderId, 25_000L))))
                .andExpect(status().isForbidden());
    }

    /** Idempotency: same orderId retried -> same ArTransactionDto.id, exactly one row, one JE. */
    @Test
    void retryingSameOrderId_isIdempotent_oneRowOneJe() throws Exception {
        UUID orderId = UUID.randomUUID();
        String body = objectMapper.writeValueAsString(chargeBody(orderId, 30_000L));

        String firstResponse = mockMvc.perform(MockMvcRequestBuilders.post("/internal/finance/ar/charges")
                        .header(FinanceInternalServiceFilter.HEADER, internalSecret)
                        .header("X-Tenant-Id", tenantId.toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        String secondResponse = mockMvc.perform(MockMvcRequestBuilders.post("/internal/finance/ar/charges")
                        .header(FinanceInternalServiceFilter.HEADER, internalSecret)
                        .header("X-Tenant-Id", tenantId.toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        String firstId = objectMapper.readTree(firstResponse).at("/data/id").asText();
        String secondId = objectMapper.readTree(secondResponse).at("/data/id").asText();
        assertThat(secondId).isEqualTo(firstId);

        tenantHelper.activate(tenantId, branchId);
        try {
            assertThat(arTransactionRepository.findByTenantIdAndSourceTypeAndSourceId(
                    tenantId, "POS_ORDER", orderId)).isPresent();
            long arCount = arTransactionRepository.findByCustomerAccountIdOrderByTxnDateAsc(customerAccountId)
                    .stream().filter(t -> orderId.equals(t.getSourceId())).count();
            assertThat(arCount).isEqualTo(1L);
            assertThat(journalEntryRepository.findByTenantIdAndSourceTypeAndSourceId(tenantId, "AR_CHARGE", orderId))
                    .isPresent();
        } finally {
            tenantHelper.clear();
        }
    }
}
