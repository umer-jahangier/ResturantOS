package io.restaurantos.pos.ws;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.UUID;

/**
 * Announces a committed menu change to every terminal of the tenant.
 *
 * <p>Two properties are the whole reason this is a class rather than a call:
 *
 * <ol>
 *   <li><b>After COMMIT, never before.</b> {@code MenuServiceImpl}'s writes are
 *       {@code @Transactional}, so pushing from inside one would tell terminals to re-read a
 *       menu that has not been written yet — and worse, they might win the race and re-cache
 *       the OLD row, producing a stale grid that looks freshly refreshed. It would also lie
 *       outright on rollback: "the naan is 86'd" for a change that never happened.
 *       Registering a {@link TransactionSynchronization} is the same mechanism
 *       {@code PrintDispatchService} already uses on the fire seam, for the same reason.</li>
 *   <li><b>Nothing here may reach the manager.</b> Spring RETHROWS an exception escaping
 *       {@code afterCommit} to the caller of the transactional method, so an unguarded socket
 *       failure would surface as a failed menu edit even though the edit committed perfectly.
 *       A terminal that misses a frame falls back to its next ordinary read; a manager who is
 *       told their deactivation failed will deactivate it twice.</li>
 * </ol>
 */
@Component
public class MenuLiveNotifier {

    private static final Logger log = LoggerFactory.getLogger(MenuLiveNotifier.class);

    private final PosOrderWebSocketHandler webSocketHandler;

    public MenuLiveNotifier(PosOrderWebSocketHandler webSocketHandler) {
        this.webSocketHandler = webSocketHandler;
    }

    public void notifyAfterCommit(UUID tenantId, MenuChangedFrame frame) {
        if (tenantId == null || frame == null) {
            return;
        }
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            // No transaction to hang off (a direct service call outside @Transactional). Push
            // now rather than silently doing nothing — a dropped notification is the exact
            // failure this class exists to end.
            push(tenantId, frame);
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                push(tenantId, frame);
            }
        });
    }

    private void push(UUID tenantId, MenuChangedFrame frame) {
        try {
            webSocketHandler.notifyMenuChanged(tenantId, frame);
        } catch (Throwable t) {
            log.warn("Menu live notification failed (tenant={} change={}) — the menu change itself "
                    + "is committed and unaffected", tenantId, frame.change(), t);
        }
    }
}
