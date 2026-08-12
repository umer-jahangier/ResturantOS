package io.restaurantos.pos.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.pos.feign.UserBranchClient;
import io.restaurantos.shared.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * The branch's printer registry, in the shape a print agent needs to drive a printer.
 *
 * <h2>Why this exists — the seam that was missing</h2>
 *
 * <p>Before this class, the registry was readable by exactly two things: a settings screen (over a
 * user JWT, which an agent does not have) and {@code PrintDispatchService}, which used it to
 * resolve a job's {@code targetPrinterId} and then threw the rest away. The agent therefore
 * received a job addressed to a printer id and had <b>no way to learn what that id meant</b> — it
 * fell back to a printers array in its own local JSON config file. Configuring a printer in the
 * product changed nothing at the till, which is the "structurally present, behaviourally absent"
 * shape this repair exists to remove.
 *
 * <p>So the claim response carries the registry. The agent's poll already runs every few seconds,
 * it is already authenticated as a device, and it is already scoped to one branch by the ROW its
 * credential resolved to — so this is the cheapest correct channel available, and it needs no new
 * gateway path (which would have had to be added to {@code JwtGlobalFilter.AGENT_PATHS}, a security
 * boundary this repair had no reason to touch).
 *
 * <h2>What is deliberately NOT here</h2>
 *
 * <p>No header, no footer, no FBR preference and no agent endpoint URL. The agent needs to reach a
 * printer; it does not need the branch's document layout preferences, and a payload that carries
 * more than the recipient uses is a payload nobody prunes later.
 *
 * <h2>Failure direction</h2>
 *
 * <p>Fail-SOFT, the same direction {@link PrintDispatchService#readRegistry} chose: an unreadable
 * registry yields an EMPTY list and a WARN, never an exception. The claim response is on the path
 * that delivers a kitchen ticket, and a settings lookup must not be able to stop paper that is
 * already queued. An agent that receives an empty registry answers "no printer &lt;id&gt; is
 * configured" per job, which is a visible, per-job failure with a row behind it — not silence.
 */
@Service
public class BranchPrinterRegistryService {

    private static final Logger log = LoggerFactory.getLogger(BranchPrinterRegistryService.class);

    private final UserBranchClient userBranchClient;
    private final TenantContext tenantContext;
    private final ObjectMapper objectMapper;

    public BranchPrinterRegistryService(UserBranchClient userBranchClient,
                                        TenantContext tenantContext,
                                        ObjectMapper objectMapper) {
        this.userBranchClient = userBranchClient;
        this.tenantContext = tenantContext;
        this.objectMapper = objectMapper;
    }

    /**
     * The subset of 26-02's {@code PrinterEntry} an agent acts on. Field names match that DTO and
     * the agent's own {@code config.ts} exactly, so this is a transport rather than a translation —
     * a renamed field here would be a silent routing change in a kitchen.
     */
    public record AgentPrinter(String id,
                               String role,
                               String stationCode,
                               String transport,
                               String host,
                               Integer port,
                               String systemPrinterName,
                               Integer widthMm,
                               Integer columns,
                               boolean columnsMeasured,
                               String codepage,
                               String cut,
                               Integer drawerPin,
                               Integer drawerPulseMs) {}

    public List<AgentPrinter> forBranch(UUID branchId) {
        UUID tenantId = tenantContext.requireTenantId();
        JsonNode registry;
        try {
            UserBranchClient.BranchDetail detail = userBranchClient.getBranch(branchId, tenantId);
            if (detail == null || detail.receiptConfig() == null || detail.receiptConfig().isBlank()) {
                return List.of();
            }
            registry = objectMapper.readTree(detail.receiptConfig());
        } catch (Exception e) {
            log.warn("branch {} printer registry unreadable while answering an agent poll: {}",
                    branchId, e.toString());
            return List.of();
        }

        List<AgentPrinter> printers = new ArrayList<>();
        for (JsonNode p : registry.path("printers")) {
            String id = text(p, "id");
            if (id == null || id.isBlank()) {
                // A registry entry with no id addresses nothing. Skipped rather than shipped, so
                // the agent never holds a printer it cannot be sent a job for.
                continue;
            }
            printers.add(new AgentPrinter(
                    id,
                    text(p, "role"),
                    text(p, "stationCode"),
                    text(p, "transport"),
                    text(p, "host"),
                    integer(p, "port"),
                    text(p, "systemPrinterName"),
                    integer(p, "widthMm"),
                    integer(p, "columns"),
                    p.path("columnsMeasured").asBoolean(false),
                    text(p, "codepage"),
                    text(p, "cut"),
                    integer(p, "drawerPin"),
                    integer(p, "drawerPulseMs")));
        }
        return printers;
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.path(field);
        return value.isMissingNode() || value.isNull() ? null : value.asText();
    }

    private static Integer integer(JsonNode node, String field) {
        JsonNode value = node.path(field);
        return value.isMissingNode() || value.isNull() || !value.isNumber() ? null : value.asInt();
    }
}
