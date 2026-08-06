package io.restaurantos.auth.config;

import io.restaurantos.auth.config.PasswordResetDeliveryProperties.Mode;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The delivery switch's own contract: what an unconfigured deployment gets, and what an operator is
 * told at boot.
 *
 * <p>The startup warning is a real requirement rather than politeness. Self-service reset is off by
 * default (D-31), so without it the first thing that tells anyone is a user complaining that the
 * email never arrived — which is indistinguishable from a broken SMTP configuration and sends the
 * investigation somewhere else entirely.
 */
class PasswordResetDeliveryPropertiesTest {

    @Test
    @DisplayName("an unconfigured deployment is DISABLED with a fifteen-minute cooldown")
    void defaults_areClosed() {
        PasswordResetDeliveryProperties properties = new PasswordResetDeliveryProperties(null, null);

        assertThat(properties.deliveryMode()).isEqualTo(Mode.DISABLED);
        assertThat(properties.cooldown()).isEqualTo(Duration.ofMinutes(15));
        assertThat(properties.deliveryEnabled()).isFalse();
    }

    @Test
    @DisplayName("the startup warning names the exact property an operator has to change")
    void startupWarning_namesTheProperty() {
        String warning = new PasswordResetDeliveryProperties(Mode.DISABLED, null)
            .startupWarning().orElseThrow();

        assertThat(warning).contains(PasswordResetDeliveryProperties.MODE_PROPERTY);
        assertThat(warning).contains("outbox");
        // A warning that says "disabled" and stops leaves the reader to guess what IS supported.
        assertThat(warning).containsIgnoringCase("administrator");
    }

    @Test
    @DisplayName("no warning when delivery is on — a boot-time warning nobody can act on trains people to ignore warnings")
    void startupWarning_isSilentWhenEnabled() {
        assertThat(new PasswordResetDeliveryProperties(Mode.OUTBOX, null).startupWarning()).isEmpty();
        assertThat(new PasswordResetDeliveryProperties(Mode.OUTBOX, null).deliveryEnabled()).isTrue();
    }

    @Test
    @DisplayName("an explicit cooldown wins over the default")
    void cooldown_isOverridable() {
        assertThat(new PasswordResetDeliveryProperties(Mode.OUTBOX, Duration.ofMinutes(3)).cooldown())
            .isEqualTo(Duration.ofMinutes(3));
    }
}
