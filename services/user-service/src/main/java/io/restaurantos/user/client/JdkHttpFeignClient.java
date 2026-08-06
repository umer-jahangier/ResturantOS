package io.restaurantos.user.client;

import feign.Client;
import feign.Request;
import feign.Response;

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
 * A Feign transport backed by the JDK's own {@link HttpClient}, because Feign's default one
 * <b>cannot send PATCH at all</b>.
 *
 * <h2>The defect this exists to fix</h2>
 *
 * <p>{@code feign.Client.Default} is built on {@code HttpURLConnection}, whose method list is fixed
 * and does not include PATCH. auth-service's profile update is
 * {@code PATCH /internal/auth/users/{userId}} — deliberately, because every field is optional and a
 * PUT would invite a client to blank the fields it did not render. So the very first call to the
 * public update endpoint failed with:
 *
 * <pre>java.net.ProtocolException: Invalid HTTP method: PATCH</pre>
 *
 * <p>which arrives as a {@code FeignException} — i.e. as a transport failure, indistinguishable
 * from auth-service being down. It was caught by {@code UserAdminIT}, and only because that test
 * asserts a 200 rather than merely "not a 4xx".
 *
 * <h2>Why not add an HTTP client library</h2>
 *
 * <p>The usual fix is {@code feign-hc5} or {@code feign-okhttp}. This plan's threat register
 * ({@code T-13-12-SC}) forbids adding a package without a package-legitimacy audit and a blocking
 * human checkpoint, and that rule is worth more than the fifty lines below: an HTTP client is
 * exactly the kind of dependency an attacker would like to be the one who supplies. The JDK has
 * shipped a fully capable HTTP client since 11, it supports arbitrary methods, and it adds no
 * supply-chain surface at all.
 *
 * <p>Scoped to {@link FeignInternalConfig}, so it is the transport for the auth-service client and
 * for nothing else. Another Feign client added later keeps the default and its own decision.
 */
public class JdkHttpFeignClient implements Client {

    /**
     * Headers the JDK client sets itself and refuses to have set for it — passing any of them
     * through throws {@code IllegalArgumentException}, which would turn every request into a
     * transport failure. Feign populates {@code Content-Length} on every request with a body, so
     * this is not a hypothetical.
     */
    private static final Set<String> RESTRICTED =
        Set.of("connection", "content-length", "expect", "host", "upgrade");

    private final HttpClient httpClient;

    public JdkHttpFeignClient(Duration connectTimeout) {
        this.httpClient = HttpClient.newBuilder()
            .connectTimeout(connectTimeout)
            // NEVER: a redirect from an internal service would replay the request — including the
            // shared secret and the acting-user identity — at whatever location it names.
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();
    }

    @Override
    public Response execute(Request request, Request.Options options) throws IOException {
        byte[] body = request.body() != null ? request.body() : new byte[0];

        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(request.url()))
            .timeout(Duration.ofMillis(options.readTimeoutMillis()))
            .method(request.httpMethod().name(), HttpRequest.BodyPublishers.ofByteArray(body));

        request.headers().forEach((name, values) -> {
            if (RESTRICTED.contains(name.toLowerCase(Locale.ROOT))) return;
            values.forEach(value -> builder.header(name, value));
        });

        HttpResponse<byte[]> response;
        try {
            response = httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofByteArray());
        } catch (InterruptedException e) {
            // Restore the flag before leaving: swallowing it makes a cancelled request look like an
            // ordinary I/O failure and leaves the thread unable to notice it was asked to stop.
            Thread.currentThread().interrupt();
            throw new IOException("Interrupted while calling " + request.url(), e);
        }

        Map<String, Collection<String>> headers = new LinkedHashMap<>();
        response.headers().map().forEach(headers::put);

        return Response.builder()
            .status(response.statusCode())
            .request(request)
            .headers(headers)
            .body(response.body())
            .build();
    }
}
