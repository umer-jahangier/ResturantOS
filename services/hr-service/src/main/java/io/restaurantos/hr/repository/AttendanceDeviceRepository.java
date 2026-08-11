package io.restaurantos.hr.repository;

import io.restaurantos.hr.entity.AttendanceDeviceEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
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

    // ── Lifecycle-aware lookups (25-03) ───────────────────────────────────────────────────────
    // Two named methods rather than one with a boolean parameter. A boolean at a call site says
    // nothing at the place a reader is standing, and an archived device appearing in a list nobody
    // expected it in is precisely the failure that costs an afternoon.

    /** The normal lookup: a device a user can still act on. */
    Optional<AttendanceDeviceEntity> findByIdAndTenantIdAndArchivedAtIsNull(UUID id, UUID tenantId);

    /** Includes archived rows. For provenance — reading which device produced a punch last month. */
    @Query("SELECT d FROM AttendanceDeviceEntity d WHERE d.id = :id AND d.tenantId = :tenantId")
    Optional<AttendanceDeviceEntity> findByIdAndTenantIdIncludingArchived(@Param("id") UUID id,
                                                                          @Param("tenantId") UUID tenantId);

    /** The normal listing: everything a user can still act on, archived rows excluded. */
    List<AttendanceDeviceEntity> findAllByTenantIdAndArchivedAtIsNullOrderByDisplayNameAsc(UUID tenantId);

    /**
     * Devices whose silence has exceeded <b>their own</b> configured interval (D-25-02).
     *
     * <p>Three things are deliberate here.
     *
     * <p><b>The comparison is in SQL.</b> The alternative is loading every device in every tenant into
     * memory on every sweep, which is a sweep that gets slower exactly as a customer grows.
     *
     * <p><b>A device never contacted at all is returned.</b> {@code last_seen_at IS NULL} is a stronger
     * fault than having fallen silent — it means the terminal was registered and never worked once —
     * and it must not be invisible for want of a timestamp to compare. It sorts first for the same
     * reason.
     *
     * <p><b>Archived and deactivated devices are excluded.</b> A terminal somebody deliberately
     * switched off must not generate a warning on every sweep forever; that is how a warning channel
     * becomes noise and then becomes muted.
     *
     * <p>Ordered so that the most overdue relative to its own cadence comes first: a device expected
     * every five minutes and silent for an hour is a worse signal than one expected daily and silent
     * for an hour, even though the second has been quiet just as long.
     */
    // The explicit CAST on :asOf is required, not decorative. A bare bind parameter reaches Postgres
    // untyped, and `:asOf - make_interval(...)` is then resolved against the wrong operator —
    // "operator does not exist: timestamp with time zone < interval", at runtime, from a query that
    // compiled and deployed cleanly.
    @Query(value = """
            SELECT * FROM attendance_devices d
             WHERE d.tenant_id = CAST(:tenantId AS uuid)
               AND d.archived_at IS NULL
               AND d.is_active = TRUE
               AND (d.last_seen_at IS NULL
                    OR d.last_seen_at < CAST(:asOf AS timestamptz)
                                        - make_interval(secs => d.expected_contact_interval_seconds))
             ORDER BY (d.last_seen_at IS NOT NULL),
                      (EXTRACT(EPOCH FROM (CAST(:asOf AS timestamptz) - d.last_seen_at))
                       / d.expected_contact_interval_seconds) DESC NULLS FIRST
            """, nativeQuery = true)
    List<AttendanceDeviceEntity> findSilentDevices(@Param("tenantId") UUID tenantId,
                                                   @Param("asOf") Instant asOf);
}
