package io.restaurantos.nlq.settings;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * PUT body for {@code /api/v1/nlq/settings/ai}.
 *
 * <p>{@code apiKey} travels in one direction only. It is accepted here and never returned by
 * anything — see {@link AiSettingsView}.
 *
 * <p>No {@code toString()} is generated for a record... actually one is, which is why this record
 * overrides it. An unhandled-exception log, a validation failure, or a debugger frame that
 * interpolates the request object would otherwise print the key.
 *
 * <p>The length bound is a sanity limit, not a format check. Validating the shape of a provider
 * token client-side ages badly — Anthropic has already changed its prefix once — and the
 * authoritative check is the save-time probe, which asks the provider itself.
 */
public record UpdateAiSettingsRequest(

        @NotBlank(message = "provider is required")
        String provider,

        @NotBlank(message = "apiKey is required")
        @Size(min = 8, max = 512, message = "apiKey length is out of range")
        String apiKey) {

    @Override
    public String toString() {
        return "UpdateAiSettingsRequest[provider=" + provider + ", apiKey=***]";
    }
}
