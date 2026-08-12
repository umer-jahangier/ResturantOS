package io.restaurantos.pos.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.List;
import java.util.UUID;

/** Wire contracts for the modifier catalogue (S6): groups of options attached to one dish. */
public final class ModifierDtos {

    /**
     * One group as the till and the manager both read it.
     *
     * @param required    the group must be answered before the line can be added. Always equal to
     *                    {@code minSelect >= 1}; both are sent because the till renders the word
     *                    "Required" and the validator reads the number
     * @param minSelect   fewest options the cashier must pick
     * @param maxSelect   most the cashier may pick
     * @param optionCount how many LIVE options the group holds, including inactive ones — the
     *                    number the manage screen prints so "choose 2 of 1" is visible before it
     *                    is saved
     */
    public record ModifierGroupDto(
            UUID id,
            UUID menuItemId,
            String name,
            boolean required,
            int minSelect,
            int maxSelect,
            int sortOrder,
            boolean active,
            int optionCount,
            List<ModifierOptionDto> options
    ) {}

    /**
     * @param priceDeltaPaisa BIGINT paisa, signed. "Extra cheese" is +15000; "no cheese" may be
     *                        -5000. It is added to the line's UNIT price before quantity, which is
     *                        what makes 2× (dish + extra cheese) cost twice the extra cheese too —
     *                        the arithmetic {@code OrderPricingCalculator.lineSubtotal} has always
     *                        done and that this catalogue finally feeds real numbers into
     */
    public record ModifierOptionDto(
            UUID id,
            UUID groupId,
            String name,
            long priceDeltaPaisa,
            int sortOrder,
            boolean active
    ) {}

    /**
     * {@code required} and {@code minSelect} are BOTH required on the wire and must agree.
     *
     * <p>Deriving one from the other on the server would be friendlier and wrong: a screen that
     * sends {@code required=true, minSelect=0} has a bug, and answering it with a silently-corrected
     * row hides that bug until a cashier meets a "forced" group they can skip. The service refuses
     * and names the field.
     */
    public record CreateModifierGroupRequest(
            @NotBlank @Size(max = 100) String name,
            @NotNull Boolean required,
            @NotNull @Min(0) @Max(50) Integer minSelect,
            @NotNull @Min(1) @Max(50) Integer maxSelect,
            Integer sortOrder
    ) {}

    /**
     * PUT is a REPLACE — every field, including the ones you are not changing. The rule
     * {@code UpdateMenuItemRequest} and {@code UpdateTaxClassRequest} both state, for the reason
     * this codebase has already paid for once: an omitted key read as "clear it" destroys
     * configuration on an unrelated rename.
     */
    public record UpdateModifierGroupRequest(
            @NotBlank @Size(max = 100) String name,
            @NotNull Boolean required,
            @NotNull @Min(0) @Max(50) Integer minSelect,
            @NotNull @Min(1) @Max(50) Integer maxSelect,
            @NotNull Integer sortOrder,
            @NotNull Boolean active
    ) {}

    public record CreateModifierRequest(
            @NotBlank @Size(max = 100) String name,
            @NotNull Long priceDeltaPaisa,
            Integer sortOrder
    ) {}

    public record UpdateModifierRequest(
            @NotBlank @Size(max = 100) String name,
            @NotNull Long priceDeltaPaisa,
            @NotNull Integer sortOrder,
            @NotNull Boolean active
    ) {}

    private ModifierDtos() {}
}
