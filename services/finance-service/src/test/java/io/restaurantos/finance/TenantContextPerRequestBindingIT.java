package io.restaurantos.finance;

import io.restaurantos.shared.feature.FeatureFlagService;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import io.restaurantos.shared.testsupport.TenantContextBindingTestFilter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors;
import org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Regression guard for the trap that {@link TenantContextBindingTestFilter} exists to close.
 *
 * <p>Every other finance IT that issues two requests in one method has a second request that
 * expects 403. That short-circuits at {@code @PreAuthorize} before {@code FeatureFlagAspect}
 * (no {@code @Order}, so {@code LOWEST_PRECEDENCE}) can call {@code requireTenantId()} — so the
 * suite stayed green while the bug was live. Only a second <em>authorized</em> request reaches the
 * aspect. Without the binding filter this test fails with 400 {@code INVALID_OPERATION},
 * "TenantContext is empty: tenant id was not set on this thread".
 *
 * <p>Delete this only together with the filter.
 */
class TenantContextPerRequestBindingIT extends FinanceTestBase {

    @Autowired private WebApplicationContext webApplicationContext;
    @Autowired private TenantContext tenantContext;
    @MockitoBean private FeatureFlagService featureFlagService;

    private MockMvc mockMvc;
    private static final String BRANCH_ID = UUID.randomUUID().toString();

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .apply(SecurityMockMvcConfigurers.springSecurity())
                .addFilter(TenantContextBindingTestFilter.from(webApplicationContext), "/*")
                .build();
        tenantContext.set(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), null);
        when(featureFlagService.isEnabled(any(), any())).thenReturn(true);
    }

    private static RequestPostProcessor asUser(String... authorities) {
        List<GrantedAuthority> granted = List.of(authorities).stream()
                .<GrantedAuthority>map(SimpleGrantedAuthority::new)
                .toList();
        var authentication = new UsernamePasswordAuthenticationToken(
                new JwtClaims(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                        List.of(), List.of(authorities), java.util.Map.of(), null),
                null, granted);
        return SecurityMockMvcRequestPostProcessors.authentication(authentication);
    }

    @Test
    void aSecondAuthorizedRequestInTheSameMethodStillHasATenant() throws Exception {
        mockMvc.perform(MockMvcRequestBuilders.get("/api/v1/finance/ar/aging")
                        .param("branchId", BRANCH_ID).with(asUser("finance.ar.view")))
                .andExpect(status().isOk());

        // The request that used to 400: production's JwtAuthenticationFilter cleared the
        // ThreadLocal on the way out of the first one, and rightly so.
        mockMvc.perform(MockMvcRequestBuilders.get("/api/v1/finance/ar/aging")
                        .param("branchId", BRANCH_ID).with(asUser("finance.ar.view")))
                .andExpect(status().isOk());
    }
}
