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

    /**
     * The branch's postal address, as the one block of plain text a human types.
     *
     * <h3>Why this is text and was jsonb</h3>
     *
     * <p>It was declared {@code jsonb} and written straight from the request body
     * ({@code branch.setAddress(req.address())}), so PostgreSQL rejected anything that was not
     * valid JSON and the driver's error surfaced to the owner as
     * <b>409 CONFLICT — "This conflicts with existing data"</b>. Measured live through the gateway
     * on 2026-08-12: {@code {"address":"12 Khayaban-e-Iqbal, F-7 Markaz, Islamabad"}} → 409;
     * {@code {"address":"Islamabad"}} → 409; {@code {"address":"\"12 Khayaban-e-Iqbal\""}} — with
     * the quote marks typed by the user — → 200 and persisted, because a bare quoted string is
     * valid JSON. The only input the field accepted was one no human would guess.
     *
     * <p><b>The column was the thing that was wrong, not the write.</b> Nothing in this product
     * produces or consumes a structured address: the DTOs declare a bare {@code String} on the way
     * in and out, {@code /app/settings} renders one plain text input labelled "Address", and
     * pos-service's receipt header turns whatever it gets into lines of text. A jsonb column was a
     * claim about a structure that no writer ever wrote and no reader ever relied on. Serialising a
     * string into a JSON string on write would have kept that claim alive — and kept the next
     * caller who writes this column through any other path one plain sentence away from the same
     * 409. Changeset 021 converts the column and flattens the handful of object-shaped rows that
     * were hand-written into it.
     *
     * <p>Deliberately NOT modelled as line1/city/postcode: that is a different product decision
     * with a different screen, and inventing it here would leave a five-field form nobody asked
     * for over a one-field API.
     */
    @Column(name = "address", columnDefinition = "TEXT")
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
