package io.restaurantos.pos.feign;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import io.restaurantos.pos.config.FeignClientConfig;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;

import java.util.UUID;

/**
 * Branch identity and the branch's printer registry, for the receipt header and the drawer kick.
 *
 * <p><b>Why the internal endpoint and not {@code /api/v1/branches/{id}/receipt-config}.</b> That
 * endpoint is gated on {@code branch.manage}, which a cashier does not hold — and this call is made
 * while a cashier settles an order. {@code GET /internal/users/branches/{id}} is reachable with the
 * internal-service header ({@link FeignClientConfig} adds it) and returns the whole branch row,
 * which already carries BOTH halves this assembler needs: the printed identity (name, address,
 * phone, NTN, STRN) and the {@code receiptConfig} jsonb. One call, not two.
 *
 * <p><b>{@code X-Tenant-Id} is required and is not decoration.</b> {@code branches} is
 * FORCE ROW LEVEL SECURITY on {@code app.current_tenant_id} and there is no JWT on
 * {@code /internal/**}, so without the header the lookup matches zero rows and reports success —
 * the green-but-broken shape this phase has already found on five separate paths.
 *
 * <p><b>Fail-soft, deliberately, and in exactly one direction.</b> Unlike
 * {@link FinancePeriodClient}, which is fail-CLOSED because closing into an unknown accounting
 * period corrupts the ledger, a failure here degrades the receipt and never fails it. A cashier
 * holding a customer's money must not be blocked by a settings lookup — see
 * {@code ReceiptDocumentAssembler}, which owns that decision and records the degradation on the
 * paper.
 */
@FeignClient(name = "user-service", contextId = "userBranchClient", configuration = FeignClientConfig.class)
public interface UserBranchClient {

    @GetMapping("/internal/users/branches/{branchId}")
    BranchDetail getBranch(@PathVariable("branchId") UUID branchId,
                           @RequestHeader("X-Tenant-Id") UUID tenantId);

    /**
     * The same row as {@link #getBranch}, read for one question: is this branch still somewhere
     * work may happen?
     *
     * <p><b>A second method on the same URL, not two fields added to {@link BranchDetail}.</b> The
     * two reads have opposite failure policies and it must be impossible to acquire one by editing
     * the other. {@code getBranch} is documented fail-SOFT — a lookup outage degrades a receipt and
     * never blocks a cashier holding a customer's money. {@link BranchStatus} is consumed
     * fail-CLOSED by {@code ActiveBranchGuard}: an unverifiable branch takes no orders. Widening
     * {@code BranchDetail} would have put both policies behind one record and left the next person
     * to change the receipt path one keystroke from reopening this hole.
     *
     * <p>(It also keeps {@code BranchDetail}'s constructor arity, which seven integration tests
     * construct positionally — but that is a convenience, not the reason.)
     */
    @GetMapping("/internal/users/branches/{branchId}")
    BranchStatus getBranchStatus(@PathVariable("branchId") UUID branchId,
                                 @RequestHeader("X-Tenant-Id") UUID tenantId);

    /**
     * Whether a branch is live and open for business.
     *
     * <p>The field names are Jackson's for user-service's Lombok getters on {@code BranchEntity} —
     * {@code isActive()} and {@code isDeleted()} serialise as {@code "active"} and {@code "deleted"},
     * NOT as the field spellings {@code isActive}/{@code deletedAt}. Verified against the running
     * service rather than inferred:
     * {@code GET /internal/users/branches/{id}} → {@code {"active": false, "deleted": false, ...}}.
     * A boxed {@link Boolean} rather than a primitive so that a response missing the key reads as
     * {@code null} — absent authority — instead of silently defaulting to {@code false} and
     * refusing every order, or (worse, on a rename in the other direction) to {@code true}.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record BranchStatus(UUID id, Boolean active, Boolean deleted) {}

    /**
     * A deliberate SUBSET of user-service's {@code BranchEntity} response.
     *
     * <p>{@code ignoreUnknown} because that response is an entity, not a DTO: it carries auditing
     * columns, soft-delete markers and whatever the next phase adds to branches. A strict reader
     * here would make an unrelated branch column a receipt outage.
     *
     * @param address       the {@code address} jsonb column, as a raw string — it has no schema
     *                      this service can rely on, so the assembler parses it defensively
     * @param receiptConfig the {@code receipt_config} jsonb column: the printer registry written by
     *                      user-service's {@code ReceiptConfigService} (plan 26-02). Null for a
     *                      branch nobody has configured, which is a normal branch.
     * @param timezone      the branch's IANA zone — the one {@code /app/settings} describes as the
     *                      field "Business dates and reports are cut on". It was already on this
     *                      response and this record simply did not read it, which is why pos-service
     *                      spent its whole life believing it "does not hold branch timezone data"
     *                      and cutting the trading day in UTC. Nullable: an unconfigured branch
     *                      falls back to {@code restaurantos.business-day.default-timezone}.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record BranchDetail(
            UUID id,
            String name,
            String address,
            String phone,
            String ntn,
            String fbrStrn,
            String receiptConfig,
            String timezone
    ) {}
}
