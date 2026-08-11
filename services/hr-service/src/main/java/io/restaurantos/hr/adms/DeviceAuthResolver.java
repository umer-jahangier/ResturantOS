package io.restaurantos.hr.adms;

import io.restaurantos.hr.entity.AttendanceDeviceEntity;
import io.restaurantos.hr.repository.AttendanceDeviceRepository;
import io.restaurantos.hr.service.AttendanceDeviceService;
import io.restaurantos.shared.exception.FeatureDisabledException;
import io.restaurantos.shared.feature.FeatureFlagService;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;

/**
 * The real authentication boundary for the device-authenticated ingest path. Punches arrive with
 * NO user JWT, so this resolves the device by serial + presented token and derives tenant/branch
 * from the {@code attendance_devices} registry — never from client input.
 *
 * <p>Structurally mirrors {@code TenantAwareMessageProcessor}: it sets the tenant GUC transaction-
 * locally on the already-open connection before touching an RLS-protected row. Tenant context is
 * bound only AFTER every check passes, so a rejected request never leaks context; callers on the
 * ingest path MUST still clear {@link TenantContext} in a finally block (pooled threads).
 */
@Component
public class DeviceAuthResolver {

    private final AttendanceDeviceRepository repository;
    private final AttendanceDeviceService deviceService;
    private final TenantContext tenantContext;
    private final DeviceAuthFailureRecorder failureRecorder;
    private final DeviceCredentialPolicy credentialPolicy;
    private final DeviceRefusalRecorder refusalRecorder;
    private final FeatureFlagService featureFlagService;

    @PersistenceContext
    private EntityManager entityManager;

    public DeviceAuthResolver(AttendanceDeviceRepository repository,
                              AttendanceDeviceService deviceService,
                              TenantContext tenantContext,
                              DeviceAuthFailureRecorder failureRecorder,
                              DeviceCredentialPolicy credentialPolicy,
                              DeviceRefusalRecorder refusalRecorder,
                              FeatureFlagService featureFlagService) {
        this.repository = repository;
        this.deviceService = deviceService;
        this.tenantContext = tenantContext;
        this.failureRecorder = failureRecorder;
        this.credentialPolicy = credentialPolicy;
        this.refusalRecorder = refusalRecorder;
        this.featureFlagService = featureFlagService;
    }

    @Transactional
    public AttendanceDeviceEntity resolve(String serial, String presentedToken) {
        // The ordering below is unchanged and must stay that way: resolve, then check active, then
        // compare the token in constant time, and only THEN bind tenant context. 25-04 adds nothing
        // but a recording call at each refusal — the recorder is bounded and publishes in its own
        // transaction, because this one is about to roll back.
        AttendanceDeviceEntity device = repository.resolveBySerial(serial).orElse(null);
        if (device == null) {
            failureRecorder.record(serial, DeviceAuthFailureRecorder.Cause.UNKNOWN_SERIAL, null);
            throw new DeviceAuthException("Unknown device serial");
        }
        if (!device.isActive()) {
            failureRecorder.record(serial, DeviceAuthFailureRecorder.Cause.INACTIVE_DEVICE, device.getTenantId());
            throw new DeviceAuthException("Device is inactive");
        }
        if (device.getArchivedAt() != null) {
            failureRecorder.record(serial, DeviceAuthFailureRecorder.Cause.ARCHIVED_DEVICE, device.getTenantId());
            throw new DeviceAuthException("Device is archived");
        }
        // 25-08 substitutes the credential POLICY for the direct token check, inside this ordering
        // rather than around it. For a TOKEN device the policy delegates to the same constant-time
        // comparison as before, so that path is unchanged. Every other mode is refused with the same
        // exception and the same recorder, so no mode is distinguishable from outside.
        DeviceCredentialPolicy.Decision decision = credentialPolicy.evaluate(device, presentedToken);
        if (!decision.permitted()) {
            if (decision.observedSourceAddress() != null) {
                // 25-AUTH-MODES.md's added constraint: record the address it was actually refused
                // FROM, so a restaurant whose public IP changed can fix it from the device screen
                // instead of raising a support call about attendance nobody can reconstruct.
                refusalRecorder.recordObservedSourceAddress(
                        device.getId(), device.getTenantId(), decision.observedSourceAddress());
            }
            failureRecorder.record(serial, decision.reason(), device.getTenantId());
            throw new DeviceAuthException("Device credential refused");
        }

        // Only now bind tenant/branch from the registry (so failures above never leak context) and
        // set the GUC transaction-locally so the RLS-protected last_seen update below is permitted.
        tenantContext.set(device.getTenantId(), device.getBranchId(), null, null);
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
                .setParameter("tid", device.getTenantId().toString())
                .getSingleResult();

        // 25-08: the FEATURE_HR gate, enforced HERE because here is the first moment a tenant exists
        // on this path. The gateway maps /iclock/ to FEATURE_HR and cannot ever act on it:
        // FeatureFlagGlobalFilter reads the tenant from X-Tenant-Id and passes straight through when
        // it is absent, which on a device request it always is - a terminal carries no JWT and no
        // tenant header, which is the whole reason JwtGlobalFilter exempts this path. So the mapping
        // was decorative and a tenant with HR switched off kept ingesting attendance.
        //
        // Placed after the bind and before the last-seen write, so a disabled tenant writes no row.
        if (!featureFlagService.isEnabled(device.getTenantId(), "FEATURE_HR")) {
            throw new FeatureDisabledException("FEATURE_HR");
        }

        device.setLastSeenAt(Instant.now());
        repository.save(device);
        return device;
    }
}
