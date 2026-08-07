# Design decisions — locked

## D-UI-01 — Brand colour: designer's choice (user-delegated, 2026-08-07)

The user has no existing brand colour and has explicitly delegated the choice:
*"Go with the best UI/UX and colors, because currently we do not have any specific brand color."*

This unblocks the design-system work. It is a delegation, not an absence of
requirements — the palette must be justified, not merely picked.

### Constraints the palette MUST satisfy

1. **The current tokens are broken, not merely unset.** `--primary` and all five chart
   tokens are chroma-zero, so no chart can visually distinguish two series today. Fixing
   that is the point of this decision.

2. **Restaurant POS runs all day, often on a bright floor or a dim bar.** Contrast is a
   functional requirement, not an aesthetic one. WCAG 2.2 AA minimum for all text
   (4.5:1 body, 3:1 large), and AAA for anything a cashier reads under time pressure.

3. **Five chart series must be distinguishable — including for the ~8% of men with
   colour-vision deficiency.** Verify with a deuteranopia/protanopia simulation, not by
   eye. Vary lightness as well as hue so the series survive greyscale printing.

4. **Semantic colours must not collide with the brand hue.** Success/warning/danger have
   to read instantly on a KDS ticket ageing from fresh to late. If the brand hue is green
   or red, semantics win and the brand moves.

5. **Light AND dark themes.** A bar terminal at night and an office at noon are the same
   product.

6. **Tailwind v4 CSS-first tokens**, matching the existing setup — an OKLCH ramp, so
   lightness is perceptually even rather than nominally even.

### What to deliver

A full ramp (50→950) for primary, neutral, and the semantic set; five chart colours
verified under CVD simulation; both themes; and a short written rationale for the hue.

Because the choice is delegated rather than dictated, record WHY the hue was chosen and
what was rejected. If the user later supplies a brand colour, the ramp must be
regenerable by changing one hue value — do not hard-code hex values throughout.
