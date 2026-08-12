package io.restaurantos.kitchen.service;

import io.restaurantos.kitchen.client.PosStationClient;
import io.restaurantos.kitchen.client.PosStationClient.PosStation;
import io.restaurantos.kitchen.domain.model.KdsStation;
import io.restaurantos.kitchen.domain.model.StationType;
import io.restaurantos.kitchen.repository.KdsStationRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Keeps {@code kds_stations} in step with the station registry pos-service owns.
 *
 * <h2>The defect this exists to close</h2>
 *
 * <p>{@code kds_stations} used to have exactly one writer: {@link TicketRoutingService#route} →
 * {@code upsertStation}, which runs when a ticket is ROUTED. A station therefore did not exist on
 * the KDS until its first ticket landed on it. An admin could create PANTRY1 at {@code
 * /app/stations}, and the station picker, the board and the pantry cook's screen would all insist
 * there was no such station — indistinguishable from a station that had been deleted. Measured at
 * branch F-7: pos-service held 5 stations, {@code GET /kitchen/kds/stations} returned 3, and one of
 * those 3 (DEFAULT) exists in no registry anywhere.
 *
 * <p>Ticket-time upsert stays. It is still correct — it is how a ticket arriving for an unknown
 * free-text code gets a row rather than vanishing — but it is no longer the only way a station
 * becomes visible, which is what made it a defect.
 *
 * <h2>Why a synced projection rather than a live lookup</h2>
 *
 * <p>Because {@code StationType}'s javadoc already committed to it: "kitchen-service has to keep
 * serving its board when pos-service is down, which is the entire reason {@code kds_stations} is a
 * projection rather than a lookup." So this refreshes the projection on read and, when pos-service
 * cannot be reached, LEAVES THE PROJECTION ALONE and reports that it could not sync. A kitchen mid
 * service keeps the board it had; it does not get an empty screen because a different service is
 * restarting.
 *
 * <h2>What it will not touch</h2>
 *
 * <p>A {@code kds_stations} row whose code is in no pos station is left exactly as it is. That is
 * not laziness — {@code DEFAULT} is such a row, every unrouted item in the product lands on it,
 * and "reconciling it away" would black out the only board most of these tenants have. Rows are
 * only ever retired when pos-service NAMES them and says {@code active=false}.
 */
@Service
public class StationRegistryService {

    private static final Logger log = LoggerFactory.getLogger(StationRegistryService.class);

    /** What a sync attempt actually did — the caller needs "could not read" separate from "read zero". */
    public enum SyncOutcome {
        /** pos-service answered; the projection now matches it. */
        SYNCED,
        /** pos-service could not be read. The projection is whatever it already was. */
        REGISTRY_UNAVAILABLE
    }

    private final PosStationClient posStationClient;
    private final KdsStationRepository stationRepository;

    public StationRegistryService(PosStationClient posStationClient,
                                   KdsStationRepository stationRepository) {
        this.posStationClient = posStationClient;
        this.stationRepository = stationRepository;
    }

    /**
     * Pull the branch's stations from pos-service and reconcile the local projection.
     *
     * <p>Idempotent and write-only-when-dirty: a branch whose registry has not changed produces
     * zero UPDATEs, so this is safe to run on every read of the station list.
     */
    @Transactional
    public SyncOutcome syncBranch(UUID tenantId, UUID branchId) {
        Optional<List<PosStation>> registry = posStationClient.listStations(tenantId, branchId);
        if (registry.isEmpty()) {
            return SyncOutcome.REGISTRY_UNAVAILABLE;
        }

        int created = 0;
        int updated = 0;
        for (PosStation posStation : registry.get()) {
            if (posStation == null || posStation.code() == null || posStation.code().isBlank()) {
                continue;
            }
            Optional<KdsStation> existing =
                    stationRepository.findByBranchIdAndCode(branchId, posStation.code());
            if (existing.isPresent()) {
                if (refresh(existing.get(), posStation)) {
                    stationRepository.save(existing.get());
                    updated++;
                }
            } else if (posStation.active()) {
                // A station pos has already deactivated and the KDS has never seen is not worth a
                // row: there is nothing for it to show and nothing to retire.
                stationRepository.save(project(tenantId, branchId, posStation));
                created++;
            }
        }
        if (created > 0 || updated > 0) {
            log.info("Station registry synced for branch {}: {} projected, {} refreshed, {} in registry",
                    branchId, created, updated, registry.get().size());
        }
        return SyncOutcome.SYNCED;
    }

    private KdsStation project(UUID tenantId, UUID branchId, PosStation posStation) {
        KdsStation station = new KdsStation();
        station.setTenantId(tenantId);
        station.setBranchId(branchId);
        station.setCode(posStation.code());
        station.setName(nameOf(posStation));
        station.setActive(true);
        station.setSourceStationId(posStation.id());
        // A type pos did not send is the ENTITY DEFAULT (KITCHEN), not a guess written over a
        // stored value — there is no stored value yet on a row being created.
        StationType type = posStation.parsedType();
        if (type != null) {
            station.setStationType(type);
        }
        return station;
    }

    /** @return true when the row actually changed and needs saving. */
    private boolean refresh(KdsStation station, PosStation posStation) {
        boolean dirty = false;
        String name = nameOf(posStation);
        if (!name.equals(station.getName())) {
            // pos owns the name outright. The ticket-time upsert only ever promoted a placeholder
            // (name == code) because a fire event is a weaker source than the registry; the
            // registry is the registry, so a rename there is the answer.
            station.setName(name);
            dirty = true;
        }
        if (posStation.id() != null && !posStation.id().equals(station.getSourceStationId())) {
            station.setSourceStationId(posStation.id());
            dirty = true;
        }
        StationType type = posStation.parsedType();
        // Only when pos actually said something. An unknown-but-present value parses to null and
        // must leave the stored type alone (D-28-01) — the same rule the fire-event path follows,
        // and for the same reason: a newer pos and an older kitchen must not walk BAR back to
        // KITCHEN one refresh at a time.
        if (type != null && type != station.getStationType()) {
            station.setStationType(type);
            dirty = true;
        }
        if (posStation.active() != station.isActive()) {
            station.setActive(posStation.active());
            dirty = true;
        }
        return dirty;
    }

    private String nameOf(PosStation posStation) {
        return posStation.name() != null && !posStation.name().isBlank()
                ? posStation.name()
                : posStation.code();
    }
}
