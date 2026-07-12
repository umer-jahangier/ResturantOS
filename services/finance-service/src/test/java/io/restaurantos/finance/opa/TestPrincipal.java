package io.restaurantos.finance.opa;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Mutable stand-in for the caller identity a real JWT would carry (10-08). Tests mutate this
 * bean between service calls to switch approver identity, permissions, tenant/branch, and
 * approval-limit attributes, exactly as {@code OpaBackedAuthorizationClient} reads it when it
 * builds the real {@code OpaInput} sent to the Testcontainers OPA instance.
 */
public class TestPrincipal {

    private UUID userId;
    private UUID tenantId;
    private UUID branchId;
    private List<String> permissions;
    private Map<String, Object> attributes;

    public TestPrincipal(UUID userId, UUID tenantId, UUID branchId,
                          List<String> permissions, Map<String, Object> attributes) {
        this.userId = userId;
        this.tenantId = tenantId;
        this.branchId = branchId;
        this.permissions = permissions;
        this.attributes = attributes;
    }

    public UUID userId() { return userId; }
    public UUID tenantId() { return tenantId; }
    public UUID branchId() { return branchId; }
    public List<String> permissions() { return permissions; }
    public Map<String, Object> attributes() { return attributes; }

    public void setUserId(UUID userId) { this.userId = userId; }
    public void setTenantId(UUID tenantId) { this.tenantId = tenantId; }
    public void setBranchId(UUID branchId) { this.branchId = branchId; }
    public void setPermissions(List<String> permissions) { this.permissions = permissions; }
    public void setAttributes(Map<String, Object> attributes) { this.attributes = attributes; }
}
