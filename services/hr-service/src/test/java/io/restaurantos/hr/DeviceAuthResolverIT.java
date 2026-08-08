package io.restaurantos.hr;

import io.restaurantos.hr.adms.DeviceAuthException;
import io.restaurantos.hr.adms.DeviceAuthResolver;
import io.restaurantos.hr.dto.DeviceDtos.DeviceRegistrationResponse;
import io.restaurantos.hr.dto.DeviceDtos.RegisterDeviceRequest;
import io.restaurantos.hr.entity.AttendanceDeviceEntity;
import io.restaurantos.hr.entity.AttendanceDeviceEntity.ConnectionMode;
import io.restaurantos.hr.service.AttendanceDeviceService;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Proves the device-auth boundary: a valid serial+token resolves tenant/branch from the registry;
 * unknown serial, inactive device, and wrong token are all rejected; and a rejected request leaves
 * no tenant context behind.
 */
class DeviceAuthResolverIT extends HrTestBase {

    @Autowired DeviceAuthResolver deviceAuthResolver;
    @Autowired AttendanceDeviceService deviceService;
    @Autowired TenantContext tenantContext;

    private String registerDevice(String serial, UUID tenant, UUID branch, boolean deactivate) {
        tenantContext.set(tenant, branch, null, null);
        try {
            DeviceRegistrationResponse reg =
                    deviceService.register(new RegisterDeviceRequest(serial, "ZKTeco", ConnectionMode.NETWORK_ADMS));
            if (deactivate) {
                deviceService.deactivate(reg.device().id());
            }
            return reg.deviceToken();
        } finally {
            tenantContext.clear();
        }
    }

    @Test
    void resolve_validSerialAndToken_bindsTenantBranch_fromRegistry() {
        UUID tenant = UUID.randomUUID();
        UUID branch = UUID.randomUUID();
        String serial = "SN-" + UUID.randomUUID();
        String token = registerDevice(serial, tenant, branch, false);
        try {
            AttendanceDeviceEntity device = deviceAuthResolver.resolve(serial, token);
            assertThat(device.getSerialNo()).isEqualTo(serial);
            assertThat(tenantContext.getTenantId()).contains(tenant);
            assertThat(tenantContext.getBranchId()).contains(branch);
        } finally {
            tenantContext.clear();
        }
    }

    @Test
    void resolve_wrongToken_rejected_noContextLeak() {
        UUID tenant = UUID.randomUUID();
        String serial = "SN-" + UUID.randomUUID();
        registerDevice(serial, tenant, UUID.randomUUID(), false);
        assertThatThrownBy(() -> deviceAuthResolver.resolve(serial, "not-the-token"))
                .isInstanceOf(DeviceAuthException.class);
        assertThat(tenantContext.getTenantId()).isEmpty();
    }

    @Test
    void resolve_unknownSerial_rejected() {
        assertThatThrownBy(() -> deviceAuthResolver.resolve("SN-nonexistent", "anything"))
                .isInstanceOf(DeviceAuthException.class);
    }

    @Test
    void resolve_inactiveDevice_rejected() {
        UUID tenant = UUID.randomUUID();
        String serial = "SN-" + UUID.randomUUID();
        String token = registerDevice(serial, tenant, UUID.randomUUID(), true);
        assertThatThrownBy(() -> deviceAuthResolver.resolve(serial, token))
                .isInstanceOf(DeviceAuthException.class);
    }
}
