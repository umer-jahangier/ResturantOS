package io.restaurantos.platform.client;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import feign.Client;
import feign.RequestInterceptor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.context.annotation.Bean;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * The platform plane's read onto {@code audit_db.audit_events}.
 *
 * <h2>Why an HTTP seam and not a query</h2>
 *
 * <p>{@code platform_db} cannot reach {@code audit_db} at all: separate databases, no
 * {@code postgres_fdw}, no {@code dblink}, and the platform roles hold zero grants in any of the
 * fourteen tenant databases — measured in changeset {@code 040-platform-db-rls-posture.xml}, not
 * assumed. {@code audit_events} and every one of its monthly partitions carry FORCE ROW LEVEL
 * SECURITY on {@code app.current_tenant_id}, against a runtime role that is
 * {@code NOSUPERUSER NOBYPASSRLS}. The platform token additionally carries only the
 * {@code SUPER_ADMIN} authority and no {@code tenant_id} claim, so the tenant-facing
 * {@code GET /api/v1/audit/events} refuses it on the gate AND would have no tenant to scope to.
 *
 * <p>So the read is: name the tenants, and let audit-service read each one under its own policy.
 * That is what {@code POST /internal/audit/platform/search} does, and this is the client for it.
 *
 * <h2>It is a read, and the POST does not change that</h2>
 *
 * <p>The verb is POST only because a tenant list of several hundred UUIDs does not fit in a query
 * string. There is no write method on this interface and there is no write endpoint on the other
 * side to call: {@code audit_writer} holds INSERT and SELECT, a trigger raises on UPDATE and
 * DELETE, and audit-service publishes no mutating handler. An audit log a platform administrator
 * can edit is not an audit log, and nothing in this client could make it one.
 *
 * <h2>The header is not the one the other clients use</h2>
 *
 * <p>auth-service, user-service and finance-service gate {@code /internal/**} on
 * {@code X-Internal-Service}; audit-service's {@code InternalServiceFilter} reads
 * {@code X-Internal-Service-Secret}. Sending the wrong one is a clean 403 with a body that says
 * "Invalid internal secret", which is easy to misread as a wrong VALUE rather than a wrong NAME.
 * Hence {@link AuditFeignConfig} rather than {@link FeignSharedConfig}.
 */
@FeignClient(
    name = "audit-service",
    contextId = "auditPlatformClient",
    url = "${restaurantos.audit-service.uri:}",
    configuration = AuditPlatformClient.AuditFeignConfig.class
)
public interface AuditPlatformClient {

    @PostMapping("/internal/audit/platform/search")
    SearchResponse search(@RequestBody SearchRequest request);

    /**
     * Mirrors {@code PlatformAuditDtos.PlatformAuditSearchRequest} field for field.
     *
     * <p>Typed rather than a map, for the reason 13-10 paid for in {@code UserInternalClient}: a
     * map-shaped client cannot express a producer-side rename, so the read silently misses and the
     * caller carries a fabricated value onward. A record makes the same mistake a compile error.
     */
    record SearchRequest(
            List<UUID> tenantIds,
            List<String> actions,
            String resourceType,
            UUID userId,
            Instant from,
            Instant to,
            Integer page,
            Integer size,
            Boolean includeFacets
    ) {}

    /** {@code ApiResponse.ok(...)} — the envelope audit-service wraps its internal bodies in. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record SearchResponse(SearchData data) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    record SearchData(
            List<AuditEvent> events,
            long totalCount,
            boolean totalCountComplete,
            List<UUID> tenantsRead,
            List<TenantReadFailure> tenantsFailed,
            Instant from,
            Instant to,
            int page,
            int size,
            List<String> actionsPresent,
            boolean scanTruncated
    ) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    record AuditEvent(
            Long id,
            UUID tenantId,
            Instant occurredAt,
            String action,
            String resourceType,
            String resourceId,
            UUID branchId,
            UUID userId,
            UUID impersonatedBy,
            String ipAddress,
            String userAgent,
            String metadata
    ) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    record TenantReadFailure(UUID tenantId, String reason) {}

    /**
     * audit-service's internal secret header, plus the same JDK-backed HTTP client the other
     * internal clients use.
     *
     * <p>The client matters even for a POST: Feign's default is built on
     * {@link java.net.HttpURLConnection}, and this project already carries a JDK-based replacement
     * because that default cannot send PATCH at all. Using one client for every internal call keeps
     * timeout and redirect behaviour identical across seams rather than varying by which verb a
     * given client happens to need.
     */
    class AuditFeignConfig {

        @Bean
        public RequestInterceptor auditInternalSecretInterceptor(
                @Value("${restaurantos.internal.secret:dev-internal-secret}") String secret) {
            return template -> template.header("X-Internal-Service-Secret", secret);
        }

        @Bean
        public Client auditFeignClient() {
            return new FeignSharedConfig.JdkHttpFeignClient();
        }
    }
}
