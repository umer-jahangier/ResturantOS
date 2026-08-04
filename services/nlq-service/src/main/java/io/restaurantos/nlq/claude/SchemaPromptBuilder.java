package io.restaurantos.nlq.claude;

import io.restaurantos.nlq.allowlist.AllowedTableService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/**
 * Builds the Claude system prompt that constrains NL-&gt;SQL generation to the caller's
 * role-scoped table allowlist (12-04's {@link AllowedTableService}) and the validator's supported
 * query shape (12-04-SUMMARY pin). Cached in Redis per role, 10-minute TTL (spec M6.2).
 *
 * <p><b>This prompt is NOT a security control.</b> It exists purely to reduce the rejection rate
 * — the fewer legitimate questions produce SQL the 7-stage {@code SqlValidationPipeline} refuses,
 * the more useful the feature is. Every single word of this prompt could be ignored by a
 * hallucinating or adversarially-steered model and the system would still be safe, because
 * nothing generated from it is ever executed before {@code SqlValidationPipeline.validate(...)}
 * proves it safe. Do not add anything here in place of a real validator stage.
 */
@Component
public class SchemaPromptBuilder {

    private static final Logger log = LoggerFactory.getLogger(SchemaPromptBuilder.class);
    private static final Duration TTL = Duration.ofMinutes(10);
    private static final String KEY_PREFIX = "nlq:schema-prompt:";

    /**
     * Exact column lists pinned in 12-02-SUMMARY.md ("Exact Column Lists (pinned for ... 12-07 NLQ
     * schema prompt)"). PII deny-listed columns (application.yml's
     * {@code restaurantos.nlq.pii-denylist}) are flagged inline so the model is told, not just the
     * validator — this is the rejection-rate optimisation described above.
     */
    private static final Map<String, String> FACT_TABLE_COLUMNS = Map.of(
            "sales_order_facts",
            "tenant_id UUID, branch_id UUID, business_date Date, order_id UUID, order_no String, "
                    + "order_type String, customer_id Nullable(UUID) [NEVER SELECT - PII], "
                    + "subtotal_paisa Int64, discount_paisa Int64, service_charge_paisa Int64, "
                    + "tax_paisa Int64, total_paisa Int64, till_session_id UUID, "
                    + "cashier_id UUID [NEVER SELECT - PII], closed_at DateTime64(3,'UTC'), event_id UUID",
            "sales_item_facts",
            "tenant_id UUID, branch_id UUID, business_date Date, order_id UUID, line_no UInt16, "
                    + "menu_item_id UUID, item_name String, qty Int32, unit_price_paisa Int64, "
                    + "line_total_paisa Int64, cogs_paisa Nullable(Int64), "
                    + "gross_margin_paisa Nullable(Int64), category_name Nullable(String), "
                    + "closed_at DateTime64(3,'UTC'), event_id UUID",
            "purchase_tax_facts",
            "tenant_id UUID, branch_id UUID, business_date Date, invoice_id UUID, "
                    + "purchase_order_id UUID, input_tax_paisa Int64, total_paisa Int64, "
                    + "match_status String, matched_at DateTime64(3,'UTC'), event_id UUID",
            "till_session_facts",
            "tenant_id UUID, branch_id UUID, business_date Date, till_session_id UUID, "
                    + "cashier_id UUID [NEVER SELECT - PII], expected_cash_paisa Int64, "
                    + "counted_cash_paisa Int64, variance_paisa Int64, closed_at DateTime64(3,'UTC'), "
                    + "event_id UUID");

    private final AllowedTableService allowedTableService;
    private final StringRedisTemplate redis;

    public SchemaPromptBuilder(AllowedTableService allowedTableService, StringRedisTemplate redis) {
        this.allowedTableService = allowedTableService;
        this.redis = redis;
    }

    public String buildFor(String roleCode) {
        String key = KEY_PREFIX + roleCode;

        if (redis != null) {
            try {
                String cached = redis.opsForValue().get(key);
                if (cached != null) {
                    return cached;
                }
            } catch (RuntimeException ex) {
                log.warn("[nlq-schema-prompt] Redis lookup failed for role={} — rebuilding", roleCode, ex);
            }
        }

        String built = build(roleCode);

        if (redis != null) {
            try {
                redis.opsForValue().set(key, built, TTL);
            } catch (RuntimeException ex) {
                log.warn("[nlq-schema-prompt] Redis write failed for role={} — result not cached", roleCode, ex);
            }
        }

        return built;
    }

    private String build(String roleCode) {
        Set<String> allowedTables = allowedTableService.allowedFor(roleCode);
        // Deterministic ordering so the (cached) prompt is stable and diffable across builds.
        Set<String> sortedTables = new TreeSet<>(allowedTables);

        StringBuilder sb = new StringBuilder();
        sb.append("You generate a single ClickHouse SELECT statement to answer a restaurant ")
          .append("owner/manager's analytics question. You do not execute anything yourself — ")
          .append("your SQL is validated and re-written by a separate system before it ever runs.\n\n");

        sb.append("## Tables you may use\n");
        if (sortedTables.isEmpty()) {
            sb.append("(none — this role has no analytics tables granted; explain in your SQL comment ")
              .append("that no data is available, but you must still return exactly one SELECT statement.)\n\n");
        } else {
            for (String table : sortedTables) {
                sb.append("- ").append(table).append("(").append(FACT_TABLE_COLUMNS.getOrDefault(table, "")).append(")\n");
            }
            sb.append('\n');
        }

        sb.append("## Hard rules\n")
          .append("1. Generate exactly ONE ClickHouse SELECT statement. No DDL, no DML, no multiple ")
          .append("statements, no semicolon-separated queries.\n")
          .append("2. Only use the tables and columns listed above. Never select a column marked ")
          .append("[NEVER SELECT - PII], and never use SELECT * on a table that has one.\n")
          .append("3. Supported query shape ONLY: a single SELECT over ONE table from the list above, ")
          .append("with an optional WHERE, GROUP BY, ORDER BY, and LIMIT. Do NOT use JOIN, WITH (CTE), ")
          .append("UNION, or a subquery anywhere — these will always be rejected.\n")
          .append("4. Do NOT add tenant_id or branch_id predicates yourself — the system injects and ")
          .append("verifies them after you respond.\n")
          .append("5. All money columns (columns ending in _paisa) are integer paisa. Do not divide by ")
          .append("100 and do not assume they are rupees.\n")
          .append("6. Respond with ONLY the SQL statement — no prose, no explanation.\n\n");

        sb.append("## Examples\n")
          .append("Q: What was total revenue in the last 7 days?\n")
          .append("A: SELECT sum(total_paisa) AS revenue_paisa FROM sales_order_facts ")
          .append("WHERE business_date >= today() - 7\n\n")
          .append("Q: What are my top 5 selling items this month?\n")
          .append("A: SELECT item_name, sum(qty) AS total_qty FROM sales_item_facts ")
          .append("WHERE business_date >= toStartOfMonth(today()) GROUP BY item_name ")
          .append("ORDER BY total_qty DESC LIMIT 5\n\n")
          .append("Q: How many orders were closed yesterday?\n")
          .append("A: SELECT count() AS order_count FROM sales_order_facts ")
          .append("WHERE business_date = yesterday()\n");

        return sb.toString();
    }
}
