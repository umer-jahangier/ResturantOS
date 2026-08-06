package io.restaurantos.platform.service;

import io.restaurantos.platform.client.AuthInternalClient;
import io.restaurantos.platform.entity.ImpersonationLogEntity;
import io.restaurantos.platform.repository.ImpersonationLogRepository;
import io.restaurantos.platform.repository.TenantRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * SuperAdmin impersonation of a tenant user (PLATFORM-05 / SC7).
 * Delegates JWT generation to auth-service /internal/auth/users/{id}/impersonate
 * and records an immutable audit log entry in platform_db.
 */
@Service
public class ImpersonationService {

    private static final Logger log = LoggerFactory.getLogger(ImpersonationService.class);
    private static final int DEFAULT_TTL_SECONDS = 1800; // 30 minutes per plan SC7

    private final AuthInternalClient authClient;
    private final ImpersonationLogRepository logRepository;
    private final TenantRepository tenantRepository;

    public ImpersonationService(AuthInternalClient authClient,
                                 ImpersonationLogRepository logRepository,
                                 TenantRepository tenantRepository) {
        this.authClient = authClient;
        this.logRepository = logRepository;
        this.tenantRepository = tenantRepository;
    }

    /**
     * Impersonate a tenant user.
     * @param tenantId       tenant the target user belongs to
     * @param targetUserId   user to impersonate
     * @param adminUserId    SuperAdmin performing the impersonation
     * @param reason         audit reason (required)
     * @return ImpersonateResult containing the short-lived JWT
     */
    @Transactional
    public ImpersonateResult impersonate(UUID tenantId, UUID targetUserId,
                                          UUID adminUserId, String reason) {
        // D-34 made structural. Both callers used to pass the TARGET in the acting position, so
        // every audit row and every issued token claimed a user had impersonated themselves. The
        // parameters here were always named correctly, which is precisely why nothing looked wrong.
        // These two checks make the defect impossible to reintroduce without a test going red:
        // there is no acting id to guess, and the acting id is never the target.
        if (adminUserId == null) {
            throw new IllegalArgumentException(
                "The acting platform administrator is required — an impersonation record that "
                    + "cannot name who performed it is not an audit trail");
        }
        if (adminUserId.equals(targetUserId)) {
            throw new IllegalArgumentException(
                "The acting administrator and the impersonation target are the same id ("
                    + targetUserId + ") — this is the D-34 caller defect, not a legitimate request");
        }

        // Validate tenant exists and is accessible
        tenantRepository.findById(tenantId)
            .orElseThrow(() -> new IllegalArgumentException("Tenant not found: " + tenantId));

        // Delegate to auth-service for JWT signing with impersonated_by claim
        @SuppressWarnings("unchecked")
        Map<String, Object> response = (Map<String, Object>) authClient.impersonate(
            targetUserId,
            Map.of("tenantId", tenantId.toString(),
                   "impersonatedBy", adminUserId.toString(),
                   "expiresInSeconds", DEFAULT_TTL_SECONDS)
        );

        String token  = extractString(response, "token");
        int expiresIn = extractInt(response, "expiresIn", DEFAULT_TTL_SECONDS);

        // Immutable audit record.
        //
        // The id is NOT set here. It is @GeneratedValue(UUID), and assigning one makes Spring Data
        // see a non-new entity and call merge() instead of persist() — Hibernate then issues an
        // UPDATE for a row that does not exist, which surfaces as an OptimisticLockingFailure and a
        // 409 to the caller. In other words the audit row could never be written at all: every
        // impersonation through this service failed at the point of recording itself. Same trap
        // ProvisioningService documents on TenantEntity; found by the first test that exercised
        // this path over HTTP.
        ImpersonationLogEntity entry = new ImpersonationLogEntity();
        entry.setAdminUserId(adminUserId);
        entry.setTargetUserId(targetUserId);
        entry.setTenantId(tenantId);
        entry.setReason(reason);
        entry.setStartedAt(Instant.now());
        entry.setExpiresAt(Instant.now().plusSeconds(expiresIn));
        logRepository.save(entry);

        log.info("[impersonation] admin={} impersonating user={} tenant={}", adminUserId, targetUserId, tenantId);
        return new ImpersonateResult(token, expiresIn);
    }

    // --- Helpers ---

    @SuppressWarnings("unchecked")
    private String extractString(Map<String, Object> response, String key) {
        Object data = response.get("data");
        if (data instanceof Map<?,?> map) {
            Object v = map.get(key);
            if (v != null) return v.toString();
        }
        return "";
    }

    @SuppressWarnings("unchecked")
    private int extractInt(Map<String, Object> response, String key, int fallback) {
        Object data = response.get("data");
        if (data instanceof Map<?,?> map) {
            Object v = map.get(key);
            if (v instanceof Number n) return n.intValue();
        }
        return fallback;
    }

    public record ImpersonateResult(String token, int expiresIn) {}
}
