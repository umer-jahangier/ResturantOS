package io.restaurantos.pos.service;

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

    public PrintAgentEnrolmentService(PrintAgentRepository repository,
                                      PasswordEncoder passwordEncoder,
                                      TenantContext tenantContext) {
        this.repository = repository;
        this.passwordEncoder = passwordEncoder;
        this.tenantContext = tenantContext;
    }

    /**
     * @param secret the ONLY time this value exists outside the client. Never persisted, never
     *               logged, never returned again.
     */
    public record Enrolled(UUID agentId, String label, Instant createdAt, String secret) {}

    /** Metadata only. There is deliberately no field here that could hold a secret or a hash. */
    public record AgentView(UUID agentId, UUID branchId, String label, Instant createdAt,
                            Instant revokedAt, Instant lastSeenAt) {
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

    @Transactional
    public void recordSeen(UUID agentId) {
        UUID tenantId = tenantContext.requireTenantId();
        repository.findScoped(tenantId, agentId).ifPresent(a -> a.setLastSeenAt(Instant.now()));
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
        return repository.findForBranch(tenantId, branchId).stream().map(PrintAgentEnrolmentService::view).toList();
    }

    private static AgentView view(PrintAgent a) {
        return new AgentView(a.getId(), a.getBranchId(), a.getLabel(), a.getCreatedAt(),
                a.getRevokedAt(), a.getLastSeenAt());
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
