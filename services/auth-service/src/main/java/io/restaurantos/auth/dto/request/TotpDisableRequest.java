package io.restaurantos.auth.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/**
 * Proof of possession for turning the second factor off, or for re-issuing recovery codes.
 *
 * <p><b>Why this is not {@link TotpVerifyRequest}.</b> That record pins its code to {@code \d{6}},
 * which is right where it is used — you cannot ACTIVATE a freshly issued secret with anything but a
 * code generated from that secret, and accepting a recovery code there would let someone enrol a
 * factor they had never successfully scanned. Disabling is the opposite case: the user reaching for
 * it most urgently is the one whose authenticator is gone, and a six-digit-only field would tell
 * them to produce the very thing they lost. So this accepts either shape and lets
 * {@code TwoFactorService} decide which check to run.
 *
 * <p>The pattern is deliberately loose — it rejects obvious junk and nothing more. Whether the code
 * is real is decided by the TOTP verifier or by an atomic single-use redemption, never by
 * validation, so tightening it here would only add ways to be refused before either check runs.
 */
public record TotpDisableRequest(
    @NotBlank
    @Pattern(regexp = "[A-Za-z0-9][A-Za-z0-9 -]{4,20}", message = "Enter an authenticator code or a recovery code")
    String code
) {}
