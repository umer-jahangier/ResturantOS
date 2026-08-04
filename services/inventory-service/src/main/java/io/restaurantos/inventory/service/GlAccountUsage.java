package io.restaurantos.inventory.service;

import java.util.List;
import java.util.Locale;

/**
 * Which of a category's three GL slots an account is being chosen for, and the account types each
 * slot legitimately accepts.
 *
 * <p>This is what keeps the picker honest: without a per-slot type filter a manager can file a
 * revenue account under "Inventory GL account" and nothing objects until Phase 9 tries to post
 * against it. The same mapping gates both the picker's options and the server-side write
 * validation, so the two can never disagree.
 */
public enum GlAccountUsage {

    /** Balance-sheet value of stock owned. Only ever an asset account. */
    INVENTORY(List.of("ASSET")),

    /**
     * Cost of stock consumed by a sale. {@code COGS} is the precise type, but plenty of real charts
     * model food cost as a plain expense account, so both are accepted rather than rejecting a
     * chart that is merely structured differently.
     */
    COST(List.of("COGS", "EXPENSE")),

    /**
     * Stock lost without revenue — spoilage, spills, shrinkage. Same accepted types as
     * {@link #COST}: the point of a separate slot is that waste lands in its own ACCOUNT, not that
     * it must use a different account type.
     */
    WASTE(List.of("EXPENSE", "COGS"));

    private final List<String> accountTypes;

    GlAccountUsage(List<String> accountTypes) {
        this.accountTypes = accountTypes;
    }

    public List<String> accountTypes() {
        return accountTypes;
    }

    public boolean accepts(String accountType) {
        return accountType != null && accountTypes.contains(accountType.toUpperCase(Locale.ROOT));
    }

    /** Human-readable slot name for error copy — "the Inventory GL account", not "INVENTORY". */
    public String label() {
        return switch (this) {
            case INVENTORY -> "Inventory GL account";
            case COST -> "Cost GL account";
            case WASTE -> "Waste GL account";
        };
    }

    public static GlAccountUsage from(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new IllegalArgumentException("usage is required");
        }
        return GlAccountUsage.valueOf(raw.trim().toUpperCase(Locale.ROOT));
    }
}
