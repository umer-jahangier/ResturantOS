package io.restaurantos.hr.repository;

import io.restaurantos.hr.entity.AttendanceDeviceEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AttendanceDeviceRepository extends JpaRepository<AttendanceDeviceEntity, UUID> {

    Optional<AttendanceDeviceEntity> findByIdAndTenantId(UUID id, UUID tenantId);

    List<AttendanceDeviceEntity> findAllByTenantId(UUID tenantId);

    boolean existsBySerialNo(String serialNo);

    Optional<AttendanceDeviceEntity> findByTenantIdAndSerialNo(UUID tenantId, String serialNo);

    /**
     * Resolve a device by serial number BEFORE any tenant context exists (the device-auth path
     * carries no JWT / tenant header). Goes through the {@code resolve_device} SECURITY DEFINER
     * function so the lookup is not blocked by attendance_devices' FORCE RLS when the tenant GUC
     * is unset. Returns the full row (SETOF attendance_devices), so the encrypted device_token is
     * still decrypted by the converter. See 11-10 changelog 031-device-resolve-fn.
     */
    @Query(value = "SELECT * FROM resolve_device(:serial)", nativeQuery = true)
    Optional<AttendanceDeviceEntity> resolveBySerial(@Param("serial") String serial);
}
