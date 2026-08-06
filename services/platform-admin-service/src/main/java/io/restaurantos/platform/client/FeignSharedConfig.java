package io.restaurantos.platform.client;

import feign.Client;
import feign.Request;
import feign.RequestInterceptor;
import feign.Response;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Feign configuration for platform-admin-service's internal clients: the {@code X-Internal-Service}
 * shared secret (Doc 4 §4.1) on every outbound call, and an HTTP client that can actually issue the
 * verbs those calls use.
 *
 * <p>Applied per-client via {@code configuration = FeignSharedConfig.class}, so these beans live in
 * each Feign client's child context and affect nothing else in the application.
 */
public class FeignSharedConfig {

    @Bean
    public RequestInterceptor internalSecretInterceptor(
            @Value("${restaurantos.internal.secret:dev-internal-secret}") String secret) {
        return requestTemplate -> requestTemplate.header("X-Internal-Service", secret);
    }

    /**
     * <b>Why this exists: Feign's default client cannot send PATCH.</b>
     *
     * <p>{@code feign.Client.Default} is built on {@link java.net.HttpURLConnection}, whose method
     * allow-list has never included PATCH; it throws {@code ProtocolException: Invalid HTTP method:
     * PATCH} before a byte reaches the network. Spring Cloud OpenFeign would normally hand this off
     * to Apache HttpClient 5 or the JDK HTTP2 client, but both of those require an adapter artifact
     * ({@code feign-hc5} / {@code feign-java11}) that is not on this classpath — and adding one is a
     * dependency install this phase's threat register (T-13-10-SC) does not permit on a whim.
     *
     * <p>It matters concretely. Plan 13-06 put the auth-side tenant status behind
     * {@code PATCH /internal/auth/tenants/{id}/status}, which is both the provisioning saga's
     * compensating action for a registered auth tenant and the only way a platform suspension can
     * ever be propagated to auth-service. On the default client, every one of those calls fails at
     * the client and the saga can do nothing but write a manual-repair record — which is how this
     * was found: {@code ProvisioningSagaIT}'s forced-failure case reported
     * {@code MANUAL-REPAIR-REQUIRED … reason=Invalid HTTP method: PATCH}. The repair record worked;
     * the compensation did not.
     *
     * <p>{@link java.net.http.HttpClient} is part of the JDK, supports every method, and needs no
     * new artifact. Connect timeout is fixed at the value {@code application.yml} configures for
     * Feign rather than taken per-request, because a JDK client's connect timeout belongs to the
     * client and not the request; the read timeout IS per-request and is honoured.
     */
    @Bean
    public Client feignClient() {
        return new JdkHttpFeignClient();
    }

    /** Minimal {@code feign.Client} over the JDK HTTP client. Package-private on purpose. */
    static final class JdkHttpFeignClient implements Client {

        /**
         * Headers {@link HttpRequest.Builder#header} refuses outright. Feign sets Content-Length
         * itself, so without this filter every request with a body dies on an
         * IllegalArgumentException instead of being sent.
         */
        private static final Set<String> RESTRICTED =
            Set.of("connection", "content-length", "expect", "host", "upgrade");

        private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

        @Override
        public Response execute(Request request, Request.Options options) throws IOException {
            HttpRequest.BodyPublisher body = request.body() == null
                ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofByteArray(request.body());

            HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(request.url()))
                .timeout(Duration.ofMillis(Math.max(1, options.readTimeoutMillis())))
                .method(request.httpMethod().name(), body);

            for (Map.Entry<String, Collection<String>> header : request.headers().entrySet()) {
                if (RESTRICTED.contains(header.getKey().toLowerCase(Locale.ROOT))) {
                    continue;
                }
                for (String value : header.getValue()) {
                    builder.header(header.getKey(), value);
                }
            }

            HttpResponse<byte[]> response;
            try {
                response = http.send(builder.build(), HttpResponse.BodyHandlers.ofByteArray());
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                throw new IOException("Interrupted calling " + request.url(), ie);
            }

            Map<String, Collection<String>> responseHeaders = new LinkedHashMap<>();
            response.headers().map().forEach(responseHeaders::put);

            return Response.builder()
                .status(response.statusCode())
                .request(request)
                .headers(responseHeaders)
                .body(response.body())
                .build();
        }
    }
}
