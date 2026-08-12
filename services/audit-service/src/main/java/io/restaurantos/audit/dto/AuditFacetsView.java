package io.restaurantos.audit.dto;

import java.time.LocalDate;
import java.util.List;

/**
 * The filter vocabulary a tenant's audit log actually contains, for the window being read.
 *
 * <p>Both lists are read from the rows rather than declared, so every option in the UI's filters
 * resolves to at least one row. See {@code AuditQueryController#getFacets}.
 *
 * <h2>Why the window is part of the answer</h2>
 *
 * <p>The vocabulary is only true OF a window, so the window travels with it. When no dates are
 * asked for the server reads the last {@code DEFAULT_WINDOW_DAYS} days rather than all of history,
 * and a screen that shows 90 days of a seven-year record without saying so tells the reader that is
 * the whole record — the same false impression as an empty filter option, arriving by a different
 * route. These two fields are what let the screen name its window instead of recomputing it from a
 * second copy of the constant that can drift from the server's.
 *
 * @param actions       distinct {@code action} values, alphabetically
 * @param resourceTypes distinct non-null {@code resource_type} values, alphabetically
 * @param windowFrom    first day covered, inclusive, cut in the request's zone
 * @param windowTo      last day covered, inclusive, cut in the request's zone
 */
public record AuditFacetsView(List<String> actions, List<String> resourceTypes,
                              LocalDate windowFrom, LocalDate windowTo) {}
