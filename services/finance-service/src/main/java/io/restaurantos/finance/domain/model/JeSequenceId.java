package io.restaurantos.finance.domain.model;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

public class JeSequenceId implements Serializable {

    private UUID tenantId;
    private int fiscalYear;

    public JeSequenceId() {}

    public JeSequenceId(UUID tenantId, int fiscalYear) {
        this.tenantId = tenantId;
        this.fiscalYear = fiscalYear;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof JeSequenceId that)) return false;
        return fiscalYear == that.fiscalYear && Objects.equals(tenantId, that.tenantId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(tenantId, fiscalYear);
    }
}
