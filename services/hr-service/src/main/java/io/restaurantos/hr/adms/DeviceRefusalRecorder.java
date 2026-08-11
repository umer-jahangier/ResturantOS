package io.restaurantos.hr.adms;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.UUID;

/**
 * Writes the source address a device was actually refused from onto that device's own row.
 *
 * <h2>Why this exists — the one constraint 25-AUTH-MODES.md adds beyond the plan</h2>
 *
 * <p>The stated failure mode of {@code SERIAL_ONLY_BOUNDED} is "a branch with a dynamic address needs
 * its allowlist maintained, and a wrong allowlist is a silently offline terminal". <b>Silently</b> is
 * the whole problem. A restaurant on a domestic connection <em>will</em> have its public address
 * change, and without this the symptom is "the clock stopped working" with nothing anywhere in the
 * product that says why: a support call, on a weekend, about attendance data nobody can reconstruct.
 *
 * <p>Recording the observed address turns that into a visible, self-service fix — the device screen
 * shows the address the terminal is actually dialling from, beside a one-click "allow this address".
 *
 * <h2>The information-disclosure objection, and why it trades correctly</h2>
 *
 * <p>Someone who knows a serial can write their own IP address into an admin's device screen. They
 * cannot read anything, cannot authenticate, and the address they inject is their own. Against a
 * support burden that would otherwise land on every dynamic-IP customer, that trades correctly. It is
 * bounded by the per-device rate limit and by {@link DeviceAuthFailureRecorder}'s suppression, so it
 * is also not a write amplifier: a device polling every three seconds updates one row per refusal,
 * and the row is a fixed size.
 *
 * <h2>Why {@code REQUIRES_NEW}</h2>
 *
 * <p>Identical to {@link DeviceAuthFailureEventPublisher}: the caller is about to throw, and
 * {@code DeviceAuthResolver.resolve} is transactional, so a write on the caller's transaction rolls
 * back with the refusal that caused it — leaving the device screen showing nothing, which is exactly
 * the silence this class exists to remove.
 *
 * <p>The update is a targeted native statement rather than an entity save, and it sets the tenant GUC
 * itself. {@code attendance_devices} is under FORCE row-level security keyed on
 * {@code app.current_tenant_id}, and at this point no tenant is bound — the resolver binds context
 * only after every check passes, and this runs precisely because one failed. Without the GUC the
 * statement would match <b>zero rows and report success</b>, which is the same silently-does-nothing
 * shape this class exists to eliminate.
 *
 * <p>The GUC is set with {@code is_local = true}, on this transaction only, exactly as
 * {@code DeviceAuthResolver} does on its own. The tenant comes from the registry row already resolved
 * by serial — never from client input. It writes two columns of one device, so it cannot be used to
 * discover or alter anything else.
 */
@Component
public class DeviceRefusalRecorder {

    @PersistenceContext
    private EntityManager entityManager;

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordObservedSourceAddress(UUID deviceId, UUID tenantId, String observedAddress) {
        if (deviceId == null || tenantId == null || observedAddress == null || observedAddress.isBlank()) {
            return;
        }
        // FORCE RLS: without this the UPDATE matches nothing and reports success. See the javadoc.
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
                .setParameter("tid", tenantId.toString())
                .getSingleResult();
        entityManager.createNativeQuery(
                        "UPDATE attendance_devices SET last_refused_source_address = :addr, last_refused_at = :at "
                                + "WHERE id = CAST(:id AS uuid)")
                .setParameter("addr", truncate(observedAddress))
                .setParameter("at", Instant.now())
                .setParameter("id", deviceId.toString())
                .executeUpdate();
    }

    /**
     * The address is attacker-influenced text arriving on a public path, so it is bounded before it is
     * stored. 64 characters is longer than any IPv6 literal with a zone identifier and short enough
     * that the column cannot be used to park data.
     */
    private static String truncate(String address) {
        String trimmed = address.trim();
        return trimmed.length() > 64 ? trimmed.substring(0, 64) : trimmed;
    }
}
