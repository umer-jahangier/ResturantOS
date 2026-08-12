package io.restaurantos.auth.service;

import io.restaurantos.auth.dto.response.BranchRoleAssignmentResponse;
import io.restaurantos.auth.dto.response.BranchStaffResponse;
import io.restaurantos.auth.repository.UserBranchRoleRepository;
import io.restaurantos.auth.repository.UserRepository;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class BranchAssignmentService {

    private final UserBranchRoleRepository userBranchRoleRepository;
    private final UserRepository userRepository;
    private final EntityManager entityManager;

    public BranchAssignmentService(UserBranchRoleRepository userBranchRoleRepository,
                                   UserRepository userRepository,
                                   EntityManager entityManager) {
        this.userBranchRoleRepository = userBranchRoleRepository;
        this.userRepository = userRepository;
        this.entityManager = entityManager;
    }

    @Transactional(readOnly = true)
    public List<BranchRoleAssignmentResponse> listActive(UUID tenantId, UUID userId) {
        setTenantGuc(tenantId);
        return userBranchRoleRepository.findByUserIdAndActiveTrue(userId).stream()
            .map(a -> new BranchRoleAssignmentResponse(a.getBranchId(), a.getRoleCode()))
            .toList();
    }

    /**
     * Everyone rostered at one branch whose role there grants {@code permissionCode}.
     *
     * <p>Exists for the duty manager's "open a drawer for…" picker in pos-service. The permission
     * is a REQUIRED parameter rather than an optional filter on purpose: an unfiltered branch
     * roster is a staff directory, and this endpoint is reachable by any service holding the
     * internal secret. Making the caller state the capability keeps the answer scoped to the
     * question being asked.
     */
    @Transactional(readOnly = true)
    public List<BranchStaffResponse> listBranchStaffWithPermission(UUID tenantId, UUID branchId,
                                                                   String permissionCode) {
        setTenantGuc(tenantId);
        return userRepository.findBranchStaffWithPermission(tenantId, branchId, permissionCode)
            .stream()
            .map(r -> new BranchStaffResponse(r.getId(), r.getEmail(), r.getFullName(), r.getRoleCode()))
            .toList();
    }

    private void setTenantGuc(UUID tenantId) {
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
            .setParameter("tid", tenantId.toString())
            .getSingleResult();
    }
}
