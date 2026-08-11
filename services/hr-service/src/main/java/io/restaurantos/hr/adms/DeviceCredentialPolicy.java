package io.restaurantos.hr.adms;

import io.restaurantos.hr.entity.AttendanceDeviceEntity;
import io.restaurantos.hr.entity.AttendanceDeviceEntity.AuthMode;
import io.restaurantos.hr.service.AttendanceDeviceService;
import org.springframework.stereotype.Component;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.Arrays;
import java.util.Optional;

/**
 * Decides whether this request may act as this device (D-25-06).
 *
 * <h2>Why this exists at all</h2>
 *
 * <p>The ADMS ingest authenticates a device by a token in the query string. That works, it is
 * constant-time compared, and it is the posture D-25-06 says not to weaken — but <b>a stock ZKTeco
 * terminal cannot use it</b>. Its configuration menu offers exactly Enable, Domain Name, Server
 * Address, Server Port and proxy settings; the request path and its entire query string are generated
 * by firmware. There is no field for a token, no documented ADMS parameter carrying a per-device
 * secret, and no header. So the accurate description of the state before this class is not "the
 * protocol is done and the management is missing" — it is <b>the protocol is done for a client we
 * write ourselves, and no stock terminal can walk it</b>.
 *
 * <p>The decision, its rejected alternatives and its residual risk are written down in
 * {@code .planning/phases/25-biometric-terminals/25-AUTH-MODES.md}. A weakening of a public
 * credential path needs a written trade, not an inferred one. Read it before changing this file.
 *
 * <h2>The four rules this class exists to keep</h2>
 *
 * <ol>
 *   <li><b>{@link AuthMode#TOKEN} is untouched and remains the default.</b> No device changes mode by
 *       migration, by default, or as a side effect of registration. This class does not restructure
 *       the token path; it delegates to the same constant-time comparison as before.</li>
 *   <li><b>A mode presenting no secret is refused outright when its allowlist is empty</b> — checked
 *       <em>before anything else</em>, failing closed. The failure that matters is an administrator
 *       who selects the mode and never fills the addresses in, and open is the wrong answer to that
 *       mistake. Serials are globally unique and the resolver looks up by serial alone, so
 *       serial-only with no network bound means anyone who learns a serial can post punches into that
 *       tenant's payroll.</li>
 *   <li><b>Every refusal is indistinguishable.</b> This class returns a reason for the operator's log
 *       and never for the response: {@code HrExceptionHandler} answers every cause with the same
 *       status, the same body and the same code. A new mode must not become a way to tell a stranger
 *       which mode a serial uses.</li>
 *   <li><b>The resolver's ordering is the control, and this is a substitution inside it.</b> Resolve
 *       by serial through the definer-context function, check active, check archived, <em>then</em>
 *       policy, and only then bind tenant context. Nothing here binds context, reads it, or writes.</li>
 * </ol>
 *
 * <h2>The mode most customers will run is the weakest one, and that is written down</h2>
 *
 * <p>{@code SERIAL_ONLY_BOUNDED} trusts two facts an attacker can obtain: a serial, which is printed
 * on the device and appears in support tickets and photographs, and a source address, which is the
 * restaurant's public IP. A guest on the restaurant's wifi shares that address and can therefore post
 * fabricated punches for that branch. It is accepted because the alternative is not a stronger
 * deployment but no deployment — the customer buys a different ADMS server which made the same trade
 * without writing it down. What makes it defensible rather than negligent: per-device, opt-in,
 * audited, bounded at the network, never a default, never applied by migration, and visible on the
 * device screen as a weaker mode.
 */
@Component
public class DeviceCredentialPolicy {

    /** The outcome. {@code reason} is for the operator's log and the recorder — never for the caller. */
    public record Decision(boolean permitted, DeviceAuthFailureRecorder.Cause reason,
                           String observedSourceAddress) {

        static Decision permit() {
            return new Decision(true, null, null);
        }

        static Decision refuse(DeviceAuthFailureRecorder.Cause reason) {
            return new Decision(false, reason, null);
        }

        /**
         * A source-address refusal carries the address it was refused from.
         *
         * <p>This is the one constraint 25-AUTH-MODES.md adds beyond the plan, and it exists because
         * the stated failure mode of the bounded mode is "a wrong allowlist is a silently offline
         * terminal". <b>Silently</b> is the whole problem. A restaurant on a domestic connection will
         * have its public address change, and without this the symptom is "the clock stopped working"
         * with nothing in the product that says why — a weekend support call about attendance nobody
         * can reconstruct. Recording it makes the fix self-service.
         */
        static Decision refuseFromAddress(String observed) {
            return new Decision(false, DeviceAuthFailureRecorder.Cause.SOURCE_ADDRESS_REFUSED, observed);
        }
    }

    private final AttendanceDeviceService deviceService;
    private final AdmsRequestContext requestContext;

    public DeviceCredentialPolicy(AttendanceDeviceService deviceService, AdmsRequestContext requestContext) {
        this.deviceService = deviceService;
        this.requestContext = requestContext;
    }

    /**
     * @param device        the row already resolved by serial, already known active and unarchived
     * @param presentedToken the {@code token} query parameter, which may be null
     */
    public Decision evaluate(AttendanceDeviceEntity device, String presentedToken) {
        AuthMode mode = device.getAuthMode() == null ? AuthMode.TOKEN : device.getAuthMode();

        // Rule 2, and it is FIRST for every mode that presents no secret. A misconfiguration must
        // fail closed before any other check has a chance to pass it.
        if (presentsNoSecret(mode) && isBlank(device.getSourceAddressAllowlist())) {
            return Decision.refuse(DeviceAuthFailureRecorder.Cause.SOURCE_ADDRESS_REFUSED);
        }

        return switch (mode) {
            // Unchanged: the same constant-time comparison, which also returns false for a null
            // presented token — which is what makes the "optional" query parameter mandatory here.
            case TOKEN -> deviceService.verifyToken(device, presentedToken)
                    ? Decision.permit()
                    : Decision.refuse(DeviceAuthFailureRecorder.Cause.BAD_TOKEN);

            case SERIAL_ONLY_BOUNDED -> {
                String observed = requestContext.sourceAddress().orElse(null);
                yield addressAllowed(observed, device.getSourceAddressAllowlist())
                        ? Decision.permit()
                        : Decision.refuseFromAddress(observed);
            }

            case HOST_MAPPED -> {
                // The device's Domain Name field is the typeable place a per-branch hostname goes.
                // The allowlist column carries that hostname for this mode; a device whose hostname
                // is unset can never match, which is the correct closed default.
                String expected = device.getSourceAddressAllowlist();
                String actual = requestContext.host().orElse(null);
                yield !isBlank(expected) && actual != null && expected.trim().equalsIgnoreCase(actual)
                        ? Decision.permit()
                        : Decision.refuse(DeviceAuthFailureRecorder.Cause.SOURCE_ADDRESS_REFUSED);
            }
        };
    }

    /** True for any mode where the request carries no per-device secret at all. */
    private static boolean presentsNoSecret(AuthMode mode) {
        return mode == AuthMode.SERIAL_ONLY_BOUNDED;
    }

    /**
     * Matches an address against a comma-separated list of literals and CIDR ranges.
     *
     * <p>Parsed as networks rather than compared as strings, deliberately: a string comparison makes
     * {@code 10.0.0.1} fail to match {@code 10.0.0.0/8}, so an administrator who writes the range
     * their ISP gave them gets a silently offline terminal — the exact failure this mode is most
     * likely to hit. An unparseable entry matches nothing rather than everything.
     */
    static boolean addressAllowed(String address, String allowlist) {
        if (address == null || isBlank(allowlist)) {
            return false;
        }
        InetAddress candidate;
        try {
            candidate = InetAddress.getByName(address.trim());
        } catch (UnknownHostException e) {
            return false;
        }
        return Arrays.stream(allowlist.split(","))
                .map(String::trim)
                .filter(entry -> !entry.isEmpty())
                .anyMatch(entry -> matches(candidate, entry));
    }

    private static boolean matches(InetAddress candidate, String entry) {
        int slash = entry.indexOf('/');
        if (slash < 0) {
            return resolve(entry).map(a -> Arrays.equals(a.getAddress(), candidate.getAddress())).orElse(false);
        }
        Optional<InetAddress> network = resolve(entry.substring(0, slash));
        if (network.isEmpty()) {
            return false;
        }
        int prefix;
        try {
            prefix = Integer.parseInt(entry.substring(slash + 1).trim());
        } catch (NumberFormatException e) {
            return false;
        }
        byte[] net = network.get().getAddress();
        byte[] addr = candidate.getAddress();
        if (net.length != addr.length || prefix < 0 || prefix > net.length * 8) {
            return false; // an IPv4 range never matches an IPv6 address, and vice versa
        }
        int fullBytes = prefix / 8;
        int remainingBits = prefix % 8;
        for (int i = 0; i < fullBytes; i++) {
            if (net[i] != addr[i]) {
                return false;
            }
        }
        if (remainingBits == 0) {
            return true;
        }
        int mask = (0xFF << (8 - remainingBits)) & 0xFF;
        return (net[fullBytes] & mask) == (addr[fullBytes] & mask);
    }

    /** Literal parsing only — never a DNS lookup, which would make an allowlist resolver-dependent. */
    private static Optional<InetAddress> resolve(String literal) {
        String value = literal.trim();
        if (value.isEmpty()) {
            return Optional.empty();
        }
        try {
            // getByName performs DNS for a non-literal; guard so an allowlist entry can never become
            // a network call on the ingest path, nor be redirected by a poisoned resolver.
            if (!value.matches("[0-9.]+") && !value.contains(":")) {
                return Optional.empty();
            }
            return Optional.of(InetAddress.getByName(value));
        } catch (UnknownHostException e) {
            return Optional.empty();
        }
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
