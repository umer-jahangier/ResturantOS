package io.restaurantos.shared.authz;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public record OpaInput(User user, Resource resource, String action, Environment environment) {

    public record User(UUID id, UUID tenantId, UUID branchId,
                       List<String> permissions, Map<String, Object> attributes) {}
    public record Resource(String type, UUID id, UUID tenantId, UUID branchId,
                           UUID createdBy, String status, Long amountPaisa) {}
    public record Environment(Instant time, String ip) {}

    public static Builder builder() { return new Builder(); }

    public static final class Builder {
        private User user; private Resource resource; private String action; private Environment environment;
        public Builder user(User u) { this.user = u; return this; }
        public Builder resource(Resource r) { this.resource = r; return this; }
        public Builder action(String a) { this.action = a; return this; }
        public Builder environment(Environment e) { this.environment = e; return this; }
        public OpaInput build() {
            if (user == null || resource == null || action == null)
                throw new IllegalStateException("OpaInput requires user, resource and action");
            if (environment == null) environment = new Environment(Instant.now(), null);
            return new OpaInput(user, resource, action, environment);
        }
    }
}
