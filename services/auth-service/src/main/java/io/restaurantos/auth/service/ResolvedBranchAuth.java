package io.restaurantos.auth.service;

import java.util.List;
import java.util.Map;
import java.util.UUID;

public record ResolvedBranchAuth(
    UUID branchId,
    List<String> roles,
    List<String> permissions,
    Map<String, Object> attributes
) {}
