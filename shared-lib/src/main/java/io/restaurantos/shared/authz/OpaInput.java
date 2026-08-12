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
     * <p>{@code anyLinePlated} is the KITCHEN question, and it is here because no other field on
     * this record can answer it. {@code status} is the order's settlement lifecycle
     * (DRAFT/OPEN/SENT_TO_KDS/CLOSED/VOIDED/REFUNDED) and stopped carrying kitchen progress when
     * pos-service retired that meaning; the POS's own {@code derivedStatus} is a SERVING
     * aggregate that collapses "being cooked" and "plated on the pass" into one value. Voiding
     * asks whether cooked food exists, so pos-service derives it from the line statuses at
     * decision time and sends it. Absent for every non-void action, none of which read it.
     *
     * <p>{@code categoryId} is the MENU CATEGORY of the item an {@code add_item} decision is about
     * (Program A). It is a fact about the ITEM, which is why it belongs here — the matching
     * allow-list is a fact about the PERSON and rides {@code User.attributes} instead, where it is
     * token-derived and cannot be asserted by a caller. pos-service sets this from the
     * {@code MenuItem} it has already resolved under a tenant predicate, never from the request
     * body. Absent for every other action, none of which read it.
     *
     * <p>Null on any of these is not zero and not false. Rego denies on a comparison against an
     * undefined value, so a caller that omits {@code amount_paid_paisa} or
     * {@code any_line_plated} is refused rather than waved through — the same fail-closed reading
     * {@code approval_gated_actions_test.rego} pins for {@code approval_limit_paisa}. That is
     * load-bearing for {@code authorization-service}, which rebuilds this record from an untrusted
     * HTTP body and cannot know the line statuses: its {@code void.own} attempts deny, and only
     * pos-service's own call can allow.
     */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record Resource(String type, UUID id, UUID tenantId, UUID branchId,
                           UUID createdBy, String status, Long amountPaisa, Long amountPaidPaisa,
                           Boolean anyLinePlated, UUID categoryId) {

        /**
         * The shape before the per-user menu-category boundary existed (Program A).
         * {@code categoryId} is null, which {@code pos.rego}'s scoped {@code add_item} rule reads
         * as deny — see the field's own note below.
         */
        public Resource(String type, UUID id, UUID tenantId, UUID branchId,
                        UUID createdBy, String status, Long amountPaisa, Long amountPaidPaisa,
                        Boolean anyLinePlated) {
            this(type, id, tenantId, branchId, createdBy, status, amountPaisa, amountPaidPaisa,
                 anyLinePlated, null);
        }

        /**
         * The void shape before the kitchen boundary existed. Retained for callers that decide
         * on money alone; {@code anyLinePlated} is null, which {@code pos.rego}'s
         * {@code void.own} reads as deny (see below).
         */
        public Resource(String type, UUID id, UUID tenantId, UUID branchId,
                        UUID createdBy, String status, Long amountPaisa, Long amountPaidPaisa) {
            this(type, id, tenantId, branchId, createdBy, status, amountPaisa, amountPaidPaisa,
                 null, null);
        }

        /**
         * The shape every call site outside the void path uses — no money has been recorded
         * against the resource as far as this decision is concerned, and no rule for those
         * actions reads it. Kept so adding {@code amountPaidPaisa} did not have to touch eleven
         * authorization services across seven microservices to say "not applicable".
         */
        public Resource(String type, UUID id, UUID tenantId, UUID branchId,
                        UUID createdBy, String status, Long amountPaisa) {
            this(type, id, tenantId, branchId, createdBy, status, amountPaisa, null, null, null);
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
