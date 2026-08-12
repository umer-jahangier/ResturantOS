package io.restaurantos.shared.authz;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record OpaInput(User user, Resource resource, String action, Environment environment) {

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record User(UUID id, UUID tenantId, UUID branchId,
                       List<String> permissions, Map<String, Object> attributes) {}

    /**
     * The resource a decision is about.
     *
     * <p>{@code amountPaisa} is the amount an action MOVES — the refund rule compares it against
     * the caller's {@code approval_limit_paisa}. {@code amountPaidPaisa} is the money already
     * RECORDED against the resource, which is a different question and now has its own field:
     * {@code pos.rego}'s {@code void.own} rule refuses a void once any tender exists, because a
     * void writes no reversing entry. Overloading the one field across the two meanings is how a
     * rule comes to read a number that means something else.
     *
     * <p>Null on either field is not zero. Rego denies on a comparison against an undefined value,
     * so a caller that omits {@code amountPaidPaisa} is refused rather than waved through — the
     * same fail-closed reading {@code approval_gated_actions_test.rego} pins for
     * {@code approval_limit_paisa}.
     */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record Resource(String type, UUID id, UUID tenantId, UUID branchId,
                           UUID createdBy, String status, Long amountPaisa, Long amountPaidPaisa) {

        /**
         * The shape every call site outside the void path uses — no money has been recorded
         * against the resource as far as this decision is concerned, and no rule for those
         * actions reads it. Kept so adding {@code amountPaidPaisa} did not have to touch eleven
         * authorization services across seven microservices to say "not applicable".
         */
        public Resource(String type, UUID id, UUID tenantId, UUID branchId,
                        UUID createdBy, String status, Long amountPaisa) {
            this(type, id, tenantId, branchId, createdBy, status, amountPaisa, null);
        }
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
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
