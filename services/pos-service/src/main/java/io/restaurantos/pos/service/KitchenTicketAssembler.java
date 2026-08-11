package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.model.DiningTable;
import io.restaurantos.pos.domain.model.Station;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.repository.DiningTableRepository;
import io.restaurantos.pos.repository.StationRepository;
import io.restaurantos.shared.print.PrintDocument;
import io.restaurantos.shared.print.ReceiptAmount;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Turns one fire into the paper a chef works from — one ticket per station, carrying only the lines
 * that were just fired.
 *
 * <h2>The revision decides which lines are new; this class does not</h2>
 *
 * <p>{@code OrderServiceImpl.sendToKds} already owns the revision semantics: it selects the PENDING
 * lines, stamps them {@code SENT} with the next revision number, and builds the KDS payload from
 * exactly that set. This assembler is handed that same set of item ids. It does not re-derive it
 * from statuses or timestamps, because a second derivation that disagrees with the first is how a
 * kitchen ends up cooking the starter twice.
 *
 * <h2>No money, structurally</h2>
 *
 * <p>{@link PrintDocument}'s compact constructor refuses totals, a tax breakdown, tenders, a fiscal
 * region and a drawer instruction on a {@code KITCHEN_TICKET}. This class relies on that rather
 * than adding a second guard. The one money shape it MUST still supply is
 * {@link PrintDocument.Line}'s unit price and line total, which the document schema declares
 * non-optional — so it supplies {@link ReceiptAmount#zero()} on every line, and
 * {@code KitchenTicketAssemblerIT} scans the produced document GENERICALLY (walking record
 * components by reflection, not a list of field names) for any {@code ReceiptAmount} carrying a
 * non-zero paisa. A field added to the schema in a later phase cannot slip an amount past that.
 *
 * <h2>An item with no station is a visible ticket, never a dropped line</h2>
 *
 * <p>The defect register records that {@code menu_items.station_id} is null for every seeded row.
 * If unstationed items were silently dropped, the first real service would produce blank tickets
 * and nothing would say why. They go to {@link #UNASSIGNED_STATION} instead, which prints.
 */
@Service
public class KitchenTicketAssembler {

    /**
     * The station a line lands on when it carries none. Uppercase and reserved: it is matched
     * against configured station codes, and a restaurant that genuinely names a station
     * "UNASSIGNED" has bigger problems than this collision.
     */
    public static final String UNASSIGNED_STATION = "UNASSIGNED";

    private final OrderService orderService;
    private final StationRepository stationRepository;
    private final DiningTableRepository tableRepository;
    private final TenantContext tenantContext;

    public KitchenTicketAssembler(OrderService orderService,
                                  StationRepository stationRepository,
                                  DiningTableRepository tableRepository,
                                  TenantContext tenantContext) {
        this.orderService = orderService;
        this.stationRepository = stationRepository;
        this.tableRepository = tableRepository;
        this.tenantContext = tenantContext;
    }

    /** One station's ticket. The station code travels beside the document because it is ROUTING. */
    public record StationTicket(String stationCode, PrintDocument document) {}

    /**
     * @param firedItemIds the ids {@code sendToKds} just stamped with {@code revisionNo}. The
     *                     assembler filters to these and to nothing else.
     */
    @Transactional(readOnly = true)
    public List<StationTicket> assemble(UUID orderId, UUID branchId, int revisionNo,
                                        Set<UUID> firedItemIds) {
        UUID tenantId = tenantContext.requireTenantId();
        OrderDto order = orderService.getOrder(orderId, branchId);
        return assemble(order, tenantId, revisionNo, firedItemIds);
    }

    /** As above, for a caller that already holds the order — avoids a second read. */
    public List<StationTicket> assemble(OrderDto order, UUID tenantId, int revisionNo,
                                        Set<UUID> firedItemIds) {
        // LinkedHashMap: the stations come out in the order their first line appears on the order,
        // which is the order the cook added them in. Stable output makes the tests readable and
        // makes two runs of the same fire produce the same paper.
        Map<String, List<OrderDto.OrderItemDto>> byStation = new LinkedHashMap<>();
        for (OrderDto.OrderItemDto item : order.items()) {
            if (!firedItemIds.contains(item.id())) {
                continue;
            }
            String station = item.kdsStation() == null || item.kdsStation().isBlank()
                    ? UNASSIGNED_STATION
                    : item.kdsStation();
            byStation.computeIfAbsent(station, k -> new ArrayList<>()).add(item);
        }
        if (byStation.isEmpty()) {
            return List.of();
        }

        Map<String, String> stationNames = stationNames(tenantId, order.branchId(), byStation.keySet());
        String tableLabel = tableLabel(order, tenantId);
        Instant firedAt = byStation.values().stream()
                .flatMap(List::stream)
                .map(OrderDto.OrderItemDto::firedAt)
                .filter(java.util.Objects::nonNull)
                .findFirst()
                .orElse(null);

        // The order-level note goes on EVERY station's ticket. "No nuts on this table" is a fact
        // about the order, not about one pass; a station that does not see it plates the allergen.
        List<String> orderInstructions = order.notes() == null || order.notes().isBlank()
                ? List.of()
                : List.of(order.notes());

        List<StationTicket> tickets = new ArrayList<>();
        for (Map.Entry<String, List<OrderDto.OrderItemDto>> entry : byStation.entrySet()) {
            String station = entry.getKey();
            List<OrderDto.OrderItemDto> items = entry.getValue();
            tickets.add(new StationTicket(
                station,
                new PrintDocument(
                        PrintDocument.SCHEMA_VERSION,
                        PrintDocument.DocumentType.KITCHEN_TICKET,
                        PrintDocument.Provenance.SERVER,
                        tenantId,
                        order.branchId(),
                        order.id(),
                        order.orderNo(),
                        // Placeholder issue metadata, exactly as ReceiptDocumentAssembler leaves
                        // it: allocating a sequence is a write and this method is read-only.
                        // PrintJobService re-stamps it when it writes the row.
                        new PrintDocument.Issue(1L, false, Instant.now(), null),
                        // No branch identity block. A chef does not need the restaurant's NTN, and
                        // 80 mm of thermal roll in a kitchen is worth more than a letterhead.
                        null,
                        new PrintDocument.Ticket(
                                station,
                                stationNames.get(station),
                                order.type() == null ? null : order.type().name(),
                                tableLabel,
                                order.coverCount() > 0 ? order.coverCount() : null,
                                revisionNo,
                                firedAt,
                                // Not populated: pos-service has no user-name lookup and adding
                                // one is a user-service change 26-07 does not make. The reference
                                // below is what the renderer falls back to. Deferred item D-7.
                                null,
                                order.cashierId(),
                                orderInstructions),
                        items.stream().map(KitchenTicketAssembler::toLine).toList(),
                        null,          // totals — refused on a kitchen ticket
                        List.of(),     // tax breakdown — refused
                        List.of(),     // tenders — refused
                        null,          // fiscal — refused
                        null,          // drawer — refused; a kitchen printer does not open the till
                        // FULL, not PARTIAL: two stations firing seconds apart produce two tickets
                        // that must come off the roll as two pieces of paper. A partial cut leaves
                        // them joined and a cook tears the wrong one.
                        new PrintDocument.Cut(PrintDocument.CutMode.FULL),
                        null)));
        }
        return List.copyOf(tickets);
    }

    /**
     * A line as a chef reads it: quantity, name, modifiers, note — and zero money.
     *
     * <p>{@link PrintDocument.Line} declares its unit price and line total non-optional, so zero is
     * the value that carries no information rather than the value that was omitted. The generic
     * money scan in the test is what keeps that true.
     */
    private static PrintDocument.Line toLine(OrderDto.OrderItemDto item) {
        List<String> modifiers = item.modifiers() == null ? List.of()
                : item.modifiers().stream().map(OrderDto.ModifierDto::modifierNameSnapshot).toList();
        return new PrintDocument.Line(
                item.itemNameSnapshot(),
                item.quantity(),
                ReceiptAmount.zero(),
                ReceiptAmount.zero(),
                modifiers,
                item.notes(),
                item.kdsStation() == null || item.kdsStation().isBlank()
                        ? UNASSIGNED_STATION
                        : item.kdsStation());
    }

    /** Display names for the station codes on this fire, when the catalogue has them. */
    private Map<String, String> stationNames(UUID tenantId, UUID branchId, Set<String> codes) {
        Map<String, String> names = new LinkedHashMap<>();
        for (Station station : stationRepository.findByTenantIdAndBranchId(tenantId, branchId)) {
            if (codes.contains(station.getCode())) {
                names.put(station.getCode(), station.getName());
            }
        }
        return names;
    }

    /**
     * The table NUMBER as printed, never the table's UUID — and resolved even for a retired table,
     * for the same reason {@code sendToKds} does: an order already bound to a table retired
     * mid-service is still being served at it.
     */
    private String tableLabel(OrderDto order, UUID tenantId) {
        if (order.tableId() == null) {
            return null;
        }
        return tableRepository.findByIdTenantAndBranch(order.tableId(), tenantId, order.branchId())
                .map(DiningTable::getTableNumber)
                .orElse(null);
    }
}
