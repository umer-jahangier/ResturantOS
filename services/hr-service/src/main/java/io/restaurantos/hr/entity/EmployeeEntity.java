package io.restaurantos.hr.entity;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import io.restaurantos.shared.security.EncryptedStringConverter;
import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Employee master. {@code cnic} and {@code bankAccountNo} are field-encrypted (AES-256-GCM) into
 * {@code bytea} columns via {@link EncryptedStringConverter}; the plaintext never touches the DB
 * and must never be logged. tenant_id + audit columns come from {@link TenantAuditableEntity}.
 */
@Entity
@Table(name = "employees")
@Getter
@Setter
public class EmployeeEntity extends TenantAuditableEntity {

    public enum EmploymentType { PERMANENT, PART_TIME, DAILY_WAGE, CONTRACT }

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;

    @Column(name = "user_id")
    private UUID userId;

    @Column(name = "employee_no", nullable = false)
    private String employeeNo;

    @Column(name = "full_name", nullable = false)
    private String fullName;

    @Convert(converter = EncryptedStringConverter.class)
    @Column(name = "cnic", columnDefinition = "bytea")
    private String cnic;

    @Convert(converter = EncryptedStringConverter.class)
    @Column(name = "bank_account_no", columnDefinition = "bytea")
    private String bankAccountNo;

    /**
     * Foreign keys, not strings (35-05).
     *
     * <p>These were {@code department TEXT} and {@code designation TEXT}, which is how one
     * department came to exist under three spellings. Nullable because an employee genuinely may
     * have neither, and because the 015 backfill leaves a blank old value null rather than
     * inventing a placeholder.
     */
    @Column(name = "department_id")
    private UUID departmentId;

    @Column(name = "designation_id")
    private UUID designationId;

    @Enumerated(EnumType.STRING)
    @Column(name = "employment_type", nullable = false)
    private EmploymentType employmentType;

    @Column(name = "join_date", nullable = false)
    private LocalDate joinDate;

    @Column(name = "exit_date")
    private LocalDate exitDate;

    @Column(name = "basic_salary_paisa", nullable = false)
    private long basicSalaryPaisa;

    /** Durable biometric-device PIN → employee mapping key (consumed by 11-11 punch ingest). Not sensitive. */
    @Column(name = "device_user_ref")
    private String deviceUserRef;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;
}
