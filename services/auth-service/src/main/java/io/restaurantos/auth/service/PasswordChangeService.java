package io.restaurantos.auth.service;

import io.restaurantos.auth.entity.UserEntity;
import io.restaurantos.auth.exception.AuthenticationFailedException;
import io.restaurantos.auth.repository.UserRepository;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Self-service password change (D-15).
 *
 * <p>The audit found no endpoint anywhere in the repository by which a logged-in user could change
 * their own password. Every password-lifecycle behaviour this phase adds — forced change at login
 * (13-08), reset hardening (13-09), admin-initiated reset (13-13) — is untestable until one exists.
 *
 * <p><b>Two authorities are required, not one.</b> A valid access token establishes WHO is asking;
 * the current password establishes that they are not merely holding a stolen token. Dropping
 * either turns a leaked token or a borrowed session into a permanent account takeover, because the
 * change locks the real owner out.
 */
@Service
public class PasswordChangeService {

    private static final String EXCHANGE = "auth.topic";
    private static final String ROUTING_KEY = "auth.user.password_changed";
    private static final String EVENT_TYPE = "PASSWORD_CHANGED";

    /**
     * The message for EVERY failure of this operation that is authentication-shaped. Identical to
     * the string {@code AuthServiceImpl.login} uses, so a caller cannot tell a wrong current
     * password from a wrong login password, an unknown account or a deactivated one. Diverging from
     * it — even to be helpful — rebuilds the account-existence oracle this constant exists to
     * close, and {@code PasswordChangeIT} compares the two response bodies directly.
     */
    private static final String GENERIC_AUTH_FAILURE = "Invalid credentials";

    private final UserRepository userRepository;
    private final PasswordPolicyService passwordPolicyService;
    private final PasswordEncoder passwordEncoder;
    private final TenantContext tenantContext;
    private final EventPublisher eventPublisher;

    public PasswordChangeService(UserRepository userRepository,
                                 PasswordPolicyService passwordPolicyService,
                                 PasswordEncoder passwordEncoder,
                                 TenantContext tenantContext,
                                 EventPublisher eventPublisher) {
        this.userRepository = userRepository;
        this.passwordPolicyService = passwordPolicyService;
        this.passwordEncoder = passwordEncoder;
        this.tenantContext = tenantContext;
        this.eventPublisher = eventPublisher;
    }

    /**
     * Changes the caller's own password.
     *
     * <p>{@code userId} and {@code tenantId} come from the verified access token. Nothing in the
     * request body may reach these two parameters; see {@code ChangePasswordRequest}.
     *
     * <p>The ordering below is load-bearing and is listed rather than left to be inferred:
     * <ol>
     *   <li>tenant GUC first, so it and the row-level-security-scoped read share one connection;</li>
     *   <li>resolve the user, and treat "not found" as an authentication failure — a token whose
     *       subject has no row is not a 404 to be reported, it is a credential that is no longer
     *       good;</li>
     *   <li>verify the current password, failing with the shared generic exception;</li>
     *   <li>reject reuse — after authentication, because it costs up to six bcrypt comparisons;</li>
     *   <li>append the PREVIOUS hash to history, before it is overwritten;</li>
     *   <li>write the new hash, clear the forced-change flag and the lockout fields together;</li>
     *   <li>revoke refresh sessions, in the same transaction, so a rollback cannot leave the
     *       password changed and the old sessions alive.</li>
     * </ol>
     *
     * <p>No parameter of this method is ever logged, and neither is any local derived from one.
     */
    @Transactional
    public void changeOwnPassword(UUID tenantId, UUID userId, String currentPassword, String newPassword) {
        if (tenantId == null || userId == null) {
            // A tenant-less token (a platform token, per 13-01) has no row in auth_db's users
            // table. Refuse it here rather than letting it resolve to nothing further down.
            throw new AuthenticationFailedException(GENERIC_AUTH_FAILURE);
        }

        passwordPolicyService.setTenantGuc(tenantId);
        tenantContext.set(tenantId, null, userId, null);

        UserEntity user = userRepository.findById(userId)
            .filter(UserEntity::isActive)
            .orElseThrow(() -> new AuthenticationFailedException(GENERIC_AUTH_FAILURE));

        if (!passwordEncoder.matches(currentPassword, user.getPasswordHash())) {
            // Deliberately no failed-attempt accounting here. Incrementing failedLoginCount would
            // let anyone holding a valid access token lock its owner out of their own account by
            // submitting wrong current passwords — turning a read-only token leak into a denial of
            // service. Rate limiting for this path belongs at the gateway, where it already exists
            // for the credential routes.
            throw new AuthenticationFailedException(GENERIC_AUTH_FAILURE);
        }

        passwordPolicyService.rejectIfPasswordReused(user, newPassword);
        passwordPolicyService.appendCurrentPasswordToHistory(user);

        user.setPasswordHash(passwordEncoder.encode(newPassword));
        user.setMustChangePassword(false);
        passwordPolicyService.clearLockout(user);
        userRepository.save(user);

        passwordPolicyService.revokeActiveRefreshSessions(userId);

        // Audit trail only. Two identifiers and nothing else: no password, no hash, no token, no
        // email. The outbox envelope is persisted, replicated to consumers and retained, so a field
        // added here is a field that lives forever in several places at once.
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("userId", userId);
        payload.put("tenantId", tenantId);
        eventPublisher.publish(EXCHANGE, ROUTING_KEY, EVENT_TYPE, null, payload);
    }
}
