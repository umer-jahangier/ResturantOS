import type { Metadata } from "next";
import { DM_Mono, Fraunces, Sora } from "next/font/google";
import "./globals.css";
import { AppProviders } from "@/components/providers/app-providers";

// The demo-calibrated type stack (D-38-13). next/font SELF-HOSTS these — unlike the demo's
// <link href="fonts.googleapis.com">, no third-party origin is added, and `package.json` stays
// at exactly 24 runtime dependencies, which `dependency-budget.test.ts` asserts.
const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
});

// DM Mono is NOT a variable font. Weights must be enumerated or the build FAILS — loudly,
// which is the good case: a silent fallback to a system mono would misalign every figure in
// the product and nobody would see a build error.
//
// Every enumerated weight is a SEPARATE file, and the `latin` subset of each is preloaded. 38-16
// measured them: 8,632 B / 8,688 B / 8,724 B preloaded, plus ~5,700 B each of latin-ext held back
// behind a unicode-range. "300" was enumerated and then never asked for — `font-light`,
// `font-thin`, `font-extralight`, `font-[300]` and any `font-weight: 300` are absent from
// app/, components/, lib/ and e2e/ — so it cost 8,632 B on the preload path to ship a face the
// product cannot render. Removing it is behaviourally inert: the four `font-mono font-semibold`
// call sites ask for 600, and CSS font matching resolves 600 to 500 with or without a 300 face.
// `webfont-budget` in bundle-budget.test.ts holds this at two weights and fails if a third
// returns without a call site.
const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

// Display serif. The demo uses it exactly three times — logo mark, page title, KPI value —
// and never on body copy. The restraint IS the effect; it reaches type through
// `--font-heading` only (9 `className` call sites today — globals.css still says 8, which is
// drift, not a second measurement), never through `--font-sans`.
//
// It is also the most expensive family here: 36,560 B preloaded, 81,736 B emitted across three
// unicode-range subsets — more than Sora, which sets every word on the screen. 38-16 left it
// alone deliberately. Fraunces IS variable, so enumerating 400 AND 600 costs exactly zero extra
// bytes (both @font-face rules point at the same three files — verified in the built stylesheet),
// and the only real saving available is glyph subsetting, which needs a build-time subsetter and
// therefore a new devDependency and a new build step. Not worth it for 36 kB that loads once,
// behind `font-display: swap`, and is then cached.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["400", "600"],
});

export const metadata: Metadata = {
  title: "RestaurantOS",
  description: "Multi-tenant restaurant ERP platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sora.variable} ${dmMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
