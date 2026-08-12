package io.restaurantos.nlq.provider;

/**
 * The resolved credentials for one provider call.
 *
 * <p><b>{@link #toString()} IS OVERRIDDEN AND THAT IS LOAD-BEARING.</b> A record's generated
 * {@code toString} prints every component, so the default would put the API key into any log line,
 * exception message or debugger frame that ever interpolated this object. This class exists on the
 * path where a well-meaning {@code log.debug("credentials={}", creds)} is the single most likely
 * way the key escapes; the override makes that impossible rather than merely discouraged.
 *
 * <p>{@code baseUrl} is a SERVER-SIDE CONSTANT per provider, never tenant input. A tenant-supplied
 * base URL is an SSRF primitive into a service that can reach Postgres, Redis, ClickHouse and
 * Eureka.
 *
 * <p>Model IDs are platform-pinned too (v1 decision): a free-text model field produces provider
 * 404s that look exactly like key failures, and model choice drives both cost and SQL quality.
 */
public record LlmCredentials(String baseUrl, String apiKey, String modelSql, String modelNarrative) {

    @Override
    public String toString() {
        return "LlmCredentials[baseUrl=" + baseUrl + ", apiKey=***, modelSql=" + modelSql
                + ", modelNarrative=" + modelNarrative + "]";
    }
}
