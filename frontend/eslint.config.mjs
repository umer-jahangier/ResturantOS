import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// FE-08 layer boundary (spec §7.2.3, Decision D1): Layer-4 presentation code may NEVER
// import Layer-1 (api-client) or Layer-2 (repositories) or bare `axios`. It consumes
// Layer-3 hooks (lib/hooks/**) only.
//
// 20-01 (UI-SPEC §1 "Prerequisite", §10.2 step 0): the rule used to cover `components/**`
// alone, which left every route file in `app/**` — the other half of Layer 4, and where the
// revamp moves substantial code — silently uncovered. Two purchasing pages had already
// drifted through the gap. `app/api/**` is excluded: route handlers are server-side Layer 1/2
// by definition (app/api/theme/route.ts legitimately calls the palette generator), and
// `app/**/layout.tsx`-adjacent providers are still Layer 4 and stay covered.
const LAYER_BOUNDARY_MESSAGE =
  "Layer boundary violation: app/** and components/** must not import the api-client or repositories directly. Use a Layer-3 hook from @/lib/hooks/** instead.";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["components/**/*.{ts,tsx}", "app/**/*.{ts,tsx}"],
    ignores: ["app/api/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "axios", message: LAYER_BOUNDARY_MESSAGE }],
          patterns: [
            {
              group: [
                "@/lib/api-client",
                "@/lib/api-client/*",
                "@/lib/api-client/**",
                "@/lib/repositories",
                "@/lib/repositories/*",
                "@/lib/repositories/**",
              ],
              message: LAYER_BOUNDARY_MESSAGE,
            },
          ],
        },
      ],
    },
  },
  {
    // Playwright fixtures take a callback named `use`. `react-hooks/rules-of-hooks` matches on
    // the identifier alone and reports every one of them as a misplaced React hook — five false
    // positives in e2e/fixtures/auth.fixture.ts. e2e/** is not app code (the app tsconfig
    // excludes it and it has its own e2e/tsconfig.json), so the React rules do not apply here.
    // Everything else — TS rules, import hygiene — still does.
    files: ["e2e/**/*.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    "public/mockServiceWorker.js",
  ]),
]);

export default eslintConfig;
