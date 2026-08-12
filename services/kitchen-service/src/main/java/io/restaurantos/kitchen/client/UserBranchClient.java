package io.restaurantos.kitchen.client;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.util.Optional;
import java.util.UUID;

/**
 * Reads a branch's identity from user-service, which owns it. Kitchen needs exactly one field
 * off it: the IANA {@code timezone} the branch's trading day is cut on.
 *
 * <p><b>Why not just use UTC.</b> Because the product has already paid for that answer once. The
 * settings screen tells the owner, on the timezone field itself, that "Business dates and reports
 * are cut on it", and pos-service's {@code DailyTakingsService} cut them in UTC anyway — which for
 * {@code Asia/Karachi} moved the 04:00 boundary to 09:00 local and filed every breakfast service to
 * the previous day. A kitchen board that cleared "yesterday" on a UTC boundary would take five hours
 * of this morning's tickets with it in Karachi, and would leave five hours of last night's on the
 * board in Los Angeles.
 *
 * <p>Implemented with {@link RestClient} against the internal-secret seam, mirroring
 * {@link PosStationClient} — kitchen-service has no Feign infrastructure and this is one GET.
 *
 * <p><b>{@code X-Tenant-Id} is required and is not decoration.</b> {@code branches} is FORCE ROW
 * LEVEL SECURITY on {@code app.current_tenant_id} and there is no JWT on {@code /internal/**}, so
 * without the header the lookup matches zero rows and reports success.
 *
 * <p><b>Empty is not the same as "UTC".</b> A failure returns {@link Optional#empty()} and is logged
 * at WARN naming the URL tried; the caller decides what to do with not-knowing. It must never be
 * collapsed into a zone nobody chose.
 */
@Component
public class UserBranchClient {

    private static final Logger log = LoggerFactory.getLogger(UserBranchClient.class);

    /**
     * A deliberate SUBSET of user-service's {@code BranchEntity} response.
     *
     * <p>{@code ignoreUnknown} because that response is an entity, not a DTO: it carries auditing
     * columns, soft-delete markers and whatever the next phase adds to branches. A strict reader
     * here would make an unrelated branch column a kitchen outage.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record BranchIdentity(UUID id, String name, String timezone) {}

    private final RestClient restClient;
    private final String baseUrl;
    private final String internalSecret;

    public UserBranchClient(@Value("${restaurantos.user.uri:http://127.0.0.1:8082}") String baseUrl,
                            @Value("${restaurantos.internal.secret:dev-internal-secret}") String internalSecret) {
        this.baseUrl = baseUrl;
        this.internalSecret = internalSecret;
        this.restClient = RestClient.create();
    }

    public Optional<BranchIdentity> getBranch(UUID tenantId, UUID branchId) {
        if (baseUrl == null || baseUrl.isBlank() || branchId == null || tenantId == null) {
            return Optional.empty();
        }
        try {
            BranchIdentity branch = restClient.get()
                    .uri(baseUrl + "/internal/users/branches/{id}", branchId)
                    .header("X-Internal-Service", internalSecret)
                    .header("X-Tenant-Id", tenantId.toString())
                    .retrieve()
                    .body(BranchIdentity.class);
            return Optional.ofNullable(branch);
        } catch (Exception e) {
            log.warn("Branch lookup failed for branch {} against {}/internal/users/branches/{}: {}",
                    branchId, baseUrl, branchId, e.toString());
            return Optional.empty();
        }
    }
}
