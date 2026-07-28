//  @ts-check

import { tanstackConfig } from "@tanstack/eslint-config"
import jsxA11y from "eslint-plugin-jsx-a11y"

export default [
  ...tanstackConfig,
  {
    ...jsxA11y.flatConfigs.recommended,
    files: ["src/**/*.{ts,tsx}"],
  },
  {
    rules: {
      "import/no-cycle": "off",
      "import/order": "off",
      "sort-imports": "off",
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "no-shadow": "off",
      "pnpm/json-enforce-catalog": "off",
    },
  },
  {
    ignores: ["eslint.config.js", ".prettierrc", ".source/**"],
  },
]
