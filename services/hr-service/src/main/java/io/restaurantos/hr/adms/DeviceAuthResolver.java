package io.restaurantos.hr.adms;

import io.restaurantos.hr.entity.AttendanceDeviceEntity;
import io.restaurantos.hr.repository.AttendanceDeviceRepository;
import io.restaurantos.hr.service.AttendanceDeviceService;
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

    @PersistenceContext
    private EntityManager entityManager;

    public DeviceAuthResolver(AttendanceDeviceRepository repository,
                              AttendanceDeviceService deviceService,
                              TenantContext tenantContext) {
        this.repository = repository;
        this.deviceService = deviceService;
        this.tenantContext = tenantContext;
    }

    @Transactional
    public AttendanceDeviceEntity resolve(String serial, String presentedToken) {
        AttendanceDeviceEntity device = repository.resolveBySerial(serial)
                .orElseThrow(() -> new DeviceAuthException("Unknown device serial"));
        if (!device.isActive()) {
            throw new DeviceAuthException("Device is inactive");
        }
        if (!deviceService.verifyToken(device, presentedToken)) {
            throw new DeviceAuthException("Invalid device token");
        }

        // Only now bind tenant/branch from the registry (so failures above never leak context) and
        // set the GUC transaction-locally so the RLS-protected last_seen update below is permitted.
        tenantContext.set(device.getTenantId(), device.getBranchId(), null, null);
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
                .setParameter("tid", device.getTenantId().toString())
                .getSingleResult();

        device.setLastSeenAt(Instant.now());
        repository.save(device);
        return device;
    }
}
