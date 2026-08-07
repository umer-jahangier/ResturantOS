package io.restaurantos.auth.service;

import io.restaurantos.auth.client.PlatformCredentialClient;
import io.restaurantos.auth.entity.UserEntity;
import io.restaurantos.auth.repository.UserRepository;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * Answers "which account did this credential authenticate against?" when the caller supplied no
 * tenant slug — the whole of the email-first login.
 *
 * <h2>The one invariant this class exists to hold</h2>
 *
 * <p><b>Nothing about an account is disclosed before its password has been verified.</b>
 *
 * <p>The obvious way to build a unified login is to look up which tenants hold the address, present
 * them, and then ask for the password. That is an account-enumeration oracle with a form around it:
 * anyone could type an address and learn whether it exists and where, with no credential at all,
 * and for a multi-tenant restaurant platform "which groups does this person work for" is itself the
 * disclosure. So the order here is inverted and non-negotiable:
 *
 * <ol>
 *   <li>gather candidates — an INTERNAL lookup that reaches no response;</li>
 *   <li>compare the password against each candidate;</li>
 *   <li>only then decide what, if anything, to name.</li>
 * </ol>
 *
 * <p>{@link Resolution#matches()} therefore contains only tenants where the bcrypt comparison
 * SUCCEEDED. A tenant that holds the address under a different password is not in the list and is
 * not counted; from outside it is indistinguishable from a tenant that never heard of the address.
 *
 * <h2>Why the failure accounting is here and not skipped</h2>
 *
 * <p>The tenant login increments {@code users.failed_login_count} and locks at five. A unified
 * endpoint that resolved without touching that counter would be a brute-force bypass: an attacker
 * would simply stop sending a slug and guess forever. So every candidate whose comparison fails
 * takes exactly the accounting {@link AuthServiceImpl#handleFailedPassword} applies, through the
 * same method, and publishes the same failed-login event.
 *
 * <p>The uncomfortable consequence, recorded rather than hidden: one unified attempt against an
 * address held in three tenants costs one failure in each. That is correct — the attempt really was
 * against all three — but it means a persistent attacker can lock accounts they cannot enter. That
 * was already true of the slug-bearing endpoint, one tenant at a time, and the gateway rate limit
 * is the brake on doing it at scale.
 *
 * <h2>Timing</h2>
 *
 * <p>Every path performs at least one cost-12 bcrypt comparison — against a real hash where a
 * candidate exists, against {@link AuthServiceImpl#DUMMY_HASH} where none does — so "no account
 * anywhere" does not return in microseconds while "wrong password" takes ~250ms.
 *
 * <p><b>The residual, stated plainly:</b> an address held in three tenants costs three comparisons
 * and one held in one costs one, so the WALL TIME of a refusal still correlates with how many
 * tenants hold the address. Closing that completely would mean padding every attempt to a fixed
 * candidate count, which multiplies the cost of every honest login by that constant and hands an
 * unauthenticated endpoint a fixed, expensive amount of work to demand. It is bounded instead:
 * {@link #MAX_CANDIDATES} caps the comparisons, and the count it leaks is a small integer, not an
 * identity — an observer learns "this address may be held in more than one place", never which.
 */
@Service
public class LoginIdentityResolver {

    private static final Logger log = LoggerFactory.getLogger(LoginIdentityResolver.class);

    /**
     * The ceiling on bcrypt comparisons one unified attempt may cost.
     *
     * <p>At cost 12 each comparison is ~250ms, so this bounds an unauthenticated request to roughly
     * two seconds of CPU. Without a cap, an address deliberately registered across many tenants
     * would be a denial-of-service amplifier reachable with no credential — every attempt costing
     * the server N hashes for one cheap request.
     *
     * <p>Eight is chosen against the real shape of the data: a human with accounts in more than a
     * handful of restaurant groups is already outside what the chooser can usefully present. If a
     * genuine account sits beyond the cap it is not silently locked out — it still logs in through
     * the slug-bearing path, which the subdomain and {@code ?tenant=} hint both take.
     */
    static final int MAX_CANDIDATES = 8;

    private final EntityManager entityManager;
    private final UserRepository userRepository;
    private final TenantContext tenantContext;
    private final PasswordEncoder passwordEncoder;
    private final PlatformCredentialClient platformCredentialClient;

    public LoginIdentityResolver(EntityManager entityManager,
                                 UserRepository userRepository,
                                 TenantContext tenantContext,
                                 PasswordEncoder passwordEncoder,
                                 PlatformCredentialClient platformCredentialClient) {
        this.entityManager = entityManager;
        this.userRepository = userRepository;
        this.tenantContext = tenantContext;
        this.passwordEncoder = passwordEncoder;
        this.platformCredentialClient = platformCredentialClient;
    }

    /**
     * Verify the credential against every account that could hold it, and report only what matched.
     *
     * @param onFailedTenantPassword invoked for each tenant candidate whose password did NOT match,
     *                               so the caller can apply its own lockout accounting without this
     *                               class reaching into the user repository's write path
     */
    public Resolution resolve(String email, String password, String ip,
                              FailedPasswordSink onFailedTenantPassword) {
        String normalized = email == null ? "" : email.trim().toLowerCase(Locale.ROOT);

        List<Candidate> candidates = findCandidates(normalized);
        List<TenantMatch> matches = new ArrayList<>();
        boolean anyLockedMatch = false;

        for (Candidate candidate : candidates) {
            UserEntity user = loadWithTenantScope(candidate);
            if (user == null) {
                // The candidate row vanished between the lookup and the read, or the RLS-scoped
                // re-read did not see it. Either way it is not an account we can authenticate.
                continue;
            }

            boolean locked = user.getLockedUntil() != null && user.getLockedUntil().isAfter(Instant.now());

            // The comparison runs even for a locked account, and that is deliberate. It costs the
            // same time either way (so lock state is not a timing oracle), and it is what lets the
            // caller distinguish "locked" from "wrong password" for someone who ALREADY KNOWS the
            // password — which is the same rule refuseDeactivatedAccount follows: a state may only
            // be revealed to a caller who has proven the credential.
            boolean ok = passwordEncoder.matches(password, user.getPasswordHash());

            if (!ok) {
                onFailedTenantPassword.accept(user, candidate.tenantId(), normalized, ip);
                continue;
            }
            if (locked) {
                anyLockedMatch = true;
                continue;
            }
            matches.add(new TenantMatch(candidate.tenantId(), candidate.slug(), candidate.name()));
        }

        if (candidates.isEmpty()) {
            // No real hash to compare against. Burn one anyway so an address held nowhere does not
            // return measurably faster than one held somewhere under a different password.
            passwordEncoder.matches(password, AuthServiceImpl.DUMMY_HASH);
        }

        PlatformCredentialClient.Verdict platform =
            platformCredentialClient.verify(normalized, password, ip);

        Resolution resolution = new Resolution(matches, platform, anyLockedMatch);
        log.info("[unified-login] resolved email={} candidates={} tenantMatches={} platformMatch={} "
                + "lockedMatch={} source={}",
            normalized, candidates.size(), matches.size(), platform.matched(), anyLockedMatch, ip);
        return resolution;
    }

    /**
     * The control-plane half on its own, for the second leg of a chooser where the human picked the
     * platform console. Re-verifies from scratch; a selection is not a credential.
     */
    public PlatformCredentialClient.Verdict verifyPlatformOnly(String email, String password, String ip) {
        String normalized = email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
        return platformCredentialClient.verify(normalized, password, ip);
    }

    // --- Candidate lookup ---------------------------------------------------------------------

    /**
     * The cross-tenant lookup, through the SECURITY DEFINER function changeset 081 installs.
     *
     * <p>A plain JPQL query cannot do this: {@code users} is {@code FORCE ROW LEVEL SECURITY} and
     * {@code auth_user} is {@code NOBYPASSRLS}, so without {@code app.current_tenant_id} set the
     * table reads as empty — and there is no single tenant to set it to, which is the entire
     * problem. See the changeset's comment for why a narrow function beats standing the policy down.
     */
    private List<Candidate> findCandidates(String normalizedEmail) {
        if (normalizedEmail.isEmpty()) {
            return List.of();
        }
        @SuppressWarnings("unchecked")
        List<Tuple> rows = entityManager
            .createNativeQuery(
                "SELECT user_id, tenant_id, tenant_slug, tenant_name "
                    + "FROM auth_lookup_login_candidates(:email)", Tuple.class)
            .setParameter("email", normalizedEmail)
            .setMaxResults(MAX_CANDIDATES)
            .getResultList();

        List<Candidate> out = new ArrayList<>(rows.size());
        for (Tuple row : rows) {
            out.add(new Candidate(
                (UUID) row.get(0),
                (UUID) row.get(1),
                (String) row.get(2),
                (String) row.get(3)));
        }
        return out;
    }

    /**
     * Re-read the candidate through ordinary, RLS-scoped JPA.
     *
     * <p>The lookup function bypasses the policy; this read does not. Every subsequent check —
     * lockout, password, {@code is_active}, {@code must_change_password}, the TOTP secret — is then
     * made against a row that the normal tenant-scoped path would also have seen, so the unified
     * login cannot authenticate anything the slug-bearing login would have refused.
     */
    private UserEntity loadWithTenantScope(Candidate candidate) {
        setTenantGuc(candidate.tenantId());
        tenantContext.set(candidate.tenantId(), null, null, null);
        return userRepository.findById(candidate.userId()).orElse(null);
    }

    private void setTenantGuc(UUID tenantId) {
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
            .setParameter("tid", tenantId.toString())
            .getSingleResult();
    }

    // --- Types --------------------------------------------------------------------------------

    /** Applied to every tenant candidate whose password comparison failed. */
    @FunctionalInterface
    public interface FailedPasswordSink {
        void accept(UserEntity user, UUID tenantId, String email, String ip);
    }

    private record Candidate(UUID userId, UUID tenantId, String slug, String name) {}

    /** A tenant whose stored hash the submitted password ACTUALLY matched. Nothing weaker. */
    public record TenantMatch(UUID tenantId, String slug, String name) {}

    /**
     * @param matches       tenants where the password verified — possibly empty, never speculative
     * @param platform      the control-plane verdict
     * @param lockedMatch   true when the password matched an account that is currently locked out.
     *                      Only ever consulted when there is nothing else to do, so a lock is
     *                      reported to someone who knows the password and to nobody else.
     */
    public record Resolution(List<TenantMatch> matches,
                             PlatformCredentialClient.Verdict platform,
                             boolean lockedMatch) {

        public int total() {
            return matches.size() + (platform.matched() ? 1 : 0);
        }

        public boolean isEmpty() {
            return total() == 0;
        }

        /** True when exactly one identity matched and it is the platform one. */
        public boolean isSolePlatform() {
            return platform.matched() && matches.isEmpty();
        }

        /** True when exactly one identity matched and it is a tenant. */
        public boolean isSoleTenant() {
            return !platform.matched() && matches.size() == 1;
        }
    }
}
