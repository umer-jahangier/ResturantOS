package io.restaurantos.pos.domain.model;

import java.io.Serializable;
import java.time.LocalDate;
import java.util.Objects;
import java.util.UUID;

public class OrderSequenceId implements Serializable {

    private UUID tenantId;
    private UUID branchId;
    private LocalDate businessDate;

    public OrderSequenceId() {}

    public OrderSequenceId(UUID tenantId, UUID branchId, LocalDate businessDate) {
        this.tenantId = tenantId;
        this.branchId = branchId;
        this.businessDate = businessDate;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof OrderSequenceId that)) return false;
        return Objects.equals(tenantId, that.tenantId)
                && Objects.equals(branchId, that.branchId)
                && Objects.equals(businessDate, that.businessDate);
    }

    @Override
    public int hashCode() {
        return Objects.hash(tenantId, branchId, businessDate);
    }
}
