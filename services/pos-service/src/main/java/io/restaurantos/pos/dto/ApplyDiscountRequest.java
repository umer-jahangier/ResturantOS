package io.restaurantos.pos.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Apply a discount to one line or to the whole check.
 *
 * <h2>Why {@code reason} is required and not optional (B3)</h2>
 *
 * <p>Money leaves the business on this call. Until now the record was
 * {@code (scope, orderItemId, type, value)} with no reason anywhere, so the Discount Summary
 * report could only ever be a column of amounts — an owner could see that Rs 950 was given away
 * yesterday and had no way, in the product, to find out why or by whom. A discount with no
 * recorded reason is indistinguishable from theft after the fact, which is exactly why every
 * till in the trade makes the operator pick one.
 *
 * <p>It is a free-text sentence rather than a fixed code list on purpose: the reasons a
 * restaurant actually gives money away ("dropped the biryani", "regular, 20 years", "staff meal",
 * "waited 40 minutes") do not fit a list somebody guesses up front, and a mandatory list whose
 * options do not fit trains staff to pick whatever is nearest. A minimum of three characters
 * stops "x" from becoming the house habit; the UI states the requirement before submit rather
 * than 400-ing afterwards.
 *
 * <h2>The other two constraints</h2>
 *
 * <p>{@code scope} and {@code type} are pattern-bound. They used to be free strings compared with
 * {@code "ORDER".equals(...)}, so {@code scope:"WHOLE"} passed validation, missed both branches,
 * was priced against the whole order, was stored, contributed NOTHING to the total (only
 * {@code LINE}/{@code ORDER} rows are summed), and finally failed the table's own CHECK
 * constraint as a 500. A closed set is checked at the boundary, once.
 */
public record ApplyDiscountRequest(
        @NotNull @Pattern(regexp = "LINE|ORDER", message = "scope must be LINE or ORDER")
        String scope,

        /** Required when {@code scope} is LINE; ignored otherwise. Validated in the service. */
        UUID orderItemId,

        @NotNull @Pattern(regexp = "FLAT|PERCENT", message = "type must be FLAT or PERCENT")
        String type,

        /** Rupees for FLAT, percent for PERCENT. Never paisa — see OrderServiceImpl. */
        @NotNull @Positive BigDecimal value,

        @NotBlank(message = "A reason is required for every discount")
        @Size(min = 3, max = 200, message = "The reason must be between 3 and 200 characters")
        String reason
) {}
