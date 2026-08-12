package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.enums.TillStatus;
import io.restaurantos.pos.domain.model.TillSession;
import io.restaurantos.pos.dto.EligibleCashierDto;
import io.restaurantos.pos.exception.PosExceptions;
import io.restaurantos.pos.feign.AuthUserDirectoryClient;
import io.restaurantos.pos.repository.TillSessionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Who may be handed a cash drawer at a branch, and whether a named person may be handed one now.
 *
 * <h2>Why this is a separate bean from {@link StaffNameDirectory}</h2>
 *
 * <p>{@code StaffNameDirectory} answers "what is this person called" and is fail-SOFT by design: a
 * name is decoration on a list of orders and an unreachable directory must not blank a manager's
 * screen. This bean answers "may this person hold the float", which is a money-custody decision,
 * and it is fail-CLOSED. Putting both behaviours behind one class would make the failure policy a
 * property of the call site rather than of the class, which is how a fail-soft catch ends up
 * swallowing a security check.
 *
 * <h2>The capability, named once</h2>
 *
 * <p>{@code pos.till.open} is the permission that makes someone a cashier — it is what
 * {@code TillController} gates the self-service open on, and what a person needs to settle cash
 * against the drawer afterwards. Opening a drawer for somebody who does not hold it would create a
 * till its owner can never cash up.
 */
@Service
public class TillCashierDirectory {

    private static final Logger log = LoggerFactory.getLogger(TillCashierDirectory.class);

    /** The capability that makes a person able to run a drawer. */
    static final String RUNS_A_DRAWER = "pos.till.open";

    private final AuthUserDirectoryClient authUserDirectoryClient;
    private final TillSessionRepository tillSessionRepository;
    private final StaffNameDirectory staffNameDirectory;

    public TillCashierDirectory(AuthUserDirectoryClient authUserDirectoryClient,
                                TillSessionRepository tillSessionRepository,
                                StaffNameDirectory staffNameDirectory) {
        this.authUserDirectoryClient = authUserDirectoryClient;
        this.tillSessionRepository = tillSessionRepository;
        this.staffNameDirectory = staffNameDirectory;
    }

    /**
     * Everyone at {@code branchId} who may run a drawer, with whether they already hold one.
     *
     * <p>Throws rather than returning an empty list when the directory cannot be reached. An empty
     * picker and a broken picker look identical on screen, and "there are no cashiers at this
     * branch" is a statement this method has no evidence for while auth-service is not answering —
     * exactly the empty-state-that-is-really-an-error trap this codebase keeps re-finding.
     */
    public List<EligibleCashierDto> listEligible(UUID tenantId, UUID branchId) {
        List<AuthUserDirectoryClient.BranchStaff> staff;
        try {
            staff = authUserDirectoryClient.listBranchStaff(branchId, RUNS_A_DRAWER, tenantId);
        } catch (Exception e) {
            log.warn("Could not list drawer-capable staff at branch {} (tenant {}): {}",
                    branchId, tenantId, e.toString());
            throw new PosExceptions.CashierNotEligibleForTillException(
                    "The staff directory is not answering, so the list of cashiers cannot be read. "
                            + "Try again in a moment.");
        }
        // ONE query for who is already holding a drawer, not one per person: this list is rendered
        // every time a duty manager opens the panel, and a branch with twenty cashiers would
        // otherwise be twenty round trips for a boolean.
        Set<UUID> holdingADrawer = tillSessionRepository
                .findByBranchIdAndStatus(branchId, TillStatus.OPEN).stream()
                .map(TillSession::getCashierId)
                .collect(Collectors.toSet());
        return staff.stream()
                .map(s -> new EligibleCashierDto(
                        s.userId(),
                        s.displayName(),
                        s.email(),
                        s.roleCode(),
                        holdingADrawer.contains(s.userId())))
                .toList();
    }

    /**
     * Refuse unless {@code cashierId} is rostered at {@code branchId} with {@code pos.till.open}.
     *
     * <p>Fail-closed on every branch of the decision, including transport failure. The alternative
     * — trust the id the client sent when the directory is unreachable — would let a request name
     * anyone in the tenant, or anyone at all, on the one call that decides whose name is on the
     * cash.
     */
    public void requireCanRunADrawer(UUID tenantId, UUID branchId, UUID cashierId, String cashierName) {
        AuthUserDirectoryClient.ResolvedAuth resolved;
        try {
            resolved = authUserDirectoryClient.getUserPermissions(cashierId, branchId, tenantId);
        } catch (Exception e) {
            // auth-service answers 500 for "no active assignment at this branch" — the common,
            // legitimate case of naming somebody who does not work here — so a transport failure
            // and a genuine "not rostered" arrive the same way. Both are refusals; the message
            // says the thing that is true of both rather than guessing which one happened.
            log.warn("Could not resolve {} at branch {} (tenant {}): {}",
                    cashierId, branchId, tenantId, e.toString());
            throw new PosExceptions.CashierNotEligibleForTillException(
                    cashierName + " could not be confirmed as a cashier at this branch, so a "
                            + "drawer cannot be opened for them. They may not be rostered here — "
                            + "check their branch assignment, then try again.");
        }
        if (resolved == null || !resolved.grants(RUNS_A_DRAWER)) {
            throw new PosExceptions.CashierNotEligibleForTillException(
                    cashierName + " cannot be given a till at this branch: their role here does not "
                            + "allow running a cash drawer. Assign them a cashier role first — a "
                            + "drawer they cannot settle against could never be cashed up.");
        }
    }

    /**
     * The name to print in a refusal or a confirmation. Falls back to the id — never to a blank,
     * which reads as "nobody" and makes an error message unusable.
     *
     * <p><b>It is resolved BEFORE the permission check</b>, so a refused caller is told whose
     * drawer they tried to open rather than being told "forbidden" about nothing. The disclosure
     * that buys is bounded to a colleague's display name in the caller's OWN tenant — the lookup
     * carries {@code X-Tenant-Id} from the caller's own context, and a caller must already possess
     * that person's user id to ask. Naming them is what makes the refusal actionable ("ask a
     * manager to open it for THEM"), which is the point of the message.
     */
    public String nameOf(UUID tenantId, UUID userId) {
        String name = staffNameDirectory.resolve(tenantId, userId);
        return name != null && !name.isBlank() ? name : userId.toString();
    }
}
