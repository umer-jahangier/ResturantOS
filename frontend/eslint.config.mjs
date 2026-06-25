import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// FE-08 layer boundary (spec §7.2.3, Decision D1): a Layer-4 component (components/**)
// may NEVER import Layer-1 (api-client) or Layer-2 (repositories) or bare `axios`.
// Components consume Layer-3 hooks (lib/hooks/**) only.
const LAYER_BOUNDARY_MESSAGE =
  "Layer boundary violation: components/** must not import the api-client or repositories directly. Use a Layer-3 hook from @/lib/hooks/** instead.";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["components/**/*.{ts,tsx}"],
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
