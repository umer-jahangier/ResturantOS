package io.restaurantos.audit.service;

import io.restaurantos.audit.dto.PlatformAuditDtos.PlatformAuditEventView;
import io.restaurantos.audit.dto.PlatformAuditDtos.PlatformAuditSearchRequest;
import io.restaurantos.audit.dto.PlatformAuditDtos.PlatformAuditSearchResponse;
import io.restaurantos.audit.dto.PlatformAuditDtos.TenantReadFailure;
import io.restaurantos.audit.entity.AuditEventEntity;
import io.restaurantos.audit.repository.AuditEventRepository;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.persistence.criteria.Predicate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * The cross-tenant audit read, assembled from policy-checked per-tenant reads.
 *
 * <h2>The control this deliberately does not weaken</h2>
 *
 * <p>{@code audit_events} and every partition carry {@code ENABLE} + {@code FORCE ROW LEVEL
 * SECURITY} with the predicate
 * {@code tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid}
 * (changeset 030). The runtime role is {@code NOSUPERUSER NOBYPASSRLS}. There is therefore no query
 * this service can issue that returns two tenants' rows, and the three tempting ways to make one
 * are all rejected here on purpose:
 *
 * <ul>
 *   <li><b>A bypass role.</b> Services connect as a non-superuser belonging to no roles, and a
 *       Liquibase migration cannot create a role or alter ownership. It could not be built from
 *       here even if it were wanted.</li>
 *   <li><b>A SECURITY DEFINER reader.</b> The one SECURITY DEFINER function in this schema
 *       ({@code create_audit_partition}) exists because partition creation genuinely requires
 *       ownership, and it is REVOKEd from PUBLIC for that reason. A SECURITY DEFINER function owned
 *       by the wrong role is the exact defect that recently took auth-service down; a second one,
 *       whose whole purpose is to read past tenant isolation, would be strictly worse.</li>
 *   <li><b>A policy that opens on a second GUC.</b> That is a bypass with extra steps: any code
 *       path that sets the GUC reads every tenant, and the isolation control stops being a property
 *       of the schema.</li>
 * </ul>
 *
 * <p>So the loop below sets {@code TenantContext} to one tenant at a time and issues an ordinary
 * query. {@code TenantAwareDataSource} writes the GUC on checkout, and re-writes it mid-checkout
 * whenever the thread's tenant moves — which is exactly what this loop does — so every statement
 * runs under the policy for the tenant it is asking about. A cross-tenant view is built in
 * application memory from N policy-checked reads, which is the only shape that leaves the database
 * control intact.
 *
 * <p><b>Nothing here is transactional.</b> Each repository call opens and closes its own read-only
 * transaction, so each takes its own connection checkout with the GUC written from the context at
 * that moment. A surrounding transaction would hold one connection across every tenant and rely
 * solely on the proxy's mid-checkout re-sync; correct, but a subtler thing to keep true.
 *
 * <h2>Why the merge is exact, and what makes it stop being exact</h2>
 *
 * <p>To return the globally newest rows {@code [page*size, page*size+size)} across N tenants it is
 * sufficient to take the newest {@code (page+1)*size} from each tenant and merge: no row outside a
 * tenant's own top {@code (page+1)*size} can appear in the global top {@code (page+1)*size}. That
 * is why {@link #MAX_SCAN_PER_TENANT} is a truncation flag and not a silent clamp — past that
 * depth the merge would still return a page, and the page would look entirely reasonable while
 * being wrong. An audit reader is the last person who should be handed a plausible page.
 */
@Service
public class PlatformAuditReadService {

    private static final Logger log = LoggerFactory.getLogger(PlatformAuditReadService.class);

    /** Page size ceiling, matching {@code AuditQueryController}'s. */
    public static final int MAX_PAGE_SIZE = 200;
    public static final int DEFAULT_PAGE_SIZE = 50;

    /**
     * How deep into one tenant's log a single request may scan.
     *
     * <p>The merge needs {@code (page+1)*size} rows per tenant, so this bounds how far a caller can
     * page before the result stops being provably exact. Deep paging over a seven-year, partitioned
     * audit log across every tenant is not a query this endpoint should serve silently; a caller
     * that needs it narrows by tenant, action or date, all of which are parameters.
     */
    public static final int MAX_SCAN_PER_TENANT = 1_000;

    /** Refuses a scope larger than this rather than fanning out unboundedly. */
    public static final int MAX_TENANTS_PER_REQUEST = 500;

    private final AuditEventRepository auditEventRepository;
    private final TenantContext tenantContext;

    public PlatformAuditReadService(AuditEventRepository auditEventRepository,
                                    TenantContext tenantContext) {
        this.auditEventRepository = auditEventRepository;
        this.tenantContext = tenantContext;
    }

    public PlatformAuditSearchResponse search(PlatformAuditSearchRequest request) {
        List<UUID> tenantIds = distinct(request.tenantIds());
        if (tenantIds.isEmpty()) {
            throw new IllegalArgumentException("tenantIds is required and must not be empty");
        }
        if (tenantIds.size() > MAX_TENANTS_PER_REQUEST) {
            throw new IllegalArgumentException(
                    "tenantIds holds " + tenantIds.size() + " entries; the maximum is "
                            + MAX_TENANTS_PER_REQUEST);
        }

        Instant from = request.from() != null ? request.from() : Instant.EPOCH;
        Instant to = request.to() != null ? request.to() : Instant.now();
        int page = request.page() == null ? 0 : Math.max(0, request.page());
        int size = request.size() == null || request.size() <= 0
                ? DEFAULT_PAGE_SIZE
                : Math.min(request.size(), MAX_PAGE_SIZE);

        long neededPerTenant = (long) (page + 1) * size;
        boolean truncated = neededPerTenant > MAX_SCAN_PER_TENANT;
        int scanDepth = (int) Math.min(neededPerTenant, MAX_SCAN_PER_TENANT);

        List<String> actions = request.actions() == null ? List.of()
                : request.actions().stream().filter(a -> a != null && !a.isBlank()).toList();
        String resourceType = blankToNull(request.resourceType());

        Specification<AuditEventEntity> spec =
                specification(actions, resourceType, request.userId(), from, to);

        List<AuditEventEntity> merged = new ArrayList<>();
        List<UUID> read = new ArrayList<>();
        List<TenantReadFailure> failed = new ArrayList<>();
        Set<String> facets = request.includeFacets() != null && request.includeFacets()
                ? new LinkedHashSet<>() : null;
        long total = 0L;

        for (UUID tenantId : tenantIds) {
            try {
                tenantContext.set(tenantId, null, null, null);
                Page<AuditEventEntity> slice = auditEventRepository.findAll(
                        spec, PageRequest.of(0, scanDepth, newestFirst()));
                merged.addAll(slice.getContent());
                total += slice.getTotalElements();
                if (facets != null) {
                    facets.addAll(auditEventRepository.findDistinctActions(tenantId, from, to));
                }
                read.add(tenantId);
            } catch (RuntimeException ex) {
                // One tenant's read failing must not be indistinguishable from that tenant having
                // no rows. It is named, the total is marked incomplete, and the caller decides.
                log.warn("[platform-audit] tenant={} read failed ({}) — reported as a failure, not "
                        + "as an empty log", tenantId, ex.toString());
                failed.add(new TenantReadFailure(tenantId, ex.getClass().getSimpleName()
                        + (ex.getMessage() == null ? "" : ": " + ex.getMessage())));
            } finally {
                tenantContext.clear();
            }
        }

        merged.sort(Comparator
                .comparing(AuditEventEntity::getOccurredAt, Comparator.reverseOrder())
                .thenComparing(AuditEventEntity::getId, Comparator.reverseOrder()));

        int fromIndex = Math.min((int) Math.min((long) page * size, Integer.MAX_VALUE), merged.size());
        int toIndex = Math.min(fromIndex + size, merged.size());
        List<PlatformAuditEventView> events = merged.subList(fromIndex, toIndex).stream()
                .map(PlatformAuditEventView::of)
                .toList();

        return new PlatformAuditSearchResponse(
                events,
                total,
                failed.isEmpty(),
                List.copyOf(read),
                List.copyOf(failed),
                from,
                to,
                page,
                size,
                facets == null ? null : List.copyOf(facets),
                truncated);
    }

    /**
     * Every predicate built with the Criteria API rather than as JPQL with nullable parameters.
     *
     * <p>The repository's derived finders exist one per filter combination precisely because
     * {@code (:action IS NULL OR e.action = :action)} meets PostgreSQL and produces
     * {@code could not determine data type of parameter $n} on the branch nobody exercised. This
     * read has four independent optional filters, which is sixteen finders. Criteria sidesteps
     * both: a filter that is absent contributes no predicate and therefore no bind parameter, so
     * there is no untyped null to infer.
     */
    private Specification<AuditEventEntity> specification(List<String> actions,
                                                          String resourceType,
                                                          UUID userId,
                                                          Instant from,
                                                          Instant to) {
        return (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();
            predicates.add(cb.between(root.get("occurredAt"), from, to));
            if (!actions.isEmpty()) {
                predicates.add(root.get("action").in(actions));
            }
            if (resourceType != null) {
                predicates.add(cb.equal(root.get("resourceType"), resourceType));
            }
            if (userId != null) {
                // The actor as themselves, OR the administrator behind an impersonated session.
                // Asking "what did this person do" and getting back only the un-impersonated half
                // is the misattribution D-34 already produced once, from the other direction.
                predicates.add(cb.or(
                        cb.equal(root.get("userId"), userId),
                        cb.equal(root.get("impersonatedBy"), userId)));
            }
            return cb.and(predicates.toArray(new Predicate[0]));
        };
    }

    private static Sort newestFirst() {
        return Sort.by(Sort.Order.desc("occurredAt"), Sort.Order.desc("id"));
    }

    private static List<UUID> distinct(List<UUID> ids) {
        if (ids == null) {
            return List.of();
        }
        return List.copyOf(new LinkedHashSet<>(ids.stream().filter(java.util.Objects::nonNull).toList()));
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
