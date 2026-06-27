package io.restaurantos.auth.dto.response;

import java.util.UUID;

public record BranchRoleAssignmentResponse(UUID branchId, String roleCode) {}
