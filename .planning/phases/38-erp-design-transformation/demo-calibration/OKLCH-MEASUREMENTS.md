# Demo palette, measured in OKLCH — and what it means for `--brand-h`

Measured with the repo's own `colorjs.io@0.6.1` (the same library `globals.css` says its values
were derived with). Reproduce: `frontend/` + the script in this session's scratchpad.

## Every demo colour in OKLCH

| Token | Hex | L | C | H |
|---|---|---|---|---|
| primary (gold) | `#E8A045` | 0.7600 | 0.1353 | **69.3** |
| primary-dim | `#C4822E` | 0.6602 | 0.1258 | 68.3 |
| teal | `#2DD4BF` | 0.7845 | 0.1325 | **181.9** |
| teal-dim | `#0D9488` | 0.6002 | 0.1038 | 184.7 |
| blue | `#60A5FA` | 0.7137 | 0.1434 | 254.6 |
| red | `#F87171` | 0.7106 | 0.1661 | 22.2 |
| green | `#4ADE80` | 0.8003 | 0.1821 | 151.7 |
| purple | `#A78BFA` | 0.7090 | 0.1592 | 293.5 |
| bg | `#080C12` | 0.1530 | 0.0146 | 257.6 |
| bg-2 | `#0D1320` | 0.1877 | 0.0283 | 264.8 |
| bg-3 | `#111827` | 0.2101 | 0.0318 | 264.7 |
| surface | `#141E2E` | 0.2338 | 0.0343 | 259.5 |
| surface-2 | `#1A2740` | 0.2742 | 0.0500 | 262.6 |
| surface-3 | `#1E2E48` | 0.3005 | 0.0521 | 259.8 |
| border | `#1F2E45` | 0.2994 | 0.0467 | 258.7 |
| border-2 | `#263850` | 0.3367 | 0.0487 | 255.9 |
| text | `#F0F4FF` | 0.9673 | 0.0153 | 270.0 |
| text-2 | `#94A3B8` | 0.7107 | 0.0351 | 256.8 |
| text-3 | `#5A6E8A` | 0.5329 | 0.0503 | 256.8 |

## Finding 1 — the identity change is one number

`globals.css:313` declares `--brand-h: 195`. The demo's gold sits at **H 69.3**.
Adopting the demo's accent is, at the token layer, `--brand-h: 195 → 69`. Every `--primary-*`
step, `--chart-1`, the sequential ramp and the diverging midpoint follow automatically, because
they are all authored as `oklch(L C var(--brand-h))`. This is the mechanism working as designed.

The L/C pairs on the existing ramp are close to the demo's already: the demo's gold is
L 0.76 / C 0.135; the ramp's `--primary-400` is `oklch(0.775 0.104 …)` and `--primary-500` is
`oklch(0.7 0.116 …)`. Gold at H 69 admits more chroma in sRGB than cyan at H 195, so the ramp's
chroma can be **raised** at the mid steps and still gamut-map — re-derive, do not copy.

## Finding 2 — the demo's teal is where our brand hue already is

Demo teal = **H 181.9**; the app's current `--brand-h` = 195. They are neighbours. So the move is
not "throw away the current identity" — it is **demote the current hue to the secondary accent and
promote gold to primary**. Propose `--accent-h: 182` alongside `--brand-h: 69`.

## Finding 3 — THE ARCHITECTURAL CONFLICT: the demo's neutrals are not its brand hue

This is the one thing that does not fall out of a hue swap, and it must be decided explicitly.

The demo's surfaces and text tiers all sit at **H 255–270 — a cool blue-black** — while its accent
is **warm gold at H 69**. That complementary tension (warm accent on cool ground) is a large part
of why the demo reads as expensive.

But `globals.css:331-343` ties the neutral ramp to the brand hue:
`--neutral-800: oklch(0.302 0.008 var(--brand-h))`, and the file's own header states the intent —
"ours carries the brand hue at imperceptible chroma so surfaces harmonise."

Set `--brand-h: 69` and the neutrals turn **warm brown-grey**, not the demo's cool blue-black. The
demo's look is *not* reproducible by a single-number change.

**Required amendment:** decouple the ramps —
```
--brand-h:   69;   /* gold   — primary accent */
--accent-h: 182;   /* teal   — secondary accent */
--neutral-h: 260;  /* cool blue-black — surfaces, borders, text tiers */
```
The neutral chroma must also rise: the demo's surfaces carry C 0.028–0.052, where the current
ramp uses C 0.006–0.010. The demo's ground is visibly blue, not neutral-grey.

This is a real change to the "one number" property. State it as such in the decision record rather
than quietly breaking the invariant the file's header advertises.

## Finding 4 — two demo values FAIL the accessibility gate and must not be copied

Measured, WCAG 2.1:

| Pairing | Ratio | Verdict |
|---|---|---|
| text on bg | 17.81:1 | AA |
| text-2 on bg | 7.64:1 | AA |
| gold on bg | 8.91:1 | AA |
| gold on surface | 7.61:1 | AA |
| teal on surface | 8.99:1 | AA |
| green / blue / red / purple on surface | 9.60 / 6.58 / 6.05 / 6.15 | AA |
| bg-on-gold (primary button label) | 8.91:1 | AA |
| **text-3 on surface** | **3.21:1** | **FAILS AA for body text** |
| **border vs bg-2 (hairline)** | **1.36:1** | **FAILS WCAG 1.4.11 (3:1 for UI components)** |

The demo's accent set is genuinely accessible — that is good news, and most of it transfers.
Two things do not:

1. `--text-3` (`#5A6E8A`) is used in the demo for nav group labels, timestamps and metadata.
   At 3.21:1 it is legal only for incidental text. Our tertiary foreground must be lifted
   (raise L to ≈0.60) or restricted by contract to non-essential copy.
2. The 1px borders at 1.36:1 are decorative-only by WCAG. Where a border is the *only* thing
   marking an input's boundary, it must reach 3:1 — so form controls need a stronger border
   than the demo's hairline, even while cards keep the hairline look.

This is precisely why the "re-derive in OKLCH" decision was the right one: a literal copy would
have shipped two accessibility regressions into a codebase that gates on 53 measured pairings.
