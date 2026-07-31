import { http, HttpResponse } from "msw";

// Real hex UUIDs (decision 10-03-D) even though NLQ rows don't strictly require uuid-typed
// fields — kept consistent with every other mock module's fixture convention.
const MENU_ITEM_ID = "22222222-2222-4222-8222-222222220001";

function ok<T>(data: T) {
  return HttpResponse.json({ data, meta: null, warnings: [] });
}

/**
 * RFC-7807 ProblemDetail envelope shape emitted by `NlqGlobalExceptionHandler`:
 * `{ type, title, status, detail, code }` — `title` is set via `ProblemDetail#setTitle` (a
 * generic category, e.g. "QUERY_REJECTED") and `code` (the SPECIFIC RejectionCode or operational
 * failure code, e.g. "TENANT_FILTER_MISSING") via `setProperty("code", ...)`, which Spring's
 * `ProblemDetailJacksonMixin` flattens onto the JSON root — NOT nested under a "properties"
 * wrapper. `frontend/lib/api-client/errors.ts` reads the flattened `code` field first.
 */
function problem(status: number, title: string, detail: string, code: string) {
  return HttpResponse.json(
    {
      type: `urn:restaurantos:nlq:${title.toLowerCase().replaceAll("_", "-")}`,
      title,
      status,
      detail,
      code,
    },
    { status },
  );
}

/** MSW fixtures for the 12-09 NLQ frontend — POST /api/v1/nlq/query, happy + every rejection. */
export const nlqHandlers = [
  http.post("*/api/v1/nlq/query", async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { question?: string };
    const question = body.question ?? "";

    // Rejection triggers — the question text drives which fixture the test/dev exercises.
    if (question.includes("__reject_tenant_filter")) {
      return problem(
        400,
        "QUERY_REJECTED",
        "That question could not be safely limited to your restaurant's data.",
        "TENANT_FILTER_MISSING",
      );
    }
    if (question.includes("__reject_branch_filter")) {
      return problem(
        400,
        "QUERY_REJECTED",
        "That question could not be safely limited to your branch's data.",
        "BRANCH_FILTER_MISSING",
      );
    }
    if (question.includes("__reject_shape")) {
      return problem(400, "QUERY_REJECTED", "Only read-only queries are allowed.", "SHAPE_INVALID");
    }
    if (question.includes("__reject_table")) {
      return problem(
        400,
        "QUERY_REJECTED",
        "That question needs data your role can't access.",
        "TABLE_NOT_ALLOWED",
      );
    }
    if (question.includes("__reject_pii")) {
      return problem(
        400,
        "QUERY_REJECTED",
        "That question asks for personal customer information.",
        "PII_COLUMN_DENIED",
      );
    }
    if (question.includes("__reject_limit")) {
      return problem(400, "QUERY_REJECTED", "That query asked for too many rows.", "LIMIT_INVALID");
    }
    if (question.includes("__reject_parse")) {
      return problem(
        400,
        "QUERY_REJECTED",
        "We couldn't turn that into a valid query.",
        "PARSE_FAILED",
      );
    }
    if (question.includes("__reject_timeout")) {
      return problem(400, "QUERY_TIMEOUT", "That query took too long.", "QUERY_TIMEOUT");
    }
    if (question.includes("__reject_row_cap")) {
      return problem(
        400,
        "ROW_CAP_EXCEEDED",
        "That query returned too many rows.",
        "ROW_CAP_EXCEEDED",
      );
    }
    if (question.includes("__reject_quota")) {
      return problem(
        429,
        "QUOTA_EXCEEDED",
        "You've used all your NLQ questions for this hour.",
        "QUOTA_EXCEEDED_HOURLY",
      );
    }
    if (question.includes("__reject_claude_unavailable")) {
      return problem(
        503,
        "CLAUDE_UNAVAILABLE",
        "The NLQ SQL-generation service is temporarily unavailable.",
        "CLAUDE_UNAVAILABLE",
      );
    }
    if (question.includes("__reject_quota_service_unavailable")) {
      return problem(
        503,
        "QUOTA_SERVICE_UNAVAILABLE",
        "NLQ quota service is temporarily unavailable.",
        "QUOTA_SERVICE_UNAVAILABLE",
      );
    }

    if (question.includes("__cache_hit")) {
      return ok({
        question,
        sql: "SELECT sum(total_paisa) AS revenue_paisa FROM fact_sales WHERE tenant_id = ? AND branch_id = ? LIMIT 1000",
        rows: [{ revenue_paisa: 535_000 }],
        columns: ["revenue_paisa"],
        rowCount: 1,
        narrative: "Revenue last week was PKR 5,350.00.",
        cacheHit: true,
        durationMs: 0,
      });
    }

    if (question.includes("__null_narrative")) {
      return ok({
        question,
        sql: "SELECT sum(total_paisa) AS revenue_paisa FROM fact_sales WHERE tenant_id = ? AND branch_id = ? LIMIT 1000",
        rows: [{ revenue_paisa: 535_000 }],
        columns: ["revenue_paisa"],
        rowCount: 1,
        narrative: null,
        cacheHit: false,
        durationMs: 812,
      });
    }

    // Default: 200 happy path — rows + narrative, executed sql echoed back.
    return ok({
      question: question || "What was revenue last week?",
      sql: "SELECT menu_item_id, item_name, sum(qty) AS qty_sold FROM fact_sales_by_item WHERE tenant_id = ? AND branch_id = ? GROUP BY menu_item_id, item_name ORDER BY qty_sold DESC LIMIT 1000",
      rows: [
        { menu_item_id: MENU_ITEM_ID, item_name: "Chicken Karahi", qty_sold: 30 },
        { menu_item_id: "22222222-2222-4222-8222-222222220002", item_name: "Seekh Kebab", qty_sold: 18 },
      ],
      columns: ["menu_item_id", "item_name", "qty_sold"],
      rowCount: 2,
      narrative: "Chicken Karahi was the top-selling item, with 30 units sold.",
      cacheHit: false,
      durationMs: 940,
    });
  }),
];
