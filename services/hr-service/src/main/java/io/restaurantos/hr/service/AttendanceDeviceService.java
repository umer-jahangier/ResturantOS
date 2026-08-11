package io.restaurantos.hr.service;

import io.restaurantos.hr.dto.DeviceDtos.DeviceRegistrationResponse;
import io.restaurantos.hr.dto.DeviceDtos.DeviceSetupInstructions;
import io.restaurantos.hr.dto.DeviceDtos.DeviceResponse;
import io.restaurantos.hr.dto.DeviceDtos.RegisterDeviceRequest;
import io.restaurantos.hr.entity.AttendanceDeviceEntity;
import io.restaurantos.hr.entity.AttendanceDeviceEntity.AuthMode;
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
    private final String deviceServerHost;
    private final int deviceServerPort;

    public AttendanceDeviceService(AttendanceDeviceRepository repository,
                                   TenantContext tenantContext,
                                   @Value("${restaurantos.hr.device-server-host:localhost}") String deviceServerHost,
                                   @Value("${restaurantos.hr.device-server-port:8080}") int deviceServerPort) {
        this.repository = repository;
        this.tenantContext = tenantContext;
        this.deviceServerHost = deviceServerHost;
        this.deviceServerPort = deviceServerPort;
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

        // The token is handed back ONLY for the mode that uses one. A terminal in a secret-less mode
        // has no field to type it into, and giving one anyway sends an installer looking for a field
        // that does not exist.
        boolean usesToken = device.getAuthMode() == AuthMode.TOKEN;
        return new DeviceRegistrationResponse(
                toResponse(device),
                usesToken ? plaintextToken : null,
                "http://" + deviceServerHost + ":" + deviceServerPort + "/iclock",
                setupFor(device));
    }

    /**
     * What to type into the terminal, for the mode this device is actually in.
     *
     * <p>Sourced from configuration rather than compiled in. Until 25-08 this response handed every
     * installer {@code https://REPLACE-WITH-GATEWAY-HOST/iclock}, on every deployment, beside a token
     * shown exactly once — so the one screen whose entire job is telling somebody what to type told
     * them to replace something, and the only way back was re-registering the device.
     */
    private DeviceSetupInstructions setupFor(AttendanceDeviceEntity device) {
        AuthMode mode = device.getAuthMode() == null ? AuthMode.TOKEN : device.getAuthMode();
        return switch (mode) {
            case TOKEN -> new DeviceSetupInstructions(
                    mode, deviceServerHost, deviceServerPort, null,
                    List.of("This mode needs a client that can send a token in the query string — "
                                    + "the USB bridge agent, or firmware that permits one. A stock "
                                    + "ZKTeco terminal cannot use it; choose 'Serial + network "
                                    + "address' or 'Hostname' for one of those.",
                            "Configure the bridge agent with the server address, the port, and the "
                                    + "device token shown on this screen.",
                            "The token is shown ONCE. If it is lost, rotate it rather than "
                                    + "re-registering the device."),
                    null);
            case SERIAL_ONLY_BOUNDED -> new DeviceSetupInstructions(
                    mode, deviceServerHost, deviceServerPort, null,
                    List.of("On the terminal: COMM -> Cloud Server -> Enable = ON.",
                            "Server Address = " + deviceServerHost,
                            "Server Port = " + deviceServerPort,
                            "Leave Domain Name empty. Nothing else needs to be set.",
                            "If the terminal shows as refused, open its device screen: the address it "
                                    + "is actually dialling from is displayed there, and 'allow this "
                                    + "address' adds it."),
                    "This device is trusted on its serial number plus its source address, so the "
                            + "allowlist must stay correct. If the restaurant's connection changes "
                            + "address regularly, ask the ISP for a static IP — it is a small monthly "
                            + "cost and removes this class of problem entirely.");
            case HOST_MAPPED -> new DeviceSetupInstructions(
                    mode, null, deviceServerPort, device.getSourceAddressAllowlist(),
                    List.of("On the terminal: COMM -> Cloud Server -> Enable = ON.",
                            "Domain Name = " + (device.getSourceAddressAllowlist() == null
                                    ? "(not yet set — set the device's hostname first)"
                                    : device.getSourceAddressAllowlist()),
                            "Server Port = " + deviceServerPort,
                            "Leave Server Address empty."),
                    "The hostname must resolve to this platform and must be covered by the TLS "
                            + "certificate, or the terminal will not connect.");
        };
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
