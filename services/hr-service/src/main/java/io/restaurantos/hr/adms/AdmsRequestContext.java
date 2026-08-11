package io.restaurantos.hr.adms;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.util.Optional;

/**
 * The two facts about an incoming device request that a credential policy can check: where it came
 * from, and what host it asked for.
 *
 * <h2>Which address counts as "where it came from" — read this before trusting it</h2>
 *
 * <p>hr-service never sees a terminal directly. The deployed path is
 * {@code terminal → Nginx → gateway → hr-service}, so {@code getRemoteAddr()} is the gateway's own
 * address, identically for every device on the platform. <b>An allowlist built on it would match
 * everyone</b> — which is not a weaker allowlist, it is the appearance of one, and that is worse than
 * having none.
 *
 * <p>So the source address is taken from {@code X-Forwarded-For}, using the <b>first</b> token, which
 * is the same rule the gateway's own {@code ipKeyResolver} already rate-limits on. Consistency with
 * the deployed convention is the argument: two components in one request path disagreeing about who
 * the client is would be its own defect.
 *
 * <p><b>The caveat, stated plainly because {@code SERIAL_ONLY_BOUNDED} rests entirely on it.</b> The
 * first token of {@code X-Forwarded-For} is only trustworthy because Nginx <em>overwrites</em> the
 * header with {@code proxy_set_header X-Forwarded-For $remote_addr}. If Nginx is removed from the
 * path, or reconfigured to append rather than overwrite, that token becomes <b>client-controlled</b>
 * — and a mode whose entire security is a source-address bound would then be trusting a value the
 * attacker types. Anyone changing the ingress topology must revisit this class and
 * {@link DeviceCredentialPolicy} together. It is recorded in 25-AUTH-MODES.md as residual risk for
 * the same reason.
 *
 * <p>{@code restaurantos.hr.device-source-address-header} exists so a deployment with a different
 * ingress can name the header it trusts; setting it blank falls back to the peer address, which fails
 * closed for {@code SERIAL_ONLY_BOUNDED} because the peer address will not be in anyone's allowlist.
 */
@Component
public class AdmsRequestContext {

    /**
     * Everything a handler needs to know about one device request, captured once.
     *
     * <p>{@code host} and {@code remoteAddress} are read by {@link DeviceCredentialPolicy} for the
     * modes D-25-06 added; {@code declaredContentType} is carried so a zero-yield batch can name what
     * the device SAID it was sending, which is the fact that distinguishes "firmware sent a shape we
     * cannot read" from "the body never arrived".
     */
    public record Captured(String serialNo, String presentedToken, String table,
                           String declaredContentType, String host, String remoteAddress) {
    }

    /** Capture the current request. Cheap; call once per handler. */
    public Captured capture(String serialNo, String presentedToken, String table, String declaredContentType) {
        return new Captured(serialNo, presentedToken, table, declaredContentType,
                host().orElse(null), sourceAddress().orElse(null));
    }

    private final String sourceAddressHeader;

    public AdmsRequestContext(
            @Value("${restaurantos.hr.device-source-address-header:X-Forwarded-For}") String sourceAddressHeader) {
        this.sourceAddressHeader = sourceAddressHeader;
    }

    /** The address the request appears to originate from, or empty when there is no current request. */
    public Optional<String> sourceAddress() {
        return currentRequest().map(req -> {
            if (sourceAddressHeader != null && !sourceAddressHeader.isBlank()) {
                String forwarded = req.getHeader(sourceAddressHeader);
                if (forwarded != null && !forwarded.isBlank()) {
                    return forwarded.split(",")[0].trim();
                }
            }
            return req.getRemoteAddr();
        });
    }

    /** The host the request asked for, without any port, lowercased. Used by {@code HOST_MAPPED}. */
    public Optional<String> host() {
        return currentRequest().map(req -> {
            // X-Forwarded-Host is set by the gateway; Host is what the terminal's Domain Name field
            // produced. Prefer the forwarded one for the same reason as the address above.
            String host = req.getHeader("X-Forwarded-Host");
            if (host == null || host.isBlank()) {
                host = req.getHeader("Host");
            }
            if (host == null) {
                return null;
            }
            String first = host.split(",")[0].trim();
            int colon = first.lastIndexOf(':');
            // Guard against an IPv6 literal, where colons are part of the address rather than a port.
            if (colon > -1 && first.indexOf(':') == colon) {
                first = first.substring(0, colon);
            }
            return first.toLowerCase();
        });
    }

    private Optional<HttpServletRequest> currentRequest() {
        return Optional.ofNullable(RequestContextHolder.getRequestAttributes())
                .filter(ServletRequestAttributes.class::isInstance)
                .map(ServletRequestAttributes.class::cast)
                .map(ServletRequestAttributes::getRequest);
    }
}
