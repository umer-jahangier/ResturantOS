package io.restaurantos.hr.service;

import io.restaurantos.hr.dto.DeviceDtos.DeviceRegistrationResponse;
import io.restaurantos.hr.dto.DeviceDtos.DeviceResponse;
import io.restaurantos.hr.dto.DeviceDtos.RegisterDeviceRequest;
import io.restaurantos.hr.entity.AttendanceDeviceEntity;
import io.restaurantos.hr.repository.AttendanceDeviceRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

/**
 * Device registry management (HR-07). A Tenant Admin registers a device by serial and receives a
 * device token ONCE; the token is stored AES-256-GCM encrypted. tenant/branch come from
 * {@link TenantContext}, never the request.
 */
@Service
public class AttendanceDeviceService {

    private static final SecureRandom RANDOM = new SecureRandom();

    private final AttendanceDeviceRepository repository;
    private final TenantContext tenantContext;
    private final String deviceServerUrl;

    public AttendanceDeviceService(AttendanceDeviceRepository repository,
                                   TenantContext tenantContext,
                                   @Value("${restaurantos.hr.device-server-url:https://REPLACE-WITH-GATEWAY-HOST/iclock}") String deviceServerUrl) {
        this.repository = repository;
        this.tenantContext = tenantContext;
        this.deviceServerUrl = deviceServerUrl;
    }

    @Transactional
    public DeviceRegistrationResponse register(RegisterDeviceRequest req) {
        UUID tenantId = tenantContext.getTenantId()
                .orElseThrow(() -> new IllegalStateException("No tenant context"));
        UUID branchId = tenantContext.getBranchId()
                .orElseThrow(() -> new IllegalStateException("No branch context"));
        if (repository.existsBySerialNo(req.serialNo())) {
            throw new IllegalStateException("Device serial already registered: " + req.serialNo());
        }
        String plaintextToken = generateToken();

        AttendanceDeviceEntity device = new AttendanceDeviceEntity();
        device.setTenantId(tenantId);
        device.setBranchId(branchId);
        device.setSerialNo(req.serialNo());
        device.setModel(req.model());
        device.setConnectionMode(req.connectionMode());
        device.setDeviceToken(plaintextToken); // converter encrypts on write
        device.setActive(true);
        device = repository.save(device);

        return new DeviceRegistrationResponse(toResponse(device), plaintextToken, deviceServerUrl);
    }

    @Transactional(readOnly = true)
    public List<DeviceResponse> list() {
        UUID tenantId = tenantContext.getTenantId()
                .orElseThrow(() -> new IllegalStateException("No tenant context"));
        return repository.findAllByTenantId(tenantId).stream().map(AttendanceDeviceService::toResponse).toList();
    }

    @Transactional
    public void deactivate(UUID id) {
        UUID tenantId = tenantContext.getTenantId()
                .orElseThrow(() -> new IllegalStateException("No tenant context"));
        AttendanceDeviceEntity device = repository.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new IllegalArgumentException("Device not found: " + id));
        device.setActive(false);
        repository.save(device);
    }

    /** Constant-time comparison of a presented token against a device's stored (decrypted) token. */
    public boolean verifyToken(AttendanceDeviceEntity device, String presentedToken) {
        if (presentedToken == null || device.getDeviceToken() == null) {
            return false;
        }
        return MessageDigest.isEqual(
                device.getDeviceToken().getBytes(StandardCharsets.UTF_8),
                presentedToken.getBytes(StandardCharsets.UTF_8));
    }

    private static String generateToken() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static DeviceResponse toResponse(AttendanceDeviceEntity d) {
        return new DeviceResponse(d.getId(), d.getSerialNo(), d.getModel(), d.getConnectionMode(),
                d.getBranchId(), d.isActive(), d.getLastSeenAt());
    }
}
