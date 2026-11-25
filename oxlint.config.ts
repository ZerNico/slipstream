import { defineConfig } from "oxlint";
import type { SlopRuleName } from "eslint-plugin-slop";

const slop = (level: "error" | "warn", ...rules: SlopRuleName[]) =>
  Object.fromEntries(
    rules.map((rule) => [`slop/${rule}`, [level, { inspection: "full" }]] as const),
  );

/** What a call site may do to a web component (shadcn contract, same as chat and siva). */
const callSiteMayDo = [
  "layout",
  "truncate",
  "tabular-nums",
  "text-muted-foreground",
  "hover:text-foreground",
  "text-destructive",
  "opacity-0",
  "opacity-100",
  "transition-opacity",
];

/** Server and Node code that client code (web, app) must never import at runtime. */
const serverOnly = {
  group: [
    "@slipstream/server",
    "@slipstream/server/**",
    "@slipstream/recorder",
    "@slipstream/recorder/**",
    "node:*",
    "drizzle-orm",
    "drizzle-orm/**",
  ],
  message: "Client code cannot import server code. Talk to the server through @slipstream/api.",
  allowTypeImports: true,
};

const phoneTvMessage =
  "Phone and TV code share through src/ outside both (ui, data, recordings, routes); see src/README.md.";

export default defineConfig({
  plugins: ["typescript", "react", "import", "unicorn", "oxc", "vitest"],
  jsPlugins: ["eslint-plugin-slop", "@shadcn/lint", "./lint/i18n.mjs"],
  categories: { correctness: "error", suspicious: "warn", perf: "warn" },
  env: { browser: true, node: true, es2024: true },
  rules: {
    "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    // Effect's discriminant and TanStack Router's history key are names others fix.
    "no-underscore-dangle": ["warn", { allow: ["_tag", "__TSR_index"] }],
    // Both ask for in-place mutation, the opposite of the immutable updates used throughout.
    "oxc/no-map-spread": "off",
    "oxc/no-accumulating-spread": "off",
    // Ordered async loops are chosen on purpose; concurrency goes through Effect.forEach.
    "no-await-in-loop": "off",
    "import/no-cycle": "error",
    "import/no-unassigned-import": "off",
    // Type-aware (oxlint-tsgolint, run with --type-aware): what types can prove wrong is never a
    // judgement call.
    "typescript/no-floating-promises": "error",
    "typescript/no-misused-promises": "error",
    "typescript/await-thenable": "error",
    "typescript/switch-exhaustiveness-check": "error",
    // `return yield* Effect.fail(...)` beside a plain `return` is how an Effect generator exits early.
    "typescript/consistent-return": "off",
    "typescript/no-unsafe-type-assertion": "off",
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn",
    "react/react-in-jsx-scope": "off",
    // Code React Compiler cannot compile is left as written, unmemoized and unnoticed.
    "react/unsupported-syntax": "error",
    "react/only-export-components": "warn",
    ...slop(
      "error",
      "no-em-dash",
      "no-jargon",
      "max-comment-length",
      "no-trivial-functions",
      "no-trivial-type-aliases",
      "no-static-only-class",
      "no-chained-type-assertions",
    ),
    ...slop("warn", "prefer-jsdoc"),
  },
  overrides: [
    {
      files: ["apps/web/src/**", "apps/app/src/**", "apps/app/app/**"],
      rules: { "typescript/no-restricted-imports": ["error", { patterns: [serverOnly] }] },
    },
    {
      // The app's phone and TV screens share code only through the folders outside both.
      files: ["apps/app/src/phone/**"],
      rules: {
        "typescript/no-restricted-imports": [
          "error",
          { patterns: [serverOnly, { group: ["**/tv/**"], message: phoneTvMessage }] },
        ],
      },
    },
    {
      files: ["apps/app/src/tv/**"],
      rules: {
        "typescript/no-restricted-imports": [
          "error",
          { patterns: [serverOnly, { group: ["**/phone/**"], message: phoneTvMessage }] },
        ],
      },
    },
    {
      // Domain is pure: schemas and logic that every package (server, web, app) shares. The TV
      // guide's core in the app is held to the same rule, so it stays testable without a device.
      // Last, so the app's own overrides above never replace it.
      files: ["packages/domain/src/**", "apps/app/src/tv/guide/core/**"],
      rules: {
        "typescript/no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: [
                  "**",
                  "!effect",
                  "!effect/**",
                  "!./**",
                  "!../**",
                  "!@slipstream/domain",
                  "!@slipstream/domain/**",
                ],
                message: "Pure modules import only effect, the domain and their own files.",
              },
            ],
          },
        ],
      },
    },
    {
      // The core's tests sit beside it and add the test runner.
      files: ["apps/app/src/tv/guide/core/**/*.test.ts"],
      rules: {
        "typescript/no-restricted-imports": [
          "error",
          { patterns: [serverOnly, { group: ["**/phone/**"], message: phoneTvMessage }] },
        ],
      },
    },
    {
      // Words a person reads come from messages, English included.
      // JSX in .tsx; toasts and date and number formatting in plain .ts modules too.
      files: [
        "apps/web/src/**/*.{ts,tsx}",
        "apps/app/src/**/*.{ts,tsx}",
        "apps/app/app/**/*.{ts,tsx}",
      ],
      rules: { "i18n/no-literal-text": "error", "i18n/format-locale": "error" },
    },
    {
      // Web styling goes through the design system (shadcn on Base UI).
      files: ["apps/web/src/**/*.tsx"],
      rules: {
        "shadcn/no-restyle": ["error", { allow: callSiteMayDo }],
        "shadcn/no-raw-colors": "error",
        "shadcn/no-unknown-classes": "error",
      },
    },
    {
      // Generated from the shadcn registry; edits would be lost on regenerate.
      files: ["apps/web/src/ui/primitives/**"],
      rules: {
        "no-shadow": "off",
        "no-underscore-dangle": "off",
        "react/no-unstable-nested-components": "off",
        "react/no-array-index-key": "off",
        "react/only-export-components": "off",
        "shadcn/no-restyle": "off",
      },
    },
    {
      files: ["apps/web/src/routes/**", "apps/app/app/**"],
      rules: { "react/only-export-components": "off" },
    },
    {
      files: ["**/*.test.ts", "**/*.test.tsx", "**/tests/**", "**/scripts/**", "scripts/**"],
      rules: {
        "i18n/no-literal-text": "off",
        "i18n/format-locale": "off",
        "slop/no-trivial-functions": "off",
        // @effect/vitest's it.effect / it.live / it.scoped are test blocks the vitest plugin can't see.
        "vitest/no-standalone-expect": "off",
        "vitest/expect-expect": "off",
      },
    },
  ],
  ignorePatterns: [
    "dist",
    ".output",
    ".tanstack",
    ".expo",
    "node_modules",
    "**/routeTree.gen.ts",
    "**/drizzle/**",
    "docs/**",
    "apps/app/android/**",
    "apps/app/ios/**",
  ],
});
