package io.restaurantos.auth.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;
import java.util.Optional;

/**
 * Whether self-service password reset can deliver anything, and how often one account may ask.
 *
 * <p><b>Why this switch exists (D-31).</b> {@code notification-service} is an active Maven module
 * with <i>zero source files</i>. Nothing consumes {@code PASSWORD_RESET_REQUESTED}, so before this
 * plan the forgot-password endpoint answered 200, minted a live credential, wrote an event nobody
 * read, and the user waited for an email that was never going to arrive. 13-CONTEXT was explicit
 * that this phase must not leave a flow that silently does nothing, and offered two ways out:
 * implement a minimal consumer, or declare email out of scope and say so.
 *
 * <p><b>The second was taken, and the reason is worth keeping.</b> A real consumer means an SMTP or
 * provider integration, per-tenant sender configuration, bounce handling and a template story —
 * none of it in this phase's scope, all of it capable of consuming the budget the three actual
 * blockers need. A fake one — accept a message, log it, drop it — is strictly WORSE than the status
 * quo, because it makes a dead flow look alive to everyone who reads the code afterwards. So the
 * flow is switched off by default and the endpoint says which recovery route does work.
 * {@code Docs/known-gaps/notification-delivery.md} records this as a named gap rather than burying
 * it in a commit message, so the next phase can pick it up deliberately.
 *
 * <p><b>{@code OUTBOX} mode must still be correct.</b> It is not dead code kept warm: plan 13-13's
 * administrator-initiated reset reuses the same issuance path, and the day someone writes the
 * delivery consumer this is the mode they will turn on. The redaction, the cooldown and the
 * single-live-token rule therefore all land in full regardless of which mode is configured.
 *
 * @param deliveryMode {@code disabled} (default) or {@code outbox}
 * @param cooldown     the minimum interval between two token issuances for ONE account; fifteen
 *                     minutes by default, which is half the reset token's own thirty-minute life,
 *                     so a user who genuinely lost the first message can ask again while the first
 *                     token is still theoretically live rather than being told nothing twice
 */
@ConfigurationProperties(prefix = "restaurantos.auth.password-reset")
public record PasswordResetDeliveryProperties(Mode deliveryMode, Duration cooldown) {

    /** Spelled out so the startup warning can name the exact key an operator has to change. */
    public static final String MODE_PROPERTY = "restaurantos.auth.password-reset.delivery-mode";

    private static final Duration DEFAULT_COOLDOWN = Duration.ofMinutes(15);

    public enum Mode {
        /**
         * The request endpoint issues nothing, writes nothing, and returns a deterministic,
         * account-independent response naming the administrator-initiated route.
         */
        DISABLED,

        /**
         * The request endpoint issues a token and emits {@code PASSWORD_RESET_REQUESTED} carrying
         * identity plus the token's row handle. Turn this on only once something consumes that
         * event; on its own it changes nothing a user can see.
         */
        OUTBOX
    }

    /**
     * Defaults applied here rather than in the yaml alone.
     *
     * <p>The yaml carries them too, for an operator reading the file — but a missing or misspelled
     * key must not produce {@code null} and a {@code NullPointerException} at the first reset
     * request, and it must certainly not produce an ENABLED flow by accident. Fail closed: absent
     * configuration means disabled.
     */
    public PasswordResetDeliveryProperties {
        deliveryMode = deliveryMode == null ? Mode.DISABLED : deliveryMode;
        cooldown = cooldown == null ? DEFAULT_COOLDOWN : cooldown;
    }

    public boolean deliveryEnabled() {
        return deliveryMode == Mode.OUTBOX;
    }

    /**
     * What to log at boot, if anything.
     *
     * <p>An operator who expects password-reset emails must be told by the service starting up, not
     * by a user complaint weeks later — a silently disabled flow is indistinguishable from a broken
     * SMTP configuration, and sends the investigation somewhere else entirely. The message names
     * the property, the value that turns it on, and what users should be told to do meanwhile.
     *
     * <p>Empty when delivery is on: a boot-time warning nobody can act on is how people learn to
     * scroll past warnings.
     */
    public Optional<String> startupWarning() {
        if (deliveryEnabled()) {
            return Optional.empty();
        }
        return Optional.of(
            "Self-service password reset is DISABLED: no reset token will be issued and no "
            + "notification will be emitted. Set " + MODE_PROPERTY + "=outbox to enable it, and "
            + "only once something consumes PASSWORD_RESET_REQUESTED. Until then the supported "
            + "recovery paths are an administrator-initiated reset and, for a user who can still "
            + "log in, POST /api/v1/auth/change-password. See "
            + "Docs/known-gaps/notification-delivery.md.");
    }
}
