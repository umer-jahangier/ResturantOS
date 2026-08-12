package io.restaurantos.kitchen.client;

import io.restaurantos.kitchen.domain.model.StationType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Reads the branch's STATION REGISTRY from pos-service, which owns it.
 *
 * <p>Implemented with {@link RestClient} against the internal-secret seam rather than OpenFeign,
 * mirroring {@code hr-service}'s {@code PosRevenueClient} — kitchen-service has no Feign infra and
 * this is one GET.
 *
 * <h3>Empty is not the same as unavailable</h3>
 *
 * <p>This returns {@link Optional#empty()} when pos-service could not be reached or answered with
 * something unusable, and {@code Optional.of(List.of())} when pos-service answered and the branch
 * genuinely has no stations. The caller MUST keep the two apart: collapsing them is how a
 * pos-service outage turns into "this branch has no stations configured" on a wall-mounted screen
 * in the middle of service, which is precisely the failure this whole repair exists to remove.
 *
 * <p>A failure is logged at WARN, never swallowed silently. {@code hr-service}'s equivalent client
 * defaults its base URL to blank and returns empty forever if nobody configures it — a client that
 * is structurally present and behaviourally absent. The default here points at pos-service's real
 * dev port, and the log line names the URL it actually tried.
 */
@Component
public class PosStationClient {

    private static final Logger log = LoggerFactory.getLogger(PosStationClient.class);

    /**
     * One station as pos-service reports it.
     *
     * <p>{@code stationType} is carried as a raw String and parsed by the consumer through
     * {@link StationType#fromWireOrNull}, for the same reason the fire-event payload does: a value
     * added to pos's enum before kitchen's must leave the stored type alone rather than crash the
     * read or guess KITCHEN.
     */
    public record PosStation(UUID id, String code, String name, boolean active, String stationType) {

        /** The parsed type, or null when pos sent nothing usable. Never a guess. */
        public StationType parsedType() {
            return StationType.fromWireOrNull(stationType);
        }
    }

    private final RestClient restClient;
    private final String baseUrl;
    private final String internalSecret;

    public PosStationClient(@Value("${restaurantos.pos.uri:http://127.0.0.1:8084}") String baseUrl,
                            @Value("${restaurantos.internal.secret:dev-internal-secret}") String internalSecret) {
        this.baseUrl = baseUrl;
        this.internalSecret = internalSecret;
        this.restClient = RestClient.create();
    }

    /**
     * The branch's stations as pos-service knows them (active AND inactive), or
     * {@link Optional#empty()} when pos-service could not be read.
     */
    public Optional<List<PosStation>> listStations(UUID tenantId, UUID branchId) {
        if (baseUrl == null || baseUrl.isBlank()) {
            log.warn("Station registry sync skipped: restaurantos.pos.uri is not configured. The KDS "
                    + "will only show stations that have already received a ticket.");
            return Optional.empty();
        }
        try {
            List<PosStation> stations = restClient.get()
                    .uri(baseUrl + "/internal/stations?branchId={b}", branchId)
                    .header("X-Internal-Service", internalSecret)
                    .header("X-Tenant-Id", tenantId.toString())
                    .retrieve()
                    .body(new ParameterizedTypeReference<List<PosStation>>() {});
            return Optional.ofNullable(stations);
        } catch (Exception e) {
            log.warn("Station registry sync failed for branch {} against {}/internal/stations: {}",
                    branchId, baseUrl, e.toString());
            return Optional.empty();
        }
    }
}
