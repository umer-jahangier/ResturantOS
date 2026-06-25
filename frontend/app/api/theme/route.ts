import { NextRequest, NextResponse } from "next/server";

import { generatePalette } from "@/lib/theme/palette-generator";

const HEX_REGEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Dynamic CSS theme endpoint for tenant brand colour overrides.
 *
 * Returns `:root` and `.dark` CSS custom property blocks for the generated
 * OKLCH palette, suitable for `<link rel="stylesheet">` injection in the
 * tenant layout.
 *
 * @Backend API contract (Phase 7):
 *   GET /api/v1/tenants/:id/theme → { brandColor: string, logoUrl: string | null }
 *
 *   This route will be replaced by a proxied call once the backend delivers
 *   tenant settings. Currently, the colour comes from the `brandColor` query
 *   param and persistence is client-side (localStorage via Settings → Appearance).
 *
 * @example GET /api/theme?brandColor=%233b82f6
 */
export function GET(request: NextRequest): NextResponse {
  const brandColor = request.nextUrl.searchParams.get("brandColor");

  if (!brandColor) {
    return NextResponse.json({ error: "brandColor required" }, { status: 400 });
  }

  if (!HEX_REGEX.test(brandColor)) {
    return NextResponse.json(
      { error: "brandColor must be a 6-digit hex colour (e.g. #3b82f6)" },
      { status: 400 },
    );
  }

  const palette = generatePalette(brandColor);

  const css = `:root {
  --primary: ${palette.primary[500]};
  --primary-foreground: ${palette.foreground};
  --primary-50: ${palette.primary[50]};
  --primary-100: ${palette.primary[100]};
  --primary-200: ${palette.primary[200]};
  --primary-300: ${palette.primary[300]};
  --primary-400: ${palette.primary[400]};
  --primary-500: ${palette.primary[500]};
  --primary-600: ${palette.primary[600]};
  --primary-700: ${palette.primary[700]};
  --primary-800: ${palette.primary[800]};
  --primary-900: ${palette.primary[900]};
  --primary-950: ${palette.primary[950]};
}
.dark {
  --primary: ${palette.primary[400]};
  --primary-foreground: ${palette.foreground};
}`;

  return new NextResponse(css, {
    headers: {
      "Content-Type": "text/css",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
