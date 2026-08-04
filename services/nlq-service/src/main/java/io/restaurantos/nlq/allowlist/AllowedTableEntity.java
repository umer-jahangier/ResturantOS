package io.restaurantos.nlq.allowlist;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;

import java.io.Serializable;
import java.util.Objects;

/**
 * A single (role_code, table_name) grant row in {@code nlq_allowed_tables}.
 *
 * <p>This is a PLATFORM-level table (role-keyed, not tenant-keyed) — no {@code tenant_id} column,
 * no RLS. See {@code V1__nlq_schema.sql} for the rationale.
 */
@Entity
@Table(name = "nlq_allowed_tables")
@IdClass(AllowedTableEntity.Key.class)
public class AllowedTableEntity {

    @Id
    private String roleCode;

    @Id
    private String tableName;

    protected AllowedTableEntity() {
        // JPA
    }

    public AllowedTableEntity(String roleCode, String tableName) {
        this.roleCode = roleCode;
        this.tableName = tableName;
    }

    public String getRoleCode() {
        return roleCode;
    }

    public String getTableName() {
        return tableName;
    }

    public static final class Key implements Serializable {
        private String roleCode;
        private String tableName;

        public Key() {
        }

        public Key(String roleCode, String tableName) {
            this.roleCode = roleCode;
            this.tableName = tableName;
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) {
                return true;
            }
            if (!(o instanceof Key key)) {
                return false;
            }
            return Objects.equals(roleCode, key.roleCode) && Objects.equals(tableName, key.tableName);
        }

        @Override
        public int hashCode() {
            return Objects.hash(roleCode, tableName);
        }
    }
}
