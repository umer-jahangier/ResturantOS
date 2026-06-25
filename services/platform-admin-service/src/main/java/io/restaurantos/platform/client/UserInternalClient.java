package io.restaurantos.platform.client;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

/**
 * Feign client for user-service internal branch creation (Doc 4 §4.2).
 * Called by TenantProvisioningService (FD-1 step 4) to create the HQ branch.
 */
@FeignClient(
    name = "user-service",
    url = "${restaurantos.user-service.uri:}",
    configuration = FeignSharedConfig.class
)
public interface UserInternalClient {

    @PostMapping("/internal/users/branches")
    Map<String, Object> createBranch(@RequestBody Map<String, Object> request);
}
