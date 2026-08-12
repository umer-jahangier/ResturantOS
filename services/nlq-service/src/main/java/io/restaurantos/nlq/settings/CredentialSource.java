package io.restaurantos.nlq.settings;

/** Whose credential a given NLQ call actually used. Drives both the UI copy and who can fix it. */
public enum CredentialSource {

    /** The tenant's own key, from {@code nlq_tenant_ai_settings}. */
    TENANT,

    /** The platform's deploy-level key ({@code restaurantos.nlq.anthropic.api-key}). */
    PLATFORM
}
