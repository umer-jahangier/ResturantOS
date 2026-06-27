package io.restaurantos.auth.service;

import io.restaurantos.auth.dto.response.BranchRoleAssignmentResponse;
import io.restaurantos.auth.repository.UserBranchRoleRepository;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class BranchAssignmentService {

    private final UserBranchRoleRepository userBranchRoleRepository;
    private final EntityManager entityManager;

    public BranchAssignmentService(UserBranchRoleRepository userBranchRoleRepository,
                                   EntityManager entityManager) {
        this.userBranchRoleRepository = userBranchRoleRepository;
        this.entityManager = entityManager;
    }

    @Transactional(readOnly = true)
    public List<BranchRoleAssignmentResponse> listActive(UUID tenantId, UUID userId) {
        setTenantGuc(tenantId);
        return userBranchRoleRepository.findByUserIdAndActiveTrue(userId).stream()
            .map(a -> new BranchRoleAssignmentResponse(a.getBranchId(), a.getRoleCode()))
            .toList();
    }

    private void setTenantGuc(UUID tenantId) {
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
            .setParameter("tid", tenantId.toString())
            .getSingleResult();
    }
}
