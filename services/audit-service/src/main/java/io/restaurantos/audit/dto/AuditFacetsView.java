package io.restaurantos.audit.dto;

import java.util.List;

/**
 * The filter vocabulary a tenant's audit log actually contains, for the window being read.
 *
 * <p>Both lists are read from the rows rather than declared, so every option in the UI's filters
 * resolves to at least one row. See {@code AuditQueryController#getFacets}.
 *
 * @param actions       distinct {@code action} values, alphabetically
 * @param resourceTypes distinct non-null {@code resource_type} values, alphabetically
 */
public record AuditFacetsView(List<String> actions, List<String> resourceTypes) {}
