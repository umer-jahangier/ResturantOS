package io.restaurantos.nlq.settings;

/**
 * What we actually know about the tenant's stored key — as opposed to what we would like to
 * assume about it.
 *
 * <p>The tri-state exists because "saved" and "works" are different facts and conflating them is a
 * lie in one direction or a blocked customer in the other. If the provider is down when an owner
 * pastes a key, refusing the save blocks a legitimate key; saving it and reporting success claims
 * something unverified. {@link #UNVERIFIED} is the honest third answer, and the settings screen
 * renders it as such.
 */
public enum KeyState {

    /** No tenant key stored. The platform's deploy key is in use. */
    UNSET,

    /** Stored, but the save-time probe could not reach the provider. We have not proven it works. */
    UNVERIFIED,

    /** The provider accepted it. */
    VERIFIED,

    /**
     * The provider refused it (401/403).
     *
     * <p>Written from a {@code REQUIRES_NEW} transaction when a live query is rejected, so it
     * survives the rollback of the failing request. Without that, the row would roll back with the
     * query and the settings screen would keep reporting VERIFIED forever — a self-inflicted
     * instance of exactly the "reads correctly, never runs" defect this work exists to remove.
     */
    REJECTED
}
