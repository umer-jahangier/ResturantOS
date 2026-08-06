package io.restaurantos.platform;

import com.github.tomakehurst.wiremock.client.WireMock;
import io.restaurantos.platform.entity.TenantEntity.TenantStatus;
import io.restaurantos.platform.service.ProvisioningService;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Verifies the complete provisioning saga (SC3 / PLATFORM-01) and, since plan 13-10, the six
 * defects blocker B2 is made of.
 */
class ProvisioningSagaIT extends BasePlatformIT {

    @Autowired ProvisioningService provisioningService;

    /** Everything the saga now calls, all succeeding. Individual tests override one stub. */
    private void stubHappyPath(UUID adminUserId, UUID branchId, String tempPassword) {
        stubProvisioningSagaHappyPath(adminUserId, branchId, tempPassword);
    }

    @Test
    void provisionTenant_happyPath_tenantActiveWithinSixtySeconds() {
        UUID adminUserId = UUID.randomUUID();
        UUID branchId = UUID.randomUUID();
        stubHappyPath(adminUserId, branchId, "Temp#Pass123");

        long start = System.currentTimeMillis();
        var result = provisioningService.provision(
            "happy-" + UUID.randomUUID(), "IT Happy Restaurant", "admin@happy.local", "GROWTH");
        long elapsed = System.currentTimeMillis() - start;

        assertThat(elapsed).isLessThan(60_000L);
        assertThat(result.tenantId()).isNotNull();
        assertThat(result.slug()).isNotBlank();

        var tenant = tenantRepository.findById(result.tenantId()).orElseThrow();
        assertThat(tenant.getStatus()).isEqualTo(TenantStatus.ACTIVE);

        List<Map<String, Object>> features = jdbc.queryForList(
            "SELECT feature_code, is_enabled FROM tenant_features WHERE tenant_id = ?",
            result.tenantId());
        assertThat(features).isNotEmpty();

        Map<String, Object> pos = features.stream()
            .filter(f -> "FEATURE_POS".equals(f.get("feature_code"))).findFirst().orElse(null);
        assertThat(pos).isNotNull();
        assertThat(pos.get("is_enabled")).isEqualTo(Boolean.TRUE);

        Map<String, Object> multiBranch = features.stream()
            .filter(f -> "FEATURE_MULTI_BRANCH".equals(f.get("feature_code"))).findFirst().orElse(null);
        assertThat(multiBranch).isNotNull();
        assertThat(multiBranch.get("is_enabled")).isEqualTo(Boolean.TRUE);

        List<Map<String, Object>> outboxRows = jdbc.queryForList(
            "SELECT event_type FROM event_outbox WHERE tenant_id = ?", result.tenantId());
        assertThat(outboxRows).extracting(r -> r.get("event_type")).contains("TENANT_PROVISIONED");
    }

    @Test
    void provisionTenant_idempotent_replayReturnsSameTenant() {
        String idempotencyKey = "idem-" + UUID.randomUUID();
        stubHappyPath(UUID.randomUUID(), UUID.randomUUID(), "Tmp#123");

        var first = provisioningService.provision(idempotencyKey, "Idem Brand", "admin@idem.local", "STARTER");
        var second = provisioningService.provision(idempotencyKey, "Idem Brand", "admin@idem.local", "STARTER");

        assertThat(second.tenantId()).isEqualTo(first.tenantId());
        assertThat(second.slug()).isEqualTo(first.slug());

        long count = jdbc.queryForObject(
            "SELECT COUNT(*) FROM tenants WHERE id = ?", Long.class, first.tenantId());
        assertThat(count).isEqualTo(1L);
    }

    @Test
    void provisionTenant_branchFails_compensates_tenantProvisioningFailed() {
        stubHappyPath(UUID.randomUUID(), UUID.randomUUID(), "Tmp#123");
        stubUserCreateBranchFail();

        String key = "comp-" + UUID.randomUUID();

        assertThatThrownBy(() -> provisioningService.provision(
                key, "Compensation Brand", "admin@comp.local", "STARTER"))
            .isInstanceOf(ProvisioningService.ProvisioningException.class);

        var tenants = tenantRepository.findAll().stream()
            .filter(t -> "Compensation Brand".equals(t.getBrandName()))
            .toList();
        assertThat(tenants).isNotEmpty();
        assertThat(tenants.get(0).getStatus()).isEqualTo(TenantStatus.PROVISIONING_FAILED);

        List<Map<String, Object>> events = jdbc.queryForList(
            "SELECT event_type FROM event_outbox WHERE tenant_id = ?",
            tenants.get(0).getId());
        assertThat(events).extracting(r -> r.get("event_type")).doesNotContain("TENANT_PROVISIONED");
    }

    // ── 13-10 / D-06, D-07, D-09: the four silent defects ──────────────────────────────────

    /**
     * D-06. The branch id the saga carries forward must be the one user-service returned. Before
     * this plan the parse looked for {@code {"data":{"id"}}} against a producer that returns a bare
     * {@code {"branchId"}}, so it never matched and the fallback fabricated one.
     */
    @Test
    void provisionTenant_recordsTheBranchIdUserServiceReturned() {
        UUID branchId = UUID.randomUUID();
        stubHappyPath(UUID.randomUUID(), branchId, "Tmp#123");

        var result = provisioningService.provision(
            "realid-" + UUID.randomUUID(), "Real Branch Id Brand", "admin@realid.local", "STARTER");

        // The event's aggregate id — event_outbox.branch_id, which is what downstream consumers
        // correlate against — must be the real branch row, not a random UUID.
        UUID eventBranchId = jdbc.queryForObject(
            "SELECT branch_id FROM event_outbox WHERE tenant_id = ? AND event_type = 'TENANT_PROVISIONED'",
            UUID.class, result.tenantId());
        assertThat(eventBranchId).isEqualTo(branchId);
    }

    /**
     * D-07 + the request shape. The internal create request declares exactly tenantId, name and
     * isHq; the saga used to send an {@code addressLine1} the record does not declare (silently
     * dropped) and to omit {@code isHq} entirely, so the "HQ" branch was persisted isHq=false.
     */
    @Test
    void provisionTenant_branchRequest_carriesHeadquartersFlagAndNoUndeclaredField() {
        stubHappyPath(UUID.randomUUID(), UUID.randomUUID(), "Tmp#123");

        provisioningService.provision(
            "hq-" + UUID.randomUUID(), "HQ Flag Brand", "admin@hq.local", "STARTER");

        WIREMOCK.verify(1, WireMock.postRequestedFor(WireMock.urlPathEqualTo("/internal/users/branches"))
            .withRequestBody(WireMock.matchingJsonPath("$.isHq", WireMock.equalTo("true")))
            .withRequestBody(WireMock.matchingJsonPath("$.tenantId"))
            .withRequestBody(WireMock.matchingJsonPath("$.name")));

        var requests = WIREMOCK.findAll(
            WireMock.postRequestedFor(WireMock.urlPathEqualTo("/internal/users/branches")));
        assertThat(requests).hasSize(1);
        assertThat(requests.get(0).getBodyAsString()).doesNotContain("addressLine1");
    }

    /**
     * D-06's prohibition. A response with no readable branch id must abort the saga. Continuing
     * with a substitute is worse than failing: the fabricated id becomes the event's aggregate id
     * and every downstream consumer correlates against a branch that does not exist.
     */
    @Test
    void provisionTenant_unparseableBranchResponse_abortsAndMarksTenantFailed() {
        stubHappyPath(UUID.randomUUID(), UUID.randomUUID(), "Tmp#123");
        stubUserCreateBranchUnparseable();

        assertThatThrownBy(() -> provisioningService.provision(
                "noid-" + UUID.randomUUID(), "No Branch Id Brand", "admin@noid.local", "STARTER"))
            .isInstanceOf(ProvisioningService.ProvisioningException.class);

        var tenant = tenantRepository.findAll().stream()
            .filter(t -> "No Branch Id Brand".equals(t.getBrandName()))
            .findFirst().orElseThrow();
        assertThat(tenant.getStatus()).isEqualTo(TenantStatus.PROVISIONING_FAILED);

        // Nothing downstream of the branch may have run.
        WIREMOCK.verify(0, WireMock.postRequestedFor(
            WireMock.urlPathMatching("/internal/auth/tenants/.*/provision-admin")));
        List<Map<String, Object>> events = jdbc.queryForList(
            "SELECT event_type FROM event_outbox WHERE tenant_id = ?", tenant.getId());
        assertThat(events).extracting(r -> r.get("event_type")).doesNotContain("TENANT_PROVISIONED");
    }

    /**
     * D-09, half one. The guard is asserted by BEHAVIOUR at this value, because an unbound
     * {@code @Value} with a default of {@code true} is indistinguishable from a bound one until
     * somebody sets it false — which is exactly why the key mismatch survived.
     */
    @Test
    void provisionTenant_seedCoaDisabled_skipsTheSeedingCall() {
        stubHappyPath(UUID.randomUUID(), UUID.randomUUID(), "Tmp#123");
        stubFinanceSeedCoaFail();   // would abort the saga if the guard were ignored

        var result = provisioningService.provision(
            "coaoff-" + UUID.randomUUID(), "Coa Off Brand", "admin@coaoff.local", "STARTER");

        assertThat(tenantRepository.findById(result.tenantId()).orElseThrow().getStatus())
            .isEqualTo(TenantStatus.ACTIVE);
        WIREMOCK.verify(0, WireMock.postRequestedFor(
            WireMock.urlPathMatching("/internal/finance/tenants/.*/seed-coa")));
    }

    // ── 13-10 / D-04, D-05, D-08, D-10: the tenant that can actually be logged into ─────────

    /**
     * D-04 + D-05, the two writes blocker B2 is made of. Nothing in application code registered the
     * auth tenant row that login resolves by slug, and nothing wrote the OWNER assignment without
     * which PermissionResolver refuses the login outright.
     */
    @Test
    void provisionTenant_registersAuthTenantAndAssignsOwnerAtTheRealBranch() {
        UUID branchId = UUID.randomUUID();
        stubHappyPath(UUID.randomUUID(), branchId, "Tmp#123");

        var result = provisioningService.provision(
            "b2-" + UUID.randomUUID(), "B2 Closed Brand", "admin@b2.local", "STARTER");

        WIREMOCK.verify(1, WireMock.postRequestedFor(WireMock.urlPathEqualTo("/internal/auth/tenants"))
            .withRequestBody(WireMock.matchingJsonPath("$.slug", WireMock.equalTo(result.slug())))
            .withRequestBody(WireMock.matchingJsonPath("$.tenantId",
                WireMock.equalTo(result.tenantId().toString()))));

        WIREMOCK.verify(1, WireMock.postRequestedFor(WireMock.urlPathEqualTo(
                "/internal/auth/tenants/" + result.tenantId() + "/provision-admin"))
            .withRequestBody(WireMock.matchingJsonPath("$.roleCode", WireMock.equalTo("OWNER")))
            .withRequestBody(WireMock.matchingJsonPath("$.branchId", WireMock.equalTo(branchId.toString())))
            .withRequestBody(WireMock.matchingJsonPath("$.email", WireMock.equalTo("admin@b2.local"))));
    }

    /**
     * Ordering, not decoration. A slug collision must be discovered while the only thing to undo is
     * a branch — so no user may exist by the time the auth tenant is registered.
     */
    @Test
    void provisionTenant_slugCollision_failsBeforeAnyUserExists_andCompensatesTheBranch() {
        UUID branchId = UUID.randomUUID();
        stubHappyPath(UUID.randomUUID(), branchId, "Tmp#123");
        stubAuthRegisterTenantSlugConflict();

        assertThatThrownBy(() -> provisioningService.provision(
                "slug-" + UUID.randomUUID(), "Slug Collision Brand", "admin@slug.local", "STARTER"))
            .isInstanceOf(ProvisioningService.ProvisioningException.class);

        // No admin was created, so there is none to clean up...
        WIREMOCK.verify(0, WireMock.postRequestedFor(
            WireMock.urlPathMatching("/internal/auth/tenants/.*/provision-admin")));
        // ...and the branch that WAS created is gone.
        WIREMOCK.verify(1, WireMock.deleteRequestedFor(
            WireMock.urlPathEqualTo("/internal/users/branches/" + branchId)));

        var tenant = tenantRepository.findAll().stream()
            .filter(t -> "Slug Collision Brand".equals(t.getBrandName()))
            .findFirst().orElseThrow();
        assertThat(tenant.getStatus()).isEqualTo(TenantStatus.PROVISIONING_FAILED);
    }

    /** D-08: the caller receives the credential and the account it belongs to. */
    @Test
    void provisionTenant_resultCarriesTheAdminEmailAndTheTemporaryPassword() {
        stubHappyPath(UUID.randomUUID(), UUID.randomUUID(), "Handed#Over1");

        var result = provisioningService.provision(
            "cred-" + UUID.randomUUID(), "Credential Brand", "admin@cred.local", "STARTER");

        assertThat(result.adminEmail()).isEqualTo("admin@cred.local");
        assertThat(result.tempPassword()).isEqualTo("Handed#Over1");
        // The credential must not have been written into the durable idempotency record.
        String storedJson = jdbc.queryForObject(
            "SELECT response_json FROM idempotency_keys WHERE status = 'COMPLETED' "
                + "AND response_json LIKE ?", String.class, "%" + result.tenantId() + "%");
        assertThat(storedJson).doesNotContain("Handed#Over1");
        // Nor into the event payload.
        String envelope = jdbc.queryForObject(
            "SELECT envelope_json FROM event_outbox WHERE tenant_id = ?", String.class, result.tenantId());
        assertThat(envelope).doesNotContain("Handed#Over1");
    }

    /**
     * D-10's prohibition. When a compensating action itself fails, the saga must say exactly what
     * was left behind — asserted on the structured record, not by scraping a log line.
     */
    @Test
    void provisionTenant_compensationFails_recordsAStructuredManualRepairEntry() {
        UUID branchId = UUID.randomUUID();
        stubHappyPath(UUID.randomUUID(), branchId, "Tmp#123");
        stubAuthRegisterTenantSlugConflict();
        stubUserDeactivateBranchFail();

        var thrown = org.assertj.core.api.Assertions.catchThrowableOfType(
            ProvisioningService.ProvisioningException.class,
            () -> provisioningService.provision(
                "repair-" + UUID.randomUUID(), "Repair Record Brand", "admin@repair.local", "STARTER"));

        assertThat(thrown.manualRepairs())
            .extracting(ProvisioningService.ManualRepairRecord::resourceKind,
                        ProvisioningService.ManualRepairRecord::resourceId)
            .contains(org.assertj.core.groups.Tuple.tuple("branch", branchId.toString()));
        assertThat(thrown.manualRepairs().get(0).tenantId()).isNotNull();
        assertThat(thrown.manualRepairs().get(0).reason()).isNotBlank();
    }

    /** Replay must not double-create, and must hand back the same credential. */
    @Test
    void provisionTenant_replay_returnsTheSameTemporaryPasswordAndCreatesNothingNew() {
        String key = "replay-" + UUID.randomUUID();
        stubHappyPath(UUID.randomUUID(), UUID.randomUUID(), "Replayed#1");

        var first = provisioningService.provision(key, "Replay Brand", "admin@replay.local", "STARTER");
        var second = provisioningService.provision(key, "Replay Brand", "admin@replay.local", "STARTER");

        assertThat(second.tempPassword()).isEqualTo(first.tempPassword()).isEqualTo("Replayed#1");
        assertThat(second.adminEmail()).isEqualTo("admin@replay.local");
        assertThat(second.tenantId()).isEqualTo(first.tenantId());

        // Nothing downstream ran a second time.
        WIREMOCK.verify(1, WireMock.postRequestedFor(
            WireMock.urlPathMatching("/internal/auth/tenants/.*/provision-admin")));
        WIREMOCK.verify(1, WireMock.postRequestedFor(WireMock.urlPathEqualTo("/internal/users/branches")));
        WIREMOCK.verify(1, WireMock.postRequestedFor(WireMock.urlPathEqualTo("/internal/auth/tenants")));
        long branches = jdbc.queryForObject(
            "SELECT COUNT(*) FROM tenants WHERE brand_name = 'Replay Brand'", Long.class);
        assertThat(branches).isEqualTo(1L);
    }

    /**
     * seed-coa must be flipped to true for these scenarios, but the outer class's default
     * (application-test.yml: restaurantos.provisioning.seed-coa.enabled=false) must stay off for
     * the other tests in this file. A dedicated @Nested class with its own @TestPropertySource
     * gets its own Spring context (property override), without disturbing the outer tests.
     */
    @Nested
    @TestPropertySource(properties = "restaurantos.provisioning.seed-coa.enabled=true")
    class FinanceSeedFailureTests {

        @Autowired ProvisioningService provisioningService;

        /**
         * D-10, the forced mid-saga failure. Finance is made to fail at step 6 — after the branch,
         * the auth tenant and the admin all exist — so every one of the three compensating actions
         * has to be issued for real. This is the test that would have failed against the previous
         * {@code log.warn} stubs, which is the point: a saga that "compensates" without a test that
         * induced the failure is a saga whose compensation has never run.
         */
        @Test
        void provisionTenant_financeSeedFails_compensatesAdminAuthTenantAndBranch() {
            UUID branchId = UUID.randomUUID();
            UUID adminUserId = UUID.randomUUID();
            stubHappyPath(adminUserId, branchId, "Tmp#123");
            stubFinanceSeedCoaFail();

            String key = "finfail-" + UUID.randomUUID();

            assertThatThrownBy(() -> provisioningService.provision(
                    key, "Finance Fail Brand", "admin@finfail.local", "STARTER"))
                .isInstanceOf(ProvisioningService.ProvisioningException.class);

            var tenants = tenantRepository.findAll().stream()
                .filter(t -> "Finance Fail Brand".equals(t.getBrandName()))
                .toList();
            assertThat(tenants).isNotEmpty();
            assertThat(tenants.get(0).getStatus()).isEqualTo(TenantStatus.PROVISIONING_FAILED);

            // 1. the admin's only branch-role is revoked — the account can no longer resolve
            //    permissions, which is what "deactivated" means for a login.
            WIREMOCK.verify(1, WireMock.deleteRequestedFor(
                    WireMock.urlPathEqualTo("/internal/auth/users/" + adminUserId + "/branch-roles"))
                .withQueryParam("branchId", WireMock.equalTo(branchId.toString()))
                .withQueryParam("roleCode", WireMock.equalTo("OWNER"))
                .withHeader("X-Tenant-Id", WireMock.equalTo(tenants.get(0).getId().toString())));
            // 2. the auth tenant row is marked non-loginable
            WIREMOCK.verify(1, WireMock.patchRequestedFor(WireMock.urlPathEqualTo(
                    "/internal/auth/tenants/" + tenants.get(0).getId() + "/status"))
                .withRequestBody(WireMock.matchingJsonPath("$.status",
                    WireMock.equalTo("PROVISIONING_FAILED"))));
            // 3. the branch is deactivated
            WIREMOCK.verify(1, WireMock.deleteRequestedFor(
                    WireMock.urlPathEqualTo("/internal/users/branches/" + branchId))
                .withHeader("X-Tenant-Id", WireMock.equalTo(tenants.get(0).getId().toString())));
            // ...and the feature rows are gone.
            long features = jdbc.queryForObject(
                "SELECT COUNT(*) FROM tenant_features WHERE tenant_id = ?", Long.class,
                tenants.get(0).getId());
            assertThat(features).isZero();
        }

        /** D-09, half two: the same property at the other value demonstrably performs the call. */
        @Test
        void provisionTenant_seedCoaEnabled_performsTheSeedingCall() {
            UUID branchId = UUID.randomUUID();
            stubHappyPath(UUID.randomUUID(), branchId, "Tmp#123");
            stubFinanceSeedCoaAnyTenant();

            var result = provisioningService.provision(
                "coaon-" + UUID.randomUUID(), "Coa On Brand", "admin@coaon.local", "STARTER");

            assertThat(tenantRepository.findById(result.tenantId()).orElseThrow().getStatus())
                .isEqualTo(TenantStatus.ACTIVE);
            WIREMOCK.verify(1, WireMock.postRequestedFor(
                WireMock.urlPathEqualTo("/internal/finance/tenants/" + result.tenantId() + "/seed-coa")));
        }
    }
}
