package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.model.Order;
import io.restaurantos.pos.domain.model.OrderItem;
import io.restaurantos.pos.dto.OrderDto;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Pure entity-to-DTO mapping for {@link Order}, extracted from {@link OrderServiceImpl}'s
 * private {@code toDto} so it can be shared with {@link TableServiceImpl} (which needs to
 * embed a full {@code OrderDto} in {@code TableDetailDto} without depending on {@link
 * OrderService} — {@code OrderServiceImpl} already depends on {@code TableService} for
 * table-status derivation, so a reverse dependency would create a circular Spring bean
 * graph). No repository access, no side effects.
 */
@Component
public class OrderMapper {

    public OrderDto toDto(Order order) {
        List<OrderDto.OrderItemDto> itemDtos = order.getItems().stream()
                .map(item -> new OrderDto.OrderItemDto(
                        item.getId(),
                        item.getMenuItemId(),
                        item.getItemNameSnapshot(),
                        item.getUnitPriceSnapshot(),
                        item.getQuantity(),
                        item.getKdsStation(),
                        item.getItemStatus(),
                        item.getRevisionNo(),
                        item.getFiredAt(),
                        item.getDiscountPaisa(),
                        item.getTaxPaisa(),
                        item.getLineTotalPaisa(),
                        item.getNotes(),
                        item.getModifiers().stream()
                                .map(m -> new OrderDto.ModifierDto(
                                        m.getId(),
                                        m.getModifierId(),
                                        m.getModifierNameSnapshot(),
                                        m.getPriceDeltaPaisa()))
                                .collect(Collectors.toList())
                ))
                .collect(Collectors.toList());

        // B3: item names are resolved here rather than by the reader, so the charge page and the
        // report both print "10% off Chicken Karahi" instead of a uuid. Keyed off the SAME item
        // list above, so a discount attached to a line that no longer exists reads as null and
        // is never silently attached to whatever line happens to sit at that index.
        Map<UUID, String> itemNames = order.getItems().stream()
                .collect(Collectors.toMap(OrderItem::getId, OrderItem::getItemNameSnapshot,
                        (a, b) -> a));

        List<OrderDto.OrderDiscountDto> discountDtos = order.getDiscounts().stream()
                .map(d -> new OrderDto.OrderDiscountDto(
                        d.getId(),
                        d.getScope(),
                        d.getOrderItemId(),
                        d.getOrderItemId() == null ? null : itemNames.get(d.getOrderItemId()),
                        d.getType(),
                        d.getValue(),
                        d.getAmountPaisa(),
                        d.getReason(),
                        d.getAppliedBy(),
                        d.getAppliedByName(),
                        d.getCreatedAt()))
                .collect(Collectors.toList());

        return new OrderDto(
                order.getId(),
                order.getBranchId(),
                order.getOrderNo(),
                order.getType(),
                order.getStatus(),
                order.getDerivedStatus(),
                order.getTableId(),
                order.getCoverCount(),
                order.getCashierId(),
                order.getCustomerId(),
                order.getSubtotalPaisa(),
                order.getTaxPaisa(),
                order.getDiscountPaisa(),
                order.getServiceChargePaisa(),
                order.getTotalPaisa(),
                order.getNotes(),
                order.getOpenedAt(),
                order.getSentToKdsAt(),
                order.getClientOrderId(),
                order.getVersion(),
                itemDtos,
                discountDtos
        );
    }
}
