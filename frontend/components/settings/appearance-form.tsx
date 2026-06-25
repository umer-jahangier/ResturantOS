"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { createZodResolver } from "@/lib/forms/zod-resolver";
import {
  generatePalette,
  type ThemePalette,
} from "@/lib/theme/palette-generator";

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
  brandColor: z
    .string()
    .regex(HEX_REGEX, "Must be a valid 6-digit hex colour (e.g. #3b82f6)"),
  logoUrl: z.string().refine(
    (val) =>
      val === "" ||
      val.startsWith("http://") ||
      val.startsWith("https://"),
    { message: "Must be a valid URL starting with http:// or https://" },
  ),
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
        className="flex items-center justify-center rounded-md px-4 py-3 text-sm font-medium"
        style={{ background: scale[500], color: foreground }}
      >
        Sample Text — AA{" "}
        {foreground === "#ffffff" ? "white-on-dark" : "black-on-light"}
      </div>
    </div>
  );
}

export function AppearanceForm({
  initialColor = "#3b82f6",
  onSave,
}: AppearanceFormProps) {
  const [brandColor, setBrandColor] = useState(initialColor);
  const [hexInput, setHexInput] = useState(initialColor.replace(/^#/, ""));
  const [palette, setPalette] = useState<ThemePalette>(() =>
    generatePalette(initialColor),
  );
  const [saveSuccess, setSaveSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<AppearanceFormValues>({
    resolver: createZodResolver(appearanceSchema),
    defaultValues: { brandColor: initialColor, logoUrl: "" },
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

  const onSubmit = (data: AppearanceFormValues) => {
    const settings: AppearanceSettings = {
      brandColor: data.brandColor,
      logoUrl: data.logoUrl,
    };

    // Persistence stub (localStorage).
    // Phase 7 backend contract: PUT /api/v1/tenants/:id/theme { brandColor, logoUrl }
    try {
      localStorage.setItem("tenant-theme-settings", JSON.stringify(settings));
    } catch {
      // storage unavailable in some browser contexts — silently skip
    }

    onSave?.(settings);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-8"
      aria-label="Appearance settings"
    >
      {/* Preset colour swatches */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-foreground">
          Brand colour presets
        </legend>
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">
          {PRESET_COLOURS.map(({ label, hex }) => (
            <button
              key={hex}
              type="button"
              onClick={() => handlePresetClick(hex)}
              className="touch-target relative flex flex-col items-center gap-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label={`${label} — ${hex}`}
              aria-pressed={brandColor === hex}
            >
              <span
                className="h-10 w-10 rounded-full border-2 transition-all"
                style={{
                  background: hex,
                  borderColor:
                    brandColor === hex ? "var(--foreground)" : "transparent",
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
        <label
          className="text-sm font-medium text-foreground"
          htmlFor="brand-hex"
        >
          Custom hex colour
        </label>
        <div className="flex items-center gap-2">
          <span className="select-none text-sm text-muted-foreground">#</span>
          <input
            id="brand-hex"
            type="text"
            inputMode="text"
            value={hexInput}
            onChange={handleHexInputChange}
            maxLength={6}
            placeholder="3b82f6"
            className="w-32 rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Custom brand colour — 6 hex digits without #"
            aria-describedby={
              errors.brandColor ? "hex-error" : undefined
            }
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
          <p
            id="hex-error"
            role="alert"
            className="mt-0.5 text-xs text-destructive"
          >
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
          className="flex items-center gap-2 rounded-md border border-warning bg-warning/15 px-4 py-3 text-sm text-warning-foreground"
        >
          <span aria-hidden="true">⚠</span>
          This colour does not meet WCAG AA contrast (4.5:1). Save is disabled
          until a valid colour is selected.
        </div>
      )}

      {/* Live palette preview */}
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">Palette preview</p>
        <PaletteSwatch scale={palette.primary} foreground={palette.foreground} />
      </div>

      {/* Logo URL input */}
      <div className="flex flex-col gap-1">
        <label
          htmlFor="logo-url"
          className="text-sm font-medium text-foreground"
        >
          Logo URL
        </label>
        <input
          id="logo-url"
          type="url"
          {...register("logoUrl")}
          placeholder="https://example.com/logo.png"
          className="w-full max-w-md rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-describedby="logo-url-hint"
        />
        <p id="logo-url-hint" className="text-xs text-muted-foreground">
          File upload will be available in a future release. Provide a publicly
          accessible URL for now.
        </p>
        {errors.logoUrl && (
          <p role="alert" className="mt-0.5 text-xs text-destructive">
            {errors.logoUrl.message}
          </p>
        )}
      </div>

      {/* Save */}
      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={contrastFailing}
          className="touch-target inline-flex items-center justify-center rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-disabled={contrastFailing}
        >
          Save appearance
        </button>
        {saveSuccess && (
          <p role="status" className="text-sm text-success">
            Saved successfully
          </p>
        )}
      </div>
    </form>
  );
}
