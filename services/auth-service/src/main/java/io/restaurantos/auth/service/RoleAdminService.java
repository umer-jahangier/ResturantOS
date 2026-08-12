package io.restaurantos.auth.service;

import io.restaurantos.auth.dto.request.RoleWriteRequest;
import io.restaurantos.auth.dto.response.RoleCatalogDtos.RoleEntry;
import io.restaurantos.auth.entity.PermissionEntity;
import io.restaurantos.auth.entity.RoleEntity;
import io.restaurantos.auth.exception.InvalidUserRequestException;
import io.restaurantos.auth.exception.RoleCeilingExceededException;
import io.restaurantos.auth.exception.UnknownRoleCodeException;
import io.restaurantos.auth.repository.PermissionRepository;
import io.restaurantos.auth.repository.RolePermissionRepository;
import io.restaurantos.auth.repository.RoleRepository;
import io.restaurantos.auth.repository.UserBranchRoleRepository;
import io.restaurantos.shared.exception.DuplicateValueException;
import io.restaurantos.shared.exception.StateInvalidException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;

/**
 * The WRITE half of the role catalogue (S3) — composing a role out of the permission vocabulary.
 *
 * <p>Everything a role picker needed to exist has been in place since 13-07: {@code GET
 * /api/v1/roles} lists the roles a caller may assign with the codes each grants, and {@code GET
 * /api/v1/permissions} publishes the 76-code vocabulary grouped into 13 modules. What did not exist
 * was any way to make a new one. A restaurant's org chart had to be forced into the eight seeded
 * roles, and nowhere in the product could anyone see what any of them actually granted.
 *
 * <h2>The ceiling applies to creation, not only to assignment</h2>
 *
 * <p><b>You may put into a role only permissions you already hold.</b> Without that rule this
 * service is a privilege-escalation endpoint with a nicer UI than the one 13-11 closed: a
 * TENANT_ADMIN who cannot be granted OWNER (403 {@code ROLE_CEILING_EXCEEDED}) would simply create
 * "Head Waiter" carrying {@code rbac.manage}, assign it to themselves, and hold the umbrella
 * permission 13-02 split the tenant-administration authority precisely in order to withhold.
 *
 * <p>The comparison is {@link RoleCeiling#permits}, the same static predicate the read side and the
 * assignment write path share, so there is one implementation of "no more than you hold" in this
 * service and not three. Only its INPUT differs: assignment measures a role's grants, this measures
 * a request's. And like the assignment path it recomputes the caller's own permissions from the
 * database rather than reading them off the presented token — a token minted a minute ago still
 * carries a role revoked a second ago.
 *
 * <p>The ceiling is applied on edit and on delete as well, and in both directions. Editing means
 * measuring the role's CURRENT grants too, or a tenant admin could take a role an owner built and
 * strip {@code rbac.manage} out of it — destroying authority you do not hold is the same overreach
 * as granting it, and it is how a tenant loses its last administrator.
 *
 * <h2>Why the code is derived and never accepted</h2>
 *
 * <p>{@code role_code} is a foreign key in everything but name: it is what {@code user_branch_roles}
 * stores and what {@code role_permissions} keys on. A caller-supplied code could be {@code OWNER},
 * and a tenant row sharing a system role's code is the one collision the tenant-scoped catalogue
 * cannot resolve — {@code PermissionResolver} would union the platform grants with the tenant's and
 * mint a token holding both. Deriving the code and refusing any collision closes that at the only
 * door that can create one. It also means a rename does not move the identifier, so renaming
 * "Head Waiter" to "Section Head" leaves every assignment intact.
 */
@Service
public class RoleAdminService {

    private static final Logger log = LoggerFactory.getLogger(RoleAdminService.class);

    /** {@code roles.code} is VARCHAR(50); a derived code is truncated to fit rather than rejected. */
    private static final int MAX_CODE_LENGTH = 50;

    private final RoleRepository roleRepository;
    private final RolePermissionRepository rolePermissionRepository;
    private final PermissionRepository permissionRepository;
    private final UserBranchRoleRepository userBranchRoleRepository;
    private final PermissionResolver permissionResolver;

    public RoleAdminService(RoleRepository roleRepository,
                            RolePermissionRepository rolePermissionRepository,
                            PermissionRepository permissionRepository,
                            UserBranchRoleRepository userBranchRoleRepository,
                            PermissionResolver permissionResolver) {
        this.roleRepository = roleRepository;
        this.rolePermissionRepository = rolePermissionRepository;
        this.permissionRepository = permissionRepository;
        this.userBranchRoleRepository = userBranchRoleRepository;
        this.permissionResolver = permissionResolver;
    }

    /**
     * Create one of this tenant's own roles.
     *
     * @throws RoleCeilingExceededException 403, if the request asks for anything the caller lacks
     * @throws InvalidUserRequestException  400, if a permission code is not in the catalogue
     * @throws DuplicateValueException      409, if the derived code is already taken
     */
    @Transactional
    public RoleEntry create(UUID tenantId, UUID actingUserId, RoleWriteRequest request) {
        String name = requireName(request);
        List<String> permissions = validatedPermissions(request);
        requireWithinCeiling(actingUserId, permissions, "create");

        String code = deriveCode(name);
        for (RoleEntity existing : roleRepository.findVisibleToTenant(tenantId)) {
            if (existing.getCode().equalsIgnoreCase(code)) {
                throw new DuplicateValueException("name",
                    "A role called \"" + existing.getName() + "\" already exists"
                        + (existing.getTenantId() == null ? " on this platform" : "")
                        + ". Choose a different name.");
            }
        }

        RoleEntity role = new RoleEntity();
        role.setId(UUID.randomUUID());
        role.setTenantId(tenantId);
        role.setCode(code);
        role.setName(name);
        role.setSystem(false);
        roleRepository.save(role);

        for (String permission : permissions) {
            rolePermissionRepository.insertTenantGrant(tenantId, code, permission);
        }
        log.info("Tenant {} created custom role {} with {} permission(s), by user {}",
            tenantId, code, permissions.size(), actingUserId);
        return new RoleEntry(code, name, false, permissions);
    }

    /**
     * Replace what one of this tenant's roles is called and what it grants.
     *
     * <p>Replace, not merge: the request states the whole set. The grants are cleared and rewritten
     * inside one transaction, so a failure part-way leaves the role exactly as it was rather than
     * holding half a permission set — which is the state in which a role silently stops working for
     * everybody holding it.
     */
    @Transactional
    public RoleEntry update(UUID tenantId, UUID actingUserId, String roleCode,
                            RoleWriteRequest request) {
        RoleEntity role = requireTenantOwnedRole(tenantId, roleCode);
        String name = requireName(request);
        List<String> permissions = validatedPermissions(request);

        // Both sides of the edit. The role as it stands may carry authority this caller does not
        // hold; being able to rewrite it would then be a way to take that authority away from the
        // people who do.
        requireWithinCeiling(actingUserId, currentPermissionsOf(tenantId, role.getCode()), "edit");
        requireWithinCeiling(actingUserId, permissions, "edit");

        role.setName(name);
        roleRepository.save(role);

        rolePermissionRepository.deleteTenantGrants(tenantId, role.getCode());
        for (String permission : permissions) {
            rolePermissionRepository.insertTenantGrant(tenantId, role.getCode(), permission);
        }
        log.info("Tenant {} updated custom role {} to {} permission(s), by user {}",
            tenantId, role.getCode(), permissions.size(), actingUserId);
        // Counted rather than defaulted to zero: an edited role usually HAS holders, and a response
        // saying otherwise would be a lie the client could render before its list refetch lands.
        return new RoleEntry(role.getCode(), name, false, permissions,
            userBranchRoleRepository.countByTenantIdAndRoleCodeAndActiveTrue(tenantId, role.getCode()));
    }

    /**
     * Retire one of this tenant's roles.
     *
     * <p>Refused while anybody still holds it, and the refusal counts them. Deleting a role out from
     * under its holders would leave {@code user_branch_roles} rows pointing at a code with no grants
     * — which is not a locked-out user but something worse: a user who logs in successfully, holds
     * nothing, and sees a product with every screen missing. That is the exact failure
     * {@code UnknownRoleCodeException} was written to stop being creatable by typo, and it must not
     * become creatable by deletion instead.
     */
    @Transactional
    public void delete(UUID tenantId, UUID actingUserId, String roleCode) {
        RoleEntity role = requireTenantOwnedRole(tenantId, roleCode);
        requireWithinCeiling(actingUserId, currentPermissionsOf(tenantId, role.getCode()), "delete");

        long holders = userBranchRoleRepository
            .countByTenantIdAndRoleCodeAndActiveTrue(tenantId, role.getCode());
        if (holders > 0) {
            throw new StateInvalidException("ROLE_IN_USE",
                "\"" + role.getName() + "\" is still assigned to " + holders
                    + (holders == 1 ? " person" : " people")
                    + ". Move them to another role first, then delete this one.");
        }

        rolePermissionRepository.deleteTenantGrants(tenantId, role.getCode());
        roleRepository.delete(role);
        log.info("Tenant {} deleted custom role {}, by user {}", tenantId, role.getCode(), actingUserId);
    }

    // ─────────────────────────────────── the rules ────────────────────────────────────────────

    /**
     * Refuses unless every requested code is one {@code actingUserId} holds.
     *
     * <p>Recomputed from {@code user_branch_roles} and {@code role_permissions} rather than taken
     * from the caller's token, for the reason {@link RoleCeiling} records: a permission list on a
     * request is a claim about authority made by the party whose authority is in question.
     *
     * <p>Fails closed. An acting user who cannot be resolved — no id, no active assignment — holds
     * the empty set and can therefore compose nothing, which is a refusal rather than a pass.
     *
     * <p>The refusal names a COUNT and never the codes, matching {@link RoleCeilingExceededException}:
     * listing the permissions the caller lacks republishes exactly the map the ceiling exists to
     * withhold.
     */
    private void requireWithinCeiling(UUID actingUserId, List<String> requested, String verb) {
        Set<String> held = permissionsOfActingUser(actingUserId);
        if (RoleCeiling.permits(held, requested)) {
            return;
        }
        long beyond = requested.stream().filter(code -> !held.contains(code)).count();
        throw new RoleCeilingExceededException(
            "You cannot " + verb + " a role carrying " + beyond
                + " permission(s) you do not hold yourself. A role can only grant what its author "
                + "can already do.");
    }

    private Set<String> permissionsOfActingUser(UUID actingUserId) {
        if (actingUserId == null) {
            return Set.of();
        }
        try {
            return new TreeSet<>(permissionResolver.resolveDefault(actingUserId).permissions());
        } catch (IllegalStateException unresolvable) {
            return Set.of();
        }
    }

    /**
     * The role this tenant owns under {@code roleCode}, or a refusal naming which rule was hit.
     *
     * <p>An unknown code is 400 and a SYSTEM role is 409, and the two are deliberately different: a
     * typo is fixable by retyping, while "OWNER cannot be edited" is a fact about the platform that
     * no retype changes. Both are checked here rather than at each verb so edit and delete cannot
     * come to disagree about what is editable.
     */
    private RoleEntity requireTenantOwnedRole(UUID tenantId, String roleCode) {
        String code = roleCode == null ? "" : roleCode.trim();
        RoleEntity own = null;
        RoleEntity anyVisible = null;
        for (RoleEntity candidate : roleRepository.findVisibleToTenant(tenantId)) {
            if (!candidate.getCode().equalsIgnoreCase(code)) {
                continue;
            }
            anyVisible = candidate;
            if (tenantId != null && tenantId.equals(candidate.getTenantId())) {
                own = candidate;
            }
        }
        if (own != null) {
            return own;
        }
        if (anyVisible != null) {
            throw new StateInvalidException("SYSTEM_ROLE_IMMUTABLE",
                "\"" + anyVisible.getName() + "\" is a built-in role. Its permissions are the same "
                    + "on every installation and cannot be changed. Create your own role instead.");
        }
        throw new UnknownRoleCodeException(code);
    }

    /** What the role grants right now — this tenant's rows only, since a tenant role has no others. */
    private List<String> currentPermissionsOf(UUID tenantId, String roleCode) {
        return rolePermissionRepository
            .findPermissionCodesByRoleCodesForTenant(List.of(roleCode), tenantId)
            .stream()
            .distinct()
            .sorted()
            .toList();
    }

    private static String requireName(RoleWriteRequest request) {
        String name = request.name() == null ? "" : request.name().trim();
        if (name.length() < 2) {
            throw new InvalidUserRequestException("Enter a name for this role — at least 2 characters");
        }
        return name;
    }

    /**
     * The requested codes, de-duplicated and sorted, every one of them checked against the
     * catalogue.
     *
     * <p>A code that is not in {@code permissions} would persist happily — {@code role_permissions}
     * has no foreign key to it — and then grant nothing forever, silently, to everyone holding the
     * role. Naming the offending codes in the 400 is what turns that into an answer; they are not a
     * disclosure, because the caller just sent them.
     */
    private List<String> validatedPermissions(RoleWriteRequest request) {
        List<String> requested = request.permissions() == null ? List.of() : request.permissions();
        Set<String> distinct = new LinkedHashSet<>();
        for (String code : requested) {
            if (code != null && !code.isBlank()) {
                distinct.add(code.trim());
            }
        }
        if (distinct.isEmpty()) {
            throw new InvalidUserRequestException(
                "Tick at least one permission — a role that grants nothing lets its holders sign in "
                    + "to an empty product");
        }
        Set<String> known = new LinkedHashSet<>();
        for (PermissionEntity permission : permissionRepository.findAllById(distinct)) {
            known.add(permission.getCode());
        }
        List<String> unknown = new ArrayList<>();
        for (String code : distinct) {
            if (!known.contains(code)) {
                unknown.add(code);
            }
        }
        if (!unknown.isEmpty()) {
            throw new InvalidUserRequestException(
                "Not a permission on this platform: " + String.join(", ", unknown));
        }
        return distinct.stream().sorted().toList();
    }

    /**
     * A stable, collision-checkable identifier from what the administrator typed.
     *
     * <p>Uppercase A–Z, digits and underscore, which is the shape every seeded code already has, so
     * a custom role reads the same as a built-in one anywhere a code is displayed. A name made
     * entirely of punctuation or of a non-Latin script leaves nothing behind; that yields
     * {@code ROLE}, which then collides on the second attempt and is refused with a message naming
     * the name — better than minting an unreadable identifier nobody can talk about.
     */
    static String deriveCode(String name) {
        String code = name.trim().toUpperCase(Locale.ROOT)
            .replaceAll("[^A-Z0-9]+", "_")
            .replaceAll("^_+", "")
            .replaceAll("_+$", "");
        if (code.isEmpty()) {
            code = "ROLE";
        }
        return code.length() > MAX_CODE_LENGTH ? code.substring(0, MAX_CODE_LENGTH) : code;
    }
}
