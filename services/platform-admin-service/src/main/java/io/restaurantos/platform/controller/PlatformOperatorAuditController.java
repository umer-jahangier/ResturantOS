package io.restaurantos.platform.controller;

import io.restaurantos.platform.dto.PlatformUserDtos.PlatformAuditRecord;
import io.restaurantos.platform.service.PlatformAdminAuditQueryService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.api.PageMeta;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * What platform operators have done to tenant accounts (superadmin plan).
 *
 * <pre>
 *   GET /api/v1/platform/operator-audit
 *       ?platformUserId=&amp;tenantId=&amp;targetUserId=&amp;from=&amp;to=&amp;page=&amp;size=
 * </pre>
 *
 * <h2>Why the reader ships with the writer</h2>
 *
 * <p>{@code impersonation_log} is the cautionary example, in this same database: the write side
 * worked from PLATFORM-05 and had <b>no read path at all</b> until 13-14 — the repository finder
 * had zero callers, no controller exposed it, and the accountability trail for platform staff
 * entering tenant data could only be read from a psql session. An accountability record nobody can
 * read is only marginally better than one that is not written.
 *
 * <h2>The question this answers that audit_db cannot</h2>
 *
 * <p><i>"Where has operator X been?"</i> {@code audit_events} is per-tenant with FORCED row-level
 * security, so that question there is one query and one token per tenant, it misses any tenant
 * whose outbox delivery failed, and for two of the five recorded actions (unlock, revoke-sessions)
 * there is no tenant-side event at all. Here it is one indexed read over one immutable table.
 *
 * <p>The rows are append-only at the trigger layer (changeset 050), so this reader cannot be shown
 * a rewritten history — the property that makes reading it worth anything.
 *
 * <p><b>It never carries a credential.</b> The platform password reset hands a temporary password
 * to the operator once and it exists nowhere else; {@code platform_admin_audit} has no column it
 * could occupy and this response has no field for it.
 */
@RestController
@RequestMapping("/api/v1/platform/operator-audit")
@PreAuthorize("hasAuthority('SUPER_ADMIN')")
public class PlatformOperatorAuditController {

    private final PlatformAdminAuditQueryService auditQueryService;

    public PlatformOperatorAuditController(PlatformAdminAuditQueryService auditQueryService) {
        this.auditQueryService = auditQueryService;
    }

    /**
     * One page of operator actions, newest first.
     *
     * <p>Filters are applied in priority order — operator, then tenant, then target user — rather
     * than combined, matching {@code ImpersonationQueryService}. That is a real limitation and is
     * stated: "what did operator X do to tenant Y" is two filters and this serves the first.
     *
     * <p>An omitted date bound reads as "everything" ({@code EPOCH}..now), never as "nothing". An
     * UNPARSEABLE one is a 400 rather than being treated as absent — silently widening a filter a
     * caller narrowed is how an operator concludes nothing happened in a window they mistyped.
     *
     * <p>Both successes and REFUSALS are returned. An operator repeatedly attempting something they
     * are refused is exactly the pattern an abuse review looks for, and a feed of successes cannot
     * show it.
     */
    @GetMapping
    public ResponseEntity<ApiResponse<List<PlatformAuditRecord>>> search(
            @RequestParam(required = false) UUID platformUserId,
            @RequestParam(required = false) UUID tenantId,
            @RequestParam(required = false) UUID targetUserId,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        var paged = auditQueryService.search(platformUserId, tenantId, targetUserId,
            from, to, page, size);
        // Same envelope as every other list in the platform: the cursor fields carry the page
        // NUMBER, and a null nextCursor is the "last page" signal a pager needs. Without it a
        // client can only discover the end by asking for a page and receiving nothing, which is
        // indistinguishable from a failed filter.
        boolean hasNext = (long) (paged.page() + 1) * paged.size() < paged.totalCount();
        PageMeta meta = new PageMeta(
            new PageMeta.Page(
                String.valueOf(paged.page()),
                hasNext ? String.valueOf(paged.page() + 1) : null,
                paged.size()),
            paged.totalCount());
        return ResponseEntity.ok(ApiResponse.paginated(paged.records(), meta));
    }
}
