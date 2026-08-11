package io.restaurantos.kitchen.authz;

import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * What stations a caller is allowed to look at (D-28-02).
 *
 * <h2>The single most dangerous line in this phase is the default</h2>
 *
 * <p><b>Absent means UNRESTRICTED.</b> Every user in this product today has no station assignment,
 * so if "no stations named" were read as "no stations permitted", every kitchen screen in every
 * tenant would go blank the moment this deployed — during service, with no error anywhere, looking
 * exactly like a product that had stopped receiving orders.
 *
 * <p>That is why this type exists at all rather than the callers passing a {@code Set<String>}
 * around. A set can be empty, and an empty set invites exactly one reading: "nothing is permitted".
 * {@link #unrestricted()} is a distinct state with no accessor that hands out an empty collection,
 * so the wrong reading is not available to make.
 *
 * <h2>Every degenerate input degrades OPEN</h2>
 *
 * <p>Absent attribute, present-but-empty value, wrong type, unparseable entry — all of them produce
 * {@link #unrestricted()}, and the malformed ones log a warning so an operator can see that
 * something is wrong <em>while the board keeps working</em>.
 *
 * <p>This is deliberately the opposite of the fail-closed posture the rest of this codebase uses for
 * authorization, and the difference is worth stating because a later reader "hardening" it would be
 * making a locally reasonable change with a product-wide outage attached. A station scope is not an
 * authorization boundary — it is a VIEW filter, chosen by a manager so a bartender is not reading
 * biryani tickets. Tenant and branch isolation are the security boundary, they are enforced
 * separately and BEFORE this, and they fail closed. Getting the view filter wrong shows somebody
 * too much of their own branch's board; getting it wrong in the other direction stops a restaurant
 * from cooking.
 */
public final class StationScope {

    private static final StationScope UNRESTRICTED = new StationScope(null);

    /** Null means unrestricted. Never exposed; see the class javadoc for why. */
    private final Set<String> permitted;

    private StationScope(Set<String> permitted) {
        this.permitted = permitted;
    }

    /** Sees every station in their branch — the state every existing user is in. */
    public static StationScope unrestricted() {
        return UNRESTRICTED;
    }

    /**
     * Restricted to exactly these codes.
     *
     * <p>An empty or all-blank collection returns {@link #unrestricted()} rather than a scope that
     * permits nothing. There is no legitimate meaning for "assigned to zero stations" that differs
     * from "not assigned", and allowing the two to be distinct is how one of them eventually gets
     * treated as an empty allow-list.
     */
    public static StationScope restrictedTo(Collection<String> codes) {
        if (codes == null || codes.isEmpty()) {
            return UNRESTRICTED;
        }
        Set<String> normalised = new LinkedHashSet<>();
        for (String code : codes) {
            if (code != null && !code.isBlank()) {
                normalised.add(code.trim().toUpperCase());
            }
        }
        return normalised.isEmpty() ? UNRESTRICTED : new StationScope(Set.copyOf(normalised));
    }

    /** True when this caller sees everything at their branch. */
    public boolean isUnrestricted() {
        return permitted == null;
    }

    /** May this caller see this station's tickets? Always true for an unrestricted scope. */
    public boolean permits(String stationCode) {
        if (permitted == null) {
            return true;
        }
        return stationCode != null && permitted.contains(stationCode.trim().toUpperCase());
    }

    /**
     * The permitted codes, for building a query predicate.
     *
     * <p>Throws for an unrestricted scope rather than returning an empty set — a caller that reaches
     * here without checking {@link #isUnrestricted()} first is about to build a query with an empty
     * {@code IN} clause, and this is the loud version of that mistake.
     */
    public Set<String> permittedCodes() {
        if (permitted == null) {
            throw new IllegalStateException(
                "An unrestricted scope has no code list. Check isUnrestricted() first — asking for "
                    + "the codes here means a query is about to be built with an empty IN clause, "
                    + "which returns no tickets and blacks out the board.");
        }
        return permitted;
    }

    @Override
    public String toString() {
        return permitted == null ? "StationScope[unrestricted]" : "StationScope" + permitted;
    }
}
