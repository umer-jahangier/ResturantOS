package io.restaurantos.platform.client;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * Feign client for user-service internal branch endpoints (Doc 4 §4.2).
 * Called by {@code ProvisioningService} to create the HQ branch and, on a failed saga, to
 * compensate it away.
 *
 * <p><b>Why these are typed records rather than {@code Map<String,Object>} (13-10).</b> The
 * previous signature took a map and returned a map, and the saga read {@code data.id} out of the
 * result. user-service's {@code BranchInternalController} returns its response record <i>directly</i>
 * — a bare {@code {"branchId": …}} with no ApiResponse envelope — so the read never matched and
 * every provisioned tenant silently carried a fabricated branch id (audit B2/D-06). A map-shaped
 * client cannot express that mismatch; a typed one makes a producer-side rename a compile error on
 * this side, which is the documented lesson from the Phase 7→10 integration repair. The request
 * side is typed for the same reason: the old call sent an {@code addressLine1} that
 * {@code InternalCreateBranchRequest} does not declare (silently dropped) and omitted {@code isHq}
 * altogether (D-07).
 */
@FeignClient(
    name = "user-service",
    url = "${restaurantos.user-service.uri:}",
    configuration = FeignSharedConfig.class
)
public interface UserInternalClient {

    @PostMapping("/internal/users/branches")
    CreateBranchResponse createBranch(@RequestBody CreateBranchRequest request);

    /**
     * Compensating action for a failed provisioning saga: soft-deactivate a branch this service
     * created. Idempotent on the producer side (204 whether or not the branch is still live), so a
     * retried compensation cannot turn a completed cleanup into a new failure.
     *
     * <p>{@code X-Tenant-Id} is not decoration — {@code branches} is FORCE ROW LEVEL SECURITY on
     * {@code app.current_tenant_id} and there is no JWT on {@code /internal/**}, so without this
     * header the delete matches zero rows and reports success.
     */
    @DeleteMapping("/internal/users/branches/{branchId}")
    void deactivateBranch(@PathVariable UUID branchId,
                          @RequestHeader("X-Tenant-Id") UUID tenantId);

    /**
     * Every LIVE branch for a tenant — the only authoritative branch count platform-admin-service
     * can obtain, and what {@code TenantSubscriptionService} compares a downgraded tier's branch
     * cap against (13-14).
     *
     * <p>{@code branches} is FORCE ROW LEVEL SECURITY on {@code app.current_tenant_id}, and the
     * producer sets the GUC itself from the path variable before querying — so this call needs no
     * {@code X-Tenant-Id} header, unlike the delete above which addresses a branch by its own id.
     *
     * <p>Typed to a record carrying only the id: the producer returns raw {@code BranchEntity}
     * JSON, and binding the whole of another service's entity here would make any field it adds a
     * deserialisation liability for a call that only needs a count.
     */
    @GetMapping("/internal/users/tenants/{tenantId}/branches")
    List<BranchSummary> listBranches(@PathVariable UUID tenantId);

    /** Mirrors {@code BranchDtos.InternalCreateBranchRequest} field for field. */
    record CreateBranchRequest(UUID tenantId, String name, boolean isHq) {}

    /** Mirrors {@code BranchDtos.InternalCreateBranchResponse} — returned UNWRAPPED. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record CreateBranchResponse(UUID branchId) {}

    /** Just enough of a branch row to count it. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record BranchSummary(UUID id, String name) {}
}
