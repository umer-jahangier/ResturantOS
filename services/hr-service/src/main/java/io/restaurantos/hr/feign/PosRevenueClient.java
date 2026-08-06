package io.restaurantos.hr.feign;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.time.LocalDate;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Internal seam for branch revenue (POS/finance), used only to compute labour-cost %. Revenue is
 * ALWAYS pulled here, never accepted from the labour-cost caller. Named *Client to mark the seam;
 * implemented with {@link RestClient} rather than OpenFeign to avoid adding Feign infra to
 * hr-service. Degrades gracefully: if the internal URL is unset or the call fails, returns empty
 * (labour-cost % then reports as unavailable rather than fabricating a number).
 */
@Component
public class PosRevenueClient {

    private final RestClient restClient;
    private final String baseUrl;
    private final String internalSecret;

    public PosRevenueClient(@Value("${restaurantos.pos.internal-url:}") String baseUrl,
                            @Value("${restaurantos.internal.secret:dev-internal-secret}") String internalSecret) {
        this.baseUrl = baseUrl;
        this.internalSecret = internalSecret;
        this.restClient = RestClient.create();
    }

    /** Total revenue (paisa) for a branch over [from, to], or empty if the source is unavailable. */
    public Optional<Long> revenueForBranch(UUID branchId, LocalDate from, LocalDate to) {
        if (baseUrl == null || baseUrl.isBlank()) {
            return Optional.empty();
        }
        try {
            Map<?, ?> body = restClient.get()
                    .uri(baseUrl + "/internal/pos/revenue?branchId={b}&from={f}&to={t}", branchId, from, to)
                    .header("X-Internal-Service", internalSecret)
                    .retrieve()
                    .body(Map.class);
            if (body == null || body.get("revenuePaisa") == null) {
                return Optional.empty();
            }
            return Optional.of(((Number) body.get("revenuePaisa")).longValue());
        } catch (Exception e) {
            return Optional.empty();
        }
    }
}
