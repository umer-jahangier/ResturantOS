package io.restaurantos.platform.subscription;

import io.restaurantos.platform.config.TierLimits;
import io.restaurantos.platform.entity.SubscriptionPlanEntity.BillingPeriod;
import io.restaurantos.platform.entity.TenantEntity.TierType;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The four seeded plans must grant EXACTLY what their tier already grants.
 *
 * <h3>The defect this exists to catch</h3>
 *
 * <p>Plans are a new way to move a tenant's entitlement, and {@code TierLimits} is the old one. They
 * now both write the same four columns on the tenant row. If a seeded plan's ceilings drift from its
 * tier's — someone raises GROWTH's branch cap in {@code TierLimits.forTier} and does not touch the
 * changelog, or edits the changelog and not the code — then a GROWTH tenant provisioned through the
 * saga and a GROWTH tenant moved by assigning {@code growth-monthly} end up with <b>different
 * numbers</b>, and nothing fails. There is no runtime symptom until an operator compares two tenants
 * on the same plan and finds one of them capped lower.
 *
 * <p>That is the identical failure mode {@code TierLimits}' own javadoc describes as the reason the
 * table was extracted out of {@code ProvisioningService} in the first place. Adding a second table
 * in XML and not guarding it would reintroduce it one layer down.
 *
 * <h3>What is deliberately NOT asserted: the prices</h3>
 *
 * <p>No price for this product exists anywhere in the repository — no price table, no currency field
 * on any platform table, no processor integration
 * (.planning/superadmin/CAPABILITY-MAP.md §1.3). The seeded prices are placeholders an operator is
 * expected to replace. Asserting them against a number invented here would only lock in the
 * invention; the test asserts they are ZERO — the marker for "unset" — so that a real price arriving
 * in the changelog is a deliberate act and not a silent one. It does not, and cannot, assert that
 * any price is CORRECT.
 *
 * <p>Reads the changelog off disk rather than starting a database, for the same reason
 * {@code FeatureCodeClosureTest} reads the gateway's source: it makes this a fast unit test that
 * needs no container, and it fails on the branch that introduces the drift.
 */
class SeededPlanTierConsistencyTest {

    private static final Path CHANGELOG = Path.of(
        "src/main/resources/db/changelog/v1.0.0/050-subscription-plans-and-subscriptions.xml");

    /** {@code <column name="x" value="y"/>} and {@code valueNumeric="y"} alike. */
    private static final Pattern COLUMN = Pattern.compile(
        "<column\\s+name=\"([a-z_]+)\"\\s+(?:value|valueNumeric)=\"([^\"]*)\"\\s*/>");

    private static final Pattern INSERT_BLOCK = Pattern.compile(
        "<insert\\s+tableName=\"subscription_plans\">(.*?)</insert>", Pattern.DOTALL);

    private final TierLimits tierLimits = new TierLimits();

    @Test
    void everySeededPlanGrantsExactlyItsTiersLimits() throws IOException {
        List<Map<String, String>> plans = seededPlans();

        assertThat(plans)
            .as("the changelog seeds the four tier-aligned plans; a regex that stopped matching "
                + "would otherwise make this whole test vacuously green")
            .hasSize(4);

        for (Map<String, String> plan : plans) {
            String code = plan.get("code");
            TierType tier = TierType.valueOf(plan.get("tier"));
            TierLimits.Limits expected = tierLimits.forTier(tier);

            assertThat(Integer.parseInt(plan.get("max_branches")))
                .as("plan '%s' branch ceiling must equal TierLimits.forTier(%s) — two tables that "
                    + "write the same tenant column and disagree is a divergence nothing detects "
                    + "at runtime", code, tier)
                .isEqualTo(expected.maxBranches());
            assertThat(Integer.parseInt(plan.get("max_users")))
                .as("plan '%s' user ceiling must equal TierLimits.forTier(%s)", code, tier)
                .isEqualTo(expected.maxUsers());
            assertThat(Integer.parseInt(plan.get("storage_gb")))
                .as("plan '%s' storage ceiling must equal TierLimits.forTier(%s)", code, tier)
                .isEqualTo(expected.storageGb());
            assertThat(Integer.parseInt(plan.get("nlq_quota")))
                .as("plan '%s' NLQ quota must equal TierLimits.forTier(%s)", code, tier)
                .isEqualTo(expected.nlqQuota());
        }
    }

    @Test
    void everySeededPlanNamesATierAndBillingPeriodTheCodeCanResolve() throws IOException {
        for (Map<String, String> plan : seededPlans()) {
            String code = plan.get("code");
            // A tier the enum does not know would be accepted by the CHECK constraint's own
            // vocabulary only by coincidence and would then blow up at read time, inside
            // TierFeatureDefaults.defaultsFor, on a screen rather than at startup.
            assertThat(TierType.valueOf(plan.get("tier")))
                .as("plan '%s' names a tier TierType can resolve", code)
                .isNotNull();
            assertThat(BillingPeriod.valueOf(plan.get("billing_period")))
                .as("plan '%s' names a billing period BillingPeriod can resolve — an unresolvable "
                    + "one makes every renewal date on that plan uncomputable", code)
                .isNotNull();
        }
    }

    @Test
    void seededPricesAreZeroBecauseNoRealPriceExistsAnywhereInThisProduct() throws IOException {
        for (Map<String, String> plan : seededPlans()) {
            assertThat(Long.parseLong(plan.getOrDefault("price_paisa", "0")))
                .as("plan '%s': the seeded price must stay 0 — the marker for UNSET. This product "
                    + "has no billing integration and no price exists anywhere in the repository, "
                    + "so a non-zero placeholder here is a number an operator might believe. A real "
                    + "price is set through PATCH /api/v1/platform/plans/{code}, deliberately.",
                    plan.get("code"))
                .isZero();
            assertThat(plan.get("currency"))
                .as("plan '%s' must state a currency; money with no unit is the bug that outlives "
                    + "every rename", plan.get("code"))
                .isNotBlank()
                .hasSize(3);
        }
    }

    @Test
    void theChangelogSeedsNoSubscriptionForAnyExistingTenant() throws IOException {
        String xml = Files.readString(CHANGELOG, StandardCharsets.UTF_8);
        assertThat(xml)
            .as("no tenant_subscriptions row may be seeded or backfilled. Every tenant in "
                + "platform_db has a tier and NONE has ever had a subscription; writing one would "
                + "assert a plan, a price and a start date that no human agreed to. A tenant with "
                + "no subscription reads back as exactly that, which is true.")
            .doesNotContain("<insert tableName=\"tenant_subscriptions\">")
            .doesNotContain("INSERT INTO tenant_subscriptions");
    }

    @Test
    void theHistoryTableIsProtectedByTriggersAndNotOnlyByGrants() throws IOException {
        String xml = Files.readString(CHANGELOG, StandardCharsets.UTF_8);
        // Changeset 040 measured that a REVOKE in platform_db is INERT: platform_user inherits
        // platform_admin through pg_auth_members, so the runtime role holds owner privileges and a
        // grant-based control changes the catalogue and nothing else. Only a trigger fires for the
        // owner, an inheriting member, and Liquibase.
        assertThat(xml)
            .as("subscription_history must be protected by triggers; a grant-based control here is "
                + "inert (see changeset 040's measurement)")
            .contains("trg_subscription_history_immutable")
            .contains("trg_subscription_history_no_truncate");
    }

    /** Parses the {@code <insert>} blocks of changeset 050-006 into column maps. */
    private static List<Map<String, String>> seededPlans() throws IOException {
        String xml = Files.readString(CHANGELOG, StandardCharsets.UTF_8);
        List<Map<String, String>> plans = new ArrayList<>();
        Matcher blocks = INSERT_BLOCK.matcher(xml);
        while (blocks.find()) {
            Map<String, String> columns = new LinkedHashMap<>();
            Matcher cols = COLUMN.matcher(blocks.group(1));
            while (cols.find()) {
                columns.put(cols.group(1), cols.group(2));
            }
            plans.add(columns);
        }
        return plans;
    }
}
