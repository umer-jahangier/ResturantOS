package io.restaurantos.audit.controller;

import io.restaurantos.audit.dto.AuditEventView;
import io.restaurantos.audit.dto.AuditFacetsView;
import io.restaurantos.audit.repository.AuditEventRepository;
import io.restaurantos.audit.service.AuditActorDirectory;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.api.PageMeta;
import io.restaurantos.shared.exception.FieldValidationException;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.DateTimeException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * The tenant-facing audit log (15-01, extended by F4).
 *
 * <p>Until 15-01 the only way to read {@code audit_events} was {@code /internal/audit/events},
 * which is gated on a shared secret and has no gateway route — so the audit log was unreachable from
 * outside the cluster and "everything logged for audits" had no reader. This endpoint is that
 * reader, and it is reachable through {@code audit-route} in the gateway.
 *
 * <h2>The tenant is taken, not asked for</h2>
 *
 * <p>{@code tenantId} is read from {@link TenantContext} — populated by {@code JwtAuthenticationFilter}
 * from the {@code tenant_id} claim of a signature-verified JWT — and there is <b>no tenant parameter
 * on this endpoint at all</b>. That is the whole of the cross-tenant control, and it is a structural
 * one: there is no code path here that could be persuaded to read another tenant's rows, because
 * there is nothing for a caller to influence. The internal endpoint next door takes a tenant as a
 * query parameter, which is defensible only because the secret that gates it is held by services and
 * not by users; repeating that shape on a user-facing endpoint would have made every tenant admin a
 * reader of every other tenant's audit log.
 *
 * <p>{@code AuditReadPathIT} asserts a token for tenant A reading nothing of tenant B's, over
 * the controller, against a database holding both.
 *
 * <h2>Why {@code audit.log.view} and not an existing permission</h2>
 *
 * <p>Reading the audit log is not implied by any other capability. It shows every login, every void,
 * every role change and every password reset in the tenant — including the acting administrators'
 * own — so it is exactly the surface a compromised manager account would want, and exactly the
 * record that would show the compromise. It is granted to OWNER and TENANT_ADMIN only (changeset
 * 060). MANAGER deliberately does not hold it: a manager can void an order, and a manager who can
 * also read the void log is a manager who can see whether anyone is looking.
 *
 * <h2>What F4 added, and the one correction it makes to the 2026-08-12 walkthrough</h2>
 *
 * <p>The walkthrough recorded "the audit read path ignores its own filter", having sent
 * {@code ?resourceType=ORDER} and been given logins. The filter was not ignored — it did not exist.
 * This method declared {@code action}, {@code from}, {@code to}, {@code page} and {@code size}, and
 * Spring silently discards an undeclared query parameter, so {@code resourceType} had never been a
 * filter at any point. It is one now, at both ends: a declared parameter and a repository method
 * per shape.
 *
 * <p>Three other things a reader needs and could not have:
 *
 * <ul>
 *   <li><b>A total.</b> The response was {@code ApiResponse.ok(list)} with {@code meta: null}, so a
 *       client paging through had no way to say "of 208" and no way to know it had reached the end
 *       other than by asking for a page and getting nothing. It is now
 *       {@code ApiResponse.paginated} with a real count of the matching rows.</li>
 *   <li><b>Names.</b> {@code user_id} is a UUID. See {@link AuditActorDirectory}.</li>
 *   <li><b>Days cut where the restaurant is.</b> {@code from}/{@code to} were cut at UTC midnight
 *       unconditionally. For a branch in {@code Asia/Karachi} that silently moves the boundary five
 *       hours, so "everything on the 12th" began at 05:00 local and swept in five hours of the
 *       11th — the same class of defect as the Takings screen's, which PROJECT.md pins as
 *       "business dates are cut on the BRANCH timezone". The optional {@code zone} parameter is that
 *       boundary, and an unrecognised zone is a 422 naming the field rather than a silent fall back
 *       to UTC, because a silent fall back is indistinguishable from the bug.</li>
 * </ul>
 *
 * <h2>What this endpoint cannot do</h2>
 *
 * <p>Read only. There is no write, no update and no delete surface here or anywhere else in the
 * service — the table is append-only at the privilege layer and again at the trigger layer, and this
 * controller holds a repository whose runtime role has SELECT and INSERT and nothing more.
 */
@RestController
@RequestMapping("/api/v1/audit")
public class AuditQueryController {

    private static final int MAX_PAGE_SIZE = 200;
    private static final int DEFAULT_PAGE_SIZE = 50;

    /**
     * How far back the screen reads when the caller names no dates.
     *
     * <p><b>One constant, deliberately, and used by both endpoints through the same helper.</b> The
     * grid and the filter dropdowns must read the SAME window or the screen starts lying. Writing it
     * formally: with facets over window F and the grid over window G, an offered option returns rows
     * iff {@code F ⊆ G}. Two separate defaults would hold that property only for as long as two call
     * sites happened to agree, and the day they diverge the dropdown offers a filter whose only
     * possible result is "no events match" — which on an audit log reads as "your trail has a hole
     * in it", the one impression this screen must never give. Because {@link #startOfDay} is the
     * single place a default can come from, {@code F = G} is structural here rather than maintained.
     *
     * <p>Ninety days rather than thirty because the failure mode that matters is an ABSENT category,
     * not a slow query: an action whose last occurrence falls outside the window drops out of the
     * dropdown, and an absent option on an audit screen reads as "that never happened here". A
     * shorter window omits more. A quarter also matches the cadence an owner already reviews the
     * business on, and widening is one click.
     *
     * <p>This is a default, not a cap. Any range the reader explicitly asks for is honoured however
     * far back it goes — the log stays readable for the full seven-year retention. What changes is
     * that a scan of every partition is now something a person requested, rather than something
     * every first load of the screen pays for silently.
     */
    private static final int DEFAULT_WINDOW_DAYS = 90;

    private final AuditEventRepository auditEventRepository;
    private final AuditActorDirectory auditActorDirectory;
    private final TenantContext tenantContext;

    public AuditQueryController(AuditEventRepository auditEventRepository,
                                AuditActorDirectory auditActorDirectory,
                                TenantContext tenantContext) {
        this.auditEventRepository = auditEventRepository;
        this.auditActorDirectory = auditActorDirectory;
        this.tenantContext = tenantContext;
    }

    /**
     * {@code GET /api/v1/audit/events?action=&resourceType=&from=&to=&zone=&page=&size=}
     *
     * <p>Newest first. {@code from}/{@code to} are inclusive dates cut in {@code zone} (UTC when
     * omitted). Omitting them reads the last {@value #DEFAULT_WINDOW_DAYS} days — see
     * {@link #DEFAULT_WINDOW_DAYS} for why that is bounded and why the same bound serves
     * {@link #getFacets}. A caller wanting more says so, and gets it.
     *
     * <p>The screen must state the window it is showing. A reader given 90 days of a seven-year
     * record with nothing saying so concludes that is the whole record, which is the same false
     * impression as an empty filter option arriving by a different route.
     */
    @GetMapping("/events")
    @PreAuthorize("hasAuthority('audit.log.view')")
    public ApiResponse<List<AuditEventView>> getEvents(
            @RequestParam(required = false) String action,
            @RequestParam(required = false) String resourceType,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(required = false) String zone,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {

        // From the verified token, never from the request. See the class javadoc.
        UUID tenantId = tenantContext.requireTenantId();

        ZoneId cutZone = resolveZone(zone);
        Instant fromInstant = startOfDay(resolveFrom(from, cutZone), cutZone);
        Instant toInstant = endOfDay(resolveTo(to, cutZone), cutZone);

        String actionFilter = blankToNull(action);
        String resourceTypeFilter = blankToNull(resourceType);

        int pageNumber = Math.max(page, 0);
        int pageSize = size <= 0 ? DEFAULT_PAGE_SIZE : Math.min(size, MAX_PAGE_SIZE);
        PageRequest pageRequest = PageRequest.of(pageNumber, pageSize,
                Sort.by(Sort.Direction.DESC, "occurredAt"));

        List<AuditEventView> events = findPage(
                tenantId, actionFilter, resourceTypeFilter, fromInstant, toInstant, pageRequest)
                .stream()
                .map(AuditEventView::of)
                .toList();

        long totalCount = countMatching(
                tenantId, actionFilter, resourceTypeFilter, fromInstant, toInstant);

        List<AuditEventView> named = withActorNames(tenantId, events);

        // The cursor fields carry the page NUMBER, the same convention as
        // UserLifecycleInternalController: PageMeta is shaped for cursor pagination and this is
        // offset pagination, and one envelope for every list in the platform is worth more than a
        // second one that fits better. `nextCursor` null is the "last page" signal a pager needs.
        boolean hasNext = (long) (pageNumber + 1) * pageSize < totalCount;
        PageMeta meta = new PageMeta(
                new PageMeta.Page(
                        String.valueOf(pageNumber),
                        hasNext ? String.valueOf(pageNumber + 1) : null,
                        pageSize),
                totalCount);

        return ApiResponse.paginated(named, meta);
    }

    /**
     * {@code GET /api/v1/audit/facets?from=&to=&zone=} — the filter vocabulary this tenant has.
     *
     * <p>Read from the tenant's own rows, not from the platform's catalogue of auditable events.
     * A dropdown listing {@code PAYROLL_APPROVED} to a restaurant that does not run payroll here
     * offers a choice whose only possible result is an empty log — which on THIS screen reads as
     * "your audit trail has a hole in it", the one impression an audit log must never give.
     *
     * <p>Same permission as the events themselves: the set of action names present is itself a
     * disclosure ("this tenant has had a password reset this week").
     */
    @GetMapping("/facets")
    @PreAuthorize("hasAuthority('audit.log.view')")
    public ApiResponse<AuditFacetsView> getFacets(
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(required = false) String zone) {

        UUID tenantId = tenantContext.requireTenantId();
        ZoneId cutZone = resolveZone(zone);
        LocalDate windowFrom = resolveFrom(from, cutZone);
        LocalDate windowTo = resolveTo(to, cutZone);
        Instant fromInstant = startOfDay(windowFrom, cutZone);
        Instant toInstant = endOfDay(windowTo, cutZone);

        // The window travels WITH the vocabulary it produced. The screen has to name the dates it is
        // showing, and the only way it can be wrong about them is by working them out for itself
        // from a second copy of DEFAULT_WINDOW_DAYS that has drifted from this one.
        return ApiResponse.ok(new AuditFacetsView(
                auditEventRepository.findDistinctActions(tenantId, fromInstant, toInstant),
                auditEventRepository.findDistinctResourceTypes(tenantId, fromInstant, toInstant),
                windowFrom, windowTo));
    }

    // ── the four query shapes ──────────────────────────────────────────────────

    private List<io.restaurantos.audit.entity.AuditEventEntity> findPage(
            UUID tenantId, String action, String resourceType,
            Instant from, Instant to, PageRequest pageRequest) {
        if (action != null && resourceType != null) {
            return auditEventRepository.findByTenantIdAndActionAndResourceTypeAndOccurredAtBetween(
                    tenantId, action, resourceType, from, to, pageRequest);
        }
        if (action != null) {
            return auditEventRepository.findByTenantIdAndActionAndOccurredAtBetween(
                    tenantId, action, from, to, pageRequest);
        }
        if (resourceType != null) {
            return auditEventRepository.findByTenantIdAndResourceTypeAndOccurredAtBetween(
                    tenantId, resourceType, from, to, pageRequest);
        }
        return auditEventRepository.findByTenantIdAndOccurredAtBetween(
                tenantId, from, to, pageRequest);
    }

    private long countMatching(UUID tenantId, String action, String resourceType,
                               Instant from, Instant to) {
        if (action != null && resourceType != null) {
            return auditEventRepository.countByTenantIdAndActionAndResourceTypeAndOccurredAtBetween(
                    tenantId, action, resourceType, from, to);
        }
        if (action != null) {
            return auditEventRepository.countByTenantIdAndActionAndOccurredAtBetween(
                    tenantId, action, from, to);
        }
        if (resourceType != null) {
            return auditEventRepository.countByTenantIdAndResourceTypeAndOccurredAtBetween(
                    tenantId, resourceType, from, to);
        }
        return auditEventRepository.countByTenantIdAndOccurredAtBetween(tenantId, from, to);
    }

    // ── helpers ────────────────────────────────────────────────────────────────

    /**
     * Attaches display names, resolving each distinct id once for the whole page.
     *
     * <p>Both actor columns are resolved from the same lookup set, so an impersonated action —
     * where {@code userId} and {@code impersonatedBy} are two different real people — prints two
     * names for the price of the ids it holds.
     */
    private List<AuditEventView> withActorNames(UUID tenantId, List<AuditEventView> rows) {
        Set<UUID> ids = new LinkedHashSet<>();
        for (AuditEventView row : rows) {
            if (row.userId() != null) ids.add(row.userId());
            if (row.impersonatedBy() != null) ids.add(row.impersonatedBy());
        }
        if (ids.isEmpty()) {
            return rows;
        }
        Map<UUID, String> names = auditActorDirectory.namesFor(tenantId, ids);
        List<AuditEventView> out = new ArrayList<>(rows.size());
        for (AuditEventView row : rows) {
            out.add(row.withActorNames(
                    row.userId() == null ? null : names.get(row.userId()),
                    row.impersonatedBy() == null ? null : names.get(row.impersonatedBy())));
        }
        return out;
    }

    /**
     * The zone the day boundaries are cut in.
     *
     * <p>Refuses an unrecognised id instead of falling back. A caller that sends
     * {@code zone=Asia/Karachi } (or a stale IANA name, or a browser locale by mistake) and is
     * quietly given UTC gets a screen that looks right and is five hours wrong — which is exactly
     * how the Takings screen came to show "a zero it does not mean". A named 422 is a bug report;
     * a silent fallback is a bug.
     */
    private ZoneId resolveZone(String zone) {
        String trimmed = blankToNull(zone);
        if (trimmed == null) {
            return ZoneOffset.UTC;
        }
        try {
            return ZoneId.of(trimmed);
        } catch (DateTimeException e) {
            throw new FieldValidationException(
                    "INVALID_TIME_ZONE",
                    "zone",
                    "\"" + trimmed + "\" is not a time zone this server recognises. Use an IANA "
                            + "zone id such as Asia/Karachi.",
                    e);
        }
    }

    /**
     * The dates the window actually spans — the caller's, or the default.
     *
     * <p>Resolved to {@code LocalDate} BEFORE being turned into instants so that the dates the
     * screen prints and the dates the query runs on are the same values, not two computations of
     * the same intent. The screen must state its window ("Showing 14 May – 12 Aug 2026"), and the
     * only way it can be wrong about that is if it works the window out for itself.
     */
    private static LocalDate resolveFrom(LocalDate from, ZoneId zone) {
        return from != null ? from : LocalDate.now(zone).minusDays(DEFAULT_WINDOW_DAYS);
    }

    /** The upper bound date — the caller's, or today in {@code zone}. */
    private static LocalDate resolveTo(LocalDate to, ZoneId zone) {
        return to != null ? to : LocalDate.now(zone);
    }

    /**
     * The lower bound, cut at midnight in {@code zone} — the caller's date, or the default window.
     *
     * <p>The default was {@link Instant#EPOCH}, which made every dateless call a scan of every
     * attached partition: 84 of them at the seven-year retention, and no index can serve it.
     * {@code idx_audit_events_tenant_occurred} leads on {@code tenant_id} but does not carry
     * {@code action}, and {@code idx_audit_events_action} carries {@code action} but cannot prune to
     * a tenant, so {@code SELECT DISTINCT action} read every row the tenant had ever written and
     * deduplicated it — twice per load of the audit screen, plus a {@code COUNT} over the same rows
     * from {@link #countMatching} on every page load AND every page change. Measured at 4,010 rows
     * that was instant; the table only grows, and the query got slower every day it worked.
     *
     * <p>The default is cut in {@code zone} like every other boundary here, so "the last 90 days"
     * means 90 whole local days and not 90×24 hours ending at whatever time the page was opened —
     * the same reason {@code zone} exists at all.
     */
    private static Instant startOfDay(LocalDate resolvedFrom, ZoneId zone) {
        return resolvedFrom.atStartOfDay(zone).toInstant();
    }

    /**
     * The upper bound: midnight at the END of the resolved day, in {@code zone}.
     *
     * <p>Was {@code Instant.now()} when {@code to} was omitted. Now it is the end of today in
     * {@code zone}, so the window is a whole number of local days at both ends and the range the
     * screen prints is the range the query ran. {@code occurred_at} is never in the future, so the
     * few hours between "now" and local midnight select nothing extra.
     */
    private static Instant endOfDay(LocalDate resolvedTo, ZoneId zone) {
        return resolvedTo.plusDays(1).atStartOfDay(zone).toInstant();
    }

    private static String blankToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
