package io.restaurantos.auth.repository;

import io.restaurantos.auth.entity.UserEntity;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface UserRepository extends JpaRepository<UserEntity, UUID> {

    /**
     * The login lookup. Takes no tenant because login sets the tenant GUC first and the row-level
     * -security policy on {@code users} scopes the read — do not "fix" this by adding a tenant
     * parameter without reading {@code AuthServiceImpl.login} first.
     */
    Optional<UserEntity> findByEmail(String email);

    /**
     * The login lookup, with the tenant carried in the query as well as in the policy — 16a-01.
     *
     * <h2>Why {@link #findByEmail} was not enough</h2>
     *
     * <p>{@code users} is unique on {@code (tenant_id, lower(email))}, NOT on the address alone:
     * changeset 058 kept cross-tenant reuse legal on purpose. {@code findByEmail} returns an
     * {@code Optional}, so it is correct only for as long as the row-level-security policy is the
     * thing narrowing the result to one tenant. On the live database it is — {@code auth_user} is
     * {@code NOSUPERUSER NOBYPASSRLS} — but that makes the correctness of the login lookup rest
     * entirely on a control that <b>cannot be exercised by any test in this repository</b>, because
     * Testcontainers' Postgres user is a SUPERUSER and the policy is inert under it.
     *
     * <p>That is not theoretical. Writing {@code UnifiedLoginIT}'s duplicate-address fixture made
     * {@code findByEmail} match two rows and login answered <b>HTTP 500</b>
     * ({@code NonUniqueResultException}) — on the ORDINARY slug-bearing path, not the new one. On a
     * database where the policy is enforced that cannot happen; on one where it has been
     * misconfigured, dropped by a migration, or is being bypassed by a superuser connection, the
     * login endpoint fails open into a 500 instead of quietly working. Carrying the predicate here
     * gives two independent controls and makes the second one assertable in CI — the same reasoning
     * {@link #findPageForTenant} and {@link #findByIdForTenant} already record.
     *
     * <p><b>{@code lower(email)} is compared, not {@code email}.</b> The callers lower-case the
     * submitted address and 058's unique index is on {@code lower(email)}, so matching on the raw
     * column would make a row stored as {@code Bob@x} unreachable at login while the index treats it
     * as the same account.
     *
     * @param email a PRE-LOWERCASED address
     */
    @Query("""
        SELECT u FROM UserEntity u
         WHERE u.tenantId = :tenantId
           AND LOWER(u.email) = :email
           AND u.deletedAt IS NULL
        """)
    Optional<UserEntity> findByTenantAndEmail(@Param("tenantId") UUID tenantId,
                                              @Param("email") String email);

    /**
     * One page of a tenant's users, deterministically ordered.
     *
     * <h2>Why the tenant predicate is in the query as well as in the policy</h2>
     *
     * <p>{@code users} is {@code FORCE ROW LEVEL SECURITY}, and {@link UserEntity} also carries
     * Hibernate's {@code tenantFilter}. Neither can be relied on alone here. The RLS policy is
     * <b>inert in every integration test in this repository</b>, because Testcontainers' Postgres
     * user is a SUPERUSER — so a list that leaned on it would be untested by construction, which is
     * precisely how {@code ab7e59a} and {@code 7609a0d} shipped broken. The Hibernate filter is
     * enabled by {@code TenantFilterInterceptor} from a JWT, and these are {@code /internal/**}
     * paths where there is no JWT. Carrying the predicate here gives two independent controls, one
     * of which CI can actually assert, and it is the reason a cross-tenant read returns nothing
     * rather than everything on a database that does not enforce the policy.
     *
     * <h2>The ordering</h2>
     *
     * <p>{@code (email, id)} — email because it is what an administrator scans for, id because
     * email alone is not a total order the moment two tenants' worth of rows share the index, and
     * an unstable sort makes page 2 silently omit and repeat rows. Fixed in the query rather than
     * taken from {@code Pageable} so a caller cannot ask for an order the supporting index does not
     * serve, and so the contract 13-12 codes against does not depend on a query parameter.
     *
     * @param activeOnly when true, only {@code is_active} rows; when false, all live rows
     * @param term a pre-lowercased {@code %fragment%}, or null for no search
     */
    @Query(value = """
        SELECT u FROM UserEntity u
         WHERE u.tenantId = :tenantId
           AND u.deletedAt IS NULL
           AND (:activeOnly = false OR u.active = true)
           AND (:term IS NULL
                OR LOWER(u.email) LIKE :term
                OR LOWER(COALESCE(u.fullName, '')) LIKE :term)
         ORDER BY u.email ASC, u.id ASC
        """,
        countQuery = """
        SELECT COUNT(u) FROM UserEntity u
         WHERE u.tenantId = :tenantId
           AND u.deletedAt IS NULL
           AND (:activeOnly = false OR u.active = true)
           AND (:term IS NULL
                OR LOWER(u.email) LIKE :term
                OR LOWER(COALESCE(u.fullName, '')) LIKE :term)
        """)
    Page<UserEntity> findPageForTenant(@Param("tenantId") UUID tenantId,
                                       @Param("activeOnly") boolean activeOnly,
                                       @Param("term") String term,
                                       Pageable pageable);

    /**
     * One live user of one tenant.
     *
     * <p>Tenant-scoped in the query for the same reason as the page above, and it is what makes a
     * cross-tenant fetch a clean empty rather than a row: the caller then receives 404, which does
     * not confirm that the identifier exists.
     */
    @Query("""
        SELECT u FROM UserEntity u
         WHERE u.id = :userId
           AND u.tenantId = :tenantId
           AND u.deletedAt IS NULL
        """)
    Optional<UserEntity> findByIdForTenant(@Param("userId") UUID userId,
                                           @Param("tenantId") UUID tenantId);

    /**
     * The pre-flight duplicate check for a create, matching changeset 058's index exactly —
     * {@code lower(email)}, one tenant, live rows only.
     *
     * <p>It is a courtesy, not the enforcement. Two concurrent creates can both pass it; the unique
     * index is what makes the second one fail. Its purpose is to answer with a named 409 in the
     * overwhelmingly common single-request case, instead of a generic integrity-violation conflict
     * that names nothing.
     */
    @Query("""
        SELECT u FROM UserEntity u
         WHERE u.tenantId = :tenantId
           AND LOWER(u.email) = :email
           AND u.deletedAt IS NULL
        """)
    Optional<UserEntity> findLiveByTenantAndLowercasedEmail(@Param("tenantId") UUID tenantId,
                                                            @Param("email") String email);
}
