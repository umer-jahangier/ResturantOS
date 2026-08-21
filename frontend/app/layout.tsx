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
const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
});

// Display serif. The demo uses it exactly three times — logo mark, page title, KPI value —
// and never on body copy. The restraint IS the effect; it reaches type through
// `--font-heading` only (8 call sites today), never through `--font-sans`.
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
