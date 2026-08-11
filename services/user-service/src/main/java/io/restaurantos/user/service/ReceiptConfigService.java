package io.restaurantos.user.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.shared.exception.StateInvalidException;
import io.restaurantos.user.dto.ReceiptConfigDtos.CompletenessReport;
import io.restaurantos.user.dto.ReceiptConfigDtos.PrinterEntry;
import io.restaurantos.user.dto.ReceiptConfigDtos.PrinterRole;
import io.restaurantos.user.dto.ReceiptConfigDtos.ReceiptConfig;
import io.restaurantos.user.dto.ReceiptConfigDtos.ReceiptConfigResponse;
import io.restaurantos.user.entity.BranchEntity;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * Read and write a branch's printer registry.
 *
 * <p><b>Storage.</b> {@code branches.receipt_config}, the jsonb column that already exists. This
 * service is the ONLY thing in Phase 26 that touches that column; every other consumer — the
 * renderer, the agent, the kitchen router, the client bridge, the configuration UI — goes through
 * this service or through the frontend repository. That is what makes the Phase 17 migration a
 * two-method change instead of a search across the fleet.
 *
 * <p><b>Persistence path.</b> Writes go through {@link BranchService}, which owns the branch row:
 * same service, same repository, same tenant-scoped {@code get}. No second repository and no
 * second table.
 *
 * <p><b>Tenant scoping.</b> {@code branches} is RLS-scoped and {@link BranchService#get} is the
 * existing lookup, so a branch id belonging to another tenant is simply not found. Under forced
 * RLS an unscoped query returns zero rows rather than erroring, which is why the negative case is
 * asserted in {@code ReceiptConfigIT} rather than assumed from the policy's existence.
 */
@Service
public class ReceiptConfigService {

    private static final Logger log = LoggerFactory.getLogger(ReceiptConfigService.class);

    private final BranchService branchService;
    private final ObjectMapper objectMapper;

    public ReceiptConfigService(BranchService branchService, ObjectMapper objectMapper) {
        this.branchService = branchService;
        this.objectMapper = objectMapper;
    }

    /**
     * The stored configuration, or an explicitly EMPTY one for a branch nobody has configured.
     *
     * <p>Never null and never a 404 for the "not configured yet" case: a caller must be able to
     * distinguish "there are no printers here" from "the read failed", and both a null body and a
     * 404 collapse those two into one thing the UI then renders as an empty list.
     */
    @Transactional(readOnly = true)
    public ReceiptConfigResponse read(UUID branchId) {
        BranchEntity branch = branchService.getForCurrentTenant(branchId);
        ReceiptConfig config = deserialise(branch);
        return new ReceiptConfigResponse(config, report(config));
    }

    /**
     * Validate (already done declaratively by the time we are here), serialise, persist, and
     * report what is still missing.
     */
    @Transactional
    public ReceiptConfigResponse write(UUID branchId, ReceiptConfig config) {
        ReceiptConfig toStore = config == null ? ReceiptConfig.empty() : config;
        String json;
        try {
            json = objectMapper.writeValueAsString(toStore);
        } catch (JsonProcessingException e) {
            throw new StateInvalidException("Receipt configuration could not be serialised: " + e.getOriginalMessage());
        }
        branchService.updateReceiptConfig(branchId, json);
        return new ReceiptConfigResponse(toStore, report(toStore));
    }

    private ReceiptConfig deserialise(BranchEntity branch) {
        String raw = branch.getReceiptConfig();
        if (raw == null || raw.isBlank()) {
            return ReceiptConfig.empty();
        }
        try {
            ReceiptConfig parsed = objectMapper.readValue(raw, ReceiptConfig.class);
            return parsed == null ? ReceiptConfig.empty() : parsed;
        } catch (JsonProcessingException e) {
            // A column written by the legacy bare-string path before this plan closed it, or by
            // hand in psql. Surfaced LOUDLY rather than swallowed into an empty configuration:
            // returning empty here would tell a manager there are no printers configured when in
            // fact there is a configuration that cannot be read, and they would enter a second one.
            log.error("branch {} has an unreadable receipt_config: {}", branch.getId(), e.getOriginalMessage());
            throw new StateInvalidException(
                    "Branch " + branch.getId() + " has a stored receipt configuration that cannot be read. "
                            + "It predates the validated endpoint or was written by hand. "
                            + "Re-save it through PUT /api/v1/branches/{id}/receipt-config to repair it.");
        }
    }

    /**
     * Which declared kitchen stations no printer routes.
     *
     * <p>A kitchen station with no printer is the failure that presents as silence — the ticket is
     * enqueued for a destination that does not exist and nothing anywhere says so. Naming them in
     * the write response is the cheapest place to catch it.
     */
    private CompletenessReport report(ReceiptConfig config) {
        Set<String> routed = new LinkedHashSet<>();
        boolean hasReceiptPrinter = false;
        for (PrinterEntry entry : config.printers()) {
            if (entry.role() == PrinterRole.KITCHEN && entry.stationCode() != null) {
                routed.add(entry.stationCode());
            }
            if (entry.role() == PrinterRole.RECEIPT) {
                hasReceiptPrinter = true;
            }
        }

        List<String> unrouted = config.kitchenStations().stream()
                .filter(station -> !routed.contains(station))
                .toList();

        List<String> warnings = new ArrayList<>();
        if (config.agent() == null) {
            warnings.add("No print agent endpoint is configured; only the browser HTML bill will work.");
        }
        if (!hasReceiptPrinter) {
            warnings.add("No RECEIPT printer is configured; settlement will fall back to the browser HTML bill.");
        }
        for (PrinterEntry entry : config.printers()) {
            if (!entry.columnsMeasured()) {
                warnings.add("Printer '" + entry.id() + "' has an UNMEASURED column count ("
                        + entry.columns() + "); run the calibration print before trusting the layout.");
            }
        }

        boolean complete = unrouted.isEmpty() && hasReceiptPrinter && config.agent() != null;
        return new CompletenessReport(complete, unrouted, warnings);
    }
}
