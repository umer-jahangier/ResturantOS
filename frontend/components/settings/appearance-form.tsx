"use client";

import { useState, useSyncExternalStore } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { MonitorSmartphone } from "lucide-react";

import { createZodResolver } from "@/lib/forms/zod-resolver";
import { checkBrandHue } from "@/lib/theme/brand-hue-guard";
import { generatePalette, type ThemePalette } from "@/lib/theme/palette-generator";

const PRESET_COLOURS = [
  { label: "Ocean Blue", hex: "#3b82f6" },
  { label: "Emerald", hex: "#10b981" },
  { label: "Amber", hex: "#f59e0b" },
  { label: "Coral Red", hex: "#ef4444" },
  { label: "Violet", hex: "#8b5cf6" },
  { label: "Pink", hex: "#ec4899" },
  { label: "Cyan", hex: "#06b6d4" },
  { label: "Lime", hex: "#84cc16" },
] as const;

const HEX_REGEX = /^#[0-9a-fA-F]{6}$/;

const appearanceSchema = z.object({
  brandColor: z.string().regex(HEX_REGEX, "Must be a valid 6-digit hex colour (e.g. #3b82f6)"),
  logoUrl: z
    .string()
    .refine((val) => val === "" || val.startsWith("http://") || val.startsWith("https://"), {
      message: "Must be a valid URL starting with http:// or https://",
    }),
});

type AppearanceFormValues = z.infer<typeof appearanceSchema>;

export interface AppearanceSettings {
  brandColor: string;
  logoUrl: string;
}

export interface AppearanceFormProps {
  initialColor?: string;
  onSave?: (settings: AppearanceSettings) => void;
}

function PaletteSwatch({
  scale,
  foreground,
}: {
  scale: ThemePalette["primary"];
  foreground: string;
}) {
  const stops = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
  return (
    <div className="mt-3 space-y-2">
      <div className="flex gap-0.5 overflow-hidden rounded-md">
        {stops.map((stop) => (
          <div
            key={stop}
            className="h-8 flex-1"
            style={{ background: scale[stop] }}
            title={`${stop}: ${scale[stop]}`}
          />
        ))}
      </div>
      <div
        className="flex items-center justify-center rounded-md px-4 py-3 text-small font-medium"
        style={{ background: scale[500], color: foreground }}
      >
        Sample Text — AA {foreground === "#ffffff" ? "white-on-dark" : "black-on-light"}
      </div>
    </div>
  );
}

/**
 * The key `(tenant)/layout.tsx` reads on every load to decide whether to inject `/api/theme`.
 * Named here rather than repeated as a literal so the reader and the writer cannot drift.
 */
const STORAGE_KEY = "tenant-theme-settings";

/**
 * Read back what was last saved — in THIS browser, which is the only place it was ever written.
 *
 * <p>Measured before this existed, on 2026-08-11, signed in as `admin@terrace.local`: choose
 * Emerald `#10b981`, enter a logo URL, save, reload. The theme `<link>` WAS injected (so the app
 * turned green) and the form came back reading `3b82f6` with an empty logo field. The product was
 * therefore showing a green interface next to a form insisting the brand colour was blue, and the
 * logo URL had been written to storage that nothing on earth reads.
 *
 * <p>That is the half this closes. The other half — that none of it leaves this browser — is closed
 * by saying so, not by pretending, because there is no endpoint to close it with.
 */
function readStoredSettings(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Unreadable storage is the same as no storage. Never throw out of a render path over it.
    return null;
  }
}

function parseStoredSettings(raw: string | null): AppearanceSettings | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AppearanceSettings>;
    if (typeof parsed.brandColor !== "string" || !HEX_REGEX.test(parsed.brandColor)) return null;
    return {
      brandColor: parsed.brandColor,
      logoUrl: typeof parsed.logoUrl === "string" ? parsed.logoUrl : "",
    };
  } catch {
    return null;
  }
}

// `useSyncExternalStore` and not a lazy `useState`, for the reason `(tenant)/layout.tsx` uses an
// effect for the same value: the server renders this form and cannot see localStorage, so reading
// it during the first client render is a hydration mismatch. The server snapshot is null, the
// client adopts the stored value on the commit after hydration, and the `key` below remounts the
// fields around it — which is the only way a form whose inputs are `useState`-initialised can take
// on a value that arrives after mount.
const subscribeToNothing = () => () => {};

/**
 * Settings → Appearance.
 *
 * <p><b>This screen saves to this browser and to nowhere else, and it now says so.</b> There is no
 * tenant-theme API: `PUT/GET /api/v1/tenants/{id}/theme` answers 404, as do `/api/v1/tenant-profile`
 * and `/api/v1/settings` (measured as TENANT_ADMIN through the real gateway, 2026-08-11). The
 * "Phase 7 backend contract" this file has cited since it was written was never built.
 *
 * <p>The brief for this work is "persist through a real API, or state plainly in the UI that a
 * setting is not yet persisted — never silently discard input". There is no API to persist through,
 * so the second option is the honest one, and the notice is placed above the controls rather than
 * in small print underneath them.
 */
export function AppearanceForm({ initialColor = "#3b82f6", onSave }: AppearanceFormProps) {
  const storedRaw = useSyncExternalStore(subscribeToNothing, readStoredSettings, () => null);
  const stored = parseStoredSettings(storedRaw);

  return (
    <AppearanceFormFields
      // Remount when the stored value first becomes readable (server null → client value), so the
      // uncontrolled inputs below pick it up instead of keeping the defaults they mounted with.
      key={stored?.brandColor ?? "unset"}
      initialColor={stored?.brandColor ?? initialColor}
      initialLogoUrl={stored?.logoUrl ?? ""}
      {...(onSave ? { onSave } : {})}
    />
  );
}

function AppearanceFormFields({
  initialColor,
  initialLogoUrl,
  onSave,
}: {
  initialColor: string;
  initialLogoUrl: string;
  onSave?: (settings: AppearanceSettings) => void;
}) {
  const [brandColor, setBrandColor] = useState(initialColor);
  const [hexInput, setHexInput] = useState(initialColor.replace(/^#/, ""));
  const [palette, setPalette] = useState<ThemePalette>(() => generatePalette(initialColor));
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<AppearanceFormValues>({
    resolver: createZodResolver(appearanceSchema),
    defaultValues: { brandColor: initialColor, logoUrl: initialLogoUrl },
  });

  const applyColor = (hex: string) => {
    if (!HEX_REGEX.test(hex)) return;
    setBrandColor(hex);
    setHexInput(hex.replace(/^#/, ""));
    setValue("brandColor", hex, { shouldValidate: true });
    setPalette(generatePalette(hex));
  };

  const handlePresetClick = (hex: string) => {
    applyColor(hex);
  };

  const handleHexInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cleaned = e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 6);
    setHexInput(cleaned);
    if (cleaned.length === 6) {
      applyColor(`#${cleaned}`);
    }
  };

  const contrastFailing = !palette.contrastValid;

  /*
   * 38-10 task 4 — the brand-hue guard, re-derived. See `lib/theme/brand-hue-guard.ts` for why
   * the plan's "within 35° of 262" rule is not what shipped: it names a collision that D-38-12
   * removed, misses the one that is real, and would refuse this form's own default colour.
   *
   * WARNS, does not block. The contrast check above disables Save because a 4.5:1 failure is a
   * floor somebody falls through. This is a legibility risk in one composition, so it states the
   * problem, names the series it collides with, and offers a specific replacement — and the
   * operator decides. A guard that silently rewrote the chosen colour would be the same class of
   * defect as a control that looks saved and is not.
   */
  const hueVerdict = checkBrandHue(brandColor);

  const onSubmit = (data: AppearanceFormValues) => {
    const settings: AppearanceSettings = {
      brandColor: data.brandColor,
      logoUrl: data.logoUrl,
    };

    // localStorage is the whole of persistence here, and the notice above the form says so.
    // A failure used to be swallowed with `// silently skip`, which meant a private-mode browser
    // showed "Saved successfully" over a save that did not happen — the same class of lie this
    // screen's copy is being fixed for, one level down. It is now reported.
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      setSaveFailed(true);
      setSaveSuccess(false);
      return;
    }

    setSaveFailed(false);
    onSave?.(settings);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8" aria-label="Appearance settings">
      {/* GA-009 / the settings-that-forget defect. Above the controls, not under them: a caveat
          a user reads after choosing a colour and clicking Save has already failed at its job. */}
      <div
        data-testid="appearance-not-persisted"
        /*
         * `text-foreground`, not `text-warning-foreground`. Measured 2026-08-12 while verifying
         * this screen in a real browser as the OWNER: `--warning-foreground` is the stop for
         * text on a SOLID warning fill, and in dark it resolves to `--neutral-1000` — on a 10%
         * warning tint over the card that is **1.21:1**, which is not a contrast, it is
         * camouflage. Light was fine (17.74:1), which is why it survived: the defect is
         * invisible in the theme most people develop in.
         *
         * The semantic channel is not lost — the border, the tint and the icon all still say
         * "warning", and §40's rule is that colour is never the ONLY channel. Measured after:
         * 17.74:1 light, 15.94:1 dark. Asserted in `state-character.test.tsx`.
         */
        className="flex items-start gap-2 rounded-md border border-warning bg-warning/10 px-3 py-2 text-small text-foreground"
      >
        <MonitorSmartphone className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          <span className="font-medium">Saved in this browser only.</span> There is no API to store
          a restaurant&apos;s branding yet, so this is not attached to your account: colleagues, and
          you on another device, will see the default colours. Clearing your browser data resets it.
        </span>
      </div>
      {/* Preset colour swatches */}
      <fieldset className="space-y-3">
        <legend className="text-small font-medium text-foreground">Brand colour presets</legend>
        <div className="grid grid-cols-4 gap-3 md:grid-cols-8">
          {PRESET_COLOURS.map(({ label, hex }) => (
            <button
              key={hex}
              type="button"
              onClick={() => handlePresetClick(hex)}
              className="touch-target relative flex flex-col items-center gap-1 rounded-md"
              aria-label={`${label} — ${hex}`}
              aria-pressed={brandColor === hex}
            >
              <span
                className="h-10 w-10 rounded-full border-2 transition-all"
                style={{
                  background: hex,
                  borderColor: brandColor === hex ? "var(--foreground)" : "transparent",
                  boxShadow:
                    brandColor === hex
                      ? "0 0 0 2px var(--background), 0 0 0 4px var(--foreground)"
                      : "none",
                }}
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
      </fieldset>

      {/* Custom hex input — fully controlled, no useEffect needed */}
      <div className="flex flex-col gap-1">
        <label className="text-small font-medium text-foreground" htmlFor="brand-hex">
          Custom hex colour
        </label>
        <div className="flex items-center gap-2">
          <span className="select-none text-small text-muted-foreground">#</span>
          <input
            id="brand-hex"
            type="text"
            inputMode="text"
            value={hexInput}
            onChange={handleHexInputChange}
            maxLength={6}
            placeholder="3b82f6"
            className="w-32 rounded-md border border-input bg-background px-3 py-2 font-mono text-small"
            aria-label="Custom brand colour — 6 hex digits without #"
            aria-describedby={errors.brandColor ? "hex-error" : undefined}
          />
          {hexInput.length === 6 && (
            <div
              className="h-8 w-8 rounded-md border border-input"
              style={{ background: `#${hexInput}` }}
              aria-hidden="true"
            />
          )}
        </div>
        {errors.brandColor && (
          <p id="hex-error" role="alert" className="mt-0.5 text-label text-destructive">
            {errors.brandColor.message}
          </p>
        )}
      </div>

      {/* Hidden RHF field — keeps Zod validation in sync with colour state */}
      <input type="hidden" {...register("brandColor")} value={brandColor} />

      {/* WCAG contrast warning */}
      {contrastFailing && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-warning bg-warning/15 px-4 py-3 text-small text-warning-foreground"
        >
          <span aria-hidden="true">⚠</span>
          This colour does not meet WCAG AA contrast (4.5:1). Save is disabled until a valid colour
          is selected.
        </div>
      )}

      {/*
        The hue collision notice. Three channels, none of them colour alone (D-38-13): the word
        "close to chart series N" states it, the border and icon carry the warning shape, and the
        suggested swatch is a concrete alternative rather than "pick something else".

        `text-foreground`, not `text-warning-foreground`, for the reason recorded on the
        not-persisted notice above: `--warning-foreground` is the stop for text on a SOLID warning
        fill and measures 1.21:1 on a 10 % tint in dark.
      */}
      {!hueVerdict.ok && (
        <div
          role="status"
          data-testid="appearance-hue-collision"
          data-delta-e={hueVerdict.deltaE.toFixed(1)}
          className="flex items-start gap-2 rounded-md border border-warning bg-warning/10 px-3 py-2 text-small text-foreground"
        >
          <MonitorSmartphone className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-medium">Hard to tell apart from a chart line.</span>{" "}
            {hueVerdict.reason}{" "}
            {hueVerdict.suggestedHex ? (
              <>
                The nearest colour that stays distinct is{" "}
                <button
                  type="button"
                  data-testid="appearance-hue-nudge"
                  onClick={() => applyColor(hueVerdict.suggestedHex!)}
                  className="font-mono font-medium underline underline-offset-2"
                >
                  {hueVerdict.suggestedHex}
                </button>
                . You can keep the one you chose.
              </>
            ) : (
              <>Every nearby hue has the same problem, so this one is as good as any.</>
            )}
          </span>
        </div>
      )}

      {/* Live palette preview */}
      <div className="space-y-1">
        <p className="text-small font-medium text-foreground">Palette preview</p>
        <PaletteSwatch scale={palette.primary} foreground={palette.foreground} />
      </div>

      {/* Logo URL input */}
      <div className="flex flex-col gap-1">
        <label htmlFor="logo-url" className="text-small font-medium text-foreground">
          Logo URL
        </label>
        <input
          id="logo-url"
          type="url"
          {...register("logoUrl")}
          placeholder="https://example.com/logo.png"
          className="w-full max-w-md rounded-md border border-input bg-background px-3 py-2 text-small"
          aria-describedby="logo-url-hint"
        />
        <p id="logo-url-hint" className="text-label text-muted-foreground">
          Stored alongside the colour in this browser — but nothing in the app renders a restaurant
          logo yet, so setting it changes nothing you can see today. It is kept rather than dropped
          so it is here when a logo surface ships.
        </p>
        {errors.logoUrl && (
          <p role="alert" className="mt-0.5 text-label text-destructive">
            {errors.logoUrl.message}
          </p>
        )}
      </div>

      {/* Save */}
      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={contrastFailing}
          className="touch-target inline-flex items-center justify-center rounded-md bg-primary-solid px-6 py-2 text-small font-medium text-primary-solid-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          aria-disabled={contrastFailing}
        >
          Save appearance
        </button>
        {saveSuccess && (
          <p role="status" className="text-small text-success">
            Saved in this browser
          </p>
        )}
        {saveFailed && (
          <p role="alert" className="text-small text-destructive">
            This browser refused to store the setting, so nothing was saved. Private browsing and
            blocked site data both do this.
          </p>
        )}
      </div>
    </form>
  );
}
