package io.restaurantos.auth.service;

import io.restaurantos.auth.dto.response.TotpSetupResponse;
import io.restaurantos.auth.dto.response.TwoFactorStatusResponse;
import io.restaurantos.auth.entity.UserEntity;
import io.restaurantos.auth.exception.AuthenticationFailedException;
import io.restaurantos.auth.exception.TotpAlreadyEnrolledException;
import io.restaurantos.auth.repository.UserRepository;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.persistence.EntityManager;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class TwoFactorService {

    private final UserRepository userRepository;
    private final TotpService totpService;
    private final TenantContext tenantContext;
    private final EntityManager entityManager;
    private final RecoveryCodeService recoveryCodeService;

    public TwoFactorService(UserRepository userRepository,
                            TotpService totpService,
                            TenantContext tenantContext,
                            EntityManager entityManager,
                            RecoveryCodeService recoveryCodeService) {
        this.userRepository = userRepository;
        this.totpService = totpService;
        this.tenantContext = tenantContext;
        this.entityManager = entityManager;
        this.recoveryCodeService = recoveryCodeService;
    }

    /**
     * Issues a secret for a signed-in user, and — when one already exists — demands a live code
     * from the CURRENT authenticator before re-pointing it.
     *
     * <h3>Why the argument exists (an adversarial review found this route wide open)</h3>
     *
     * This method used to take nothing and check nothing. Every sibling proves possession —
     * {@link #bootstrap} refuses once a secret exists, {@link #disable} calls
     * {@link #proveSecondFactor}, {@link #regenerateRecoveryCodes} demands a live TOTP code — and
     * this one re-pointed a live second factor on nothing but a bearer token. Two things followed,
     * both of which defeat the point of the feature:
     *
     * <ul>
     *   <li><b>Recovery codes laundered into a takeover.</b> Redeem one at login (which grants
     *       {@code totp_verified}), call {@code /2fa/setup} with no code at all, then
     *       {@code /2fa/verify} with a code from an authenticator you control. {@link #verify}
     *       regenerates the recovery-code set against the secret you just planted. That is exactly
     *       the outcome {@link #regenerateRecoveryCodes} pins its {@code \d{6}} rule to prevent,
     *       reached by a different door — so the rule was decorative while this route existed.</li>
     *   <li><b>Silent factor removal.</b> {@code setTotpEnabled(false)} is the whole of what
     *       {@code requiresTotpStepUp} tests for a user who holds none of the three gated
     *       permissions. One call reverted such an account to password-only, which is precisely
     *       the end state {@link #disable} demands a code for.</li>
     * </ul>
     *
     * <p>The check is against the CURRENT secret and accepts a TOTP code only — deliberately NOT
     * {@link #proveSecondFactor}, because honouring a recovery code here would re-open the first
     * bullet. The lost-phone route is unaffected: {@link #disable} still takes a recovery code,
     * nulls the secret and revokes the pool, after which this method needs nothing.
     */
    @Transactional
    public TotpSetupResponse setup(String currentCode) {
        UserEntity user = loadCurrentUser();
        if (user.getTotpSecret() != null
            && !totpService.verify(user.getTotpSecret(), currentCode)) {
            throw new AuthenticationFailedException("Invalid TOTP code");
        }
        String secret = totpService.generateSecret();
        user.setTotpSecret(secret);
        user.setTotpEnabled(false);
        userRepository.save(user);
        return new TotpSetupResponse(totpService.otpauthUri(secret, user.getEmail()));
    }

    /**
     * Activates a secret issued by {@link #setup()} and hands back a fresh set of recovery codes.
     *
     * <p>The codes are issued HERE rather than at {@code setup()} because activation is the first
     * moment the user can actually be locked out. Issuing them alongside the secret would print a
     * list of codes for an enrolment that may never complete, and the user would file them away
     * believing they were covered.
     */
    @Transactional
    public List<String> verify(String code) {
        UserEntity user = loadCurrentUser();
        if (user.getTotpSecret() == null || !totpService.verify(user.getTotpSecret(), code)) {
            throw new AuthenticationFailedException("Invalid TOTP code");
        }
        user.setTotpEnabled(true);
        userRepository.save(user);
        return recoveryCodeService.regenerate(user.getId(), tenantContext.requireTenantId());
    }

    /**
     * Issues a TOTP secret to a user who is required to use one but has never enrolled, proving
     * identity with the password rather than a bearer token.
     *
     * <p>{@code AuthServiceImpl.enforceTotpStepUp} demands a code from anyone holding
     * {@code rbac.manage} or {@code finance.period.close} — whether or not they ever enrolled — and
     * {@code /2fa/setup} needs a session to reach. A freshly provisioned OWNER therefore held both
     * halves of a deadlock: no token without a code, no code without a token, and no way to enrol.
     * That is not a theoretical state; two of the three seeded tenant owners were in it.
     *
     * <p>This is the only enrolment path that does not need a session, so it is deliberately
     * narrow: it refuses outright once a secret exists. Re-enrolment stays behind
     * {@link #setup()}, where a live token is required — otherwise a stolen password would be
     * enough to re-point someone's second factor, and the second factor would be worth nothing.
     */
    @Transactional
    public TotpSetupResponse bootstrap(UserEntity user) {
        if (user.getTotpSecret() != null) {
            throw new TotpAlreadyEnrolledException("Two-factor authentication is already set up");
        }
        String secret = totpService.generateSecret();
        user.setTotpSecret(secret);
        user.setTotpEnabled(false);
        userRepository.save(user);
        return new TotpSetupResponse(totpService.otpauthUri(secret, user.getEmail()));
    }

    /**
     * Activates a secret issued by {@link #bootstrap}, again on the strength of the password, and
     * returns the recovery codes for it.
     *
     * <p>This path matters more than {@link #verify} does. Bootstrap exists for the owner of a
     * freshly provisioned tenant — the only account there is — so a lost phone afterwards would
     * leave a restaurant with no way into its own product and nobody able to help. These codes are
     * that restaurant's way back.
     */
    @Transactional
    public List<String> bootstrapVerify(UserEntity user, String code) {
        if (user.getTotpSecret() == null || !totpService.verify(user.getTotpSecret(), code)) {
            throw new AuthenticationFailedException("Invalid TOTP code");
        }
        user.setTotpEnabled(true);
        userRepository.save(user);
        return recoveryCodeService.regenerate(user.getId(), tenantContext.requireTenantId());
    }

    /**
     * Turns the second factor off, accepting either a live TOTP code or a recovery code.
     *
     * <p>Accepting a recovery code here is what makes "lost my phone" recoverable rather than
     * merely survivable: sign in with a code, disable, then re-enrol against the new device. Without
     * it a user could get INTO the product with a recovery code and still be unable to repair the
     * account, because every remaining route demanded the authenticator they no longer had.
     *
     * <p>The codes are revoked with the secret. They authorise nothing once there is no second
     * factor, and leaving ten live credentials behind on an account that no longer has 2FA is a
     * quiet way to end up worse off than before enrolling.
     */
    @Transactional
    public void disable(String code) {
        UserEntity user = loadCurrentUser();
        if (user.getTotpSecret() == null || !proveSecondFactor(user, code)) {
            throw new AuthenticationFailedException("Invalid TOTP code");
        }
        user.setTotpSecret(null);
        user.setTotpEnabled(false);
        userRepository.save(user);
        recoveryCodeService.revokeAll(user.getId());
    }

    /**
     * Re-issues the whole set, invalidating every previous code.
     *
     * <p>Requires a LIVE authenticator code, not a recovery code. Regeneration is the action that
     * decides what the account's fallbacks will be for the next year, and permitting it on the
     * strength of a recovery code would let anyone holding one printed list quietly replace it with
     * a list only they hold — locking out the legitimate user with their own feature.
     */
    @Transactional
    public List<String> regenerateRecoveryCodes(String totpCode) {
        UserEntity user = loadCurrentUser();
        if (!user.isTotpEnabled()
            || user.getTotpSecret() == null
            || !totpService.verify(user.getTotpSecret(), totpCode)) {
            throw new AuthenticationFailedException("Invalid TOTP code");
        }
        return recoveryCodeService.regenerate(user.getId(), tenantContext.requireTenantId());
    }

    /**
     * Reports the true state, including codes that outlive a half-finished re-enrolment.
     *
     * <p>This used to answer {@code 0} whenever {@code totpEnabled} was false, which was a lie with
     * consequences rather than a rounding: {@link RecoveryCodeService#redeem} does not consult
     * {@code totpEnabled}, so codes stay redeemable through {@link #disable} while the flag is
     * down. A user who began re-enrolment and walked away was shown "no recovery codes" over ten
     * live ones. Report what is actually in the table.
     */
    @Transactional(readOnly = true)
    public TwoFactorStatusResponse status() {
        UserEntity user = loadCurrentUser();
        return new TwoFactorStatusResponse(
            user.isTotpEnabled(), recoveryCodeService.remaining(user.getId()));
    }

    /**
     * True if {@code code} is either a valid TOTP code or an unused recovery code. A recovery code
     * is SPENT by this call when it matches, so it must not be called speculatively.
     */
    private boolean proveSecondFactor(UserEntity user, String code) {
        if (RecoveryCodeService.looksLikeRecoveryCode(code)) {
            return recoveryCodeService.redeem(user.getId(), code);
        }
        return totpService.verify(user.getTotpSecret(), code);
    }

    private UserEntity loadCurrentUser() {
        UUID userId = currentUserId();
        return userRepository.findById(userId)
            .orElseThrow(() -> new AuthenticationFailedException("User not found"));
    }

    private UUID currentUserId() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof JwtClaims claims)) {
            throw new AuthenticationFailedException("Not authenticated");
        }
        tenantContext.set(claims.tenantId(), claims.branchId(), claims.subject(), claims.impersonatedBy());
        if (claims.tenantId() != null) {
            entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
                .setParameter("tid", claims.tenantId().toString())
                .getSingleResult();
        }
        return claims.subject();
    }
}
