package io.restaurantos.user.entity;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDate;
import java.util.UUID;

@Entity
@Table(name = "branches")
@Getter
@Setter
public class BranchEntity extends TenantAuditableEntity {

    @Id
    @Column(name = "id", columnDefinition = "uuid default gen_random_uuid()")
    private UUID id;

    @Column(name = "name", nullable = false, length = 150)
    private String name;

    @Column(name = "is_hq", nullable = false)
    private boolean isHq;

    @Column(name = "is_active", nullable = false)
    private boolean isActive = true;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "address", columnDefinition = "jsonb")
    private String address;

    @Column(name = "fbr_strn", length = 50)
    private String fbrStrn;

    @Column(name = "ntn", length = 50)
    private String ntn;

    @Column(name = "phone", length = 30)
    private String phone;

    @Column(name = "email", length = 255)
    private String email;

    @Column(name = "timezone", nullable = false, length = 64)
    private String timezone = "Asia/Karachi";

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "currency_config", columnDefinition = "jsonb")
    private String currencyConfig;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "receipt_config", columnDefinition = "jsonb")
    private String receiptConfig;

    @Column(name = "opened_on")
    private LocalDate openedOn;
}
