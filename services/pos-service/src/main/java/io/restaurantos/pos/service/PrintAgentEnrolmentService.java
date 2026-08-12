package io.restaurantos.pos.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.pos.domain.model.PrintAgent;
import io.restaurantos.pos.repository.PrintAgentRepository;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Enrolling, resolving and revoking the identity of a machine that prints.
 *
 * <h2>The credential exists in the clear for exactly one HTTP response</h2>
 *
 * <p>{@link #enrol} is the only method that ever returns a secret. Nothing stores it, no read
 * returns it, no log line contains it and no event payload carries it — the same rule Phase 13
 * locked for the password reset token, for the same reason: a credential that appears in a second
 * place has two chances to leak and only one of them gets audited.
 *
 * <p>An integration test captures this class's log output during an enrolment and a failed
 * authentication and scans it for the secret. That is not decoration: "we don't log it" is the kind
 * of claim that stops being true one debugging session after it is made.
 *
 * <h2>The shape of the credential, and why it carries its own tenant</h2>
 *
 * <pre>{@code   rosprt.<tenant-hex-32>.<lookup-id>.<secret> }</pre>
 *
 * <p>{@code print_agents} is FORCE RLS. The agent authenticates before anything knows its tenant,
 * and under forced RLS a query with no {@code app.current_tenant_id} returns ZERO ROWS rather than
 * erroring — so a lookup by credential alone would always find nothing and would be indistinguishable
 * from a wrong secret. The credential therefore carries the tenant so the caller can set the GUC
 * before the lookup.
 *
 * <p>That is safe because the tenant id is not the secret. Claiming a tenant you hold no credential
 * for finds either no row or a row whose hash you cannot match. <b>The tenant and branch used
 * downstream are read from the ROW, never from the string the client sent</b> — that is the load-
 * bearing sentence in this class.
 *
 * <p>The {@code rosprt.} prefix is deliberate: a secret pasted into an issue tracker should be
 * identifiable as one at a glance, by a human or by a secret scanner.
 */
@Service
public class PrintAgentEnrolmentService {

    private static final Logger log = LoggerFactory.getLogger(PrintAgentEnrolmentService.class);

    /** Recognisable at a glance, and greppable by a secret scanner. */
    public static final String PREFIX = "rosprt";

    /**
     * 32 bytes from a CSPRNG. Guessing is not a strategy against 256 bits, and the bcrypt cost
     * factor makes online attempts expensive on top of that.
     */
    private static final int SECRET_BYTES = 32;
    private static final int LOOKUP_BYTES = 12;

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Base64.Encoder ENCODER = Base64.getUrlEncoder().withoutPadding();

    private final PrintAgentRepository repository;
    private final PasswordEncoder passwordEncoder;
    private final TenantContext tenantContext;
    private final ObjectMapper objectMapper;

    public PrintAgentEnrolmentService(PrintAgentRepository repository,
                                      PasswordEncoder passwordEncoder,
                                      TenantContext tenantContext,
                                      ObjectMapper objectMapper) {
        this.repository = repository;
        this.passwordEncoder = passwordEncoder;
        this.tenantContext = tenantContext;
        this.objectMapper = objectMapper;
    }

    /**
     * @param secret the ONLY time this value exists outside the client. Never persisted, never
     *               logged, never returned again.
     */
    public record Enrolled(UUID agentId, String label, Instant createdAt, String secret) {}

    /**
     * One print queue on the machine an agent runs on (S8).
     *
     * <p>{@code name} is the destination {@code lp -d} takes, NOT a display label — the settings
     * screen may show the description, but the value it stores has to be this one or the spooler
     * will not find the printer.
     */
    public record ReportedDevice(String name, String description, String state, boolean isDefault) {}

    /**
     * Metadata only. There is deliberately no field here that could hold a secret or a hash.
     *
     * @param devices             what the agent last enumerated. NULL — not an empty list — when it
     *                            has never reported, so the screen can tell "no printers attached"
     *                            from "this machine has never said".
     * @param devicesUnavailable  why there is no list, when there is none. Never non-null alongside
     *                            a non-empty {@code devices}.
     */
    public record AgentView(UUID agentId, UUID branchId, String label, Instant createdAt,
                            Instant revokedAt, Instant lastSeenAt,
                            List<ReportedDevice> devices, String devicesUnavailable,
                            Instant devicesReportedAt) {
        public boolean revoked() {
            return revokedAt != null;
        }
    }

    @Transactional
    public Enrolled enrol(UUID branchId, String label) {
        UUID tenantId = tenantContext.requireTenantId();

        String lookupId = randomToken(LOOKUP_BYTES);
        String secret = randomToken(SECRET_BYTES);

        PrintAgent agent = new PrintAgent();
        agent.setTenantId(tenantId);
        agent.setBranchId(branchId);
        agent.setLabel(label == null || label.isBlank() ? "Print agent" : label.trim());
        agent.setLookupId(lookupId);
        agent.setCredentialHash(passwordEncoder.encode(secret));
        PrintAgent saved = repository.saveAndFlush(agent);

        // The agent ID and the label. Not the secret, not the lookup id, not the hash.
        log.info("print agent {} enrolled for branch {}", saved.getId(), branchId);

        return new Enrolled(saved.getId(), saved.getLabel(), saved.getCreatedAt(),
                compose(tenantId, lookupId, secret));
    }

    /**
     * Resolve a presented credential to its agent, or empty.
     *
     * <p><b>Every failure returns the same empty.</b> A malformed string, an unknown tenant, an
     * unknown lookup id, a wrong secret and a revoked agent are indistinguishable to the caller, so
     * there is no oracle to enumerate with. They ARE distinguishable in this service's own debug
     * log, which is where that distinction belongs.
     *
     * <p>The tenant GUC must already be set to the credential's claimed tenant when this is called —
     * see {@link #tenantOf(String)}. It cannot be set inside this method: the transaction's JDBC
     * connection is checked out on entry, and {@code TenantAwareDataSource} writes the GUC at
     * checkout.
     */
    @Transactional(readOnly = true)
    public Optional<PrintAgent> resolve(String credential) {
        String[] parts = split(credential);
        if (parts == null) {
            log.debug("print agent authentication refused: malformed credential");
            return Optional.empty();
        }
        UUID tenantId;
        try {
            tenantId = parseTenant(parts[1]);
        } catch (IllegalArgumentException e) {
            log.debug("print agent authentication refused: unparsable tenant segment");
            return Optional.empty();
        }

        Optional<PrintAgent> found = repository.findForAuthentication(tenantId, parts[2]);
        if (found.isEmpty()) {
            // Still pay the hashing cost, so "unknown agent" and "wrong secret" do not differ by a
            // measurable ~100 ms. Without this the fast path IS the enumeration oracle the generic
            // error was meant to close.
            passwordEncoder.matches(parts[3], DUMMY_HASH);
            log.debug("print agent authentication refused: no such agent for the claimed tenant");
            return Optional.empty();
        }

        PrintAgent agent = found.get();
        if (!passwordEncoder.matches(parts[3], agent.getCredentialHash())) {
            log.debug("print agent authentication refused: secret does not match agent {}", agent.getId());
            return Optional.empty();
        }
        if (agent.isRevoked()) {
            // Checked AFTER the hash comparison so a revoked agent is not a faster answer than a
            // wrong secret, and re-read from the row on every call — there is no cache, so
            // revocation takes effect on the very next poll.
            log.debug("print agent authentication refused: agent {} is revoked", agent.getId());
            return Optional.empty();
        }
        return Optional.of(agent);
    }

    /**
     * The tenant a credential CLAIMS, for the caller to set on the context before {@link #resolve}.
     *
     * <p>Named "claims" on purpose. This value is attacker-controlled until {@code resolve} matches
     * a hash against a row; it is only ever used to scope the lookup, never to authorise anything.
     */
    public Optional<UUID> tenantOf(String credential) {
        String[] parts = split(credential);
        if (parts == null) {
            return Optional.empty();
        }
        try {
            return Optional.of(parseTenant(parts[1]));
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
    }

    /**
     * Whether anything on this branch is in a position to put paper in a customer's hand, and which
     * machine that is.
     *
     * <h2>Why a receipt needs this and why it is not the admin list</h2>
     *
     * <p>The bill screen told every cashier "the branch print agent will put it on paper" whether or
     * not a single agent had ever polled — measured live on 2026-08-12 with nine enrolled agents,
     * all of them cold. That is this product's signature defect wearing its friendliest face: the
     * screen states an outcome it has not observed, and the cashier finds out at the counter.
     *
     * <p>The cashier cannot be told this by {@code GET /print-agents}: that endpoint carries
     * {@code pos.printers.admin}, which a cashier does not hold and must not be given — deciding
     * which machines may drive a branch's printers is not a cashier's business. So the answer rides
     * on the response the cashier is ALREADY entitled to, the issue of their own bill, and carries
     * only what the sentence on screen needs: how many agents are live-capable, the name of the one
     * that would take this job, and when it was last heard from. No credential, no hash, no lookup
     * id — there is no field on {@link Presence} that could hold one.
     *
     * <p><b>{@code lastSeenAt} is reported, not judged.</b> This service does not decide "connected";
     * it hands over the timestamp and the caller applies the one recency rule the product has
     * (`AGENT_CONNECTED_WINDOW_MS`). Two places computing liveness from the same timestamp can only
     * ever agree; two places each storing their own flag cannot.
     *
     * @param enrolled   live-capable agents — enrolled and not revoked. Zero means nothing on this
     *                   branch can print at all, which is a different sentence from "the machine is
     *                   off" and the screen must be able to say both.
     * @param label      the agent that would take this job: the one heard from most recently, or —
     *                   when none has ever polled — the most recently enrolled, so the manager is
     *                   told which machine to go and start rather than nothing at all.
     * @param lastSeenAt null when that agent has never polled.
     */
    public record Presence(int enrolled, String label, Instant lastSeenAt) {}

    @Transactional(readOnly = true)
    public Presence presence(UUID branchId) {
        UUID tenantId = tenantContext.requireTenantId();
        List<PrintAgent> live = repository.findForBranch(tenantId, branchId).stream()
                .filter(a -> !a.isRevoked())
                .toList();

        PrintAgent candidate = live.stream()
                .filter(a -> a.getLastSeenAt() != null)
                .max(Comparator.comparing(PrintAgent::getLastSeenAt))
                .orElseGet(() -> live.stream()
                        .max(Comparator.comparing(PrintAgent::getCreatedAt))
                        .orElse(null));

        return new Presence(live.size(),
                candidate == null ? null : candidate.getLabel(),
                candidate == null ? null : candidate.getLastSeenAt());
    }

    @Transactional
    public void recordSeen(UUID agentId) {
        recordSeen(agentId, null, null);
    }

    /**
     * Stamp the poll, and store what the agent says its machine can print on (S8).
     *
     * <h2>Why the caps are applied HERE and not only in the agent</h2>
     *
     * <p>The agent caps the list at 50 and each name at 128 characters before it sends. That cap is
     * a courtesy, not a control: the agent is software on a machine in a restaurant, and this
     * endpoint is reached with a credential that machine holds. A cap enforced only by the client
     * is not a cap, and this column is rendered on a settings screen and stored in a tenant's row.
     *
     * <h2>Why an absent report is left alone</h2>
     *
     * <p>{@code devices == null} means the agent said nothing — an older agent, or one whose scan
     * has not completed yet. The stored list is NOT cleared: it is still the last true answer, its
     * timestamp says how old it is, and wiping it would make every deploy of an older agent look
     * like a machine that lost its printers.
     *
     * @param devices            what the agent enumerated, or null if it did not say
     * @param devicesUnavailable why it could not enumerate, or null
     */
    @Transactional
    public void recordSeen(UUID agentId, List<ReportedDevice> devices, String devicesUnavailable) {
        UUID tenantId = tenantContext.requireTenantId();
        repository.findScoped(tenantId, agentId).ifPresent(agent -> {
            agent.setLastSeenAt(Instant.now());
            if (devices == null && devicesUnavailable == null) {
                return;
            }
            List<ReportedDevice> capped = (devices == null ? List.<ReportedDevice>of() : devices).stream()
                    .filter(d -> d != null && d.name() != null && !d.name().isBlank())
                    .limit(MAX_REPORTED_DEVICES)
                    .map(d -> new ReportedDevice(
                            truncate(d.name().trim(), MAX_DEVICE_NAME),
                            d.description() == null || d.description().isBlank()
                                    ? null : truncate(d.description().trim(), MAX_DEVICE_DESCRIPTION),
                            d.state() == null ? "UNKNOWN" : truncate(d.state().trim(), 20),
                            d.isDefault()))
                    .toList();
            try {
                agent.setDevices(objectMapper.writeValueAsString(capped));
            } catch (JsonProcessingException e) {
                // Serialising a list of four-string records cannot realistically fail, and if it
                // does the poll must still succeed: a device list is a convenience and printing is
                // not. Loud in the log, invisible to the kitchen.
                log.warn("could not store the device list reported by print agent {}: {}", agentId, e.getMessage());
                return;
            }
            agent.setDevicesUnavailable(
                    devicesUnavailable == null || devicesUnavailable.isBlank()
                            ? null : truncate(devicesUnavailable.trim(), MAX_UNAVAILABLE_REASON));
            agent.setDevicesReportedAt(Instant.now());
        });
    }

    private static final int MAX_REPORTED_DEVICES = 50;
    private static final int MAX_DEVICE_NAME = 128;
    private static final int MAX_DEVICE_DESCRIPTION = 160;
    private static final int MAX_UNAVAILABLE_REASON = 500;

    private static String truncate(String value, int max) {
        return value.length() <= max ? value : value.substring(0, max);
    }

    @Transactional
    public AgentView revoke(UUID agentId) {
        UUID tenantId = tenantContext.requireTenantId();
        PrintAgent agent = repository.findScoped(tenantId, agentId)
                .orElseThrow(() -> new ResourceNotFoundException("Print agent not found: " + agentId));
        if (!agent.isRevoked()) {
            agent.setRevokedAt(Instant.now());
        }
        log.info("print agent {} revoked", agentId);
        return view(repository.saveAndFlush(agent));
    }

    @Transactional(readOnly = true)
    public List<AgentView> list(UUID branchId) {
        UUID tenantId = tenantContext.requireTenantId();
        return repository.findForBranch(tenantId, branchId).stream().map(this::view).toList();
    }

    private AgentView view(PrintAgent a) {
        return new AgentView(a.getId(), a.getBranchId(), a.getLabel(), a.getCreatedAt(),
                a.getRevokedAt(), a.getLastSeenAt(),
                readDevices(a), a.getDevicesUnavailable(), a.getDevicesReportedAt());
    }

    /**
     * @return null when nothing has ever been reported. A corrupt stored value also reads as null
     *         and is logged: a settings screen that cannot parse a device list must say "nothing
     *         reported" rather than fail the whole agent list, because the list is also how a
     *         manager finds out an agent is offline.
     */
    private List<ReportedDevice> readDevices(PrintAgent agent) {
        String raw = agent.getDevices();
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return objectMapper.readValue(raw, new TypeReference<List<ReportedDevice>>() {});
        } catch (JsonProcessingException e) {
            log.warn("print agent {} has an unreadable stored device list: {}", agent.getId(), e.getMessage());
            return null;
        }
    }

    // ── The credential string ────────────────────────────────────────────────────────────────

    static String compose(UUID tenantId, String lookupId, String secret) {
        return PREFIX + "." + tenantId.toString().replace("-", "") + "." + lookupId + "." + secret;
    }

    /** {@code [prefix, tenantHex, lookupId, secret]}, or null if the shape is wrong. */
    private static String[] split(String credential) {
        if (credential == null || credential.isBlank()) {
            return null;
        }
        String[] parts = credential.trim().split("\\.");
        if (parts.length != 4 || !PREFIX.equals(parts[0]) || parts[1].length() != 32
                || parts[2].isEmpty() || parts[3].isEmpty()) {
            return null;
        }
        return parts;
    }

    private static UUID parseTenant(String hex32) {
        return UUID.fromString(hex32.substring(0, 8) + "-" + hex32.substring(8, 12) + "-"
                + hex32.substring(12, 16) + "-" + hex32.substring(16, 20) + "-" + hex32.substring(20));
    }

    private static String randomToken(int bytes) {
        byte[] buffer = new byte[bytes];
        RANDOM.nextBytes(buffer);
        return ENCODER.encodeToString(buffer);
    }

    /**
     * A real bcrypt hash of a value nobody holds, used only to keep the unknown-agent path as slow
     * as the wrong-secret path.
     */
    private static final String DUMMY_HASH =
            "$2a$12$C6UzMDM.H6dfI/f/IKcEe.3o8bGYlRmxCEYyPXpDPl4TFQrJ7Ohxu";
}
