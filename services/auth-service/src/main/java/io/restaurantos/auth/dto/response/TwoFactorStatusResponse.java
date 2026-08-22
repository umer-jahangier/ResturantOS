package io.restaurantos.auth.dto.response;

/**
 * What the settings panel needs to describe the account's second factor.
 *
 * <p>Reports how many codes remain but never which, nor any part of the secret. A user who is down
 * to their last code needs to be told; nobody needs to be told what the codes are.
 */
public record TwoFactorStatusResponse(boolean enabled, long recoveryCodesRemaining) {}
