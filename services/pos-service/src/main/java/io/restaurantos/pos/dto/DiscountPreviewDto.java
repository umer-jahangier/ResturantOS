package io.restaurantos.pos.dto;

/**
 * What a discount WILL do to this check, priced by the server that is about to do it (D-1).
 *
 * <h2>The defect this exists to close</h2>
 *
 * <p>The discount panel computed its own preview in the browser: it subtracted the discount from
 * {@code order.totalPaisa} and printed the result. {@code totalPaisa} is tax-INCLUSIVE, so that
 * arithmetic silently asserted that taking money off a bill leaves the tax alone — which is the
 * exact opposite of what {@code OrderServiceImpl.recomputeOrderTotals} does under the ruling in
 * {@code D-TAX-DISCOUNT.md}, where tax is priced on the line NET of its share of every discount.
 *
 * <p>Measured live 2026-08-12 on {@code ORD-20260812-0443} — subtotal Rs 1,700.00, tax Rs 272.00,
 * total Rs 1,972.00 — a 10% whole-check discount previewed <em>"Takes Rs 170.00 off — new total
 * Rs 1,802.00"</em> and applied as Rs 1,774.80. Out by Rs 27.20, because the tax fell to Rs 244.80
 * and the preview never asked. On the dine-in check it was worse: the panel also re-derived the
 * discount's own base and got Rs 213.90 where the server priced Rs 208.90.
 *
 * <h2>Why this is a server DTO and not better browser arithmetic</h2>
 *
 * <p>Because the second copy is the defect. The tax base is a tenant setting
 * ({@code tenant_tax_policy.tax_base}), an ORDER-scope discount is allocated across lines pro-rata
 * by remaining net with largest-remainder rounding, the service charge has its own base and its own
 * channel rules, and the discount itself is clamped against a headroom that reads the discount rows
 * and pointedly does NOT read {@code item.discountPaisa}. Every one of those is a rule that has
 * already drifted once in this codebase. A browser that reimplements them is a second implementation
 * of a tax rule, and two implementations of a tax rule WILL drift — this DTO is what stops there
 * being a second one.
 *
 * <p>Every field is the figure the check will actually carry once the discount is applied, taken
 * from the same {@code recomputeOrderTotals} the apply path runs. {@code amountOffPaisa} is the
 * discount AFTER its clamp, so a manager who types 100% off a check that already carries a line
 * discount reads the money that will really come off rather than the money they asked for.
 *
 * @param amountOffPaisa          what THIS discount takes off, after the headroom clamp
 * @param subtotalPaisa           unchanged by a discount — it is GROSS, before discount and tax
 * @param discountPaisa           every discount on the check afterwards, including this one
 * @param taxPaisa                the tax afterwards; the field the browser could not know
 * @param serviceChargePaisa      the service charge afterwards — its base moves with the discount
 * @param totalPaisa              what the guest will owe
 * @param previousTaxPaisa        the tax now, so a screen can show the movement rather than assert it
 * @param previousServiceChargePaisa the service charge now, for the same reason
 * @param previousTotalPaisa      what the guest owes now
 */
public record DiscountPreviewDto(
        long amountOffPaisa,
        long subtotalPaisa,
        long discountPaisa,
        long taxPaisa,
        long serviceChargePaisa,
        long totalPaisa,
        long previousTaxPaisa,
        long previousServiceChargePaisa,
        long previousTotalPaisa
) {}
